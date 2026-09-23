import type { Machine } from '../exec/machine'
import { ERANGE, setErrno } from './errno'
import { heap } from './heap'
import { isSpace } from './string'
import { fn, state, type LibFunction } from './types'

const rng = state(() => ({ next: 1 }))

function digit(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 122) return c - 87
  if (c >= 65 && c <= 90) return c - 55
  return 99
}

/** strtol and friends: C semantics, saturating with ERANGE; `endp` receives the end of the number. */
function strtoint(m: Machine, s: number, endp: number, baseArg: number, bits: number, signed: boolean): bigint {
  const mem = m.mem
  let base = baseArg
  let p = s
  while (isSpace(mem.u8(p))) p++
  let neg = false
  const sign = mem.u8(p)
  if (sign === 45 || sign === 43) {
    neg = sign === 45
    p++
  }
  if ((base === 0 || base === 16) && mem.u8(p) === 48 && (mem.u8(p + 1) | 32) === 120 && digit(mem.u8(p + 2)) < 16) {
    p += 2
    base = 16
  } else if (base === 0) base = mem.u8(p) === 48 ? 8 : 10
  const b = BigInt(bits)
  const max = signed ? (neg ? 1n << (b - 1n) : (1n << (b - 1n)) - 1n) : (1n << b) - 1n
  let v = 0n
  let any = false
  let over = false
  for (;;) {
    const d = digit(mem.u8(p))
    if (d >= base) break
    any = true
    if (!over) {
      v = v * BigInt(base) + BigInt(d)
      if (v > max) over = true
    }
    p++
  }
  if (endp !== 0) mem.set32(endp, any ? p : s)
  if (over) {
    setErrno(m, ERANGE)
    return signed ? (neg ? -max : max) : max
  }
  return signed ? (neg ? -v : v) : BigInt.asUintN(bits, neg ? -v : v)
}

const FLOAT = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)/i

/** strtod: decimal floating constants, inf and nan; ERANGE on overflow. */
export function strtod(m: Machine, s: number, endp: number): number {
  let p = s
  while (isSpace(m.mem.u8(p))) p++
  const text = m.mem.cstring(p, 512)
  const match = FLOAT.exec(text)
  if (!match) {
    if (endp !== 0) m.mem.set32(endp, s)
    return 0
  }
  const t = match[0]
  if (endp !== 0) m.mem.set32(endp, p + t.length)
  const body = t.replace(/^[+-]/, '').toLowerCase()
  const neg = t[0] === '-'
  if (body.startsWith('inf')) return neg ? -Infinity : Infinity
  if (body === 'nan') return NaN
  const v = Number(t)
  if (!Number.isFinite(v)) setErrno(m, ERANGE)
  return v
}

/** TI's atoi/atol: no overflow check, the value simply wraps. */
function atoiWrap(m: Machine, s: number): number {
  let p = s
  while (isSpace(m.mem.u8(p))) p++
  const neg = m.mem.u8(p) === 45
  if (neg || m.mem.u8(p) === 43) p++
  let r = 0
  for (let c = m.mem.u8(p); c >= 48 && c <= 57; c = m.mem.u8(++p)) r = (Math.imul(r, 10) + c - 48) | 0
  return neg ? -r | 0 : r
}

function qsort(m: Machine, base: number, nmemb: number, size: number, cmp: number): void {
  if (nmemb <= 1) return
  const compare = (a: number, b: number): number => m.callAddress(cmp, [a >>> 0, b >>> 0]) | 0
  const swap = (a: number, b: number): void => {
    const x = m.mem.read(a, size)
    m.mem.copy(a, b, size)
    m.mem.write(b, x)
  }
  let i = 0
  let j = nmemb - 1
  let pivot = Math.floor(nmemb / 2)
  let pivp = base + pivot * size
  while (i < j) {
    while (compare(base + i * size, pivp) < 0) ++i
    while (compare(base + j * size, pivp) > 0) --j
    if (i < j) {
      swap(base + i * size, base + j * size)
      if (pivot === i) {
        pivot = j
        pivp = base + pivot * size
      } else if (pivot === j) {
        pivot = i
        pivp = base + pivot * size
      }
      ++i
      --j
    } else if (i === j) {
      ++i
      --j
      break
    }
  }
  if (j > 0) qsort(m, base, j + 1, size, cmp)
  if (i < nmemb - 1) qsort(m, base + i * size, nmemb - i, size, cmp)
}

