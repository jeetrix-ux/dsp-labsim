import type { Machine } from '../exec/machine'
import { fn, vfn, type LibFunction } from './types'

/** Reads variadic arguments the way va_arg does: each aligned to its size (at least 4 bytes). */
export interface VaReader {
  int(): number
  uint(): number
  ll(): bigint
  ull(): bigint
  dbl(): number
  ptr(): number
}

export function vaReader(m: Machine, start: number): VaReader {
  let p = start >>> 0
  const take = (size: number): number => {
    const align = Math.max(4, size)
    p = Math.ceil(p / align) * align
    const a = p
    p += size
    return a
  }
  return {
    int: () => m.mem.i32(take(4)),
    uint: () => m.mem.u32(take(4)),
    ll: () => m.mem.i64(take(8)),
    ull: () => m.mem.u64(take(8)),
    dbl: () => m.mem.f64(take(8)),
    ptr: () => m.mem.u32(take(4))
  }
}

/** Where formatted output goes: `c` is TI's _outc, `s` its _outs (returns the count to add, or EOF). */
export interface PrintfSink {
  c(ch: number): void
  s(bytes: number[], len: number): number
}

const EOF = -1
const LONG_MAX = 2147483647
/** F_CONVERSION_BUFSIZE for the full printf. */
const BUFSIZE = 510

// _PFIELD flags
const MINUS = 0x1
const PLUS = 0x2
const SPACE = 0x4
const POUND = 0x8
const ZERO = 0x10
const MFH = 0x20
const MFHH = 0x40
const MFL = 0x80
const MFLL = 0x100
const MFLD = 0x200
const MFJ = 0x400
const MFZ = 0x800
const MFT = 0x1000
const MFI40 = 0x2000
const LENGTHS = MFH | MFHH | MFL | MFLL | MFI40 | MFJ | MFZ | MFT

// flags returned by the floating conversions
const NO_FLAG = 0
const MINUS_FLAG = 1
const SPECIAL_FLAG = 2

const ch = (s: string): number => s.charCodeAt(0)
const isHexConv = (c: number): boolean => c === ch('x') || c === ch('X') || c === ch('p')
const isSignedConv = (c: number): boolean => c !== ch('u') && c !== ch('o') && !isHexConv(c)

interface Field {
  flags: number
  fwidth: number
  precision: number
  conv: number
}

/** The conversion buffer, written right to left from its end like TI's `a_it`. */
class Fld {
  readonly b: number[]
  it: number
  constructor(size: number) {
    this.b = new Array(size).fill(32)
    this.b[size - 1] = 0
    this.it = size - 2
  }
  put(c: number): void {
    this.b[this.it--] = c
  }
  /** Writes a string so that it reads left to right. */
  putS(s: string): void {
    for (let i = s.length - 1; i >= 0; i--) this.put(s.charCodeAt(i))
  }
}

function ltostr(cvt: bigint, base: number, conv: number, f: Fld): number {
  const digits = conv === ch('X') ? '0123456789ABCDEF' : '0123456789abcdef'
  if (cvt === 0n) {
    f.put(48)
    return 1
  }
  const b = BigInt(base)
  let n = 0
  while (cvt !== 0n) {
    const q = cvt / b
    f.put(digits.charCodeAt(Number(cvt - q * b)))
    cvt = q
    n++
  }
  return n
}

/** FCVT: `fdigit` digits after the point, rounded half-up on one extra digit (TI does not round to even). */
function fcvt(input: number, fdigitArg: number): { digits: string; decpt: number } {
  let value = input < 0 ? -input : input
  const out: number[] = [48]
  let fdigit = fdigitArg + 1
  let scale = 0
  while (value > LONG_MAX) {
    value /= 10
    scale++
  }
  while (value && value < 1) {
    value *= 10
    scale--
  }
  const ip = String(Math.trunc(value))
  for (let i = 0; i < ip.length; i++) out.push(ip.charCodeAt(i))
  let decpt = scale + ip.length
  fdigit += scale
  if (fdigit > 0) {
    do {
      value -= Math.trunc(value)
      value *= 10
      out.push(48 + Math.trunc(value))
    } while (--fdigit)
  }
  const pos = out.length - 1
  if (out[pos] >= 53) {
    let ptr = pos
    while ((out[--ptr] += 1) > 57) out[ptr] = 48
    if (ptr === 0) return { digits: String.fromCharCode(...out.slice(0, pos)), decpt: decpt + 1 }
  }
  return { digits: String.fromCharCode(...out.slice(1, pos)), decpt }
}

