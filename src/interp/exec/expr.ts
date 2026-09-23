import type { BinOp, Expr, FuncSym, Init, VarSym } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import { alignOf, alignUp, compatible, sizeOf, type FunctionType, type PointerType, type Type } from '../frontend/types'
import { controlRegister } from '../runtime/cregs'
import { LoadError, type Callable, type Machine } from './machine'
import { hex } from './memory'
import { converter, isBig, isFloatKind, kindOf, kindSize, loader, storer, wrapper, zeroOf, type Kind, type Load, type Store } from './scalar'

/** A compiled expression: returns the value (number, bigint, an address for aggregates, undefined for void). */
export type Ev = () => any

/** Where the current function keeps its automatic objects, relative to the frame pointer. */
export interface FrameScope {
  offset(v: VarSym): number
  temp(size: number, align: number): number
}

type Access = 'read' | 'write' | 'none'
type Deref = Extract<Expr, { k: 'deref' }>
type PtrAdd = Extract<Expr, { k: 'ptradd' }>

const isAuto = (v: VarSym): boolean => v.storage === 'auto' || v.storage === 'param'
const isVla = (t: Type): boolean => t.kind === 'array' && !!t.vla

/** How a bounds note names an array: `y`, `s.buf`, `p->buf`; null for arrays without a simple name. */
function describe(e: Expr): string | null {
  if (e.k === 'var') return e.sym.hidden ? null : e.sym.name
  if (e.k === 'member') {
    const b = e.base
    if (b.k === 'deref' && b.arg.k === 'var') return `${b.arg.sym.name}->${e.member.name}`
    const inner = describe(b)
    return inner === null ? null : `${inner}.${e.member.name}`
  }
  return null
}

function keyOf(e: Expr): string {
  if (e.k === 'var') return `${e.sym.file}#${e.sym.id}`
  if (e.k === 'member') return `${keyOf(e.base)}.${e.member.name}`
  if (e.k === 'deref') return `*${keyOf(e.arg)}`
  return '?'
}

/** Binary arithmetic in the kind of the (converted) operands. Integer division by zero halts the target. */
export function arith(m: Machine, op: BinOp, k: Kind): (x: any, y: any) => any {
  const div0 = (): never => m.trap('Division by zero')
  if (isBig(k)) {
    const w = wrapper(k)
    const count = (y: any): bigint => BigInt(typeof y === 'bigint' ? Number(y & 63n) : y & 63)
    switch (op) {
      case '+': return (x: bigint, y: bigint) => w(x + y)
      case '-': return (x: bigint, y: bigint) => w(x - y)
      case '*': return (x: bigint, y: bigint) => w(x * y)
      case '/': return (x: bigint, y: bigint) => (y === 0n ? div0() : w(x / y))
      case '%': return (x: bigint, y: bigint) => (y === 0n ? div0() : w(x % y))
      case '<<': return (x: bigint, y) => w(x << count(y))
      case '>>': return (x: bigint, y) => w(x >> count(y))
      case '&': return (x: bigint, y: bigint) => w(x & y)
      case '|': return (x: bigint, y: bigint) => w(x | y)
      case '^': return (x: bigint, y: bigint) => w(x ^ y)
    }
  }
  if (k === 'f32') {
    switch (op) {
      case '+': return (x, y) => Math.fround(x + y)
      case '-': return (x, y) => Math.fround(x - y)
      case '*': return (x, y) => Math.fround(x * y)
      case '/': return (x, y) => Math.fround(x / y)
    }
  }
  if (k === 'f64') {
    switch (op) {
      case '+': return (x, y) => x + y
      case '-': return (x, y) => x - y
      case '*': return (x, y) => x * y
      case '/': return (x, y) => x / y
    }
  }
  if (k === 'u32' || k === 'ptr') {
    switch (op) {
      case '+': return (x, y) => (x + y) >>> 0
      case '-': return (x, y) => (x - y) >>> 0
      case '*': return (x, y) => Math.imul(x, y) >>> 0
      case '/': return (x, y) => (y === 0 ? div0() : Math.trunc(x / y))
      case '%': return (x, y) => (y === 0 ? div0() : x % y)
      case '<<': return (x, y) => (x << y) >>> 0
      case '>>': return (x, y) => x >>> y
      case '&': return (x, y) => (x & y) >>> 0
      case '|': return (x, y) => (x | y) >>> 0
      case '^': return (x, y) => (x ^ y) >>> 0
    }
  }
  switch (op) {
    case '+': return (x, y) => (x + y) | 0
    case '-': return (x, y) => (x - y) | 0
    case '*': return (x, y) => Math.imul(x, y)
    case '/': return (x, y) => (y === 0 ? div0() : (x / y) | 0)
    case '%': return (x, y) => (y === 0 ? div0() : (x % y) | 0)
    case '<<': return (x, y) => x << y
    case '>>': return (x, y) => x >> y
    case '&': return (x, y) => x & y
    case '|': return (x, y) => x | y
    case '^': return (x, y) => x ^ y
  }
  throw new Error(`no operator ${op} for ${k}`)
}

