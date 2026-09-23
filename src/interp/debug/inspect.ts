import type { AddressResult, FrameInfo, NumberFormat, VarNode } from '@shared/debug'
import { ExprCompiler, type FrameScope } from '../exec/expr'
import { LoadError, type Machine } from '../exec/machine'
import { Trap, hex } from '../exec/memory'
import type { Expr, FunctionDef, TranslationUnit, VarSym } from '../frontend/ast'
import { Diags } from '../frontend/diag'
import { parseExpression } from '../frontend/parser'
import { isLvalue } from '../frontend/sema'
import { isCharArray, isComplete, type Type } from '../frontend/types'
import { formatValue, typeName } from './format'

/** Without a frame (after the program ended) only objects with static storage have addresses. */
const NO_FRAME: FrameScope = {
  offset: (v) => {
    throw new LoadError(`'${v.name}' is not in scope`, null)
  },
  temp: () => {
    throw new LoadError('not available without a stack frame', null)
  }
}

const MAX_ELEMENTS = 1000

/** Parenthesises an expression unless it is a plain name, element or member chain. */
const wrap = (s: string): string => (/^[\w.[\]]+$/.test(s) ? s : `(${s})`)

function expandable(t: Type): boolean {
  if (t.kind === 'array') return (t.length ?? 0) > 0
  if (t.kind === 'struct' || t.kind === 'union') return (t.def.members?.length ?? 0) > 0
  if (t.kind === 'pointer') return t.to.kind !== 'void' && t.to.kind !== 'function' && isComplete(t.to)
  return false
}

const EXPR_KEYS = ['arg', 'left', 'right', 'ptr', 'index', 'target', 'value', 'test', 'then', 'else', 'callee', 'base', 'ap'] as const

function hasCall(e: Expr): boolean {
  if (e.k === 'call') return true
  const rec = e as unknown as Record<string, unknown>
  return EXPR_KEYS.some((key) => {
    const child = rec[key]
    return typeof child === 'object' && child !== null && 'k' in child && hasCall(child as Expr)
  })
}

interface Context {
  unit: TranslationUnit
  def: FunctionDef | null
  fp: number
  line: number
}

/** Looks into a paused (or finished) program: what the Debug, Variables and Expressions views show. */
export class Inspector {
  constructor(private readonly m: Machine) {}

  frames(): FrameInfo[] {
    const { m } = this
    const f = m.frames
    return f.map((_, k) => {
      const i = f.length - 1 - k
      const loc = i === f.length - 1 ? m.loc : f[i + 1].callSite
      return { index: k, name: f[i].fn.sym.name, file: loc.file, line: loc.line }
    })
  }

  variables(frame: number, formats: Record<string, NumberFormat> = {}): VarNode[] {
    const names = new Set(this.locals(this.context(frame)).map((v) => v.name))
    return [...names].map((name) => this.evaluate(frame, name, formats[name] ?? 'natural'))
  }

  evaluate(frame: number, text: string, format: NumberFormat = 'natural', name = text): VarNode {
    const base: VarNode = { name, expr: text, type: '', value: '', address: '', expandable: false }
    const r = this.compile(frame, text)
    if ('error' in r) return { ...base, error: r.error }
    const { e, ctx } = r
    return this.withFrame(ctx, (error) => ({ ...base, error }), () => {
      const ex = new ExprCompiler(this.m, ctx.def ? (this.m.scopes.get(ctx.def) ?? NO_FRAME) : NO_FRAME)
      const value = ex.value(e)()
      const address = isLvalue(e) ? (ex.address(e, 'none')() as number) : null
      let shown = formatValue(value, e.type, format)
      if (format === 'natural' && isCharArray(e.type)) shown += ` "${this.preview(value as number)}"`
      return { ...base, type: typeName(e.type), value: shown, address: address === null ? '' : `0x${hex(address)}`, expandable: expandable(e.type) }
    })
  }

  children(frame: number, text: string, formats: Record<string, NumberFormat> = {}): VarNode[] {
    const r = this.compile(frame, text)
    if ('error' in r) return []
    const t = r.e.type
    const w = wrap(text)
    const kids: [string, string][] = []
    if (t.kind === 'array') for (let i = 0; i < Math.min(t.length ?? 0, MAX_ELEMENTS); i++) kids.push([`[${i}]`, `${w}[${i}]`])
    else if (t.kind === 'struct' || t.kind === 'union') for (const mem of t.def.members ?? []) kids.push([mem.name, `${w}.${mem.name}`])
    else if (expandable(t)) kids.push([`*${text}`, `*${w}`])
    return kids.map(([name, expr]) => this.evaluate(frame, expr, formats[expr] ?? 'natural', name))
  }

