import { describe, expect, it } from 'vitest'
import { parseChar, parseNumber, parseString } from '../../../src/interp/frontend/literals'

describe('parseNumber', () => {
  it('decodes integer constants with their radix and suffix', () => {
    expect(parseNumber('42')).toEqual({ kind: 'int', value: 42n, unsigned: false, longs: 0, decimal: true })
    expect(parseNumber('0x1Fu')).toEqual({ kind: 'int', value: 31n, unsigned: true, longs: 0, decimal: false })
    expect(parseNumber('017')).toMatchObject({ value: 15n, decimal: false })
    expect(parseNumber('0b101')).toMatchObject({ value: 5n })
    expect(parseNumber('10UL')).toMatchObject({ value: 10n, unsigned: true, longs: 1 })
    expect(parseNumber('5ll')).toMatchObject({ longs: 2 })
    expect(parseNumber('0')).toMatchObject({ value: 0n })
  })
  it('decodes floating constants, rounding f-suffixed ones to single precision', () => {
    expect(parseNumber('1.5f')).toEqual({ kind: 'float', value: 1.5, suffix: 'f' })
    expect(parseNumber('0.1f')).toMatchObject({ value: Math.fround(0.1) })
    expect(parseNumber('1e3')).toEqual({ kind: 'float', value: 1000, suffix: '' })
    expect(parseNumber('.5L')).toEqual({ kind: 'float', value: 0.5, suffix: 'l' })
    expect(parseNumber('2.')).toMatchObject({ value: 2 })
    expect(parseNumber('0x1p-3')).toMatchObject({ value: 0.125 })
  })
  it('classifies the errors cl6x reports', () => {
    expect(parseNumber('08')).toEqual({ kind: 'error', error: 'octal' })
    expect(parseNumber('1.0e')).toEqual({ kind: 'error', error: 'float' })
    expect(parseNumber('3x')).toEqual({ kind: 'error', error: 'extra' })
    expect(parseNumber('1uu')).toEqual({ kind: 'error', error: 'extra' })
  })
})

describe('parseChar and parseString', () => {
  it('decodes escapes; plain char is signed on the C6000', () => {
    expect(parseChar("'a'")).toEqual({ value: 97, chars: 1, wide: false })
    expect(parseChar("'\\n'").value).toBe(10)
    expect(parseChar("'\\xff'").value).toBe(-1)
    expect(parseChar("'\\377'").value).toBe(-1)
    expect(parseChar("'\\0'").value).toBe(0)
    expect(parseChar("'ab'")).toEqual({ value: 0x6162, chars: 2, wide: false })
    expect(parseChar("L'a'")).toEqual({ value: 97, chars: 1, wide: true })
  })
  it('decodes strings into bytes, UTF-8 for non-ASCII', () => {
    expect(parseString('"a\\tb\\0c"').units).toEqual([97, 9, 98, 0, 99])
    expect(parseString('"\\x41\\101\\"\\\\"').units).toEqual([65, 65, 34, 92])
    expect(parseString('"°"').units).toEqual([0xc2, 0xb0])
    expect(parseString('"abc').units).toEqual([97, 98, 99])
  })
})
