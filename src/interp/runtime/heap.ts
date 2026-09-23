import type { Machine } from '../exec/machine'
import { state } from './types'

/** BLOCK_OVERHEAD and MIN_BLOCK: sizeof(long double). */
const OVERHEAD = 8
const MIN_BLOCK = 8
const USED = 1
const MASK = 7
const MAX_REQUEST = 0xffffffff - OVERHEAD - MASK - 1

/**
 * TI's RTS heap (lib/src/memory.c) running on simulated memory: each packet starts with an 8-byte header (size,
 * next-free link) inside .sysmem, and the free list is ordered by size. Addresses, fragmentation and exhaustion
 * therefore match the board.
 */
export class Heap {
  private free = 0
  private needInit = true
  private readonly start: number
  /** heap_size(): __TI_SYSMEM_SIZE - BLOCK_OVERHEAD. */
  private readonly size: number

  constructor(private readonly m: Machine) {
    this.start = m.image.heap.start >>> 0
    this.size = m.image.heap.size - OVERHEAD
  }

  private psize(p: number): number {
    return this.m.mem.u32(p)
  }
  private setPsize(p: number, v: number): void {
    this.m.mem.set32(p, v)
  }
  private link(p: number): number {
    return this.m.mem.u32(p + 4)
  }
  private setLink(p: number, v: number): void {
    this.m.mem.set32(p + 4, v)
  }

  private init(): void {
    this.free = this.start
    this.setPsize(this.start, this.size)
    this.setLink(this.start, 0)
    this.needInit = false
  }

  private minsert(ptr: number): void {
    let current = this.free
    let last = 0
    if (current === 0) {
      this.free = ptr
      this.setLink(ptr, 0)
      return
    }
    const size = this.psize(ptr)
    while (current !== 0 && this.psize(current) < size) {
      last = current
      current = this.link(current)
    }
    if (current === 0) {
      this.setLink(last, ptr)
      this.setLink(ptr, 0)
    } else if (last === 0) {
      this.setLink(ptr, this.free)
      this.free = ptr
    } else {
      this.setLink(ptr, current)
      this.setLink(last, ptr)
    }
  }

  private mremove(ptr: number): void {
    let current = this.free
    let last = 0
    while (current !== 0 && current !== ptr) {
      last = current
      current = this.link(current)
    }
    if (current === 0) this.free = 0
    else if (last === 0) this.free = this.link(ptr)
    else this.setLink(last, this.link(ptr))
  }

  malloc(request: number): number {
    const size = request >>> 0
    if (size === 0 || size > MAX_REQUEST || this.size < MIN_BLOCK) return 0
    const newsize = ((size + MASK) & ~MASK) >>> 0
    if (this.needInit) this.init()
    let current = this.free
    while (current !== 0 && this.psize(current) < newsize) current = this.link(current)
    if (current === 0) return 0
    const oldsize = this.psize(current)
    this.mremove(current)
    if (oldsize - newsize >= MIN_BLOCK + OVERHEAD) {
      const next = current + OVERHEAD + newsize
      this.setPsize(next, oldsize - newsize - OVERHEAD)
      this.minsert(next)
      this.setPsize(current, newsize)
    }
    this.setPsize(current, (this.psize(current) | USED) >>> 0)
    return current + OVERHEAD
  }

  calloc(num: number, size: number): number {
    const bytes = Math.imul(num, size) >>> 0
    const p = this.malloc(bytes)
    if (p !== 0) this.m.mem.fill(p, 0, bytes)
    return p
  }