function writeDiv(m: Machine, ret: number, quot: number | bigint, rem: number | bigint, wide: boolean): number {
  if (ret === 0) return 0
  if (wide) {
    m.mem.set64(ret, quot as bigint)
    m.mem.set64(ret + 8, rem as bigint)
  } else {
    m.mem.set32(ret, quot as number)
    m.mem.set32(ret + 4, rem as number)
  }
  return ret
}

export const STDLIB: Record<string, LibFunction> = {
  abs: fn(1, (_m, [x]) => (x < 0 ? -x | 0 : x)),
  labs: fn(1, (_m, [x]) => (x < 0 ? -x | 0 : x)),
  llabs: fn(1, (_m, [x]) => BigInt.asIntN(64, x < 0n ? -x : x)),
  div: fn(2, (m, [a, b], _va, ret) => {
    if (b === 0) m.trap('Division by zero')
    return writeDiv(m, ret, (a / b) | 0, (a % b) | 0, false)
  }),
  ldiv: fn(2, (m, args, va, ret) => STDLIB.div.call(m, args, va, ret)),
  lldiv: fn(2, (m, [a, b]: bigint[], _va, ret) => {
    if (b === 0n) m.trap('Division by zero')
    return writeDiv(m, ret, BigInt.asIntN(64, a / b), BigInt.asIntN(64, a % b), true)
  }),
  atoi: fn(1, (m, [s]) => atoiWrap(m, s)),
  atol: fn(1, (m, [s]) => atoiWrap(m, s)),
  atoll: fn(1, (m, [s]) => strtoint(m, s, 0, 10, 64, true)),
  atof: fn(1, (m, [s]) => strtod(m, s, 0)),
  strtol: fn(3, (m, [s, e, b]) => Number(strtoint(m, s, e, b, 32, true))),
  strtoul: fn(3, (m, [s, e, b]) => Number(strtoint(m, s, e, b, 32, false))),
  strtoll: fn(3, (m, [s, e, b]) => strtoint(m, s, e, b, 64, true)),
  strtoull: fn(3, (m, [s, e, b]) => strtoint(m, s, e, b, 64, false)),
  strtod: fn(2, (m, [s, e]) => strtod(m, s, e)),
  strtof: fn(2, (m, [s, e]) => Math.fround(strtod(m, s, e))),
  rand: fn(0, (m) => {
    const r = rng(m)
    r.next = (Math.imul(r.next, 1103515245) + 12345) >>> 0
    return Math.floor(r.next / 65536) % 32768
  }),
  srand: fn(1, (m, [seed]) => {
    rng(m).next = seed >>> 0
  }),
  malloc: fn(1, (m, [n]) => heap(m).malloc(n)),
  calloc: fn(2, (m, [n, s]) => heap(m).calloc(n, s)),
  realloc: fn(2, (m, [p, n]) => heap(m).realloc(p, n)),
  free: fn(1, (m, [p]) => {
    heap(m).release(p)
  }),
  memalign: fn(2, (m, [a, n]) => heap(m).memalign(a, n)),
  exit: fn(1, (m, [code]) => m.exit(code | 0)),
  abort: fn(0, (m) => m.exit(null)),
  atexit: fn(1, (m, [f]) => {
    m.atexit.push(f >>> 0)
    return 0
  }),
  qsort: fn(4, (m, [base, n, size, cmp]) => {
    qsort(m, base >>> 0, n >>> 0, size >>> 0, cmp)
  }),
  bsearch: fn(5, (m, [key, base, n, size, cmp]) => {
    let i = 0
    let j = (n | 0) - 1
    while (i <= j) {
      const pivot = Math.trunc((j + i) / 2)
      const at = (base + pivot * size) >>> 0
      const r = m.callAddress(cmp, [key >>> 0, at]) | 0
      if (r === 0) return at
      if (r < 0) j = pivot - 1
      else i = pivot + 1
    }
    return 0
  }),
  getenv: fn(1, () => 0),
  system: fn(1, () => -1),
  // assert.h: _assert(expr != 0, "Assertion failed, (expr), file F, line N\n")
  _assert: fn(2, (m, [ok, msg]) => {
    if (ok === 0) {
      m.io.write(m.mem.cstring(msg), 'stderr')
      m.exit(null)
    }
  })
}