/** ECVT: `sigdigit` significant digits, for %g. */
function ecvt(input: number, sigdigitArg: number): { digits: string; decpt: number } {
  let value = input < 0 ? -input : input
  const out: number[] = [48]
  let sigdigit = sigdigitArg + 1
  let scale = 0
  while (value > LONG_MAX) {
    value /= 10
    scale++
  }
  while (value && value < 1) {
    value *= 10
    scale--
  }
  const ip = String(Math.trunc(value))
  for (let i = 0; i < ip.length; i++) out.push(ip.charCodeAt(i))
  const decpt = scale + ip.length
  let pos: number
  if (ip.length >= sigdigit) pos = 1 + sigdigit
  else {
    sigdigit -= ip.length
    do {
      value -= Math.trunc(value)
      value *= 10
      out.push(48 + Math.trunc(value))
    } while (--sigdigit)
    pos = out.length
  }
  pos--
  if (out[pos] >= 53) {
    let ptr = pos
    while ((out[--ptr] += 1) > 57) out[ptr] = 48
    if (ptr === 0) return { digits: String.fromCharCode(...out.slice(0, pos - 1)), decpt: decpt + 1 }
  }
  return { digits: String.fromCharCode(...out.slice(1, pos)), decpt }
}

function fcpy(digits: string, dpt: number, precisionArg: number, f: Fld): void {
  let precision = precisionArg
  let i = dpt + precision - 1
  while (precision-- > 0) {
    f.put(i >= 0 && i < digits.length ? digits.charCodeAt(i) : 48)
    --i
  }
}

function ecpy(exp: number, letter: number, f: Fld): void {
  ltostr(BigInt(Math.abs(exp)), 10, ch('d'), f)
  if (letter !== ch('p') && letter !== ch('P') && exp < 10 && exp > -10) f.put(48)
  f.put(exp < 0 ? ch('-') : ch('+'))
  f.put(letter)
}

function mcpy(digits: string, dpt: number, putdec: boolean, f: Fld): void {
  const diglen = digits.length
  let wholeend = dpt > 0 && dpt <= diglen ? dpt - 1 : -1
  if (putdec) f.put(ch('.'))
  let i = dpt
  for (; i > diglen; i--) f.put(48)
  if (i > 0) for (; wholeend >= 0; wholeend--) f.put(digits.charCodeAt(wholeend))
  else f.put(48)
}

function pconvF(v: number, fl: Field, f: Fld): void {
  if (fl.precision < 0) fl.precision = 6
  const fracStart = f.it
  const { digits, decpt } = fcvt(v, fl.precision)
  fcpy(digits, decpt, fl.precision, f)
  mcpy(digits, decpt, fracStart !== f.it || (fl.flags & POUND) !== 0, f)
}

function pconvE(input: number, fl: Field, f: Fld): void {
  if (fl.precision < 0) fl.precision = 6
  let v = input
  let exp = 0
  if (v) {
    for (; v < 1; v *= 10, exp--);
    for (; v >= 10; v /= 10, exp++);
  }
  let { digits, decpt } = fcvt(v, fl.precision)
  if (decpt === 2) {
    decpt--
    exp++
    digits = digits.slice(0, -1)
  }
  ecpy(exp, fl.conv, f)
  fcpy(digits, decpt, fl.precision, f)
  mcpy(digits, decpt, decpt !== digits.length || (fl.flags & POUND) !== 0, f)
}

function pconvG(v: number, fl: Field, f: Fld): void {
  if (fl.precision === 0) fl.precision = 1
  if (fl.precision < 0) fl.precision = 6
  const r = ecvt(v, fl.precision)
  const digits = r.digits
  let dpt = r.decpt
  let exp = 0
  if (dpt < -3 || dpt > fl.precision) {
    for (; dpt > 1; dpt--, exp++);
    for (; dpt < 1; dpt++, exp--);
    ecpy(exp, fl.conv - 2, f)
  }
  let seen = false
  for (let i = digits.length - 1; i >= dpt; --i) {
    const d = i >= 0 ? digits.charCodeAt(i) : 48
    if (d !== 48 || seen || fl.flags & POUND) {
      f.put(d)
      seen = true
    }
  }
  mcpy(digits, dpt, (fl.flags & POUND) !== 0 || seen, f)
}

