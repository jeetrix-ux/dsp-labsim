import { describe, expect, it } from 'vitest'
import type { Expr, Init, VarSym } from '../../../src/interp/frontend/ast'
import { evalConst } from '../../../src/interp/frontend/consteval'
import { Diags } from '../../../src/interp/frontend/diag'
import { lowerInit, type Designator, type InitSyntax } from '../../../src/interp/frontend/initializer'
import { Sema } from '../../../src/interp/frontend/sema'
import { T, arrayOf, completeRecord, newRecord, typeToString, type Type } from '../../../src/interp/frontend/types'

const L = { file: 'f.c', line: 1, col: 1 }
const n = (x: number): InitSyntax => ({ k: 'expr', expr: { k: 'int', loc: L, type: T.int, value: BigInt(x) }, loc: L })
const x = (e: Expr): InitSyntax => ({ k: 'expr', expr: e, loc: L })
const fld = (name: string): Designator => ({ k: 'field', name, loc: L })
const idx = (index: number): Designator => ({ k: 'index', index, loc: L })
const list = (...items: (InitSyntax | [Designator[], InitSyntax])[]): InitSyntax => ({
  k: 'list', loc: L, items: items.map((i) => (Array.isArray(i) ? { designators: i[0], init: i[1] } : { designators: [], init: i }))
})
const str = (text: string): InitSyntax => {
  const bytes = [...Buffer.from(text, 'latin1'), 0]
  return x({ k: 'string', loc: L, type: arrayOf(T.char, bytes.length), bytes })
}
const value = (e: Expr): number | string => {
  const v = evalConst(e)
  return v && v.k !== 'addr' ? Number(v.value) : e.k
}
const rows = (init: Init): (number | string)[][] =>
  init.k === 'list' ? init.items.map((i) => [i.offset, typeToString(i.type), value(i.expr)]) : [[typeToString(init.expr.type), value(init.expr)]]

function lower(type: Type, syntax: InitSyntax): { rows: (number | string)[][]; type: string; codes: string[] } {
  const diags = new Diags()
  const r = lowerInit(new Sema(diags, 'c89'), type, syntax)
  return { rows: rows(r.init), type: typeToString(r.type), codes: diags.list.map((d) => d.code) }
}

const point = (): Type => {
  const def = newRecord('struct', 'P')
  completeRecord(def, [{ name: 'x', type: T.int }, { name: 'y', type: T.float }])
  return { kind: 'struct', def }
}

describe('lowerInit', () => {
  it('completes an incomplete array from its initialiser', () => {
    expect(lower(arrayOf(T.int, null), list(n(1), n(2), n(3)))).toEqual({
      rows: [[0, 'int', 1], [4, 'int', 2], [8, 'int', 3]], type: 'int [3]', codes: []
    })
  })
  it('elides braces across nested arrays and honours inner braces', () => {
    const m = arrayOf(arrayOf(T.int, 3), 2)
    expect(lower(m, list(n(1), n(2), n(3), n(4))).rows.map((r) => r[0])).toEqual([0, 4, 8, 12])
    expect(lower(m, list(list(n(1)), list(n(4), n(5)))).rows.map((r) => r[0])).toEqual([0, 12, 16])
  })
  it('applies designators and continues after them', () => {
    expect(lower(point(), list([[fld('y')], n(2)], [[fld('x')], n(1)])).rows).toEqual([[4, 'float', 2], [0, 'int', 1]])
    expect(lower(arrayOf(T.int, 5), list([[idx(3)], n(7)], n(8)))).toMatchObject({ rows: [[12, 'int', 7], [16, 'int', 8]], type: 'int [5]' })
    expect(lower(arrayOf(T.int, null), list([[idx(4)], n(1)])).type).toBe('int [5]')
    expect(lower(arrayOf(point(), 2), list([[idx(1), fld('y')], n(3)])).rows).toEqual([[12, 'float', 3]])
  })
  it('initialises char arrays from strings, like cl6x', () => {
    expect(lower(arrayOf(T.char, null), str('hi'))).toMatchObject({ rows: [[0, 'char [3]', 'string']], type: 'char [3]', codes: [] })
    expect(lower(arrayOf(T.char, 2), str('ab')).codes).toEqual([])
    expect(lower(arrayOf(T.char, 3), str('abcd')).codes).toEqual(['2097-D'])
    expect(lower(arrayOf(T.char, null), list(str('ok'))).type).toBe('char [3]')
    expect(lower(arrayOf(arrayOf(T.char, 4), 2), list(str('ab'), str('cd'))).rows.map((r) => r[0])).toEqual([0, 4])
  })
  it('warns once about excess initialisers', () => {
    expect(lower(arrayOf(T.int, 2), list(n(1), n(2), n(3), n(4)))).toMatchObject({ codes: ['1238-D'], rows: [[0, 'int', 1], [4, 'int', 2]] })
    expect(lower(T.int, list(n(1), n(2)))).toEqual({ rows: [['int', 1]], type: 'int', codes: ['1238-D'] })
  })
  it('treats an array initialised from an expression as cl6x does (#522-D then #145-D)', () => {
    const a: VarSym = { kind: 'var', name: 'a', linkName: 'a', type: arrayOf(T.int, 2), loc: L, storage: 'auto', external: false, file: 'f.c', init: null, defined: true, cregister: false, register: false, hidden: false, refs: 0, sets: 0, id: 0 }
    expect(lower(arrayOf(T.int, 2), x({ k: 'var', loc: L, type: a.type, sym: a })).codes).toEqual(['522-D', '145-D'])
  })
  it('fills arrays of structs with brace elision', () => {
    expect(lower(arrayOf(point(), 2), list(list(n(1), n(2)), n(3), n(4))).rows.map((r) => r[0])).toEqual([0, 4, 8, 12])
  })
  it('initialises the first union member unless designated', () => {
    const def = newRecord('union', 'U')
    completeRecord(def, [{ name: 'i', type: T.int }, { name: 'f', type: T.float }])
    const u: Type = { kind: 'union', def }
    expect(lower(u, list(n(5))).rows).toEqual([[0, 'int', 5]])
    expect(lower(u, list([[fld('f')], n(2)])).rows).toEqual([[0, 'float', 2]])
  })
  it('reports unknown fields with cl6x #137', () => {
    expect(lower(point(), list([[fld('z')], n(1)])).codes).toEqual(['137'])
  })
})
