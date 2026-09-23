import type { Block, FunctionDef, Stmt, VarSym } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import { alignOf, alignUp, sizeOf, type ArrayType, type FunctionType } from '../frontend/types'
import { ExprCompiler, type FrameScope } from './expr'
import { LoadError, type Callable, type Machine } from './machine'
import { converter, isBig, kindOf, storer, zeroOf, type Store } from './scalar'

/** How a statement completed. */
export const NORMAL = 0
export const BREAK = 1
export const CONTINUE = 2
export const RETURN = 3
export const GOTO = 4

type Exec = () => number

const isVlaVar = (v: VarSym): boolean => v.type.kind === 'array' && !!v.type.vla

function stackOverflow(m: Machine, fn: string): string {
  const size = (m.stackTop - m.stackLow).toString(16)
  return `Stack overflow in ${fn}(): .stack (0x${size} bytes) is full. Make big local arrays global or static, or raise the stack size.`
}

/** One function's frame: a slot for every parameter, automatic variable and compound literal, plus temporaries. */
class FrameLayout implements FrameScope {
  size = 0
  private readonly offsets = new Map<VarSym, number>()

  constructor(def: FunctionDef) {
    for (const v of [...def.params, ...def.locals]) {
      const vla = isVlaVar(v)
      this.offsets.set(v, this.temp(vla ? 4 : Math.max(sizeOf(v.type), 1), vla ? 4 : alignOf(v.type)))
    }
  }

  offset(v: VarSym): number {
    const o = this.offsets.get(v)
    if (o === undefined) throw new LoadError(`LabSim: no stack slot for '${v.name}'`, v.loc)
    return o
  }

  temp(size: number, align: number): number {
    this.size = alignUp(this.size, align)
    const o = this.size
    this.size += size
    return o
  }
}

/** Labels that are statements of this list, directly or behind case/default/label prefixes: name → index. */
function directLabels(list: Stmt[]): Map<string, number> {
  const out = new Map<string, number>()
  list.forEach((s, i) => {
    let x: Stmt = s
    while (x.k === 'label' || x.k === 'case' || x.k === 'default') {
      if (x.k === 'label') out.set(x.name, i)
      x = x.body
    }
  })
  return out
}

function runFrom(m: Machine, list: Exec[], labels: Map<string, number>, start: number): number {
  for (let i = start; i < list.length; i++) {
    const c = list[i]()
    if (c === NORMAL) continue
    if (c === GOTO) {
      const j = labels.get(m.gotoLabel)
      if (j !== undefined) {
        i = j - 1
        continue
      }
    }
    return c
  }
  return NORMAL
}

class StmtCompiler {
  /** Labels of the enclosing blocks: where a goto compiled now may jump. */
  private readonly scopes: Set<string>[] = []

  constructor(
    private readonly m: Machine,
    private readonly ex: ExprCompiler,
    private readonly frame: FrameLayout
  ) {}

  stmt(s: Stmt): Exec {
    const m = this.m
    const loc = s.loc
    switch (s.k) {
      case 'expr': {
        const e = this.ex.value(s.expr)
        return () => {
          m.loc = loc
          if (++m.ops >= m.limit) m.poll()
          e()
          return NORMAL
        }
      }
      case 'decl':
        return this.decl(s.vars, loc)
      case 'block':
        return this.block(s)
      case 'if': {
        const t = this.ex.truth(s.test)
        const a = this.stmt(s.then)
        const b = s.else ? this.stmt(s.else) : null
        return () => {
          m.loc = loc
          if (++m.ops >= m.limit) m.poll()
          return t() ? a() : b ? b() : NORMAL
        }
      }
      case 'while': {
        const t = this.ex.truth(s.test)
        const body = this.stmt(s.body)
        return () => {
          for (;;) {
            m.loc = loc
            if (++m.ops >= m.limit) m.poll()
            if (!t()) return NORMAL
            const c = body()
            if (c === BREAK) return NORMAL
            if (c !== NORMAL && c !== CONTINUE) return c
          }
        }
      }
      case 'do': {
        const t = this.ex.truth(s.test)
        const body = this.stmt(s.body)
        const at = s.test.loc
        return () => {
          for (;;) {
            const c = body()
            if (c === BREAK) return NORMAL
            if (c !== NORMAL && c !== CONTINUE) return c
            m.loc = at
            if (++m.ops >= m.limit) m.poll()
            if (!t()) return NORMAL
          }
        }
      }
      case 'for':
        return this.forLoop(s)
      case 'switch':
        return this.switchStmt(s)
      case 'case':
      case 'default':
      case 'label':
        return this.stmt(s.body)
      case 'break':
        return this.jump(loc, BREAK)
      case 'continue':
        return this.jump(loc, CONTINUE)
      case 'return':
        return this.returnStmt(s)
      case 'goto': {
        const label = s.label
        if (!this.scopes.some((sc) => sc.has(label))) throw new LoadError('LabSim: unsupported construct goto into a nested block', loc)
        return () => {
          m.loc = loc
          if (++m.ops >= m.limit) m.poll()
          m.gotoLabel = label
          return GOTO
        }
      }
      case 'empty':
        return () => NORMAL
    }
  }