/** %a: C99 hexadecimal floating point (rare in lab code; not a line-by-line port). */
function pconvA(v: number, fl: Field, f: Fld): void {
  const upper = fl.conv === ch('A')
  let lead = 0
  let mant = 0n
  let exp = 0
  if (v !== 0) {
    const dv = new DataView(new ArrayBuffer(8))
    dv.setFloat64(0, v)
    const bits = dv.getBigUint64(0)
    const e = Number((bits >> 52n) & 0x7ffn)
    mant = bits & ((1n << 52n) - 1n)
    lead = e === 0 ? 0 : 1
    exp = e === 0 ? -1022 : e - 1023
  }
  let frac = mant.toString(16).padStart(13, '0')
  if (fl.precision >= 0 && fl.precision < 13) {
    const keep = fl.precision * 4
    let q = (mant >> BigInt(52 - keep)) + ((mant >> BigInt(51 - keep)) & 1n)
    if (q >> BigInt(keep) !== 0n) {
      lead++
      q &= (1n << BigInt(keep)) - 1n
    }
    frac = keep === 0 ? '' : q.toString(16).padStart(fl.precision, '0')
  } else if (fl.precision < 0) frac = frac.replace(/0+$/, '')
  else frac = frac.padEnd(fl.precision, '0')
  const point = frac.length > 0 || fl.flags & POUND ? '.' : ''
  const s = `0x${lead}${point}${frac}p${exp < 0 ? '-' : '+'}${Math.abs(exp)}`
  f.putS(upper ? s.toUpperCase() : s)
}

function fgea(fl: Field, va: VaReader, f: Fld): number {
  const cvt = va.dbl()
  const isCap = fl.conv >= 65 && fl.conv <= 90
  if (Number.isNaN(cvt)) {
    f.putS(isCap ? 'NAN' : 'nan')
    return SPECIAL_FLAG
  }
  if (!Number.isFinite(cvt)) {
    const s = (cvt < 0 ? '-' : '+') + (isCap ? 'INF' : 'inf')
    f.putS(s)
    return SPECIAL_FLAG
  }
  let v = cvt
  let flags = NO_FLAG
  if (v < 0 || Object.is(v, -0)) {
    flags = MINUS_FLAG
    v = -v
  }
  switch (String.fromCharCode(fl.conv)) {
    case 'f':
    case 'F':
      pconvF(v, fl, f)
      break
    case 'e':
    case 'E':
      pconvE(v, fl, f)
      break
    case 'g':
    case 'G':
      pconvG(v, fl, f)
      break
    default:
      pconvA(v, fl, f)
  }
  return flags
}

function getarg(fl: Field, va: VaReader): bigint {
  const c = String.fromCharCode(fl.conv)
  const u64 = (v: number | bigint): bigint => BigInt.asUintN(64, BigInt(v))
  if (c === 'p') return u64(va.ptr())
  const signed = c === 'd' || c === 'i'
  switch (fl.flags & LENGTHS) {
    case MFH:
      return signed ? u64(va.int()) : u64(va.uint() & 0xffff)
    case MFHH:
      return signed ? u64(va.int()) : u64(va.uint() & 0xff)
    case MFLL:
    case MFJ:
      return signed ? u64(va.ll()) : va.ull()
    case MFI40:
      return signed ? u64(BigInt.asIntN(40, va.ll())) : BigInt.asUintN(40, va.ull())
    default:
      return signed ? u64(va.int()) : u64(va.uint())
  }
}

/** Returns minus_flag. */
function diouxp(fl: Field, va: VaReader, f: Fld): boolean {
  if (fl.precision < 0) fl.precision = 1
  else fl.flags &= ~ZERO
  const conv = fl.conv
  const base = isHexConv(conv) ? 16 : conv === ch('o') ? 8 : 10
  let cvt = getarg(fl, va)
  if (fl.precision === 0 && cvt === 0n && !(fl.flags & POUND)) return false
  let minus = false
  if ((conv === ch('d') || conv === ch('i')) && BigInt.asIntN(64, cvt) < 0n) {
    minus = true
    cvt = BigInt.asUintN(64, -BigInt.asIntN(64, cvt))
  }
  let digits = ltostr(cvt, base, conv, f)
  while (digits++ < fl.precision) f.put(48)
  if (isHexConv(conv) && fl.flags & POUND) {
    f.put(conv === ch('p') ? ch('x') : conv)
    f.put(48)
  }
  if (conv === ch('o') && fl.flags & POUND && f.b[f.it + 1] !== 48) f.put(48)
  return minus
}

