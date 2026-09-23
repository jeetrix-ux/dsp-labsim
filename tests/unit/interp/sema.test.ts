import { describe, expect, it } from 'vitest'
import type { Expr, FuncSym, VarSym } from '../../../src/interp/frontend/ast'
import { Diags } from '../../../src/interp/frontend/diag'
import { Sema } from '../../../src/interp/frontend/sema'
import { T, arrayOf, completeRecord, newRecord, pointerTo, typeToString, withQuals, type FunctionType, type Type } from '../../../src/interp/frontend/types'

const L = { file: 'f.c', line: 1, col: 1 }
let nextId = 0
function v(name: string, type: Type, storage: VarSym['storage'] = 'auto'): VarSym {
  return { kind: 'var', name, linkName: name, type, loc: L, storage, external: false, file: 'f.c', init: null, defined: true, cregister: false, register: false, hidden: false, refs: 0, sets: 0, id: nextId++ }
}
function f(name: string, type: FunctionType): FuncSym {
  return { kind: 'func', name, type, loc: L, file: 'f.c', external: true, def: null, implicit: false, library: false, used: false }
}
const int = (n: number, type: Type = T.int): Expr => ({ k: 'int', loc: L, type, value: BigInt(n) })
const flt = (x: number, type: Type = T.double): Expr => ({ k: 'float', loc: L, type, value: x })
const proto = (ret: Type, params: Type[], variadic = false): FunctionType => ({
  kind: 'function', ret, params: params.map((type) => ({ name: null, type, loc: null })), variadic, prototyped: true
})
function sema(): { s: Sema; codes: () => string[] } {
  const diags = new Diags()
  return { s: new Sema(diags, 'c89'), codes: () => diags.list.map((d) => d.code) }
}
const rec = (): Type => {
  const def = newRecord('struct', 'S')
  completeRecord(def, [{ name: 'a', type: T.int }])
  return { kind: 'struct', def }
}

describe('expression typing', () => {
  it('applies the usual arithmetic conversions with explicit implicit casts', () => {
    const { s, codes } = sema()
    const sum = s.binary('+', s.varRef(v('c', T.char), L), s.varRef(v('f', T.float), L), L)
    expect(sum.type).toBe(T.float)
    expect(sum).toMatchObject({ k: 'binary', left: { k: 'cast', implicit: true, type: T.float } })
    expect(s.binary('+', s.varRef(v('a', T.char), L), s.varRef(v('b', T.short), L), L).type).toBe(T.int)
    expect(s.binary('<', int(1), flt(2), L)).toMatchObject({ type: T.int, left: { type: T.double } })
    expect(s.binary('<<', s.varRef(v('u', T.uchar), L), s.varRef(v('l', T.llong), L), L).type).toBe(T.int)
    expect(codes()).toEqual([])
  })
  it('scales pointer arithmetic and decays arrays', () => {
    const { s } = sema()
    const p = v('p', pointerTo(T.int))
    const q = v('q', pointerTo(T.int))
    expect(s.binary('+', s.varRef(p, L), int(2), L)).toMatchObject({ k: 'ptradd', scale: 4, sub: false })
    expect(s.binary('-', s.varRef(p, L), s.varRef(q, L), L)).toMatchObject({ k: 'ptrdiff', scale: 4, type: T.int })
    const a = v('a', arrayOf(T.float, 8))
    const e = s.index(s.varRef(a, L), int(3), L)
    expect(e).toMatchObject({ k: 'deref', type: T.float, arg: { k: 'ptradd', scale: 4, ptr: { k: 'decay' } } })
  })
  it('gives member access the member type and keeps const', () => {
    const { s } = sema()
    const sv = v('s', withQuals(rec(), { const: true }))
    const m = s.member(s.varRef(sv, L), 'a', L)
    expect(typeToString(m.type)).toBe('const int')
    const ps = v('ps', pointerTo(rec()))
    expect(s.arrow(s.varRef(ps, L), 'a', L)).toMatchObject({ k: 'member', member: { name: 'a', offset: 0 }, base: { k: 'deref' } })
  })
})

