import { describe, expect, it } from 'vitest'
import { Memory, Trap, hex } from '../../../../src/interp/exec/memory'

const SHRAM = { name: 'SHRAM', origin: 0x80000000, length: 0x20000, attr: 'RWIX' }
const L1D = { name: 'L1D', origin: 0x00f00000, length: 0x8000, attr: 'RWIX' }

describe('Memory', () => {
  it('stores and loads every scalar width little-endian', () => {
    const m = new Memory([SHRAM])
    m.set32(0x80000000, 0x11223344)
    expect([m.u8(0x80000000), m.u8(0x80000003)]).toEqual([0x44, 0x11])
    expect(m.u16(0x80000002)).toBe(0x1122)
    m.set32(0x80000004, -2)
    expect([m.i32(0x80000004), m.u32(0x80000004)]).toEqual([-2, 0xfffffffe])
    m.setF32(0x80000008, 0.1)
    expect(m.f32(0x80000008)).toBe(Math.fround(0.1))
    m.setF64(0x80000010, Math.PI)
    expect(m.f64(0x80000010)).toBe(Math.PI)
    m.set64(0x80000018, -5n)
    expect([m.i64(0x80000018), m.u64(0x80000018)]).toEqual([-5n, (1n << 64n) - 5n])
    m.set8(0x80000020, 200)
    expect([m.i8(0x80000020), m.u8(0x80000020)]).toEqual([-56, 200])
    m.set16(0x80000022, 0x8001)
    expect([m.i16(0x80000022), m.u16(0x80000022)]).toEqual([-32767, 0x8001])
  })

  it('ignores the low address bits like LDH/LDW/LDDW', () => {
    const m = new Memory([SHRAM])
    m.set32(0x80000100, 0xcafebabe)
    expect(m.u32(0x80000102)).toBe(0xcafebabe)
    expect(m.u16(0x80000101)).toBe(0xbabe)
    m.setF64(0x80000207, 2.5)
    expect(m.f64(0x80000200)).toBe(2.5)
  })

  it('traps outside the mapped regions, also inside a partly mapped page', () => {
    const m = new Memory([SHRAM, L1D])
    expect(() => m.u32(0)).toThrow(Trap)
    expect(() => m.u32(0)).toThrow('Illegal memory access at 0x00000000')
    expect(() => m.set8(0x80020000, 1)).toThrow('Illegal memory access at 0x80020000')
    m.set8(0x00f07fff, 1)
    expect(() => m.u8(0x00f08000)).toThrow(Trap)
    expect(m.isMapped(0x00f07ffc, 4)).toBe(true)
    expect(m.isMapped(0x00f07ffe, 4)).toBe(false)
  })

  it('copies, fills and reads C strings; peek never traps', () => {
    const m = new Memory([SHRAM])
    m.write(0x80000000, [104, 105, 0, 33])
    expect(m.cstring(0x80000000)).toBe('hi')
    m.copy(0x80000001, 0x80000000, 3)
    expect([...m.read(0x80000000, 4)]).toEqual([104, 104, 105, 0])
    m.fill(0x80000000, 0x7f, 2)
    expect([...m.read(0x80000000, 3)]).toEqual([0x7f, 0x7f, 105])
    expect(m.peek(0x8001fffe, 4)).toBeNull()
    expect([...(m.peek(0x80000000, 2) as Uint8Array)]).toEqual([0x7f, 0x7f])
  })

  it('formats addresses like CCS', () => {
    expect(hex(0x80001234)).toBe('80001234')
    expect(hex(-1)).toBe('FFFFFFFF')
  })
})