/** _SETFIELD: one conversion, justified and padded in its field. Returns the field's bytes. */
function setfield(fl: Field, va: VaReader): number[] {
  const size = Math.max(BUFSIZE, fl.fwidth + 64)
  const f = new Fld(size)
  const aEnd = size - 1
  const fEnd = fl.fwidth
  let minusFlag = false
  let plusFlag = false
  let flags = NO_FLAG
  let terminator = 0
  switch (String.fromCharCode(fl.conv)) {
    case 'd':
    case 'i':
    case 'u':
    case 'X':
    case 'p':
    case 'o':
    case 'x':
      minusFlag = diouxp(fl, va, f)
      break
    case 'a':
    case 'A':
    case 'g':
    case 'G':
    case 'e':
    case 'E':
    case 'f':
    case 'F':
      flags = fgea(fl, va, f)
      break
    case 'c': {
      const t = va.int() & 0xff
      terminator = t === 0 ? 1 : 0
      f.put(t)
      fl.flags &= ~PLUS
      break
    }
    case '%':
      return [37]
  }
  if (isSignedConv(fl.conv) && (flags === MINUS_FLAG || flags === NO_FLAG)) {
    if (flags === MINUS_FLAG) minusFlag = true
    plusFlag = (fl.flags & PLUS) !== 0
    if (minusFlag) f.put(ch('-'))
    else if (plusFlag) f.put(ch('+'))
    if (!minusFlag && !plusFlag && fl.flags & SPACE) f.put(32)
  }
  const b = f.b
  const len = aEnd - f.it
  let where = fl.flags & MINUS || len > fl.fwidth ? 0 : fEnd - len + 1
  let src = f.it + 1
  let dst = where
  for (;;) {
    const c = b[src++]
    b[dst++] = c
    if (c === 0) break
  }
  let it = dst
  if (terminator) b[it++] = 0
  if (it <= fEnd) {
    for (let k = it - 1; k < fEnd; k++) b[k] = 32
    b[fEnd] = 0
  }
  if (fl.flags & ZERO) {
    if (where !== 0) {
      for (let k = 0; k < where; k++) b[k] = 48
      let swap = 0
      if (minusFlag || plusFlag || fl.flags & SPACE) {
        b[swap++] = b[where]
        b[where++] = 48
      }
      if ((isHexConv(fl.conv) && fl.flags & POUND) || fl.conv === ch('a') || fl.conv === ch('A')) {
        b[swap + 1] = b[where + 1]
        b[where + 1] = 48
      }
    }
  } else for (let k = 0; k < where; k++) b[k] = 32
  let n = 0
  while (b[n] !== 0) n++
  return b.slice(0, n + terminator)
}