  private jump(loc: Loc, code: number): Exec {
    const m = this.m
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      return code
    }
  }

  private block(s: Block): Exec {
    const m = this.m
    const labels = directLabels(s.body)
    this.scopes.push(new Set(labels.keys()))
    const list = s.body.map((x) => this.stmt(x))
    this.scopes.pop()
    const n = list.length
    const run: Exec =
      labels.size === 0
        ? () => {
            for (let i = 0; i < n; i++) {
              const c = list[i]()
              if (c !== NORMAL) return c
            }
            return NORMAL
          }
        : () => runFrom(m, list, labels, 0)
    // A variable-length array lives until the end of its block.
    if (!s.body.some((x) => x.k === 'decl' && x.vars.some(isVlaVar))) return run
    return () => {
      const sp = m.sp
      const c = run()
      m.sp = sp
      return c
    }
  }

  private decl(vars: VarSym[], loc: Loc): Exec {
    const m = this.m
    const steps = vars.map((v) => this.declStep(v)).filter((f): f is () => void => f !== null)
    if (steps.length === 0) return () => NORMAL
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      for (let i = 0; i < steps.length; i++) steps[i]()
      return NORMAL
    }
  }

  private declStep(v: VarSym): (() => void) | null {
    const m = this.m
    const off = this.frame.offset(v)
    if (isVlaVar(v)) {
      const t = v.type as ArrayType
      const len = t.vla?.len
      const elem = sizeOf(t.of)
      if (!len || elem === 0) throw new LoadError('LabSim: unsupported construct multi-dimensional variable-length array', v.loc)
      const lenOff = this.frame.offset(len)
      return () => {
        const bytes = alignUp(m.mem.u32(m.fp + lenOff) * elem, 8)
        const p = m.sp - bytes
        if (p < m.stackLow) m.trap(stackOverflow(m, m.frames.at(-1)?.fn.sym.name ?? '?'))
        m.sp = p
        m.mem.set32(m.fp + off, p)
      }
    }
    if (!v.init) return null
    const init = this.ex.initializer(v.type, v.init)
    return () => init(m.fp + off)
  }

  private forLoop(s: Extract<Stmt, { k: 'for' }>): Exec {
    const m = this.m
    const loc = s.loc
    const init = s.init ? this.stmt(s.init) : null
    const t = s.test ? this.ex.truth(s.test) : null
    const step = s.step ? this.ex.value(s.step) : null
    const body = this.stmt(s.body)
    return () => {
      if (init) {
        const c = init()
        if (c !== NORMAL) return c
      }
      for (;;) {
        m.loc = loc
        if (++m.ops >= m.limit) m.poll()
        if (t && !t()) return NORMAL
        const c = body()
        if (c === BREAK) return NORMAL
        if (c !== NORMAL && c !== CONTINUE) return c
        if (step) step()
      }
    }
  }

  private switchStmt(s: Extract<Stmt, { k: 'switch' }>): Exec {
    const m = this.m
    const loc = s.loc
    const test = this.ex.value(s.test)
    const kind = kindOf(s.test.type)
    const key = converter('i64', kind)
    const list = s.body.k === 'block' ? s.body.body : [s.body]
    const entries = new Map<number | bigint, number>()
    let dflt = -1
    list.forEach((st, i) => {
      let x: Stmt = st
      while (x.k === 'label' || x.k === 'case' || x.k === 'default') {
        if (x.k === 'case') {
          const raw = BigInt.asIntN(64, x.value)
          entries.set(key ? key(raw) : raw, i)
        }
        if (x.k === 'default') dflt = i
        x = x.body
      }
    })
    if (entries.size !== s.cases.length || (s.default !== null && dflt < 0)) {
      throw new LoadError('LabSim: unsupported construct case label inside a nested statement', loc)
    }
    const labels = directLabels(list)
    this.scopes.push(new Set(labels.keys()))
    const code = list.map((x) => this.stmt(x))
    this.scopes.pop()
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      const start = entries.get(test()) ?? dflt
      if (start < 0) return NORMAL
      const c = runFrom(m, code, labels, start)
      return c === BREAK ? NORMAL : c
    }
  }

  private returnStmt(s: Extract<Stmt, { k: 'return' }>): Exec {
    const m = this.m
    const loc = s.loc
    const e = s.value
    if (!e) return this.jump(loc, RETURN)
    const v = this.ex.value(e)
    if (kindOf(e.type) === 'agg') {
      const n = sizeOf(e.type)
      return () => {
        m.loc = loc
        if (++m.ops >= m.limit) m.poll()
        const src = v()
        if (m.retBuf) m.mem.copy(m.retBuf, src, n)
        m.ret = m.retBuf
        return RETURN
      }
    }
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      m.ret = v()
      return RETURN
    }
  }
}

