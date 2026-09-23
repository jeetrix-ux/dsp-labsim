import type { BinOp, CompoundOp, Expr, FuncSym, VarSym } from './ast'
import { evalIntConst } from './consteval'
import { M, type Diags, type Loc, type Msg } from './diag'
import { parseChar, parseString, type NumberLiteral } from './literals'
import {
  T, arrayOf, compatibleUnqual, intType, isArithmetic, isComplete, isFloating, isInteger, isPointer, isRecord, isScalar,
  pointerTo, promote, sizeOf, typeToString, unqual, usualArith, withQuals,
  type IntName, type IntType, type PointerType, type Type
} from './types'

export type ConvContext = 'assign' | 'init' | 'arg' | 'return'

const errorExpr = (loc: Loc): Expr => ({ k: 'error', loc, type: T.error })
const isErr = (...es: Expr[]): boolean => es.some((e) => e.type.kind === 'error')

export function isLvalue(e: Expr): boolean {
  switch (e.k) {
    case 'var':
    case 'deref':
    case 'string':
    case 'compoundLit':
      return true
    case 'member':
      return isLvalue(e.base)
    default:
      return false
  }
}

/** An integer constant 0, possibly cast to an integer or to void *. */
export function isNullPointerConstant(e: Expr): boolean {
  let x = e
  while (x.k === 'cast' && (isInteger(x.type) || (isPointer(x.type) && x.type.to.kind === 'void'))) x = x.arg
  return isInteger(x.type) && evalIntConst(x) === 0n
}

/** The variable a plain `=` stores into, when the store does not go through a pointer. */
function storedVar(e: Expr): VarSym | null {
  switch (e.k) {
    case 'var':
      return e.sym
    case 'member':
      return storedVar(e.base)
    case 'deref': {
      const p = e.arg.k === 'ptradd' ? e.arg.ptr : e.arg
      return p.k === 'decay' ? storedVar(p.arg) : null
    }
    default:
      return null
  }
}

const DEC_C89: IntName[] = ['int', 'long', 'unsigned long', 'long long', 'unsigned long long']
const DEC_C99: IntName[] = ['int', 'long', 'long long', 'unsigned long long']
const NON_DEC: IntName[] = ['int', 'unsigned int', 'long', 'unsigned long', 'long long', 'unsigned long long']
const UNSIGNED: IntName[] = ['unsigned int', 'unsigned long', 'unsigned long long']

const cnst = (t: Type): Type => withQuals(t, { const: true })
const MEM_TYPES: Record<string, Type> = {
  _mem2: T.ushort, _amem2: T.ushort, _mem4: T.uint, _amem4: T.uint, _mem8: T.ullong, _amem8: T.ullong,
  _memd8: T.double, _amemd8: T.double, _mem4_const: cnst(T.uint), _amem4_const: cnst(T.uint),
  _mem8_const: cnst(T.ullong), _amem8_const: cnst(T.ullong), _memd8_const: cnst(T.double), _amemd8_const: cnst(T.double)
}
/** TI's unaligned/aligned memory-access intrinsics: `_amem4(p)` is an lvalue. */
export const MEM_INTRINSICS: ReadonlySet<string> = new Set(Object.keys(MEM_TYPES))

function convMsg(ctx: ConvContext, from: Type, to: Type, d: boolean): Msg {
  const f = typeToString(from)
  const t = typeToString(to)
  switch (ctx) {
    case 'assign': return M.badAssign(f, t, d)
    case 'init': return M.badInit(f, t, d)
    case 'arg': return M.badArg(f, t, d)
    default: return M.badReturn(d)
  }
}

/** Builds typed expression nodes, inserting conversions and reporting cl6x's diagnostics. */
export class Sema {
  constructor(
    readonly diags: Diags,
    private readonly dialect: 'c89' | 'c99'
  ) {}

  private fail(at: Loc, m: Msg): Expr {
    this.diags.error(at, m)
    return errorExpr(at)
  }

  // ------------------------------------------------------------ conversions

  /** Arrays decay to a pointer to their first element; functions to a pointer to the function. */
  rvalue(e: Expr): Expr {
    if (e.type.kind === 'array') return { k: 'decay', loc: e.loc, type: pointerTo(e.type.of), arg: e }
    if (e.type.kind === 'function') return { k: 'addr', loc: e.loc, type: pointerTo(e.type), arg: e }
    return e
  }

