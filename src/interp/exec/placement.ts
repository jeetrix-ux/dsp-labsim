import type { Expr, FuncSym, Init, InitItem, VarSym } from '../frontend/ast'
import { evalConst, type ConstValue } from '../frontend/consteval'
import { isBuiltinFile } from '../frontend/preprocessor'
import { alignOf, sizeOf, type Type } from '../frontend/types'
import { LABSIM_REGION, LoadError, type Machine } from './machine'
import { f2big, isBig, isFloatKind, kindOf, storer, type Kind } from './scalar'

type StringExpr = Extract<Expr, { k: 'string' }>

/** Code addresses for functions the linked image has no symbol for (static and unused library functions). Unmapped. */
export const CODE_BASE = 0x71000000

/** Objects LabSim's runtime defines; its built-in headers declare them extern. */
export const LIBRARY_OBJECTS: Readonly<Record<string, { size: number; align: number }>> = {
  errno: { size: 4, align: 4 },
  _ftable: { size: 20 * 24, align: 4 }
}

/** Where everything lives: objects at the addresses the linker chose, the rest in the LabSim region. */
export class Placement {
  private next = LABSIM_REGION.origin
  private nextCode = CODE_BASE
  private readonly objects = new Map<VarSym, number>()
  private readonly globals = new Map<string, number>()
  private readonly functions = new Map<string, number>()
  private readonly staticFunctions = new Map<FuncSym, number>()
  private readonly strings = new Map<StringExpr, number>()
  private readonly constStrings = new Map<string, number>()
  /** Objects the linked image has no symbol for; LabSim placed them in its own region. */
  readonly unplaced: string[] = []

  constructor(private readonly m: Machine) {
    const { program, image } = m
    for (const u of program.units) {
      for (const v of u.objects) {
        if (v.cregister || isBuiltinFile(v.loc.file)) continue
        if (v.external) {
          const def = program.globals.get(v.name)
          if (def) this.objects.set(v, this.global(def))
          else if (LIBRARY_OBJECTS[v.name]) this.objects.set(v, this.libraryObject(v.name))
        } else {
          const sym = image.statics[v.file]?.[v.linkName]
          this.objects.set(v, sym ? sym.addr >>> 0 : this.unplacedObject(v))
        }
      }
    }
  }

  private global(def: VarSym): number {
    let a = this.globals.get(def.name)
    if (a === undefined) {
      const sym = this.m.image.globals[def.name]
      a = sym && sym.kind === 'object' ? sym.addr >>> 0 : this.unplacedObject(def)
      this.globals.set(def.name, a)
    }
    return a
  }

  private unplacedObject(v: VarSym): number {
    if (!v.hidden) this.unplaced.push(v.linkName)
    return this.alloc(Math.max(sizeOf(v.type), 1), alignOf(v.type))
  }

  /** Reserves bytes in the LabSim region. */
  alloc(size: number, align = 4): number {
    const a = Math.ceil(this.next / align) * align
    if (a + size > LABSIM_REGION.origin + LABSIM_REGION.length) throw new LoadError("LabSim: LabSim's own memory region is full", null)
    this.next = a + size
    return a
  }

  /** errno, _ftable: the runtime's own objects. */
  libraryObject(name: string): number {
    let a = this.globals.get(name)
    if (a === undefined) {
      const o = LIBRARY_OBJECTS[name]
      if (!o) throw new LoadError(`LabSim: the runtime has no object named '${name}'`, null)
      a = this.alloc(o.size, o.align)
      this.globals.set(name, a)
    }
    return a
  }

  /** Address of an object with static storage (global, file or function static, extern, static compound literal). */
  objectAddress(v: VarSym): number {
    const a = this.objects.get(v)
    if (a !== undefined) return a
    if (v.external) {
      const def = this.m.program.globals.get(v.name)
      if (def) return this.global(def)
      if (LIBRARY_OBJECTS[v.name]) return this.libraryObject(v.name)
    }
    throw new LoadError(`LabSim: no address for '${v.name}'`, v.loc)
  }

  functionAddress(f: FuncSym): number {
    if (!f.external) {
      let a = this.staticFunctions.get(f)
      if (a === undefined) {
        a = this.codeSlot()
        this.staticFunctions.set(f, a)
      }
      return a
    }
    let a = this.functions.get(f.name)
    if (a === undefined) {
      const sym = this.m.image.globals[f.name]
      a = sym && sym.kind === 'func' ? sym.addr >>> 0 : this.codeSlot()
      this.functions.set(f.name, a)
    }
    return a
  }

  private codeSlot(): number {
    const a = this.nextCode
    this.nextCode += 0x20
    return a
  }

  stringAddress(s: StringExpr): number {
    let a = this.strings.get(s)
    if (a === undefined) {
      a = this.alloc(s.bytes.length, 1)
      this.m.mem.write(a, s.bytes)
      this.strings.set(s, a)
    }
    return a
  }

  /** A constant C string owned by the runtime, such as a strerror() message. */
  constString(text: string): number {
    let a = this.constStrings.get(text)
    if (a === undefined) {
      const bytes = [...text].map((c) => c.charCodeAt(0) & 0xff)
      bytes.push(0)
      a = this.alloc(bytes.length, 1)
      this.m.mem.write(a, bytes)
      this.constStrings.set(text, a)
    }
    return a
  }

  /** Writes every static initialiser, as the RTS does from .cinit before main. Uninitialised objects stay zero. */
  initialize(): void {
    for (const u of this.m.program.units) {
      for (const v of u.objects) {
        if (!v.init || v.cregister || isBuiltinFile(v.loc.file)) continue
        this.writeInit(this.objectAddress(v), v.type, v.init)
      }
    }
  }

  writeInit(addr: number, type: Type, init: Init): void {
    if (init.k === 'expr') {
      this.writeConst(addr, type, init.expr)
      return
    }
    this.m.mem.fill(addr, 0, sizeOf(type))
    for (const it of init.items) this.writeItem(addr + it.offset, it)
  }

  private writeItem(addr: number, it: InitItem): void {
    if (it.expr.k === 'string' && it.type.kind === 'array') {
      this.m.mem.write(addr, it.expr.bytes.slice(0, sizeOf(it.type)))
      return
    }
    this.writeConst(addr, it.type, it.expr)
  }

  private writeConst(addr: number, type: Type, e: Expr): void {
    const k = kindOf(type)
    if (k === 'agg') throw new LoadError('LabSim: unsupported construct struct copy in a static initializer', e.loc)
    const v = evalConst(e)
    if (!v) throw new LoadError('LabSim: unsupported construct non-constant static initializer', e.loc)
    storer(this.m.mem, k)(addr, this.constValue(v, k))
  }

  private constValue(v: ConstValue, k: Kind): number | bigint {
    if (v.k === 'addr') {
      const b = v.base
      const base = b === null ? 0 : 'kind' in b ? (b.kind === 'var' ? this.objectAddress(b) : this.functionAddress(b)) : this.stringAddress(b)
      const a = (base + v.offset) >>> 0
      return isBig(k) ? BigInt(a) : a
    }
    if (v.k === 'float') return isBig(k) ? f2big(v.value, k === 'i40' || k === 'u40' ? 40 : 64, k[0] === 'i') : v.value
    if (isBig(k)) return v.value
    if (isFloatKind(k)) return Number(BigInt.asIntN(64, v.value))
    return Number(BigInt.asIntN(32, v.value))
  }
}