function unalignedLoader(m: Machine, k: Kind): Load {
  const size = kindSize(k)
  return (a) => {
    const dv = new DataView(m.mem.read(a, size).buffer)
    switch (k) {
      case 'i16': return dv.getInt16(0, true)
      case 'u16': return dv.getUint16(0, true)
      case 'i32': return dv.getInt32(0, true)
      case 'f32': return dv.getFloat32(0, true)
      case 'f64': return dv.getFloat64(0, true)
      case 'i64': return dv.getBigInt64(0, true)
      case 'u64': return dv.getBigUint64(0, true)
      case 'i8': return dv.getInt8(0)
      case 'u8':
      case 'bool': return dv.getUint8(0)
      default: return dv.getUint32(0, true)
    }
  }
}

function unalignedStorer(m: Machine, k: Kind): Store {
  const size = kindSize(k)
  return (a, v) => {
    const bytes = new Uint8Array(size)
    const dv = new DataView(bytes.buffer)
    switch (k) {
      case 'i16':
      case 'u16': dv.setInt16(0, v, true); break
      case 'f32': dv.setFloat32(0, v, true); break
      case 'f64': dv.setFloat64(0, v, true); break
      case 'i64':
      case 'u64': dv.setBigInt64(0, v, true); break
      case 'i8':
      case 'u8':
      case 'bool': dv.setInt8(0, v); break
      default: dv.setInt32(0, v, true)
    }
    m.mem.write(a, bytes)
  }
}

interface VaSlot {
  off: number
  size: number
  align: number
  value: Ev
  store: Store
}

/** Compiles expressions of one function into closures. */
export class ExprCompiler {
  constructor(
    private readonly m: Machine,
    private readonly scope: FrameScope
  ) {}

  value(e: Expr): Ev {
    switch (e.k) {
      case 'int': {
        const c = converter('i64', kindOf(e.type))
        const raw = BigInt.asIntN(64, e.value)
        const v = c ? c(raw) : raw
        return () => v
      }
      case 'float': {
        const v = kindOf(e.type) === 'f32' ? Math.fround(e.value) : e.value
        return () => v
      }
      case 'string': {
        const a = this.m.placement.stringAddress(e)
        return () => a
      }
      case 'var':
        return this.variable(e.sym)
      case 'func':
        return this.functionValue(e.sym, e.loc)
      case 'unary':
        return this.unary(e)
      case 'deref':
        return this.deref(e)
      case 'addr':
        return e.arg.k === 'func' ? this.functionValue(e.arg.sym, e.loc) : this.address(e.arg, 'none')
      case 'binary':
        return this.binary(e)
      case 'ptradd': {
        const p = this.value(e.ptr)
        const i = this.index(e.index)
        const s = e.scale
        return e.sub ? () => (p() - i() * s) >>> 0 : () => (p() + i() * s) >>> 0
      }
      case 'ptrdiff': {
        const a = this.value(e.left)
        const b = this.value(e.right)
        const s = e.scale
        return () => Math.trunc(((a() - b()) | 0) / s) | 0
      }
      case 'logical': {
        const a = this.truth(e.left)
        const b = this.truth(e.right)
        return e.op === '&&' ? () => (a() && b() ? 1 : 0) : () => (a() || b() ? 1 : 0)
      }
      case 'assign':
        return this.assign(e)
      case 'compound':
        return this.compound(e)
      case 'incdec':
        return this.incdec(e)
      case 'cond': {
        const t = this.truth(e.test)
        const a = this.value(e.then)
        const b = this.value(e.else)
        return () => (t() ? a() : b())
      }
      case 'comma': {
        const a = this.value(e.left)
        const b = this.value(e.right)
        return () => {
          a()
          return b()
        }
      }
      case 'call':
        return this.call(e)
      case 'member':
        return this.member(e)
      case 'cast':
        return this.cast(e)
      case 'decay':
        return this.address(e.arg, 'none')
      case 'compoundLit':
        return this.compoundLiteral(e)
      case 'vaStart': {
        const ap = this.address(e.ap, 'write')
        const m = this.m
        return () => {
          m.mem.set32(ap(), m.va)
          return undefined
        }
      }
      case 'vaArg':
        return this.vaArg(e)
      case 'error':
        throw new LoadError('LabSim: the program has an expression with errors', e.loc)
    }
  }