  /** An implicit conversion node when the (unqualified) types differ. */
  convert(e: Expr, to: Type): Expr {
    const target = unqual(to)
    if (e.type.kind === 'error' || target.kind === 'error' || compatibleUnqual(e.type, target)) return e
    return { k: 'cast', loc: e.loc, type: target, arg: e, implicit: true }
  }

  /** Default argument promotions, for variadic and unprototyped arguments. */
  promoteArg(e: Expr): Expr {
    const r = this.rvalue(e)
    if (r.type.kind === 'float' && r.type.name === 'float') return this.convert(r, T.double)
    if (r.type.kind === 'int') return this.convert(r, promote(r.type))
    return r
  }

  /** Conversion as if by assignment (assign, initialise, pass, return), with cl6x's diagnostics. */
  convertFor(e: Expr, to: Type, ctx: ConvContext): Expr {
    const r = this.rvalue(e)
    if (isErr(r) || to.kind === 'error') return r
    const c = this.compat(unqual(to), r)
    if (c === 'error') return this.fail(r.loc, convMsg(ctx, r.type, to, false))
    if (c === 'warn') this.diags.warning(r.loc, convMsg(ctx, r.type, to, true))
    if (isInteger(to) && to.name !== '_Bool' && isInteger(r.type)) this.checkFits(r, to)
    return this.convert(r, to)
  }

  private compat(to: Type, from: Expr): 'ok' | 'warn' | 'error' {
    const f = from.type
    if (f.kind === 'void') return 'error'
    if (isArithmetic(to) && isArithmetic(f)) return 'ok'
    if (to.kind === 'int' && to.name === '_Bool' && isPointer(f)) return 'ok'
    if (isRecord(to) || isRecord(f)) return compatibleUnqual(to, f) ? 'ok' : 'error'
    if (isPointer(to)) {
      if (isPointer(f)) {
        const tp = to.to
        const fp = f.to
        const keepsQuals = (!fp.const || !!tp.const) && (!fp.volatile || !!tp.volatile)
        if (tp.kind === 'void' || fp.kind === 'void' || compatibleUnqual(tp, fp)) return keepsQuals ? 'ok' : 'warn'
        return 'warn'
      }
      if (isInteger(f)) return isNullPointerConstant(from) ? 'ok' : 'warn'
      return 'error'
    }
    if (isInteger(to) && isPointer(f)) return 'warn'
    return 'error'
  }

  /** #69-D / #70-D when an integer constant does not fit the target type. */
  private checkFits(e: Expr, to: IntType): void {
    const v = evalIntConst(e)
    if (v === null) return
    const b = BigInt(to.bits)
    const lo = to.signed ? -(1n << (b - 1n)) : 0n
    const hi = to.signed ? (1n << (b - 1n)) - 1n : (1n << b) - 1n
    if (v >= lo && v <= hi) return
    const fitsBits = v >= -(1n << (b - 1n)) && v <= (1n << b) - 1n
    this.diags.warning(e.loc, fitsBits ? M.signChange() : M.truncation())
  }

  // ------------------------------------------------------------ primaries

  varRef(sym: VarSym, at: Loc): Expr {
    sym.refs++
    return { k: 'var', loc: at, type: sym.type, sym }
  }

  funcRef(sym: FuncSym, at: Loc): Expr {
    sym.used = true
    return { k: 'func', loc: at, type: sym.type, sym }
  }

  number(lit: NumberLiteral, at: Loc): Expr {
    if (lit.kind === 'error') return errorExpr(at)
    if (lit.kind === 'float') {
      const type = lit.suffix === 'f' ? T.float : lit.suffix === 'l' ? T.ldouble : T.double
      return { k: 'float', loc: at, type, value: lit.value }
    }
    let names = lit.unsigned ? UNSIGNED : lit.decimal ? (this.dialect === 'c99' ? DEC_C99 : DEC_C89) : NON_DEC
    if (lit.longs === 1) names = names.filter((n) => n.includes('long'))
    if (lit.longs === 2) names = names.filter((n) => n.includes('long long'))
    let type: IntType = T.ullong
    for (const n of names) {
      const t = intType(n)
      const max = t.signed ? (1n << BigInt(t.bits - 1)) - 1n : (1n << BigInt(t.bits)) - 1n
      if (lit.value <= max) {
        type = t
        break
      }
    }
    return { k: 'int', loc: at, type, value: BigInt.asUintN(64, lit.value) }
  }

