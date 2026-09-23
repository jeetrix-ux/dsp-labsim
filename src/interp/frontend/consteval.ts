import type { Expr, FuncSym, VarSym } from './ast'
import { isFloating, isInteger, isPointer, type IntType, type Type } from './types'

export type ConstBase = VarSym | FuncSym | Extract<Expr, { k: 'string' }>

export type ConstValue =
  | { k: 'int'; value: bigint }
  | { k: 'float'; value: number }
  /** An address constant; base null is the null pointer (or an integer cast to a pointer). */
  | { k: 'addr'; base: ConstBase | null; offset: number }

export function wrapInt(v: bigint, t: IntType): bigint {
  if (t.name === '_Bool') return v !== 0n ? 1n : 0n
  return t.signed ? BigInt.asIntN(t.bits, v) : BigInt.asUintN(t.bits, v)
}

const roundTo = (v: number, t: Type): number => (t.kind === 'float' && t.name === 'float' ? Math.fround(v) : v)
const bool = (c: boolean): ConstValue => ({ k: 'int', value: c ? 1n : 0n })
const num = (v: ConstValue): number | null => (v.k === 'int' ? Number(v.value) : v.k === 'float' ? v.value : null)

function truth(v: ConstValue): boolean {
  if (v.k === 'int') return v.value !== 0n
  if (v.k === 'float') return v.value !== 0
  return v.base !== null || v.offset !== 0
}

export function evalIntConst(e: Expr): bigint | null {
  const v = evalConst(e)
  return v && v.k === 'int' ? v.value : null
}

/** The value of a constant expression, or null when it is not constant (C 6.6). */
export function evalConst(e: Expr): ConstValue | null {
  switch (e.k) {
    case 'int':
      return { k: 'int', value: isInteger(e.type) ? wrapInt(e.value, e.type) : e.value }
    case 'float':
      return { k: 'float', value: roundTo(e.value, e.type) }
    case 'cast':
      return convert(evalConst(e.arg), e.type)
    case 'unary': {
      const v = evalConst(e.arg)
      if (!v) return null
      if (e.op === '!') return bool(!truth(v))
      if (v.k === 'addr') return null
      if (v.k === 'float') return { k: 'float', value: roundTo(e.op === '-' ? -v.value : v.value, e.type) }
      const x = e.op === '-' ? -v.value : e.op === '~' ? ~v.value : v.value
      return { k: 'int', value: wrapInt(x, e.type as IntType) }
    }
    case 'binary':
      return binary(e)
    case 'logical': {
      const a = evalConst(e.left)
      if (!a) return null
      if (e.op === '&&' && !truth(a)) return bool(false)
      if (e.op === '||' && truth(a)) return bool(true)
      const b = evalConst(e.right)
      return b ? bool(truth(b)) : null
    }
    case 'cond': {
      const c = evalConst(e.test)
      return c ? evalConst(truth(c) ? e.then : e.else) : null
    }
    case 'ptradd': {
      const p = evalConst(e.ptr)
      const i = evalConst(e.index)
      if (!p || p.k !== 'addr' || !i || i.k !== 'int') return null
      const d = Number(i.value) * e.scale
      return { k: 'addr', base: p.base, offset: p.offset + (e.sub ? -d : d) }
    }
    case 'addr':
    case 'decay':
      return addressOf(e.arg)
    default:
      return null
  }
}

function addressOf(e: Expr): ConstValue | null {
  switch (e.k) {
    case 'var':
      return e.sym.storage === 'auto' || e.sym.storage === 'param' ? null : { k: 'addr', base: e.sym, offset: 0 }
    case 'func':
      return { k: 'addr', base: e.sym, offset: 0 }
    case 'string':
      return { k: 'addr', base: e, offset: 0 }
    case 'member': {
      const b = addressOf(e.base)
      return b && b.k === 'addr' ? { ...b, offset: b.offset + e.member.offset } : null
    }
    case 'deref': {
      const p = evalConst(e.arg)
      return p && p.k === 'addr' ? p : null
    }
    case 'compoundLit':
      return e.obj.storage === 'static' ? { k: 'addr', base: e.obj, offset: 0 } : null
    default:
      return null
  }
}

function convert(v: ConstValue | null, to: Type): ConstValue | null {
  if (!v) return null
  if (isInteger(to)) {
    if (v.k === 'int') return { k: 'int', value: wrapInt(v.value, to) }
    if (v.k === 'float') {
      if (to.name === '_Bool') return bool(v.value !== 0)
      return Number.isFinite(v.value) ? { k: 'int', value: wrapInt(BigInt(Math.trunc(v.value)), to) } : null
    }
    if (v.base === null) return { k: 'int', value: wrapInt(BigInt(v.offset), to) }
    return to.name === '_Bool' ? bool(true) : null
  }
  if (isFloating(to)) {
    const n = num(v)
    return n === null ? null : { k: 'float', value: roundTo(n, to) }
  }
  if (isPointer(to)) {
    if (v.k === 'int') return { k: 'addr', base: null, offset: Number(BigInt.asUintN(32, v.value)) }
    return v.k === 'addr' ? v : null
  }
  return null
}

function compare(op: string, x: number | bigint, y: number | bigint): boolean {
  switch (op) {
    case '<': return x < y
    case '>': return x > y
    case '<=': return x <= y
    case '>=': return x >= y
    case '==': return x === y
    default: return x !== y
  }
}

function binary(e: Extract<Expr, { k: 'binary' }>): ConstValue | null {
  const a = evalConst(e.left)
  const b = evalConst(e.right)
  if (!a || !b) return null
  const cmp = ['<', '>', '<=', '>=', '==', '!='].includes(e.op)
  if (a.k === 'addr' || b.k === 'addr') {
    if (a.k !== 'addr' || b.k !== 'addr' || a.base !== b.base || !cmp) return null
    return bool(compare(e.op, a.offset, b.offset))
  }
  if (a.k === 'float' || b.k === 'float') {
    const x = num(a) as number
    const y = num(b) as number
    if (cmp) return bool(compare(e.op, x, y))
    let r: number
    switch (e.op) {
      case '+': r = x + y; break
      case '-': r = x - y; break
      case '*': r = x * y; break
      case '/': r = x / y; break
      default: return null
    }
    return { k: 'float', value: roundTo(r, e.type) }
  }
  const x = a.value
  const y = b.value
  if (cmp) return bool(compare(e.op, x, y))
  const t = e.type as IntType
  let r: bigint
  switch (e.op) {
    case '+': r = x + y; break
    case '-': r = x - y; break
    case '*': r = x * y; break
    case '/':
      if (y === 0n) return null
      r = x / y
      break
    case '%':
      if (y === 0n) return null
      r = x % y
      break
    case '<<': r = x << (y & 63n); break
    case '>>': r = x >> (y & 63n); break
    case '&': r = x & y; break
    case '|': r = x | y; break
    default: r = x ^ y
  }
  return { k: 'int', value: wrapInt(r, t) }
}