describe('cl6x diagnostics', () => {
  const cases: [string, (s: Sema) => unknown, string[]][] = [
    ['% needs integers', (s) => s.binary('%', int(1), flt(2), L), ['31']],
    ['pointer + pointer', (s) => s.binary('+', s.varRef(v('p', pointerTo(T.int)), L), s.varRef(v('q', pointerTo(T.int)), L), L), ['31']],
    ['pointer * int', (s) => s.binary('*', s.varRef(v('p', pointerTo(T.int)), L), int(2), L), ['32']],
    ['-pointer', (s) => s.unary('-', s.varRef(v('p', pointerTo(T.int)), L), L), ['32']],
    ['!struct', (s) => s.unary('!', s.varRef(v('s', rec()), L), L), ['42']],
    ['assign to a constant', (s) => s.assign(int(3), int(4), L), ['138']],
    ['assign to const', (s) => s.assign(s.varRef(v('c', withQuals(T.int, { const: true })), L), int(2), L), ['138-D']],
    ['assign to an array', (s) => s.assign(s.varRef(v('a', arrayOf(T.int, 3)), L), int(0), L), ['138']],
    ['int = char *', (s) => s.assign(s.varRef(v('x', T.int), L), s.varRef(v('p', pointerTo(T.char)), L), L), ['515-D']],
    ['int * = float', (s) => s.assign(s.varRef(v('p', pointerTo(T.int)), L), s.varRef(v('f', T.float), L), L), ['515']],
    ['struct = int', (s) => s.assign(s.varRef(v('s', rec()), L), int(1), L), ['515']],
    ['*int', (s) => s.deref(s.varRef(v('x', T.int), L), L), ['76']],
    ['call an int', (s) => s.call(s.varRef(v('x', T.int), L), [], L), ['110']],
    ['x.y on an int', (s) => s.member(s.varRef(v('x', T.int), L), 'y', L), ['156']],
    ['s->a on a struct', (s) => s.arrow(s.varRef(v('s', rec()), L), 'a', L), ['45']],
    ['no such field', (s) => s.member(s.varRef(v('s', rec()), L), 'b', L), ['137']],
    ['pointer == double', (s) => s.binary('==', s.varRef(v('p', pointerTo(T.int)), L), flt(1), L), ['43']],
    ['int * == float *', (s) => s.binary('==', s.varRef(v('p', pointerTo(T.int)), L), s.varRef(v('q', pointerTo(T.float)), L), L), ['43-D']],
    ['(int)struct', (s) => s.cast(T.int, s.varRef(v('s', rec()), L), L), ['173']],
    ['(int *)1.5', (s) => s.cast(pointerTo(T.int), flt(1.5), L), ['173']],
    ['&3', (s) => s.addr(int(3), L), ['160']],
    ['3[4]', (s) => s.index(int(3), int(4), L), ['143']],
    ['a[1.0]', (s) => s.index(s.varRef(v('a', arrayOf(T.int, 2)), L), flt(1), L), ['31']],
    ['void * ++', (s) => s.incdec('++', s.varRef(v('p', pointerTo(T.void)), L), false, L), ['1219-D']],
    ['1 / 0', (s) => s.binary('/', int(1), int(0), L), ['40-D']],
    ['a[5] on int a[3]', (s) => s.index(s.varRef(v('a', arrayOf(T.int, 3)), L), int(5), L), ['177-D']],
    ['&register', (s) => s.addr(s.varRef({ ...v('r', T.int), register: true }, L), L), ['139-D']],
    ['if (struct)', (s) => s.condition(s.varRef(v('s', rec()), L)), ['42']],
    ['switch (float)', (s) => s.switchValue(flt(1)), ['31']],
    ['sizeof incomplete', (s) => s.sizeofType({ kind: 'struct', def: newRecord('struct', 'X') }, L), ['71']],
    ['x ? 1 : ptr', (s) => s.cond(s.varRef(v('x', T.int), L), s.varRef(v('x', T.int), L), s.varRef(v('q', pointerTo(T.float)), L), L), ['43-D']],
    ['return 1 in void', (s) => s.returnValue(T.void, 'f', int(1), L), ['121-D']],
    ['return; in int', (s) => s.returnValue(T.int, 'main', null, L), ['118-D']],
    ['return struct as int', (s) => s.returnValue(T.int, 'f', s.varRef(v('s', rec()), L), L), ['121']]
  ]
  for (const [name, build, expected] of cases) {
    it(name, () => {
      const { s, codes } = sema()
      build(s)
      expect(codes()).toEqual(expected)
    })
  }
})