  /** A controlling expression: true when the scalar is non-zero (NaN counts as non-zero, as in C). */
  truth(e: Expr): () => boolean {
    const v = this.value(e)
    return isBig(kindOf(e.type)) ? () => v() !== 0n : () => v() !== 0
  }

  /** The address of an lvalue, or of an aggregate value. `access` decides which bounds note an array index gives. */
  address(e: Expr, access: Access): Ev {
    switch (e.k) {
      case 'var':
        return this.varAddress(e.sym)
      case 'deref':
        return this.derefAddress(e, access)
      case 'member': {
        const base = this.address(e.base, access)
        const off = e.member.offset
        return off === 0 ? base : () => base() + off
      }
      case 'string': {
        const a = this.m.placement.stringAddress(e)
        return () => a
      }
      case 'compoundLit':
        return this.compoundLiteral(e)
      case 'func':
        return this.functionValue(e.sym, e.loc)
      default:
        if (kindOf(e.type) === 'agg') return this.value(e)
        throw new LoadError('LabSim: unsupported construct address of a value', e.loc)
    }
  }

  /** Stores an initialiser at a runtime address: `list` zeroes the object first, as C requires. */
  initializer(type: Type, init: Init): (addr: number) => void {
    if (init.k === 'expr') return this.initItem(type, 0, init.expr)
    const n = sizeOf(type)
    const items = init.items.map((it) => this.initItem(it.type, it.offset, it.expr))
    const mem = this.m.mem
    return (a) => {
      mem.fill(a, 0, n)
      for (let i = 0; i < items.length; i++) items[i](a)
    }
  }

  private initItem(type: Type, off: number, e: Expr): (addr: number) => void {
    const mem = this.m.mem
    if (e.k === 'string' && type.kind === 'array') {
      const bytes = e.bytes.slice(0, sizeOf(type))
      return (a) => mem.write(a + off, bytes)
    }
    const k = kindOf(type)
    const v = this.value(e)
    if (k === 'agg') {
      const n = sizeOf(type)
      return (a) => mem.copy(a + off, v(), n)
    }
    const st = storer(mem, k)
    return (a) => st(a + off, v())
  }

  private index(e: Expr): () => number {
    const v = this.value(e)
    return isBig(kindOf(e.type)) ? () => Number(BigInt.asIntN(32, v())) : v
  }

  private varAddress(v: VarSym): Ev {
    const m = this.m
    if (v.cregister) throw new LoadError(`LabSim: unsupported construct address of control register ${v.name}`, v.loc)
    if (isAuto(v)) {
      const off = this.scope.offset(v)
      if (isVla(v.type)) return () => m.mem.u32(m.fp + off)
      return () => m.fp + off
    }
    const a = m.placement.objectAddress(v)
    return () => a
  }

  private variable(v: VarSym): Ev {
    const m = this.m
    if (v.cregister) {
      const r = controlRegister(m, v.name)
      return () => r.read()
    }
    const k = kindOf(v.type)
    if (k === 'agg') return this.varAddress(v)
    const ld = loader(m.mem, k)
    if (isAuto(v)) {
      const off = this.scope.offset(v)
      return () => ld(m.fp + off)
    }
    const a = m.placement.objectAddress(v)
    return () => ld(a)
  }

  private functionValue(f: FuncSym, at: Loc): Ev {
    this.m.resolve(f, at)
    const a = this.m.placement.functionAddress(f)
    return () => a
  }

