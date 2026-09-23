import type { Machine } from '../exec/machine'
import { EDOM, EFPOS, ENOENT, ERANGE } from './errno'
import { fn, state, type LibFunction } from './types'

const U = 0x01
const L = 0x02
const N = 0x04
const S = 0x08
const P = 0x10
const C = 0x20
const H = 0x40
const B = 0x80

/** TI's _ctypes_ table (lib/src/ctype.c) for 0..255; bytes above 0x7F belong to no class. */
const CTYPE = new Uint8Array(256)
for (let c = 0; c < 128; c++) {
  let f = 0
  if (c < 32 || c === 127) f |= C
  if (c >= 9 && c <= 13) f |= S
  if (c === 32) f |= S | B
  if (c >= 48 && c <= 57) f |= N | H
  if (c >= 65 && c <= 90) f |= U | (c <= 70 ? H : 0)
  if (c >= 97 && c <= 122) f |= L | (c <= 102 ? H : 0)
  if (c > 32 && c < 127 && !(f & (U | L | N))) f |= P
  CTYPE[c] = f
}

export const ctype = (c: number): number => (c >= 0 && c < 256 ? CTYPE[c] : 0)
export const isSpace = (c: number): boolean => (ctype(c) & S) !== 0

export function strlen(m: Machine, s: number): number {
  let n = 0
  while (m.mem.u8(s + n) !== 0) n++
  return n
}

const tokens = state(() => ({ next: 0 }))

const ERRORS: Record<number, string> = { 0: 'No error', [EDOM]: 'Domain error', [ERANGE]: 'Range error', [ENOENT]: 'No such file or directory', [EFPOS]: 'File positioning error' }

const inSet = (m: Machine, set: number, c: number): boolean => {
  for (let p = set; ; p++) {
    const x = m.mem.u8(p)
    if (x === 0) return false
    if (x === c) return true
  }
}

const cls = (mask: number): LibFunction => fn(1, (_m, [c]) => ctype(c) & mask)

