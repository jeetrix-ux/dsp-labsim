import type { Loc } from './diag'

export type TokenKind = 'ident' | 'number' | 'char' | 'string' | 'punct' | 'other' | 'eof'

export interface Token {
  kind: TokenKind
  text: string
  file: string
  /** 1-based; 0 for the end-of-file token. */
  line: number
  col: number
  /** Whitespace or a comment comes before the token. */
  space: boolean
  /** First token of its source line (a '#' here starts a directive). */
  bol: boolean
  /** Macros that must not expand this token again (the C standard's hide set). */
  hide?: ReadonlySet<string>
  /** Lexical error, reported only if the token survives preprocessing: 7 unrecognized token, 8 missing quote. */
  bad?: '7' | '8'
  /** Stands for an empty macro argument next to ##. */
  placemarker?: boolean
}

export const loc = (t: Token): Loc => ({ file: t.file, line: t.line, col: t.col })

const PUNCT3 = new Set(['...', '<<=', '>>='])
const PUNCT2 = new Set(['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=', '##'])
const PUNCT1 = new Set('[](){}.&*+-~!/%<>^|?:;=,#'.split(''))

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isIdStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_')
const isIdChar = (c: string | undefined): boolean => isIdStart(c) || isDigit(c)

/** Splits C source into preprocessing tokens. Backslash-newlines are spliced and comments become whitespace. */
export function tokenize(source: string, file: string): Token[] {
  // Translation phases 1-2, remembering where each remaining character came from.
  const text = source.replace(/\r\n?/g, '\n')
  const chars: string[] = []
  const lines: number[] = []
  const cols: number[] = []
  let line = 1
  let col = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\' && text[i + 1] === '\n') {
      i++
      line++
      col = 1
      continue
    }
    chars.push(c)
    lines.push(line)
    cols.push(col)
    if (c === '\n') {
      line++
      col = 1
    } else col++
  }
  const s = chars.join('')

  const out: Token[] = []
  let bol = true
  let space = false
  let i = 0
  const push = (kind: TokenKind, start: number, bad?: '7' | '8'): void => {
    const t: Token = { kind, text: s.slice(start, i), file, line: lines[start], col: cols[start], space, bol }
    if (bad) t.bad = bad
    out.push(t)
    bol = false
    space = false
  }

  while (i < s.length) {
    const c = s[i]
    if (c === '\n') {
      i++
      bol = true
      space = false
      continue
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i++
      space = true
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      space = true
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end < 0 ? s.length : end + 2
      space = true
      continue
    }
    const start = i
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
      i++
      while (i < s.length) {
        const d = s[i]
        if ((d === '+' || d === '-') && 'eEpP'.includes(s[i - 1])) i++
        else if (isIdChar(d) || d === '.') i++
        else break
      }
      push('number', start)
      continue
    }
    if (c === '"' || c === "'" || (c === 'L' && (s[i + 1] === '"' || s[i + 1] === "'"))) {
      const quote = c === 'L' ? s[i + 1] : c
      i += c === 'L' ? 2 : 1
      let closed = false
      while (i < s.length && s[i] !== '\n') {
        if (s[i] === '\\' && i + 1 < s.length && s[i + 1] !== '\n') {
          i += 2
          continue
        }
        if (s[i++] === quote) {
          closed = true
          break
        }
      }
      push(quote === '"' ? 'string' : 'char', start, closed ? undefined : '8')
      continue
    }
    if (isIdStart(c)) {
      while (isIdChar(s[i])) i++
      push('ident', start)
      continue
    }
    if (PUNCT3.has(s.slice(i, i + 3))) i += 3
    else if (PUNCT2.has(s.slice(i, i + 2))) i += 2
    else if (PUNCT1.has(c)) i++
    else {
      i++
      push('other', start, '7')
      continue
    }
    push('punct', start)
  }
  out.push({ kind: 'eof', text: '', file, line: 0, col: 0, space: false, bol: true })
  return out
}