describe('calls', () => {
  it('converts prototyped arguments and promotes variadic ones', () => {
    const { s, codes } = sema()
    const printf = f('printf', proto(T.int, [pointerTo(withQuals(T.char, { const: true }))], true))
    const str = s.string(['"x=%f %d\\n"'], L)
    const call = s.call(s.funcRef(printf, L), [str, s.varRef(v('x', T.float), L), s.varRef(v('c', T.char), L)], L)
    expect(call).toMatchObject({ k: 'call', fn: printf, type: T.int })
    if (call.k !== 'call') throw new Error('not a call')
    expect(call.args.map((a) => typeToString(a.type))).toEqual(['const char *', 'double', 'int'])
    expect(printf.used).toBe(true)
    expect(codes()).toEqual([])
  })
  it('checks the argument count and types', () => {
    const two = f('f', proto(T.int, [T.int, T.int]))
    const ptr = f('g', proto(T.int, [pointerTo(T.int)]))
    const run = (build: (s: Sema) => unknown): string[] => {
      const { s, codes } = sema()
      build(s)
      return codes()
    }
    expect(run((s) => s.call(s.funcRef(two, L), [int(1)], L))).toEqual(['167'])
    expect(run((s) => s.call(s.funcRef(two, L), [int(1), int(2), int(3)], L))).toEqual(['141'])
    expect(run((s) => s.call(s.funcRef(ptr, L), [flt(3)], L))).toEqual(['169'])
    expect(run((s) => s.call(s.funcRef(ptr, L), [s.varRef(v('x', T.int), L)], L))).toEqual(['169-D'])
    expect(run((s) => s.call(s.funcRef(ptr, L), [int(0)], L))).toEqual([])
  })
})

describe('constant conversions', () => {
  it('warns about a change of sign or truncation, like cl6x', () => {
    const run = (e: Expr, to: Type): string[] => {
      const { s, codes } = sema()
      s.convertFor(e, to, 'init')
      return codes()
    }
    expect(run(int(-1), T.uint)).toEqual(['69-D'])
    expect(run(int(300), T.uchar)).toEqual(['70-D'])
    expect(run(int(0x6162), T.char)).toEqual(['70-D'])
    expect(run(int(100), T.char)).toEqual([])
    expect(run(int(5), pointerTo(T.int))).toEqual(['145-D'])
  })
})

describe('usage tracking for #179-D and #552-D', () => {
  it('counts a plain assignment as a set, not a use', () => {
    const { s } = sema()
    const x = v('x', T.int)
    s.assign(s.varRef(x, L), int(1), L)
    expect([x.refs, x.sets]).toEqual([0, 1])
    const a = v('a', arrayOf(T.int, 2))
    s.assign(s.index(s.varRef(a, L), int(0), L), int(1), L)
    expect([a.refs, a.sets]).toEqual([0, 1])
  })
  it('counts compound assignment, ++ and stores through a pointer as uses', () => {
    const { s } = sema()
    const y = v('y', T.int)
    s.compound('+=', s.varRef(y, L), int(1), L)
    s.incdec('++', s.varRef(y, L), false, L)
    expect(y.refs).toBe(2)
    const p = v('p', pointerTo(T.int))
    s.assign(s.deref(s.varRef(p, L), L), int(1), L)
    expect([p.refs, p.sets]).toEqual([1, 0])
  })
})

describe('literals', () => {
  it('types integer constants by value and dialect', () => {
    const { s } = sema()
    const lit = (value: bigint, decimal = true, unsigned = false, longs: 0 | 1 | 2 = 0): Type =>
      s.number({ kind: 'int', value, decimal, unsigned, longs }, L).type
    expect(lit(5n)).toBe(T.int)
    expect(lit(3000000000n)).toBe(T.ulong)
    expect(lit(3000000000n, false)).toBe(T.uint)
    expect(lit(5n, true, true)).toBe(T.uint)
    expect(lit(5n, true, false, 2)).toBe(T.llong)
    expect(new Sema(new Diags(), 'c99').number({ kind: 'int', value: 3000000000n, decimal: true, unsigned: false, longs: 0 }, L).type).toBe(T.llong)
  })
  it('makes string literals char arrays including the NUL, and warns on multichar constants', () => {
    const diags = new Diags()
    const s = new Sema(diags, 'c89')
    const str = s.string(['"ab"', '"c"'], L)
    expect(str).toMatchObject({ k: 'string', bytes: [97, 98, 99, 0] })
    expect(typeToString(str.type)).toBe('char [4]')
    expect(s.char("'ab'", L)).toMatchObject({ k: 'int', value: 0x6162n, type: T.int })
    expect(diags.list.map((d) => d.code)).toEqual(['1696-D'])
  })
})