export const STRING: Record<string, LibFunction> = {
  memcpy: fn(3, (m, [d, s, n]) => {
    m.mem.copy(d, s, n >>> 0)
    return d
  }),
  memmove: fn(3, (m, [d, s, n]) => {
    m.mem.copy(d, s, n >>> 0)
    return d
  }),
  memset: fn(3, (m, [d, c, n]) => {
    m.mem.fill(d, c & 0xff, n >>> 0)
    return d
  }),
  memcmp: fn(3, (m, [a, b, n]) => {
    for (let i = 0; i < n >>> 0; i++) {
      const x = m.mem.u8(a + i)
      const y = m.mem.u8(b + i)
      if (x !== y) return x - y
    }
    return 0
  }),
  memchr: fn(3, (m, [s, c, n]) => {
    for (let i = 0; i < n >>> 0; i++) if (m.mem.u8(s + i) === (c & 0xff)) return (s + i) >>> 0
    return 0
  }),
  strcpy: fn(2, (m, [d, s]) => {
    m.mem.copy(d, s, strlen(m, s) + 1)
    return d
  }),
  strncpy: fn(3, (m, [d, s, n]) => {
    let i = 0
    for (; i < n >>> 0; i++) {
      const c = m.mem.u8(s + i)
      m.mem.set8(d + i, c)
      if (c === 0) break
    }
    for (; i < n >>> 0; i++) m.mem.set8(d + i, 0)
    return d
  }),
  strcat: fn(2, (m, [d, s]) => {
    m.mem.copy(d + strlen(m, d), s, strlen(m, s) + 1)
    return d
  }),
  strncat: fn(3, (m, [d, s, n]) => {
    const end = d + strlen(m, d)
    let i = 0
    for (; i < n >>> 0; i++) {
      const c = m.mem.u8(s + i)
      if (c === 0) break
      m.mem.set8(end + i, c)
    }
    m.mem.set8(end + i, 0)
    return d
  }),
  strcmp: fn(2, (m, [a, b]) => {
    for (let i = 0; ; i++) {
      const c1 = m.mem.u8(a + i)
      const res = c1 - m.mem.u8(b + i)
      if (c1 === 0 || res !== 0) return res
    }
  }),
  strncmp: fn(3, (m, [a, b, n]) => {
    for (let i = 0; i < n >>> 0; i++) {
      const cp = m.mem.u8(b + i)
      const res = m.mem.u8(a + i) - cp
      if (res !== 0) return res
      if (cp === 0) return 0
    }
    return 0
  }),
  strcoll: fn(2, (m, args) => STRING.strcmp.call(m, args, 0, 0)),
  strxfrm: fn(3, (m, [d, s, n]) => {
    const len = strlen(m, s)
    if (len < n >>> 0) m.mem.copy(d, s, len + 1)
    return len
  }),
  strchr: fn(2, (m, [s, c]) => {
    const ch = c & 0xff
    for (let p = s; ; p++) {
      const x = m.mem.u8(p)
      if (x === ch) return p >>> 0
      if (x === 0) return 0
    }
  }),
  strrchr: fn(2, (m, [s, c]) => {
    const ch = c & 0xff
    let found = 0
    for (let p = s; ; p++) {
      const x = m.mem.u8(p)
      if (x === ch) found = p >>> 0
      if (x === 0) return found
    }
  }),
  strstr: fn(2, (m, [s, t]) => {
    const hay = m.mem.cstring(s)
    const i = hay.indexOf(m.mem.cstring(t))
    return i < 0 ? 0 : (s + i) >>> 0
  }),
  strpbrk: fn(2, (m, [s, set]) => {
    for (let p = s; ; p++) {
      const x = m.mem.u8(p)
      if (x === 0) return 0
      if (inSet(m, set, x)) return p >>> 0
    }
  }),
  strspn: fn(2, (m, [s, set]) => {
    let n = 0
    while (m.mem.u8(s + n) !== 0 && inSet(m, set, m.mem.u8(s + n))) n++
    return n
  }),
  strcspn: fn(2, (m, [s, set]) => {
    let n = 0
    while (m.mem.u8(s + n) !== 0 && !inSet(m, set, m.mem.u8(s + n))) n++
    return n
  }),
  strtok: fn(2, (m, [s, delim]) => {
    const t = tokens(m)
    let p = s !== 0 ? s : t.next
    if (p === 0) return 0
    while (m.mem.u8(p) !== 0 && inSet(m, delim, m.mem.u8(p))) p++
    if (m.mem.u8(p) === 0) {
      t.next = 0
      return 0
    }
    const start = p
    while (m.mem.u8(p) !== 0 && !inSet(m, delim, m.mem.u8(p))) p++
    if (m.mem.u8(p) === 0) t.next = 0
    else {
      m.mem.set8(p, 0)
      t.next = p + 1
    }
    return start >>> 0
  }),
  strlen: fn(1, (m, [s]) => strlen(m, s)),
  strerror: fn(1, (m, [e]) => m.placement.constString(ERRORS[e] ?? 'Unknown error')),

  isalnum: cls(U | L | N),
  isalpha: cls(U | L),
  iscntrl: cls(C),
  isdigit: cls(N),
  isgraph: cls(U | L | N | P),
  islower: cls(L),
  isprint: cls(B | U | L | N | P),
  ispunct: cls(P),
  isspace: cls(S),
  isupper: cls(U),
  isxdigit: cls(H),
  isblank: fn(1, (_m, [c]) => (c === 32 || c === 9 ? 1 : 0)),
  isascii: fn(1, (_m, [c]) => ((c >>> 0) & ~0x7f ? 0 : 1)),
  toascii: fn(1, (_m, [c]) => (c >>> 0) & 0x7f),
  tolower: fn(1, (_m, [c]) => (ctype(c) & U ? c + 32 : c)),
  toupper: fn(1, (_m, [c]) => (ctype(c) & L ? c - 32 : c))
}