  private unary(e: Extract<Expr, { k: 'unary' }>): Ev {
    if (e.op === '!') {
      const t = this.truth(e.arg)
      return () => (t() ? 0 : 1)
    }
    const a = this.value(e.arg)
    if (e.op === '+') return a
    const k = kindOf(e.type)
    if (isBig(k)) {
      const w = wrapper(k)
      return e.op === '-' ? () => w(-(a() as bigint)) : () => w(~(a() as bigint))
    }
    if (e.op === '-') {
      if (isFloatKind(k)) return () => -a()
      return k === 'u32' ? () => -a() >>> 0 : () => -a() | 0
    }
    return k === 'u32' ? () => ~a() >>> 0 : () => ~a()
  }

  private deref(e: Deref): Ev {
    const k = kindOf(e.type)
    if (k === 'agg' || k === 'void') return this.derefAddress(e, 'none')
    const ld = e.unaligned ? unalignedLoader(this.m, k) : loader(this.m.mem, k)
    const a = this.derefAddress(e, 'read')
    return () => ld(a())
  }

  private derefAddress(e: Deref, access: Access): Ev {
    const arg = e.arg
    if (access !== 'none' && arg.k === 'ptradd' && arg.ptr.k === 'decay') {
      const arr = arg.ptr.arg
      const name = describe(arr)
      if (name !== null && arr.type.kind === 'array' && arr.type.length !== null && !arr.type.vla) {
        return this.checkedElement(arr, name, arr.type.length, arg, access)
      }
    }
    return this.value(arg)
  }

  /** `a[i]` on a named array: a one-time note when i is outside it; the access still happens, as on the hardware. */
  private checkedElement(arr: Expr, name: string, length: number, add: PtrAdd, access: 'read' | 'write'): Ev {
    const base = this.address(arr, 'none')
    const idx = this.index(add.index)
    const scale = add.scale
    const sign = add.sub ? -1 : 1
    const m = this.m
    const key = `${keyOf(arr)}:${access}`
    return () => {
      const i = sign * idx()
      if (i < 0 || i >= length) {
        m.note(`${key}:${i < 0}`, `${access} ${i < 0 ? 'before start' : 'past end'} of '${name}' (${name}[${i}], size ${length})`)
      }
      return (base() + i * scale) >>> 0
    }
  }

  private member(e: Extract<Expr, { k: 'member' }>): Ev {
    const k = kindOf(e.type)
    if (k === 'agg') return this.address(e, 'none')
    const a = this.address(e, 'read')
    const ld = loader(this.m.mem, k)
    return () => ld(a())
  }

  private binary(e: Extract<Expr, { k: 'binary' }>): Ev {
    const a = this.value(e.left)
    let b = this.value(e.right)
    const op = e.op
    switch (op) {
      case '<': return () => (a() < b() ? 1 : 0)
      case '>': return () => (a() > b() ? 1 : 0)
      case '<=': return () => (a() <= b() ? 1 : 0)
      case '>=': return () => (a() >= b() ? 1 : 0)
      case '==': return () => (a() === b() ? 1 : 0)
      case '!=': return () => (a() !== b() ? 1 : 0)
    }
    const k = kindOf(e.type)
    if (k === 'i32') {
      if (op === '+') return () => (a() + b()) | 0
      if (op === '-') return () => (a() - b()) | 0
      if (op === '*') return () => Math.imul(a(), b())
    } else if (k === 'f64') {
      if (op === '+') return () => a() + b()
      if (op === '-') return () => a() - b()
      if (op === '*') return () => a() * b()
      if (op === '/') return () => a() / b()
    } else if (k === 'f32') {
      if (op === '+') return () => Math.fround(a() + b())
      if (op === '-') return () => Math.fround(a() - b())
      if (op === '*') return () => Math.fround(a() * b())
      if (op === '/') return () => Math.fround(a() / b())
    }
    if ((op === '<<' || op === '>>') && !isBig(k) && isBig(kindOf(e.right.type))) {
      const r = b
      b = () => Number(BigInt.asUintN(6, r()))
    }
    const f = arith(this.m, op, k)
    return () => f(a(), b())
  }

  private cast(e: Extract<Expr, { k: 'cast' }>): Ev {
    const a = this.value(e.arg)
    if (e.type.kind === 'void') {
      return () => {
        a()
        return undefined
      }
    }
    const c = converter(kindOf(e.arg.type), kindOf(e.type))
    return c ? () => c(a()) : a
  }