  /** `expr = (value)`, then the new value; C conversions and cl6x's errors apply. */
  assign(frame: number, text: string, valueText: string): VarNode {
    const r = this.evaluate(frame, `${wrap(text)} = (${valueText})`)
    const now = this.evaluate(frame, text)
    return r.error ? { ...now, error: r.error } : now
  }

  /** A graph's Start Address: where an array or pointer points, an address constant, or where an object lives. */
  address(frame: number, text: string): AddressResult {
    if (!text.trim()) return { error: 'the Start Address is empty' }
    const r = this.compile(frame, text)
    if ('error' in r) return r
    const { e, ctx } = r
    const t = e.type
    if (t.kind === 'function' || (t.kind === 'pointer' && t.to.kind === 'function')) return { error: `'${text.trim()}' is a function` }
    const byValue = t.kind === 'array' || t.kind === 'pointer' || (t.kind === 'int' && !isLvalue(e))
    if (!byValue && !isLvalue(e)) return { error: `'${text.trim()}' is not an address or an object` }
    return this.withFrame<AddressResult>(ctx, (error) => ({ error }), () => {
      const ex = new ExprCompiler(this.m, ctx.def ? (this.m.scopes.get(ctx.def) ?? NO_FRAME) : NO_FRAME)
      const v = (byValue ? ex.value(e)() : ex.address(e, 'none')()) as number | bigint
      return { address: typeof v === 'bigint' ? Number(BigInt.asUintN(32, v)) : Number(v) >>> 0 }
    })
  }

  private context(frame: number): Context {
    const { m } = this
    const f = m.frames
    const i = f.length - 1 - frame
    if (frame < 0 || i < 0) return { unit: this.unitOf(m.program.main), def: null, fp: m.fp, line: Infinity }
    const def = f[i].fn
    const loc = i === f.length - 1 ? m.loc : f[i + 1].callSite
    return { unit: this.unitOf(def), def, fp: f[i].fp, line: loc.line }
  }

  private unitOf(def: FunctionDef): TranslationUnit {
    return this.m.program.units.find((u) => u.functions.includes(def)) ?? this.m.program.units[0]
  }

  /** Parameters, local statics, then the locals declared up to the frame's line (a later one shadows an earlier one). */
  private locals(ctx: Context): VarSym[] {
    if (!ctx.def) return []
    const named = (v: VarSym): boolean => !v.hidden && v.name !== ''
    return [...ctx.def.params, ...ctx.def.statics.filter(named), ...ctx.def.locals.filter((v) => named(v) && v.loc.line <= ctx.line)]
  }

  private compile(frame: number, text: string): { e: Expr; ctx: Context } | { error: string } {
    const ctx = this.context(frame)
    const diags = new Diags([])
    const e = parseExpression(text, ctx.unit, this.locals(ctx), diags)
    const err = diags.list.find((d) => d.severity === 'error')
    if (!e || err) return { error: err?.message ?? 'not a C expression' }
    if (hasCall(e)) return { error: 'LabSim does not call functions from the Expressions view' }
    return { e, ctx }
  }

  /** Runs `run` with the frame pointer of the frame and without bounds notes; runtime errors go to `fail`. */
  private withFrame<T>(ctx: Context, fail: (message: string) => T, run: () => T): T {
    const m = this.m
    const fp = m.fp
    const note = m.note
    m.fp = ctx.fp
    m.note = () => {}
    try {
      return run()
    } catch (err) {
      if (err instanceof Trap || err instanceof LoadError) return fail(err.message)
      throw err
    } finally {
      m.fp = fp
      m.note = note
    }
  }

  private preview(addr: number): string {
    let s = ''
    for (let i = 0; i < 64; i++) {
      const b = this.m.mem.peek(addr + i, 1)
      if (!b || b[0] === 0) return s
      const c = b[0]
      s += c >= 32 && c < 127 && c !== 34 && c !== 92 ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, '0')}`
    }
    return `${s}…`
  }
}
