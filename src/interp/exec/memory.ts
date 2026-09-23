import type { MemoryRegion } from '@shared/program'

/** Why the simulated target stopped: an illegal access, a division by zero, a stack overflow… */
export class Trap extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Trap'
  }
}

/** An address as CCS shows it: eight upper-case hex digits. */
export const hex = (n: number): string => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')

const PAGE_BITS = 16
const PAGE_SIZE = 1 << PAGE_BITS
const OFFSET = PAGE_SIZE - 1

interface Page {
  view: DataView
  bytes: Uint8Array
  /** Mapped byte range inside the page (a region may cover only part of it). */
  lo: number
  hi: number
}

/**
 * The simulated 32-bit address space: the MEMORY regions of the linker command file, backed by 64 KB pages that are
 * allocated on first touch. Accesses are little-endian and, like the C674x's LDH/LDW/LDDW, ignore the address bits
 * that alignment requires, so an aligned access never straddles a page.
 */
export class Memory {
  readonly regions: readonly MemoryRegion[]
  private readonly table: (Page | undefined)[] = new Array(1 << (32 - PAGE_BITS))

  constructor(regions: readonly MemoryRegion[]) {
    this.regions = [...regions].sort((a, b) => a.origin - b.origin)
  }

  /** True when every byte of [addr, addr + size) lies in one region. */
  isMapped(addr: number, size = 1): boolean {
    const a = addr >>> 0
    return this.regions.some((r) => a >= r.origin && a + size <= r.origin + r.length)
  }

  illegal(addr: number): Trap {
    return new Trap(`Illegal memory access at 0x${hex(addr)}`)
  }

  private page(a: number): Page {
    const k = a >>> PAGE_BITS
    const base = k * PAGE_SIZE
    let lo = PAGE_SIZE
    let hi = 0
    for (const r of this.regions) {
      const s = Math.max(r.origin, base)
      const e = Math.min(r.origin + r.length, base + PAGE_SIZE)
      if (s < e) {
        lo = Math.min(lo, s - base)
        hi = Math.max(hi, e - base)
      }
    }
    if (hi <= lo) throw this.illegal(a)
    const buf = new ArrayBuffer(PAGE_SIZE)
    const p: Page = { view: new DataView(buf), bytes: new Uint8Array(buf), lo, hi }
    this.table[k] = p
    return p
  }

  private at(a: number, size: number): DataView {
    const p = this.table[a >>> PAGE_BITS] ?? this.page(a)
    const off = a & OFFSET
    if (off < p.lo || off + size > p.hi) throw this.illegal(a)
    return p.view
  }

  i8(a: number): number {
    return this.at(a, 1).getInt8(a & OFFSET)
  }
  u8(a: number): number {
    return this.at(a, 1).getUint8(a & OFFSET)
  }
  i16(a: number): number {
    a &= ~1
    return this.at(a, 2).getInt16(a & OFFSET, true)
  }
  u16(a: number): number {
    a &= ~1
    return this.at(a, 2).getUint16(a & OFFSET, true)
  }
  i32(a: number): number {
    a &= ~3
    return this.at(a, 4).getInt32(a & OFFSET, true)
  }
  u32(a: number): number {
    a &= ~3
    return this.at(a, 4).getUint32(a & OFFSET, true)
  }
  f32(a: number): number {
    a &= ~3
    return this.at(a, 4).getFloat32(a & OFFSET, true)
  }
  f64(a: number): number {
    a &= ~7
    return this.at(a, 8).getFloat64(a & OFFSET, true)
  }
  i64(a: number): bigint {
    a &= ~7
    return this.at(a, 8).getBigInt64(a & OFFSET, true)
  }
  u64(a: number): bigint {
    a &= ~7
    return this.at(a, 8).getBigUint64(a & OFFSET, true)
  }

  set8(a: number, v: number): void {
    this.at(a, 1).setInt8(a & OFFSET, v)
  }
  set16(a: number, v: number): void {
    a &= ~1
    this.at(a, 2).setInt16(a & OFFSET, v, true)
  }
  set32(a: number, v: number): void {
    a &= ~3
    this.at(a, 4).setInt32(a & OFFSET, v, true)
  }
  setF32(a: number, v: number): void {
    a &= ~3
    this.at(a, 4).setFloat32(a & OFFSET, v, true)
  }
  setF64(a: number, v: number): void {
    a &= ~7
    this.at(a, 8).setFloat64(a & OFFSET, v, true)
  }
  set64(a: number, v: bigint): void {
    a &= ~7
    this.at(a, 8).setBigInt64(a & OFFSET, v, true)
  }

  read(a: number, n: number): Uint8Array {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = this.u8(a + i)
    return out
  }

  write(a: number, bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.set8(a + i, bytes[i])
  }

  /** memmove semantics: overlapping ranges copy correctly. */
  copy(dst: number, src: number, n: number): void {
    if (n > 0) this.write(dst, this.read(src, n))
  }

  fill(a: number, byte: number, n: number): void {
    for (let i = 0; i < n; i++) this.set8(a + i, byte)
  }

  /** The NUL-terminated string at a, one character per byte. */
  cstring(a: number, max = 0x100000): string {
    let s = ''
    for (let i = 0; i < max; i++) {
      const c = this.u8(a + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }

  /** Reads without trapping, for graphs and the Memory view: null when any byte is unmapped. */
  peek(a: number, n: number): Uint8Array | null {
    for (let i = 0; i < n; i++) if (!this.isMapped(a + i)) return null
    return this.read(a, n)
  }
}