/** _PRINTFI: formats the string at `format`, reading arguments from `va`. Returns the count, or EOF. */
export function formatTI(m: Machine, format: number, va: VaReader, out: PrintfSink): number {
  const fmt: number[] = []
  for (let p = format; ; p++) {
    const c = m.mem.u8(p)
    if (c === 0) break
    fmt.push(c)
  }
  const n = fmt.length
  const digit = (i: number): boolean => i < n && fmt[i] >= 48 && fmt[i] <= 57
  let i = 0
  let count = 0
  while (i < n) {
    const fl: Field = { flags: 0, fwidth: 0, precision: -1, conv: 0 }
    while (i < n && fmt[i] !== 37) {
      out.c(fmt[i++])
      count++
    }
    if (i >= n) break
    i++
    for (let done = false; !done; ) {
      switch (fmt[i]) {
        case 45: fl.flags |= MINUS; i++; break
        case 43: fl.flags |= PLUS; i++; break
        case 32: fl.flags |= SPACE; i++; break
        case 35: fl.flags |= POUND; i++; break
        case 48: fl.flags |= ZERO; i++; break
        default: done = true
      }
    }
    if (fmt[i] === 42) {
      let w = va.int()
      if (w < 0) {
        w = -w
        fl.flags |= MINUS
      }
      fl.fwidth = w
      i++
    } else if (digit(i)) {
      let w = 0
      while (digit(i)) w = w * 10 + fmt[i++] - 48
      fl.fwidth = w
    }
    if (fmt[i] === 46) {
      i++
      if (fmt[i] === 42) {
        fl.precision = va.int()
        i++
      } else {
        let p = 0
        while (digit(i)) p = p * 10 + fmt[i++] - 48
        fl.precision = p
      }
    }
    switch (fmt[i]) {
      case ch('L'): fl.flags |= MFLD; i++; break
      case ch('h'):
        i++
        if (fmt[i] === ch('h')) { fl.flags |= MFHH; i++ } else fl.flags |= MFH
        break
      case ch('l'):
        i++
        if (fmt[i] === ch('l')) { fl.flags |= MFLL; i++ } else fl.flags |= MFL
        break
      case ch('j'): fl.flags |= MFJ; i++; break
      case ch('z'): fl.flags |= MFZ; i++; break
      case ch('t'): fl.flags |= MFT; i++; break
      case ch('I'):
        if (fmt[i + 1] === ch('4') && fmt[i + 2] === ch('0')) { fl.flags |= MFI40; i += 3 }
        break
    }
    fl.conv = i < n ? fmt[i] : 0
    i++
    if (fl.conv === ch('n')) {
      const p = va.ptr()
      switch (fl.flags & LENGTHS) {
        case MFLL:
        case MFJ:
        case MFI40: m.mem.set64(p, BigInt(count)); break
        case MFH: m.mem.set16(p, count); break
        case MFHH: m.mem.set8(p, count); break
        default: m.mem.set32(p, count)
      }
    } else if (fl.conv === ch('s')) {
      const p = va.ptr()
      if (p === 0) out.c(0)
      else {
        let slen = 0
        while (m.mem.u8(p + slen) !== 0) slen++
        const buflen = fl.precision >= 0 && fl.precision < slen ? fl.precision : slen
        const len = fl.fwidth > buflen ? fl.fwidth : buflen
        count += len
        if (buflen < len && !(fl.flags & MINUS)) for (let k = 0; k < len - buflen; k++) out.c(32)
        for (let k = 0; k < buflen; k++) out.c(m.mem.u8(p + k))
        if (buflen < len && fl.flags & MINUS) for (let k = 0; k < len - buflen; k++) out.c(32)
      }
    } else {
      const bytes = setfield(fl, va)
      const r = out.s(bytes, bytes.length)
      count = r === EOF ? EOF : count + r
    }
    if (count === EOF) break
  }
  return count
}

/** sprintf's sink: copies every byte (NULs included) and returns the end pointer through `end()`. */
function memorySink(m: Machine, start: number): PrintfSink & { end(): number } {
  let p = start >>> 0
  return {
    c: (c) => m.mem.set8(p++, c),
    s: (bytes, len) => {
      m.mem.write(p, bytes)
      p += len
      return len
    },
    end: () => p
  }
}

/** snprintf's sink: writes at most n - 1 bytes but counts everything. */
function boundedSink(m: Machine, start: number, size: number): PrintfSink & { end(): number } {
  const n = size === 0 ? 0 : size - 1
  let written = 0
  let p = start >>> 0
  return {
    c: (c) => {
      if (written < n) m.mem.set8(p++, c)
      written++
    },
    s: (bytes, len) => {
      if (written < n) {
        const use = Math.min(len, n - written)
        m.mem.write(p, bytes.slice(0, use))
        p += use
      }
      written += len
      return len
    },
    end: () => p
  }
}

function sprintfTo(m: Machine, buf: number, fmt: number, va: VaReader): number {
  const out = memorySink(m, buf)
  const r = formatTI(m, fmt, va, out)
  m.mem.set8(out.end(), 0)
  return r
}

function snprintfTo(m: Machine, buf: number, size: number, fmt: number, va: VaReader): number {
  const out = boundedSink(m, buf, size >>> 0)
  const r = formatTI(m, fmt, va, out)
  if (size >>> 0) m.mem.set8(out.end(), 0)
  return r
}

export const PRINTF: Record<string, LibFunction> = {
  sprintf: vfn(2, (m, [buf, fmt], va) => sprintfTo(m, buf, fmt, vaReader(m, va))),
  snprintf: vfn(3, (m, [buf, size, fmt], va) => snprintfTo(m, buf, size, fmt, vaReader(m, va))),
  vsprintf: fn(3, (m, [buf, fmt, ap]) => sprintfTo(m, buf, fmt, vaReader(m, ap))),
  vsnprintf: fn(4, (m, [buf, size, fmt, ap]) => snprintfTo(m, buf, size, fmt, vaReader(m, ap)))
}
