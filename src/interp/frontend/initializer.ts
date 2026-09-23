import type { Expr, Init, InitItem } from './ast'
import { M, type Loc } from './diag'
import type { Sema } from './sema'
import {
  T, arrayOf, compatibleUnqual, isAggregate, isCharArray, isRecord, sizeOf, unqual, withQuals,
  type ArrayType, type Type
} from './types'

export type Designator = { k: 'index'; index: number; loc: Loc } | { k: 'field'; name: string; loc: Loc }

export interface InitSyntaxItem {
  designators: Designator[]
  init: InitSyntax
}

/** An initialiser as written: expressions are typed but not yet converted. */
export type InitSyntax = { k: 'expr'; expr: Expr; loc: Loc } | { k: 'list'; items: InitSyntaxItem[]; loc: Loc }

type StringExpr = Extract<Expr, { k: 'string' }>

class Cursor {
  private i = 0
  constructor(private readonly items: InitSyntaxItem[]) {}
  get done(): boolean {
    return this.i >= this.items.length
  }
  peek(): InitSyntaxItem {
    return this.items[this.i]
  }
  next(): InitSyntaxItem {
    return this.items[this.i++]
  }
}

const zero = (loc: Loc): Expr => ({ k: 'int', loc, type: T.int, value: 0n })

function complete(type: Type, count: number): Type {
  return type.kind === 'array' && type.length === null && !type.vla ? { ...type, length: count } : type
}

/** The sub-object `index` of an aggregate and its byte offset. */
function sub(type: Type, index: number, offset: number): [Type, number] {
  if (type.kind === 'array') return [type.of, offset + index * sizeOf(type.of)]
  if (!isRecord(type) || !type.def.members) return [T.error, offset]
  const m = type.def.members[index]
  return [withQuals(m.type, { const: type.const, volatile: type.volatile }), offset + m.offset]
}

class Builder {
  readonly items: InitItem[] = []

  constructor(private readonly sema: Sema) {}

  /** Fills an aggregate from `cur`; `braced` when `cur` is the object's own brace list. Returns the elements initialised. */
  fill(type: Type, cur: Cursor, offset: number, braced: boolean): number {
    const members = isRecord(type) ? (type.def.members?.length ?? 0) : 0
    const limit = type.kind === 'array' ? (type.length ?? Infinity) : type.kind === 'union' ? Math.min(1, members) : members
    let index = 0
    let count = 0
    let warned = false
    while (!cur.done) {
      const item = cur.peek()
      if (item.designators.length > 0) {
        if (!braced) break
        cur.next()
        const at = this.designate(type, offset, item.designators, item.init)
        if (at !== null) {
          index = at + 1
          count = Math.max(count, index)
        }
        continue
      }
      if (index >= limit) {
        if (!braced) break
        if (!warned) this.sema.diags.warning(item.init.loc, M.excessInit())
        warned = true
        cur.next()
        continue
      }
      const [st, so] = sub(type, index, offset)
      this.element(st, so, cur)
      index++
      count = Math.max(count, index)
    }
    return count
  }

  /** One element from the cursor: a whole item, or several items under brace elision. */
  private element(type: Type, offset: number, cur: Cursor): void {
    const item = cur.peek()
    if (item.init.k === 'list' || !isAggregate(type)) {
      cur.next()
      this.value(type, offset, item.init)
      return
    }
    const e = item.init.expr
    if ((isCharArray(type) && e.k === 'string') || (isRecord(type) && compatibleUnqual(type, e.type))) {
      cur.next()
      this.value(type, offset, item.init)
      return
    }
    this.fill(type, cur, offset, false)
  }

  /** A brace list for an aggregate; `{"text"}` initialises a char array from the string. Returns the elements initialised. */
  braced(type: Type, list: Extract<InitSyntax, { k: 'list' }>, offset: number): number {
    const first = list.items[0]
    if (isCharArray(type) && first && first.designators.length === 0 && first.init.k === 'expr' && first.init.expr.k === 'string') {
      if (list.items.length > 1) this.sema.diags.warning(list.items[1].init.loc, M.excessInit())
      return this.string(type, offset, first.init.expr)
    }
    return this.fill(type, new Cursor(list.items), offset, true)
  }