  private assign(e: Extract<Expr, { k: 'assign' }>): Ev {
    const m = this.m
    const t = e.target
    const v = this.value(e.value)
    if (t.k === 'var' && t.sym.cregister) {
      const r = controlRegister(m, t.sym.name)
      return () => {
        const x = v()
        r.write(x)
        return x
      }
    }
    const k = kindOf(e.type)
    if (k === 'agg') {
      const dst = this.address(t, 'write')
      const n = sizeOf(e.type)
      return () => {
        const d = dst()
        m.mem.copy(d, v(), n)
        return d
      }
    }
    const st = t.k === 'deref' && t.unaligned ? unalignedStorer(m, k) : storer(m.mem, k)
    if (t.k === 'var' && isAuto(t.sym)) {
      const off = this.scope.offset(t.sym)
      return () => {
        const x = v()
        st(m.fp + off, x)
        return x
      }
    }
    const a = this.address(t, 'write')
    return () => {
      const addr = a()
      const x = v()
      st(addr, x)
      return x
    }
  }

  /** Read-modify-write access to an lvalue, for compound assignment and ++/--. */
  private cell(t: Expr): { at: () => number; get: Load; set: Store } {
    if (t.k === 'var' && t.sym.cregister) {
      const r = controlRegister(this.m, t.sym.name)
      return { at: () => 0, get: () => r.read(), set: (_a, v) => r.write(v) }
    }
    const k = kindOf(t.type)
    const unaligned = t.k === 'deref' && !!t.unaligned
    return {
      at: this.address(t, 'write'),
      get: unaligned ? unalignedLoader(this.m, k) : loader(this.m.mem, k),
      set: unaligned ? unalignedStorer(this.m, k) : storer(this.m.mem, k)
    }
  }

  private compound(e: Extract<Expr, { k: 'compound' }>): Ev {
    const c = this.cell(e.target)
    const tk = kindOf(e.type)
    const base = e.op.slice(0, -1) as BinOp
    if (e.scale > 0 && tk === 'ptr') {
      const i = this.index(e.value)
      const s = base === '-' ? -e.scale : e.scale
      return () => {
        const a = c.at()
        const r = (c.get(a) + i() * s) >>> 0
        c.set(a, r)
        return r
      }
    }
    let v = this.value(e.value)
    const ok = kindOf(e.opType)
    if ((base === '<<' || base === '>>') && !isBig(ok) && isBig(kindOf(e.value.type))) {
      const r = v
      v = () => Number(BigInt.asUintN(6, r()))
    }
    const toOp = converter(tk, ok)
    const back = converter(ok, tk)
    const f = arith(this.m, base, ok)
    return () => {
      const a = c.at()
      let x = c.get(a)
      if (toOp) x = toOp(x)
      let r = f(x, v())
      if (back) r = back(r)
      c.set(a, r)
      return r
    }
  }

  private incdec(e: Extract<Expr, { k: 'incdec' }>): Ev {
    const m = this.m
    const k = kindOf(e.type)
    const d = e.op === '++' ? 1 : -1
    const t = e.target
    if (k === 'i32' && t.k === 'var' && isAuto(t.sym)) {
      const off = this.scope.offset(t.sym)
      return e.prefix
        ? () => {
            const a = m.fp + off
            const n = (m.mem.i32(a) + d) | 0
            m.mem.set32(a, n)
            return n
          }
        : () => {
            const a = m.fp + off
            const o = m.mem.i32(a)
            m.mem.set32(a, (o + d) | 0)
            return o
          }
    }
    let step: (x: any) => any
    if (k === 'ptr') {
      const s = d * e.scale
      step = (x) => (x + s) >>> 0
    } else if (isBig(k)) {
      const w = wrapper(k)
      const b = BigInt(d)
      step = (x) => w(x + b)
    } else if (k === 'f32') step = (x) => Math.fround(x + d)
    else if (k === 'f64') step = (x) => x + d
    else if (k === 'i32') step = (x) => (x + d) | 0
    else if (k === 'u32') step = (x) => (x + d) >>> 0
    else {
      const back = converter('i32', k) as (v: any) => any
      step = (x) => back((x + d) | 0)
    }
    const c = this.cell(t)
    return e.prefix
      ? () => {
          const a = c.at()
          const n = step(c.get(a))
          c.set(a, n)
          return n
        }
      : () => {
          const a = c.at()
          const o = c.get(a)
          c.set(a, step(o))
          return o
        }
  }