  realloc(packet: number, request: number): number {
    const size = request >>> 0
    if (size > MAX_REQUEST) return 0
    const newsize = ((size + MASK) & ~MASK) >>> 0
    if (packet === 0) return this.malloc(size)
    if (size === 0) {
      this.release(packet)
      return 0
    }
    let pptr = packet - OVERHEAD
    let oldsize = this.psize(pptr)
    if (!(oldsize & USED)) return 0
    oldsize -= 1
    if (newsize === oldsize) return packet
    if (newsize < oldsize) {
      if (oldsize - newsize >= MIN_BLOCK + OVERHEAD) {
        this.setPsize(pptr, (newsize | USED) >>> 0)
        oldsize -= newsize + OVERHEAD
        pptr += newsize + OVERHEAD
        this.setPsize(pptr, (oldsize | USED) >>> 0)
        this.release(pptr + OVERHEAD)
      }
      return packet
    }
    const next = pptr + oldsize + OVERHEAD
    if (next < this.start + this.size && !(this.psize(next) & USED)) {
      const temp = (oldsize + this.psize(next) + OVERHEAD - newsize) | 0
      if (temp >= 0) {
        this.mremove(next)
        if (temp < MIN_BLOCK + OVERHEAD) {
          this.setPsize(pptr, ((newsize + temp) | USED) >>> 0)
          return packet
        }
        this.setPsize(pptr, (newsize | USED) >>> 0)
        pptr += newsize + OVERHEAD
        this.setPsize(pptr, temp - OVERHEAD)
        this.minsert(pptr)
        return packet
      }
    }
    const fresh = this.malloc(size)
    if (fresh !== 0) {
      this.m.mem.copy(fresh, packet, oldsize)
      this.release(packet)
    }
    return fresh
  }

  /** free() */
  release(packet: number): void {
    if (packet === 0) return
    const ptr = packet - OVERHEAD
    let last = 0
    let current = this.start
    while (current < ptr) {
      last = current
      current = current + (this.psize(current) & ~USED) + OVERHEAD
    }
    if (current !== ptr || !(this.psize(current) & USED)) return
    this.setPsize(current, this.psize(current) & ~USED)
    let next = current + OVERHEAD + this.psize(current)
    if (next > this.start + this.size) next = 0
    if (last !== 0 && this.psize(last) & USED) last = 0
    if (next !== 0 && this.psize(next) & USED) next = 0
    if (last !== 0 && next !== 0) {
      this.mremove(last)
      this.mremove(next)
      this.setPsize(last, this.psize(last) + this.psize(current) + this.psize(next) + 2 * OVERHEAD)
      this.minsert(last)
      return
    }
    if (last !== 0) {
      this.mremove(last)
      this.setPsize(last, this.psize(last) + this.psize(current) + OVERHEAD)
      this.minsert(last)
      return
    }
    if (next !== 0) {
      this.mremove(next)
      this.setPsize(current, this.psize(current) + this.psize(next) + OVERHEAD)
      this.minsert(current)
      return
    }
    this.minsert(current)
  }

  memalign(alignmentArg: number, request: number): number {
    const size = request >>> 0
    const alignment = alignmentArg >>> 0
    if (size === 0 || size > MAX_REQUEST) return 0
    const newsize = ((size + MASK) & ~MASK) >>> 0
    if (this.needInit) this.init()
    if (alignment <= OVERHEAD || (alignment & (alignment - 1)) !== 0) return this.malloc(size)
    let current = this.free
    let aligned = 0
    let unaligned = 0
    let leftover = 0
    for (; current !== 0; current = this.link(current)) {
      unaligned = current + OVERHEAD
      aligned = Math.ceil(unaligned / alignment) * alignment
      if (unaligned !== aligned) while (current + 8 > aligned - OVERHEAD) aligned += alignment
      const nextStart = unaligned + this.psize(current)
      const end = aligned + newsize
      if (nextStart >= end) {
        leftover = nextStart - end
        break
      }
    }
    if (current === 0) return 0
    this.mremove(current)
    const packet = aligned - OVERHEAD
    this.setPsize(packet, (newsize | USED) >>> 0)
    if (aligned !== unaligned) {
      this.setPsize(current, packet - unaligned)
      this.minsert(current)
    }
    if (leftover >= OVERHEAD + MIN_BLOCK) {
      const next = aligned + newsize
      this.setPsize(next, leftover - OVERHEAD)
      this.minsert(next)
    } else this.setPsize(packet, (this.psize(packet) + leftover) >>> 0)
    return aligned
  }
}

export const heap = state((m) => new Heap(m))