  /** The object at `offset` from one complete initialiser. */
  value(type: Type, offset: number, syn: InitSyntax): void {
    if (syn.k === 'list') {
      if (isAggregate(type)) {
        this.braced(type, syn, offset)
        return
      }
      if (syn.items.length === 0) {
        this.items.push({ offset, type: unqual(type), expr: this.sema.convert(zero(syn.loc), type) })
        return
      }
      this.value(type, offset, syn.items[0].init)
      if (syn.items.length > 1) this.sema.diags.warning(syn.items[1].init.loc, M.excessInit())
      return
    }
    const e = syn.expr
    if (isCharArray(type) && e.k === 'string') {
      this.string(type, offset, e)
      return
    }
    if (isAggregate(type) && !(isRecord(type) && compatibleUnqual(type, e.type))) {
      this.fill(type, new Cursor([{ designators: [], init: syn }]), offset, false)
      return
    }
    this.items.push({ offset, type: unqual(type), expr: this.sema.convertFor(e, type, 'init') })
  }

  /** A string literal into a char array; returns the length it gives the array. */
  string(type: ArrayType, offset: number, e: StringExpr): number {
    const length = type.length ?? e.bytes.length
    if (e.bytes.length - 1 > length) this.sema.diags.warning(e.loc, M.stringTooLong())
    this.items.push({ offset, type: arrayOf(type.of, length), expr: e })
    return length
  }

  private designate(type: Type, offset: number, ds: Designator[], init: InitSyntax): number | null {
    const d = ds[0]
    let index: number
    if (d.k === 'index') {
      if (type.kind !== 'array') {
        this.sema.diags.error(d.loc, M.pointerToObjectRequired())
        return null
      }
      if (type.length !== null && d.index >= type.length) {
        this.sema.diags.warning(d.loc, M.excessInit())
        return null
      }
      index = d.index
    } else {
      if (!isRecord(type) || !type.def.members) {
        this.sema.diags.error(d.loc, M.structRequired())
        return null
      }
      index = type.def.members.findIndex((m) => m.name === d.name)
      if (index < 0) {
        this.sema.diags.error(d.loc, M.noField(type.def.kind, type.def.tag ?? '<unnamed>', d.name))
        return null
      }
    }
    const [st, so] = sub(type, index, offset)
    if (ds.length > 1) this.designate(st, so, ds.slice(1), init)
    else this.value(st, so, init)
    return index
  }
}

/** Lowers the initialiser of an object of `type`; `int a[] = {…}` and `char s[] = "…"` get their length. */
export function lowerInit(sema: Sema, type: Type, syntax: InitSyntax): { init: Init; type: Type } {
  const b = new Builder(sema)
  if (syntax.k === 'expr') {
    const e = syntax.expr
    if (!isAggregate(type) || isRecord(type)) return { init: { k: 'expr', expr: sema.convertFor(e, type, 'init') }, type }
    if (isCharArray(type) && e.k === 'string') {
      const length = b.string(type, 0, e)
      return { init: { k: 'list', items: b.items }, type: complete(type, length) }
    }
    sema.diags.warning(syntax.loc, M.braceExpected())
    const count = b.fill(type, new Cursor([{ designators: [], init: syntax }]), 0, false)
    return { init: { k: 'list', items: b.items }, type: complete(type, count) }
  }
  if (!isAggregate(type)) {
    b.value(type, 0, syntax)
    return { init: { k: 'expr', expr: b.items[0]?.expr ?? sema.convert(zero(syntax.loc), type) }, type }
  }
  const count = b.braced(type, syntax, 0)
  return { init: { k: 'list', items: b.items }, type: complete(type, count) }
}
