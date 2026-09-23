import { describe, expect, it } from 'vitest'
import { Memory } from '../../../../src/interp/exec/memory'
import { converter, f2i, f2u, kindOf, loader, storer, zeroOf, type Kind } from '../../../../src/interp/exec/scalar'
import { T, arrayOf, pointerTo } from '../../../../src/interp/frontend/types'

const conv = (from: Kind, to: Kind, v: number | bigint): number | bigint => {
  const c = converter(from, to)
  return c ? c(v) : v
}

describe('kindOf', () => {
  it('maps C6000 EABI types to value kinds', () => {
    expect([T.bool, T.char, T.uchar, T.short, T.ushort, T.int, T.uint, T.long, T.ulong].map(kindOf)).toEqual([
      'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i32', 'u32'
    ])
    expect([T.int40, T.uint40, T.llong, T.ullong, T.float, T.double, T.ldouble].map(kindOf)).toEqual([
      'i40', 'u40', 'i64', 'u64', 'f32', 'f64', 'f64'
    ])
    expect([pointerTo(T.int), arrayOf(T.int, 4), T.void].map(kindOf)).toEqual(['ptr', 'agg', 'void'])
  })
})

describe('integer conversions wrap at the declared width', () => {
  it('narrows and sign-extends', () => {
    expect(conv('i32', 'i8', 200)).toBe(-56)
    expect(conv('i32', 'u8', -1)).toBe(255)
    expect(conv('i32', 'i16', 40000)).toBe(-25536)
    expect(conv('i32', 'u32', -1)).toBe(4294967295)
    expect(conv('u32', 'i32', 4294967295)).toBe(-1)
    expect(conv('i8', 'i32', -5)).toBe(-5)
    expect(converter('u8', 'i32')).toBeNull()
  })
  it('converts to and from 40- and 64-bit integers', () => {
    expect(conv('i32', 'u64', -1)).toBe((1n << 64n) - 1n)
    expect(conv('i64', 'i32', (1n << 32n) + 7n)).toBe(7)
    expect(conv('i64', 'i40', 1n << 39n)).toBe(-(1n << 39n))
    expect(conv('u32', 'i64', 4294967295)).toBe(4294967295n)
  })
  it('treats any non-zero value as true for _Bool', () => {
    expect(conv('i32', 'bool', 256)).toBe(1)
    expect(conv('f64', 'bool', 0.25)).toBe(1)
    expect(conv('f64', 'bool', NaN)).toBe(1)
    expect(conv('i64', 'bool', 0n)).toBe(0)
  })
})

describe('floating-point conversions', () => {
  it('rounds to single precision', () => {
    expect(conv('f64', 'f32', 0.1)).toBe(Math.fround(0.1))
    expect(conv('i32', 'f32', 16777217)).toBe(16777216)
    expect(converter('f32', 'f64')).toBeNull()
  })
  it('truncates and saturates like SPTRUNC/DPTRUNC', () => {
    expect([f2i(2.9), f2i(-2.9), f2i(1e10), f2i(-1e10), f2i(NaN)]).toEqual([2, -2, 2147483647, -2147483648, -2147483648])
    expect(conv('f64', 'i16', 40000.5)).toBe(-25536)
  })
  it('converts to unsigned like _fixdu (saturating, wrapping negatives)', () => {
    expect([f2u(3.7), f2u(5e9), f2u(-1)]).toEqual([3, 4294967295, 4294967295])
    expect(conv('f64', 'u64', 1e30)).toBe((1n << 64n) - 1n)
    expect(conv('f64', 'i64', -1e30)).toBe(-(1n << 63n))
  })
})

describe('loader and storer', () => {
  it('round-trip every kind through memory', () => {
    const mem = new Memory([{ name: 'M', origin: 0x1000, length: 0x100, attr: 'RWIX' }])
    const cases: [Kind, number | bigint][] = [
      ['bool', 1], ['i8', -3], ['u8', 250], ['i16', -300], ['u16', 60000], ['i32', -70000], ['u32', 4000000000],
      ['i40', -(1n << 38n)], ['u40', (1n << 40n) - 1n], ['i64', -9n], ['u64', 1n << 63n], ['f32', Math.fround(1.5)], ['f64', 1e-300], ['ptr', 0x80000000]
    ]
    for (const [k, v] of cases) {
      storer(mem, k)(0x1008, v)
      expect(loader(mem, k)(0x1008)).toBe(v)
    }
    expect(loader(mem, 'agg')(0x1010)).toBe(0x1010)
    expect([zeroOf('i64'), zeroOf('f32')]).toEqual([0n, 0])
  })
})
