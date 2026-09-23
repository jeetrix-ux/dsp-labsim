import { describe, expect, it } from 'vitest'
import { alignDown, float32Text, formatRows, hexAddr, PAGE_BYTES, unitSize } from '../../../src/renderer/src/memory/format'

/** One 16-byte row: 0.5f, -1, 'A' 'B' 0 0x7f, 0x12345678. */
const ROW = [0x00, 0x00, 0x00, 0x3f, 0xff, 0xff, 0xff, 0xff, 0x41, 0x42, 0x00, 0x7f, 0x78, 0x56, 0x34, 0x12]

describe('memory formats', () => {
  it('formats 32-bit words', () => {
    const cells = (f: Parameters<typeof formatRows>[2]) => formatRows(0x80001000, ROW, f)[0].cells
    expect(cells('32-Bit Hex - TI Style')).toEqual(['3F000000', 'FFFFFFFF', '7F004241', '12345678'])
    expect(cells('32-Bit Hex - C Style')).toEqual(['0x3F000000', '0xFFFFFFFF', '0x7F004241', '0x12345678'])
    expect(cells('32-Bit Signed Int')).toEqual(['1056964608', '-1', '2130723393', '305419896'])
    expect(cells('32-Bit Unsigned Int')).toEqual(['1056964608', '4294967295', '2130723393', '305419896'])
    expect(cells('32-Bit Floating Point')[0]).toBe('0.5')
    expect(cells('32-Bit Floating Point')[1]).toBe('NaN')
  })

  it('formats 16-bit, 8-bit and characters', () => {
    const cells = (f: Parameters<typeof formatRows>[2]) => formatRows(0, ROW, f)[0].cells
    expect(cells('16-Bit Hex - TI Style').slice(0, 3)).toEqual(['0000', '3F00', 'FFFF'])
    expect(cells('16-Bit Signed Int').slice(2, 4)).toEqual(['-1', '-1'])
    expect(cells('8-Bit Hex - TI Style')).toHaveLength(16)
    expect(cells('8-Bit Hex - TI Style')[3]).toBe('3F')
    expect(cells('Character').slice(8, 12)).toEqual(['A', 'B', '.', '.'])
  })

  it('marks unreadable bytes and numbers the rows', () => {
    const bytes = [...ROW, ...Array<null>(16).fill(null)]
    const rows = formatRows(0x80001000, bytes, '32-Bit Hex - TI Style')
    expect(rows.map((r) => r.address)).toEqual([0x80001000, 0x80001010])
    expect(rows[1].cells).toEqual(['????????', '????????', '????????', '????????'])
    expect(formatRows(0, bytes, 'Character')[1].cells[0]).toBe('?')
    expect(formatRows(0, bytes, '32-Bit Floating Point')[1].cells[0]).toBe('????????')
  })

  it('aligns, prints addresses and float text', () => {
    expect(PAGE_BYTES).toBe(512)
    expect(unitSize('16-Bit Signed Int')).toBe(2)
    expect(alignDown(0x80001003, '32-Bit Floating Point')).toBe(0x80001000)
    expect(alignDown(0x80001003, 'Character')).toBe(0x80001003)
    expect(hexAddr(0x80001000)).toBe('0x80001000')
    expect(hexAddr(0x10)).toBe('0x00000010')
    expect(float32Text(Math.fround(0.1))).toBe('0.1')
    expect(float32Text(Math.fround(-1.75e-7))).toBe('-1.75e-7')
    expect(float32Text(Infinity)).toBe('Inf')
    expect(float32Text(-0)).toBe('0')
  })
})
