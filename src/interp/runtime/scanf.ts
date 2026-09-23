import type { Machine } from '../exec/machine'
import type { VaReader } from './printf'
import { isSpace } from './string'

export interface CharSource {
  /** Next byte, or -1 at end of input. */
  get(): number
  unget(c: number): void
}

const EOF = -1

const isDigitIn = (c: number, base: number): boolean => {
  const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : 99
  return d < base
}

/** A C99 scanf engine: returns the number of assignments, or EOF when input ends before the first conversion. */
export function scanTI(m: Machine, format: number, va: VaReader, src: CharSource): number {
  const fmt = m.mem.cstring(format)
  let assigned = 0
  let consumed = 0
  let converted = false
  const get = (): number => {
    const c = src.get()
    if (c !== EOF) consumed++
    return c
  }
  const unget = (c: number): void => {
    if (c === EOF) return
    consumed--
    src.unget(c)
  }
  const skipSpace = (): number => {
    let c = get()
    while (c !== EOF && isSpace(c)) c = get()
    unget(c)
    return c
  }
  const result = (): number => (!converted && assigned === 0 ? EOF : assigned)

  let i = 0
  while (i < fmt.length) {
    const fc = fmt.charCodeAt(i)
    if (isSpace(fc)) {
      skipSpace()
      i++
      continue
    }
    if (fc !== 37) {
      const c = get()
      if (c !== fc) {
        unget(c)
        return c === EOF ? result() : assigned
      }
      i++
      continue
    }
    i++
    let suppress = false
    if (fmt[i] === '*') {
      suppress = true
      i++
    }
    let width = 0
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + fmt.charCodeAt(i++) - 48
    let len = ''
    if (fmt.startsWith('hh', i) || fmt.startsWith('ll', i)) {
      len = fmt.slice(i, i + 2)
      i += 2
    } else if ('hlLjzt'.includes(fmt[i] ?? '#')) len = fmt[i++]
    const conv = fmt[i++] ?? ''
    if (conv === '%') {
      skipSpace()
      const c = get()
      if (c !== 37) {
        unget(c)
        return c === EOF ? result() : assigned
      }
      continue
    }
    if (conv === 'n') {
      if (!suppress) storeInt(m, va.ptr(), len, BigInt(consumed))
      continue
    }
    if (conv !== 'c' && conv !== '[') {
      if (skipSpace() === EOF) return result()
    }
    const max = width > 0 ? width : conv === 'c' ? 1 : Infinity
    const text: number[] = []
    const take = (ok: (c: number) => boolean): void => {
      while (text.length < max) {
        const c = get()
        if (c === EOF || !ok(c)) {
          unget(c)
          return
        }
        text.push(c)
      }
    }
    switch (conv) {
      case 'd':
      case 'i':
      case 'u':
      case 'o':
      case 'x':
      case 'X':
      case 'p': {
        let base = conv === 'o' ? 8 : conv === 'x' || conv === 'X' || conv === 'p' ? 16 : 10
        take((c) => text.length === 0 && (c === 43 || c === 45))
        if (conv === 'i' || base === 16) {
          const c = get()
          if (c === 48 && text.length < max) {
            text.push(c)
            const x = get()
            if ((x === 120 || x === 88) && text.length < max) {
              text.push(x)
              base = 16
            } else {
              unget(x)
              if (conv === 'i') base = 8
            }
          } else unget(c)
        }
        const before = text.length
        take((c) => isDigitIn(c, base))
        const s = String.fromCharCode(...text)
        const digits = s.replace(/^[+-]?(0[xX])?/, '')
        // "0" and a bare "0x" are the number zero; no digits at all is a matching failure.
        if (digits.length === 0 && !(before > 0 && /0$/.test(s.replace(/[xX]$/, '')))) return assigned
        converted = true
        const neg = s.startsWith('-')
        const mag = digits.length === 0 ? 0n : BigInt((base === 16 ? '0x' : base === 8 ? '0o' : '') + digits)
        if (!suppress) {
          const v = neg ? -mag : mag
          if (conv === 'p') m.mem.set32(va.ptr(), Number(BigInt.asUintN(32, v)))
          else {
            storeInt(m, va.ptr(), len, v)
            assigned++
          }
          if (conv === 'p') assigned++
        }
        break
      }
      case 'f':
      case 'F':
      case 'e':
      case 'E':
      case 'g':
      case 'G':
      case 'a':
      case 'A': {
        let seenDot = false
        let seenExp = false
        let digitsSeen = false
        take((c) => {
          const last = text.length === 0 ? -1 : text[text.length - 1]
          if ((c === 43 || c === 45) && (text.length === 0 || last === 101 || last === 69)) return true
          if (c >= 48 && c <= 57) {
            digitsSeen = true
            return true
          }
          if (c === 46 && !seenDot && !seenExp) return (seenDot = true)
          if ((c === 101 || c === 69) && digitsSeen && !seenExp) return (seenExp = true)
          return false
        })
        const s = String.fromCharCode(...text)
        const v = Number(s.replace(/[eE][+-]?$/, ''))
        if (!digitsSeen || Number.isNaN(v)) return assigned
        converted = true
        if (!suppress) {
          const p = va.ptr()
          if (len === 'l' || len === 'L') m.mem.setF64(p, v)
          else m.mem.setF32(p, v)
          assigned++
        }
        break
      }
      case 's':
      case 'c':
      case '[': {
        let accept: (c: number) => boolean = (c) => !isSpace(c)
        if (conv === 'c') accept = () => true
        if (conv === '[') {
          let negate = false
          if (fmt[i] === '^') {
            negate = true
            i++
          }
          const set = new Set<number>()
          let first = true
          while (i < fmt.length && (fmt[i] !== ']' || first)) {
            if (fmt[i + 1] === '-' && fmt[i + 2] !== undefined && fmt[i + 2] !== ']') {
              for (let c = fmt.charCodeAt(i); c <= fmt.charCodeAt(i + 2); c++) set.add(c)
              i += 3
            } else set.add(fmt.charCodeAt(i++))
            first = false
          }
          i++
          accept = (c) => set.has(c) !== negate
        }
        take(accept)
        if (text.length === 0) {
          const c = get()
          unget(c)
          return c === EOF ? result() : assigned
        }
        converted = true
        if (!suppress) {
          const p = va.ptr()
          m.mem.write(p, text)
          if (conv !== 'c') m.mem.set8(p + text.length, 0)
          assigned++
        }
        break
      }
      default:
        return assigned
    }
  }
  return assigned
}

function storeInt(m: Machine, p: number, len: string, v: bigint): void {
  switch (len) {
    case 'hh':
      m.mem.set8(p, Number(BigInt.asIntN(8, v)))
      break
    case 'h':
      m.mem.set16(p, Number(BigInt.asIntN(16, v)))
      break
    case 'll':
    case 'j':
      m.mem.set64(p, v)
      break
    default:
      m.mem.set32(p, Number(BigInt.asIntN(32, v)))
  }
}