  char(text: string, at: Loc): Expr {
    const c = parseChar(text)
    if (c.chars > 1 && !c.wide) this.diags.warning(at, M.multichar())
    return { k: 'int', loc: at, type: c.wide ? T.ushort : T.int, value: BigInt(c.value) }
  }

  string(texts: string[], at: Loc): Expr {
    const bytes: number[] = []
    for (const t of texts) {
      const s = parseString(t)
      if (s.wide) return this.fail(at, M.unsupported('wide string literal'))
      bytes.push(...s.units)
    }
    bytes.push(0)
    return { k: 'string', loc: at, type: arrayOf(T.char, bytes.length), bytes }
  }

  // ------------------------------------------------------------ operators

  unary(op: '-' | '+' | '~' | '!', e: Expr, at: Loc): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return errorExpr(at)
    if (op === '!') {
      if (!isScalar(r.type)) return this.fail(at, M.arithOrPointerRequired())
      return { k: 'unary', op, loc: at, type: T.int, arg: r }
    }
    if (op === '~' ? !isInteger(r.type) : !isArithmetic(r.type)) return this.fail(at, op === '~' ? M.integralRequired() : M.arithRequired())
    const t = promote(r.type)
    return { k: 'unary', op, loc: at, type: t, arg: this.convert(r, t) }
  }

  binary(op: BinOp | '&&' | '||', left: Expr, right: Expr, at: Loc): Expr {
    const a = this.rvalue(left)
    const b = this.rvalue(right)
    if (isErr(a, b)) return errorExpr(at)
    const ta = a.type
    const tb = b.type
    switch (op) {
      case '&&':
      case '||':
        if (!isScalar(ta) || !isScalar(tb)) return this.fail(at, M.arithOrPointerRequired())
        return { k: 'logical', op, loc: at, type: T.int, left: a, right: b }
      case '*':
      case '/':
        if (!isArithmetic(ta) || !isArithmetic(tb)) return this.fail(at, M.arithRequired())
        return this.arith(op, a, b, at)
      case '%':
      case '&':
      case '^':
      case '|':
        if (!isInteger(ta) || !isInteger(tb)) return this.fail(at, M.integralRequired())
        return this.arith(op, a, b, at)
      case '<<':
      case '>>': {
        if (!isInteger(ta) || !isInteger(tb)) return this.fail(at, M.integralRequired())
        const t = promote(ta)
        return { k: 'binary', op, loc: at, type: t, left: this.convert(a, t), right: this.convert(b, promote(tb)) }
      }
      case '+':
        if (isPointer(ta) || isPointer(tb)) {
          const [p, i] = isPointer(ta) ? [a, b] : [b, a]
          if (!isInteger(i.type)) return this.fail(at, M.integralRequired())
          return this.ptrAdd(p, i, false, at)
        }
        if (!isArithmetic(ta) || !isArithmetic(tb)) return this.fail(at, M.arithOrPointerRequired())
        return this.arith(op, a, b, at)
      case '-':
        if (isPointer(ta) && isPointer(tb)) return { k: 'ptrdiff', loc: at, type: T.int, left: a, right: b, scale: this.scale(ta, at) }
        if (isPointer(ta)) return isInteger(tb) ? this.ptrAdd(a, b, true, at) : this.fail(at, M.integralRequired())
        if (isPointer(tb)) return this.fail(at, M.integralRequired())
        if (!isArithmetic(ta) || !isArithmetic(tb)) return this.fail(at, M.arithOrPointerRequired())
        return this.arith(op, a, b, at)
      default:
        return this.compare(op, a, b, at)
    }
  }

  private arith(op: BinOp, a: Expr, b: Expr, at: Loc): Expr {
    const t = usualArith(a.type, b.type)
    if ((op === '/' || op === '%') && isInteger(t) && evalIntConst(b) === 0n) this.diags.warning(at, M.divByZero())
    return { k: 'binary', op, loc: at, type: t, left: this.convert(a, t), right: this.convert(b, t) }
  }

  private scale(p: PointerType, at: Loc): number {
    if (p.to.kind === 'void' || p.to.kind === 'function') {
      this.diags.warning(at, M.voidPointerArith())
      return 1
    }
    if (!isComplete(p.to)) {
      this.diags.error(at, M.incompleteType())
      return 1
    }
    return sizeOf(p.to)
  }

  private ptrAdd(p: Expr, i: Expr, sub: boolean, at: Loc): Expr {
    const pt = p.type as PointerType
    return { k: 'ptradd', loc: at, type: unqual(pt), ptr: p, index: this.convert(i, promote(i.type)), scale: this.scale(pt, at), sub }
  }

  private compare(op: BinOp, a: Expr, b: Expr, at: Loc): Expr {
    const ta = a.type
    const tb = b.type
    const names = (): [string, string] => [typeToString(ta), typeToString(tb)]
    if (isArithmetic(ta) && isArithmetic(tb)) {
      const t = usualArith(ta, tb)
      return { k: 'binary', op, loc: at, type: T.int, left: this.convert(a, t), right: this.convert(b, t) }
    }
    if (!isScalar(ta) || !isScalar(tb)) return this.fail(at, M.arithOrPointerRequired())
    if (isPointer(ta) && isPointer(tb)) {
      if (!(ta.to.kind === 'void' || tb.to.kind === 'void' || compatibleUnqual(ta.to, tb.to))) this.diags.warning(at, M.incompatibleOperands(...names(), true))
      return { k: 'binary', op, loc: at, type: T.int, left: a, right: this.convert(b, ta) }
    }
    const [p, o] = isPointer(ta) ? [a, b] : [b, a]
    if (isFloating(o.type)) return this.fail(at, M.incompatibleOperands(...names(), false))
    if (!isNullPointerConstant(o) || (op !== '==' && op !== '!=')) this.diags.warning(at, M.incompatibleOperands(...names(), true))
    const c = (e: Expr): Expr => (e === p ? e : this.convert(e, p.type))
    return { k: 'binary', op, loc: at, type: T.int, left: c(a), right: c(b) }
  }

  cond(test: Expr, thenE: Expr, elseE: Expr, at: Loc): Expr {
    const c = this.rvalue(test)
    const x = this.rvalue(thenE)
    const y = this.rvalue(elseE)
    if (isErr(c, x, y)) return errorExpr(at)
    if (!isScalar(c.type)) return this.fail(at, M.arithOrPointerRequired())
    const tx = x.type
    const ty = y.type
    const warn = (): void => this.diags.warning(at, M.incompatibleOperands(typeToString(tx), typeToString(ty), true))
    let t: Type
    if (isArithmetic(tx) && isArithmetic(ty)) t = usualArith(tx, ty)
    else if (tx.kind === 'void' && ty.kind === 'void') t = T.void
    else if (isRecord(tx) && compatibleUnqual(tx, ty)) t = unqual(tx)
    else if (isPointer(tx) && isPointer(ty)) {
      const q = { const: tx.to.const || ty.to.const, volatile: tx.to.volatile || ty.to.volatile }
      if (tx.to.kind === 'void' || ty.to.kind === 'void') t = pointerTo(withQuals(T.void, q))
      else {
        if (!compatibleUnqual(tx.to, ty.to)) warn()
        t = pointerTo(withQuals(unqual(tx.to), q))
      }
    } else if (isPointer(tx) && isInteger(ty)) {
      if (!isNullPointerConstant(y)) warn()
      t = unqual(tx)
    } else if (isInteger(tx) && isPointer(ty)) {
      if (!isNullPointerConstant(x)) warn()
      t = unqual(ty)
    } else return this.fail(at, M.incompatibleOperands(typeToString(tx), typeToString(ty), false))
    const conv = (e: Expr): Expr => (t.kind === 'void' ? e : this.convert(e, t))
    return { k: 'cond', loc: at, type: t, test: c, then: conv(x), else: conv(y) }
  }

  comma(left: Expr, right: Expr, at: Loc): Expr {
    const r = this.rvalue(right)
    return { k: 'comma', loc: at, type: unqual(r.type), left, right: r }
  }

  // ------------------------------------------------------------ assignment

  private modifiable(e: Expr, at: Loc): boolean {
    const t = e.type
    if (!isLvalue(e) || t.kind === 'array' || t.kind === 'function' || t.kind === 'void') {
      this.diags.error(at, M.notModifiable(false))
      return false
    }
    if (t.const) {
      this.diags.error(at, M.notModifiable(true))
      return false
    }
    return true
  }

  assign(target: Expr, value: Expr, at: Loc): Expr {
    if (isErr(target, value)) return errorExpr(at)
    if (!this.modifiable(target, at)) return errorExpr(at)
    const v = this.convertFor(value, target.type, 'assign')
    const stored = storedVar(target)
    if (stored) {
      stored.refs--
      stored.sets++
    }
    return { k: 'assign', loc: at, type: unqual(target.type), target, value: v }
  }

  compound(op: CompoundOp, target: Expr, value: Expr, at: Loc): Expr {
    if (isErr(target, value)) return errorExpr(at)
    if (!this.modifiable(target, at)) return errorExpr(at)
    const tt = unqual(target.type)
    const v = this.rvalue(value)
    const base = op.slice(0, -1) as BinOp
    if (isPointer(tt) && (base === '+' || base === '-')) {
      if (!isInteger(v.type)) return this.fail(at, M.integralRequired())
      return { k: 'compound', op, loc: at, type: tt, target, value: this.convert(v, promote(v.type)), opType: tt, scale: this.scale(tt, at) }
    }
    const integral = base === '%' || base === '<<' || base === '>>' || base === '&' || base === '^' || base === '|'
    const ok = integral ? isInteger(tt) && isInteger(v.type) : isArithmetic(tt) && isArithmetic(v.type)
    if (!ok) return this.fail(at, integral ? M.integralRequired() : base === '+' || base === '-' ? M.arithOrPointerRequired() : M.arithRequired())
    const shift = base === '<<' || base === '>>'
    const opType = shift ? promote(tt) : usualArith(tt, v.type)
    if ((base === '/' || base === '%') && isInteger(opType) && evalIntConst(v) === 0n) this.diags.warning(at, M.divByZero())
    return { k: 'compound', op, loc: at, type: tt, target, value: this.convert(v, shift ? promote(v.type) : opType), opType, scale: 0 }
  }

  incdec(op: '++' | '--', target: Expr, prefix: boolean, at: Loc): Expr {
    if (isErr(target)) return errorExpr(at)
    if (!this.modifiable(target, at)) return errorExpr(at)
    const t = unqual(target.type)
    if (!isScalar(t)) return this.fail(at, M.arithOrPointerRequired())
    return { k: 'incdec', op, prefix, loc: at, type: t, target, scale: isPointer(t) ? this.scale(t, at) : 0 }
  }

  // ------------------------------------------------------------ memory access

  addr(e: Expr, at: Loc): Expr {
    if (isErr(e)) return errorExpr(at)
    if (e.k !== 'func' && !isLvalue(e)) return this.fail(at, M.lvalueRequired())
    if (e.k === 'var' && e.sym.register) this.diags.warning(at, M.registerAddress())
    return { k: 'addr', loc: at, type: pointerTo(e.type), arg: e }
  }

  deref(e: Expr, at: Loc): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return errorExpr(at)
    if (!isPointer(r.type)) return this.fail(at, M.derefNonPointer())
    return { k: 'deref', loc: at, type: r.type.to, arg: r }
  }

  index(base: Expr, idx: Expr, at: Loc): Expr {
    const a = this.rvalue(base)
    const i = this.rvalue(idx)
    if (isErr(a, i)) return errorExpr(at)
    let p: Expr
    let n: Expr
    let written: Expr
    if (isPointer(a.type)) [p, n, written] = [a, i, base]
    else if (isPointer(i.type)) [p, n, written] = [i, a, idx]
    else return this.fail(at, M.pointerToObjectRequired())
    if (!isInteger(n.type)) return this.fail(at, M.integralRequired())
    if (written.type.kind === 'array' && written.type.length !== null) {
      const k = evalIntConst(n)
      if (k !== null && (k < 0n || k >= BigInt(written.type.length))) this.diags.warning(at, M.subscriptRange())
    }
    const sum = this.ptrAdd(p, n, false, at)
    return { k: 'deref', loc: at, type: (p.type as PointerType).to, arg: sum }
  }

  member(base: Expr, name: string, at: Loc): Expr {
    if (isErr(base)) return errorExpr(at)
    const t = base.type
    if (!isRecord(t)) return this.fail(at, M.structRequired())
    if (!t.def.members) return this.fail(at, M.incompleteType())
    const m = t.def.members.find((x) => x.name === name)
    if (!m) return this.fail(at, M.noField(t.def.kind, t.def.tag ?? '<unnamed>', name))
    return { k: 'member', loc: at, type: withQuals(m.type, { const: t.const, volatile: t.volatile }), base, member: m }
  }

  arrow(base: Expr, name: string, at: Loc): Expr {
    const r = this.rvalue(base)
    if (isErr(r)) return errorExpr(at)
    if (!isPointer(r.type)) return this.fail(at, M.pointerRequired())
    return this.member({ k: 'deref', loc: at, type: r.type.to, arg: r }, name, at)
  }

  /** `_amem4(p)` and friends: an lvalue of the intrinsic's type at p. */
  memAccess(name: string, arg: Expr, at: Loc): Expr {
    const r = this.rvalue(arg)
    if (isErr(r)) return errorExpr(at)
    if (!isPointer(r.type)) return this.fail(at, M.pointerRequired())
    const t = MEM_TYPES[name]
    return { k: 'deref', loc: at, type: t, arg: { k: 'cast', loc: at, type: pointerTo(t), arg: r, implicit: false } }
  }

  // ------------------------------------------------------------ calls and casts

  call(callee: Expr, args: Expr[], at: Loc): Expr {
    if (isErr(callee)) return errorExpr(at)
    const fn = callee.k === 'func' ? callee.sym : null
    const c = this.rvalue(callee)
    if (!isPointer(c.type) || c.type.to.kind !== 'function') return this.fail(at, M.notCallable())
    const ft = c.type.to
    let converted: Expr[]
    if (ft.prototyped) {
      if (args.length < ft.params.length) this.diags.error(at, M.tooFewArgs())
      else if (args.length > ft.params.length && !ft.variadic) this.diags.error(at, M.tooManyArgs())
      converted = args.map((a, i) => (i < ft.params.length ? this.convertFor(a, ft.params[i].type, 'arg') : this.promoteArg(a)))
    } else converted = args.map((a) => this.promoteArg(a))
    return { k: 'call', loc: at, type: unqual(ft.ret), callee: c, args: converted, fn }
  }

  cast(to: Type, e: Expr, at: Loc): Expr {
    const r = this.rvalue(e)
    if (isErr(r) || to.kind === 'error') return errorExpr(at)
    const t = unqual(to)
    if (t.kind === 'void') return { k: 'cast', loc: at, type: T.void, arg: r, implicit: false }
    const ok =
      isScalar(t) && isScalar(r.type) && !(isPointer(t) && isFloating(r.type)) && !(isFloating(t) && isPointer(r.type))
    if (!ok && !(isRecord(t) && compatibleUnqual(t, r.type))) return this.fail(at, M.invalidConversion())
    return { k: 'cast', loc: at, type: t, arg: r, implicit: false }
  }

  sizeofType(t: Type, at: Loc): Expr {
    if (t.kind === 'array' && t.vla?.len) {
      const len: Expr = { k: 'var', loc: at, type: T.uint, sym: t.vla.len }
      return { k: 'binary', op: '*', loc: at, type: T.uint, left: len, right: { k: 'int', loc: at, type: T.uint, value: BigInt(sizeOf(t.of)) } }
    }
    if (t.kind !== 'void' && t.kind !== 'function' && t.kind !== 'error' && !isComplete(t)) return this.fail(at, M.incompleteType())
    return { k: 'int', loc: at, type: T.uint, value: BigInt(sizeOf(t)) }
  }

  sizeofExpr(e: Expr, at: Loc): Expr {
    return isErr(e) ? errorExpr(at) : this.sizeofType(e.type, at)
  }

  // ------------------------------------------------------------ statements

  /** Controlling expression of if/while/do/for/?: — any scalar. */
  condition(e: Expr): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return r
    return isScalar(r.type) ? r : this.fail(r.loc, M.arithOrPointerRequired())
  }

  switchValue(e: Expr): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return r
    return isInteger(r.type) ? this.convert(r, promote(r.type)) : this.fail(r.loc, M.integralRequired())
  }

  returnValue(ret: Type, fnName: string, value: Expr | null, at: Loc): Expr | null {
    if (value === null) {
      if (ret.kind !== 'void') this.diags.warning(at, M.returnValueMissing(fnName))
      return null
    }
    if (ret.kind === 'void') {
      const r = this.rvalue(value)
      if (!isErr(r) && r.type.kind !== 'void') this.diags.warning(at, M.badReturn(true))
      return r
    }
    return this.convertFor(value, ret, 'return')
  }

  vaStart(ap: Expr, last: Expr, at: Loc): Expr {
    if (isErr(ap) || !this.modifiable(ap, at)) return errorExpr(at)
    return { k: 'vaStart', loc: at, type: T.void, ap, last: last.k === 'var' ? last.sym : null }
  }

  vaArg(ap: Expr, t: Type, at: Loc): Expr {
    if (isErr(ap) || !this.modifiable(ap, at)) return errorExpr(at)
    return { k: 'vaArg', loc: at, type: unqual(t), ap }
  }
}
