import { M, type Diags, type Loc } from './diag'
import type { Token } from './lexer'
import { parseChar, parseNumber } from './literals'

interface Val {
  v: bigint
  u: boolean
}

class Fail extends Error {}

const BINARY: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10
}

/** Evaluates a #if expression (macros expanded, `defined` replaced) in 64-bit intmax_t arithmetic. */
export function evalPpExpr(toks: Token[], diags: Diags, at: Loc): boolean {
  const p = new PpExpr(toks, diags, at)
  try {
    const v = p.cond(true)
    if (!p.done()) throw new Fail()
    return v.v !== 0n
  } catch (e) {
    if (!(e instanceof Fail)) throw e
    diags.error(at, M.expectedExpression())
    return false
  }
}

const wrap = (v: bigint, u: boolean): Val => ({ v: u ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v), u })
const bool = (c: boolean): Val => ({ v: c ? 1n : 0n, u: false })

class PpExpr {
  private i = 0

  constructor(
    private readonly toks: Token[],
    private readonly diags: Diags,
    private readonly at: Loc
  ) {}

  done(): boolean {
    return this.i >= this.toks.length
  }

  private peek(): Token | undefined {
    return this.toks[this.i]
  }

  cond(live: boolean): Val {
    const c = this.binary(1, live)
    if (this.peek()?.text !== '?') return c
    this.i++
    const a = this.cond(live && c.v !== 0n)
    if (this.peek()?.text !== ':') throw new Fail()
    this.i++
    const b = this.cond(live && c.v === 0n)
    return wrap(c.v !== 0n ? a.v : b.v, a.u || b.u)
  }

  private binary(min: number, live: boolean): Val {
    let left = this.unary(live)
    for (;;) {
      const op = this.peek()
      const prec = op && op.kind === 'punct' ? BINARY[op.text] : undefined
      if (!op || prec === undefined || prec < min) return left
      this.i++
      const rightLive = op.text === '&&' ? live && left.v !== 0n : op.text === '||' ? live && left.v === 0n : live
      const right = this.binary(prec + 1, rightLive)
      left = this.apply(op.text, left, right, rightLive)
    }
  }

  private apply(op: string, a: Val, b: Val, live: boolean): Val {
    const u = a.u || b.u
    const x = u ? BigInt.asUintN(64, a.v) : a.v
    const y = u ? BigInt.asUintN(64, b.v) : b.v
    switch (op) {
      case '||': return bool(a.v !== 0n || b.v !== 0n)
      case '&&': return bool(a.v !== 0n && b.v !== 0n)
      case '|': return wrap(x | y, u)
      case '^': return wrap(x ^ y, u)
      case '&': return wrap(x & y, u)
      case '==': return bool(x === y)
      case '!=': return bool(x !== y)
      case '<': return bool(x < y)
      case '>': return bool(x > y)
      case '<=': return bool(x <= y)
      case '>=': return bool(x >= y)
      case '<<': return wrap(a.v << (b.v & 63n), a.u)
      case '>>': return wrap((a.u ? BigInt.asUintN(64, a.v) : a.v) >> (b.v & 63n), a.u)
      case '+': return wrap(x + y, u)
      case '-': return wrap(x - y, u)
      case '*': return wrap(x * y, u)
      default:
        if (y === 0n) {
          if (live) this.diags.error(this.at, M.ppDivByZero())
          return { v: 0n, u }
        }
        return wrap(op === '/' ? x / y : x % y, u)
    }
  }

  private unary(live: boolean): Val {
    const t = this.peek()
    if (!t) throw new Fail()
    this.i++
    if (t.kind === 'punct') {
      if (t.text === '(') {
        const v = this.cond(live)
        if (this.peek()?.text !== ')') throw new Fail()
        this.i++
        return v
      }
      if (t.text === '+' || t.text === '-' || t.text === '~' || t.text === '!') {
        const v = this.unary(live)
        if (t.text === '+') return v
        if (t.text === '-') return wrap(-v.v, v.u)
        if (t.text === '~') return wrap(~v.v, v.u)
        return bool(v.v === 0n)
      }
    }
    if (t.kind === 'number') {
      const n = parseNumber(t.text)
      if (n.kind !== 'int') throw new Fail()
      return wrap(n.value, n.unsigned || n.value > 0x7fffffffffffffffn)
    }
    if (t.kind === 'char') return { v: BigInt(parseChar(t.text).value), u: false }
    if (t.kind === 'ident') return { v: 0n, u: false }
    throw new Fail()
  }
}
