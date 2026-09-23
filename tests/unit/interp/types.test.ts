import { describe, expect, it } from 'vitest'
import {
  T, alignOf, arrayOf, compatible, completeRecord, isComplete, newRecord, pointerTo, promote, sizeOf, typeToString,
  usualArith, withQuals, type Type
} from '../../../src/interp/frontend/types'

const fn = (ret: Type, params: Type[], variadic = false, prototyped = true): Type => ({
  kind: 'function', ret, params: params.map((type) => ({ name: null, type, loc: null })), variadic, prototyped
})

describe('EABI sizes and alignment', () => {
  it('uses the C6000 model: 32-bit long, 40-bit int in 8 bytes, 64-bit double', () => {
    const rows: [Type, number, number][] = [
      [T.bool, 1, 1], [T.char, 1, 1], [T.short, 2, 2], [T.int, 4, 4], [T.long, 4, 4], [T.llong, 8, 8], [T.int40, 8, 8],
      [T.float, 4, 4], [T.double, 8, 8], [T.ldouble, 8, 8], [pointerTo(T.char), 4, 4], [arrayOf(T.short, 5), 10, 2]
    ]
    for (const [t, size, align] of rows) expect([typeToString(t), sizeOf(t), alignOf(t)]).toEqual([typeToString(t), size, align])
  })
  it('lays out structs and unions with natural alignment', () => {
    const s = newRecord('struct', 'pt')
    completeRecord(s, [{ name: 'c', type: T.char }, { name: 'd', type: T.double }, { name: 's', type: T.short }])
    expect(s.members?.map((m) => m.offset)).toEqual([0, 8, 16])
    expect([s.size, s.align]).toEqual([24, 8])
    const u = newRecord('union', 'u')
    completeRecord(u, [{ name: 'i', type: T.int }, { name: 'b', type: arrayOf(T.char, 6) }])
    expect([u.size, u.align, u.members?.[1].offset]).toEqual([8, 4, 0])
    const flex = newRecord('struct', 'f')
    completeRecord(flex, [{ name: 'n', type: T.int }, { name: 'data', type: arrayOf(T.float, null) }])
    expect(flex.size).toBe(4)
    expect(isComplete({ kind: 'struct', def: newRecord('struct', 'x') })).toBe(false)
  })
})

describe('conversions', () => {
  it('promotes small integers and enums to int', () => {
    expect(promote(T.char)).toBe(T.int)
    expect(promote(T.ushort)).toBe(T.int)
    expect(promote(T.bool)).toBe(T.int)
    expect(promote({ ...T.int, enumTag: 'E' })).toBe(T.int)
    expect(promote(T.uint)).toBe(T.uint)
  })
  it('applies the usual arithmetic conversions with a 32-bit long', () => {
    expect(usualArith(T.int, T.float)).toBe(T.float)
    expect(usualArith(T.float, T.double)).toBe(T.double)
    expect(usualArith(T.char, T.short)).toBe(T.int)
    expect(usualArith(T.int, T.uint)).toBe(T.uint)
    expect(usualArith(T.long, T.uint)).toBe(T.ulong)
    expect(usualArith(T.llong, T.ulong)).toBe(T.llong)
    expect(usualArith(T.int40, T.uint)).toBe(T.int40)
    expect(usualArith(T.ullong, T.llong)).toBe(T.ullong)
  })
})

describe('compatibility', () => {
  it('follows C rules for qualifiers, arrays, records and prototypes', () => {
    expect(compatible(T.int, { ...T.int, enumTag: 'E' })).toBe(true)
    expect(compatible(T.char, T.schar)).toBe(false)
    expect(compatible(T.int, withQuals(T.int, { const: true }))).toBe(false)
    expect(compatible(arrayOf(T.int, null), arrayOf(T.int, 4))).toBe(true)
    expect(compatible(arrayOf(T.int, 3), arrayOf(T.int, 4))).toBe(false)
    expect(compatible(fn(T.int, []), fn(T.int, [T.int], false, true))).toBe(false)
    expect(compatible(fn(T.int, [], false, false), fn(T.int, [T.int]))).toBe(true)
    const a = newRecord('struct', 'a')
    expect(compatible({ kind: 'struct', def: a }, { kind: 'struct', def: newRecord('struct', 'a') })).toBe(false)
  })
})

describe('typeToString', () => {
  it('prints types the way cl6x messages do', () => {
    const s = newRecord('struct', 'S')
    const anon = newRecord('struct', null)
    const rows: [Type, string][] = [
      [pointerTo(T.int), 'int *'],
      [pointerTo(withQuals(T.char, { const: true })), 'const char *'],
      [withQuals(pointerTo(withQuals(T.char, { const: true })), { const: true }), 'const char *const'],
      [pointerTo(arrayOf(T.int, 3)), 'int (*)[3]'],
      [pointerTo(fn(T.int, [T.int])), 'int (*)(int)'],
      [arrayOf(pointerTo(T.int), 3), 'int *[3]'],
      [fn(T.double, [T.double]), 'double (double)'],
      [fn(T.void, []), 'void (void)'],
      [fn(T.int, [], false, false), 'int ()'],
      [fn(T.int, [pointerTo(withQuals(T.char, { const: true }))], true), 'int (const char *, ...)'],
      [{ kind: 'struct', def: s }, 'struct S'],
      [{ kind: 'struct', def: anon }, 'struct <unnamed>'],
      [T.uint, 'unsigned int'],
      [{ ...T.double, alias: 'real64_T' }, 'real64_T'],
      [pointerTo({ ...T.double, alias: 'real64_T' }), 'real64_T *'],
      [{ ...T.int, enumTag: 'color' }, 'enum color']
    ]
    for (const [t, text] of rows) expect(typeToString(t)).toBe(text)
    expect(typeToString(fn(T.double, [T.double]), 'f')).toBe('double f(double)')
    expect(typeToString(T.int, 'x')).toBe('int x')
  })
})
