import { describe, expect, it } from 'vitest'
import { formatValue, shortestFloat, typeName } from '../../../../src/interp/debug/format'
import { T, arrayOf, pointerTo } from '../../../../src/interp/frontend/types'

describe('formatValue', () => {
  it('shows integers, chars and pointers like CCS', () => {
    expect(formatValue(-5, T.int, 'natural')).toBe('-5')
    expect(formatValue(-5, T.int, 'hex')).toBe('0xFFFFFFFB')
    expect(formatValue(5, T.short, 'binary')).toBe('0b0000000000000101')
    expect(formatValue(65, T.char, 'natural')).toBe("65 'A'")
    expect(formatValue(10, T.uchar, 'char')).toBe("'\\n'")
    expect(formatValue(200, T.uchar, 'decimal')).toBe('200')
    expect(formatValue(-1n, T.llong, 'hex')).toBe('0xFFFFFFFFFFFFFFFF')
    expect(formatValue(0x80001230, pointerTo(T.float), 'natural')).toBe('0x80001230')
    expect(formatValue(0x80001000, arrayOf(T.int, 4), 'natural')).toBe('0x80001000')
  })
  it('shows floats with their shortest digits, or their bits', () => {
    expect(formatValue(Math.fround(0.1), T.float, 'natural')).toBe('0.1')
    expect(formatValue(Math.fround(1.5), T.float, 'hex')).toBe('0x3FC00000')
    expect(formatValue(0.1, T.double, 'natural')).toBe('0.1')
    expect(formatValue(-0.25, T.double, 'hex')).toBe('0xBFD0000000000000')
    expect(shortestFloat(Math.fround(3.14159265))).toBe('3.1415927')
  })
  it('names types the way CCS does', () => {
    expect(typeName(arrayOf(T.float, 8))).toBe('float[8]')
    expect(typeName(pointerTo(T.int))).toBe('int *')
  })
})