interface ParamSlot {
  off: number
  store: Store
}

/** A user function compiled to closures. `invoke` builds its frame on the simulated stack. */
export class FunctionCode implements Callable {
  readonly name: string
  readonly fixed: number
  readonly variadic: boolean
  readonly type: FunctionType
  private body: Exec
  private frameSize = 0
  private params: (ParamSlot | null)[] = []
  private zeros: (number | bigint)[] = []
  /** A 40/64-bit return type: a `return 0;` compiled as an int constant still returns a bigint. */
  private retBig = false

  constructor(
    private readonly m: Machine,
    readonly def: FunctionDef
  ) {
    this.name = def.sym.name
    this.type = def.sym.type
    this.fixed = this.type.params.length
    this.variadic = this.type.variadic
    this.body = () => {
      throw new Error(`${this.name} was called before it was compiled`)
    }
  }

  compile(): void {
    const m = this.m
    const def = this.def
    const frame = new FrameLayout(def)
    const block = new StmtCompiler(m, new ExprCompiler(m, frame), frame).stmt(def.body)
    const end = def.end
    this.body = () => {
      const c = block()
      if (c !== RETURN) {
        // Falling off the end stops at the closing brace, as CCS shows it.
        m.loc = end
        if (++m.ops >= m.limit) m.poll()
      }
      return c
    }
    let named = 0
    this.params = this.type.params.map((p): ParamSlot | null => {
      if (p.name === null) return null
      const v = def.params[named++]
      const k = kindOf(v.type)
      const off = frame.offset(v)
      if (k === 'agg') {
        const n = sizeOf(v.type)
        return { off, store: (a, x) => m.mem.copy(a, x, n) }
      }
      return { off, store: storer(m.mem, k) }
    })
    this.zeros = this.type.params.map((p) => zeroOf(kindOf(p.type)))
    this.retBig = isBig(kindOf(this.type.ret))
    this.frameSize = alignUp(frame.size, 8)
  }

  invoke(args: any[], va: number, retBuf: number): any {
    const m = this.m
    const callSite = m.loc
    const oldFp = m.fp
    const oldSp = m.sp
    const oldVa = m.va
    const oldRet = m.retBuf
    const fp = oldSp - this.frameSize
    if (fp < m.stackLow) m.trap(stackOverflow(m, this.name))
    m.fp = fp
    m.sp = fp
    m.va = va
    m.retBuf = retBuf
    m.frames.push({ fn: this.def, fp, callSite })
    const ps = this.params
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      if (p) p.store(fp + p.off, i < args.length ? args[i] : this.zeros[i])
    }
    m.ret = undefined
    this.body()
    const r = m.ret
    m.frames.pop()
    m.fp = oldFp
    m.sp = oldSp
    m.va = oldVa
    m.retBuf = oldRet
    m.loc = callSite
    return this.retBig && typeof r === 'number' ? BigInt(r) : r
  }
}
