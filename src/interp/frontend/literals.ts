/** A pp-number decoded, before C typing (which depends on its value and the dialect). */
export type NumberLiteral =
  | { kind: 'int'; value: bigint; unsigned: boolean; longs: 0 | 1 | 2; decimal: boolean }
  | { kind: 'float'; value: number; suffix: '' | 'f' | 'l' }
  | { kind: 'error'; error: 'octal' | 'float' | 'extra' }

const INT_RE = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uU]?(?:ll|LL|[lL])?[uU]?)$/
const DEC_FLOAT_RE = /^([0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?)([fFlL]?)$/
const HEX_FLOAT_RE = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?[0-9]+)([fFlL]?)$/

function parseFloating(text: string, hex: boolean): NumberLiteral {
  const bad: NumberLiteral = { kind: 'error', error: 'float' }
  let value: number
  let suffix: string
  if (hex) {
    const m = HEX_FLOAT_RE.exec(text)
    if (!m || (!m[1] && !m[2])) return bad
    const frac = m[2] ?? ''
    value = (parseInt((m[1] || '') + frac || '0', 16) / 16 ** frac.length) * 2 ** Number(m[3])
    suffix = m[4]
  } else {
    const m = DEC_FLOAT_RE.exec(text)
    if (!m || !/[0-9]/.test(m[1].split(/[eE]/)[0])) return bad
    value = Number(m[1])
    suffix = m[2]
  }
  const s = suffix.toLowerCase() as '' | 'f' | 'l'
  return { kind: 'float', value: s === 'f' ? Math.fround(value) : value, suffix: s }
}

export function parseNumber(text: string): NumberLiteral {
  const hex = /^0[xX]/.test(text)
  const binary = /^0[bB]/.test(text)
  if (hex ? /[.pP]/.test(text) : !binary && /[.eE]/.test(text)) return parseFloating(text, hex)
  const m = INT_RE.exec(text)
  if (!m || (m[2].match(/u/gi)?.length ?? 0) > 1) return { kind: 'error', error: 'extra' }
  const digits = m[1]
  const octal = !hex && !binary && digits.length > 1 && digits[0] === '0'
  if (octal && /[89]/.test(digits)) return { kind: 'error', error: 'octal' }
  const value = octal ? BigInt('0o' + digits.slice(1)) : BigInt(digits)
  const suffix = m[2].toLowerCase()
  return {
    kind: 'int',
    value,
    unsigned: suffix.includes('u'),
    longs: suffix.includes('ll') ? 2 : suffix.includes('l') ? 1 : 0,
    decimal: !hex && !binary && !octal
  }
}

const SIMPLE: Record<string, number> = { n: 10, t: 9, v: 11, b: 8, r: 13, f: 12, a: 7, '\\': 92, "'": 39, '"': 34, '?': 63 }
const encoder = new TextEncoder()

/** Decodes the inside of a character constant or string literal: bytes (UTF-8) for narrow, 16-bit units for wide. */
function decodeEscapes(body: string, wide: boolean): number[] {
  const mask = wide ? 0xffff : 0xff
  const out: number[] = []
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') {
      const code = body.codePointAt(i) as number
      if (code > 0xffff) i++
      if (code < 0x80 || wide) out.push(code & 0xffff)
      else out.push(...encoder.encode(String.fromCodePoint(code)))
      continue
    }
    const e = body[++i]
    if (e === undefined) break
    if (e in SIMPLE) out.push(SIMPLE[e])
    else if (e >= '0' && e <= '7') {
      let v = 0
      let n = 0
      while (n < 3 && body[i] >= '0' && body[i] <= '7') {
        v = v * 8 + Number(body[i])
        i++
        n++
      }
      i--
      out.push(v & mask)
    } else if (e === 'x') {
      let v = 0
      while (/[0-9a-fA-F]/.test(body[i + 1] ?? '')) v = (v * 16 + parseInt(body[++i], 16)) % 0x100000000
      out.push(v & mask)
    } else out.push(e.charCodeAt(0) & mask)
  }
  return out
}

function inside(text: string, quote: string): { body: string; wide: boolean } {
  const wide = text.startsWith('L')
  const open = wide ? 2 : 1
  const closed = text.length > open && text.endsWith(quote)
  return { body: text.slice(open, closed ? -1 : undefined), wide }
}

export interface CharLiteral {
  value: number
  chars: number
  wide: boolean
}

export function parseChar(text: string): CharLiteral {
  const { body, wide } = inside(text, "'")
  const units = decodeEscapes(body, wide)
  if (wide) return { value: units[0] ?? 0, chars: units.length, wide }
  if (units.length <= 1) {
    const b = units[0] ?? 0
    return { value: b >= 128 ? b - 256 : b, chars: units.length, wide }
  }
  let v = 0
  for (const b of units) v = ((v << 8) | b) | 0
  return { value: v, chars: units.length, wide }
}

export function parseString(text: string): { units: number[]; wide: boolean } {
  const { body, wide } = inside(text, '"')
  return { units: decodeEscapes(body, wide), wide }
}