  private call(e: Extract<Expr, { k: 'call' }>): Ev {
    const m = this.m
    const direct = e.callee.k === 'addr' && e.callee.arg.k === 'func' ? e.callee.arg.sym : null
    const site = (e.callee.type as PointerType).to as FunctionType
    const target = direct ? m.resolve(direct, e.loc) : null
    // A call through an implicit declaration (or a prototype of its own) converts to the callee's real types.
    const real = target?.type && !compatible(target.type, site) ? target.type : null
    const fixed = target ? target.fixed : site.variadic ? site.params.length : e.args.length
    const named: Ev[] = e.args.slice(0, fixed).map((a, i) => {
      const v = this.value(a)
      const to = real?.params[i]?.type
      const c = to ? converter(kindOf(a.type), kindOf(to)) : null
      return c ? () => c(v()) : v
    })
    const extras = e.args.slice(fixed).map((a) => this.vaSlot(a))
    let vaSize = 0
    for (const s of extras) {
      vaSize = alignUp(vaSize, s.align)
      s.off = vaSize
      vaSize += alignUp(s.size, 4)
    }
    vaSize = alignUp(vaSize, 8)
    const retKind = kindOf(e.type)
    const retOff = retKind === 'agg' ? this.scope.temp(sizeOf(e.type), Math.max(alignOf(e.type), 4)) : -1
    const back = real ? converter(kindOf(real.ret), retKind) : null
    const zero = zeroOf(retKind)
    const callee = target ? (): Callable => target : this.pointerCallee(e.callee)
    const n = named.length
    const invoke = (): any => {
      const c = callee()
      const args = new Array(n)
      for (let i = 0; i < n; i++) args[i] = named[i]()
      const retBuf = retOff >= 0 ? m.fp + retOff : 0
      if (extras.length === 0) return c.invoke(args, 0, retBuf)
      const values = extras.map((s) => s.value())
      const sp = m.sp
      const va = sp - vaSize
      if (va < m.stackLow) m.trap(`Stack overflow passing arguments to ${c.name}()`)
      m.sp = va
      for (let i = 0; i < extras.length; i++) extras[i].store(va + extras[i].off, values[i])
      const r = c.invoke(args, va, retBuf)
      m.sp = sp
      return r
    }
    if (retKind === 'void') return invoke
    if (retKind === 'agg') {
      return () => {
        invoke()
        return m.fp + retOff
      }
    }
    return () => {
      let r = invoke()
      if (r === undefined) r = zero
      return back ? back(r) : r
    }
  }

  private pointerCallee(e: Expr): () => Callable {
    const f = this.value(e)
    const m = this.m
    return () => {
      const a = f()
      const c = m.functions.get(a)
      if (!c) return m.trap(`Call through an invalid function pointer (0x${hex(a)})`)
      return c
    }
  }

  /** A variadic argument: in memory below sp, aligned to its size (at least 4), as the C6000 EABI passes them. */
  private vaSlot(a: Expr): VaSlot {
    const k = kindOf(a.type)
    const value = this.value(a)
    if (k === 'agg') {
      const n = sizeOf(a.type)
      const mem = this.m.mem
      return { off: 0, size: n, align: Math.max(4, alignOf(a.type)), value, store: (addr, v) => mem.copy(addr, v, n) }
    }
    const size = kindSize(k)
    return { off: 0, size, align: Math.max(4, size), value, store: storer(this.m.mem, k) }
  }

  private vaArg(e: Extract<Expr, { k: 'vaArg' }>): Ev {
    const k = kindOf(e.type)
    const size = k === 'agg' ? sizeOf(e.type) : kindSize(k)
    const align = Math.max(4, k === 'agg' ? alignOf(e.type) : size)
    const ap = this.address(e.ap, 'write')
    const ld = loader(this.m.mem, k)
    const mem = this.m.mem
    return () => {
      const cell = ap()
      const p = alignUp(mem.u32(cell), align)
      mem.set32(cell, p + alignUp(size, 4))
      return ld(p)
    }
  }

  private compoundLiteral(e: Extract<Expr, { k: 'compoundLit' }>): Ev {
    const v = e.obj
    if (!isAuto(v)) {
      const a = this.m.placement.objectAddress(v)
      return () => a
    }
    const off = this.scope.offset(v)
    const init = this.initializer(v.type, e.init)
    const m = this.m
    return () => {
      const a = m.fp + off
      init(a)
      return a
    }
  }
}
