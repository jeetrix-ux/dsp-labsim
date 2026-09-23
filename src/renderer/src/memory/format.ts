/** The Memory Browser's formats (CCS's names) and row layout. */

export const MEMORY_FORMATS = [
  '32-Bit Hex - TI Style',
  '32-Bit Hex - C Style',
  '32-Bit Signed Int',
  '32-Bit Unsigned Int',
  '32-Bit Floating Point',
  '16-Bit Hex - TI Style',
  '16-Bit Signed Int',
  '8-Bit Hex - TI Style',
  'Character'
] as const
export type MemoryFormat = (typeof MEMORY_FORMATS)[number]

export const ROW_BYTES = 16
export const PAGE_ROWS = 32
export const PAGE_BYTES = ROW_BYTES * PAGE_ROWS

export function unitSize(f: MemoryFormat): 1 | 2 | 4 {
  return f.startsWith('32') ? 4 : f.startsWith('16') ? 2 : 1
}

export const alignDown = (addr: number, f: MemoryFormat): number => (addr - (addr % unitSize(f))) >>> 0

export const hexAddr = (n: number): string => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

/** The shortest decimal that reads back as the same float32. */
export function float32Text(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf'
  if (v === 0) return '0'
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p))
    if (Math.fround(n) === v) return String(n)
  }
  return String(v)
}

export interface MemoryRow {
  address: number
  cells: string[]
}

function cell(b: (number | null)[], f: MemoryFormat): string {
  const size = b.length
  if (b.some((x) => x === null)) return f === 'Character' ? '?' : '?'.repeat(size * 2)
  const bytes = b as number[]
  const u = bytes.reduceRight((acc, x) => acc * 256 + x, 0)
  const hex = u.toString(16).toUpperCase().padStart(size * 2, '0')
  switch (f) {
    case '32-Bit Hex - C Style':
      return `0x${hex}`
    case '32-Bit Signed Int':
      return String(u | 0)
    case '32-Bit Unsigned Int':
      return String(u)
    case '16-Bit Signed Int':
      return String(u >= 0x8000 ? u - 0x10000 : u)
    case '32-Bit Floating Point':
      return float32Text(new DataView(Uint8Array.from(bytes).buffer).getFloat32(0, true))
    case 'Character':
      return u >= 32 && u < 127 ? String.fromCharCode(u) : '.'
    default:
      return hex
  }
}

/** bytes[i] is the byte at start + i, or null where memory cannot be read. */
export function formatRows(start: number, bytes: (number | null)[], f: MemoryFormat): MemoryRow[] {
  const size = unitSize(f)
  const rows: MemoryRow[] = []
  for (let r = 0; r + ROW_BYTES <= bytes.length; r += ROW_BYTES) {
    const cells: string[] = []
    for (let i = r; i < r + ROW_BYTES; i += size) cells.push(cell(bytes.slice(i, i + size), f))
    rows.push({ address: (start + r) >>> 0, cells })
  }
  return rows
}
