import { describe, expect, it } from 'vitest'
import { tokenize } from '../../../src/interp/frontend/lexer'

const kinds = (src: string): [string, string][] => tokenize(src, 'f.c').map((t) => [t.kind, t.text])

describe('tokenize', () => {
  it('splits identifiers, numbers, strings, characters and punctuators', () => {
    expect(kinds('int x=0x1F+.5e-3;s="a\\"b";c=\'\\n\';')).toEqual([
      ['ident', 'int'], ['ident', 'x'], ['punct', '='], ['number', '0x1F'], ['punct', '+'], ['number', '.5e-3'], ['punct', ';'],
      ['ident', 's'], ['punct', '='], ['string', '"a\\"b"'], ['punct', ';'],
      ['ident', 'c'], ['punct', '='], ['char', "'\\n'"], ['punct', ';'], ['eof', '']
    ])
  })
  it('takes the longest punctuator', () => {
    expect(kinds('a<<=b->c...d##e').map((k) => k[1])).toEqual(['a', '<<=', 'b', '->', 'c', '...', 'd', '##', 'e', ''])
  })
  it('tracks lines, columns, line starts and spacing through comments and CRLF', () => {
    const t = tokenize('a /* x\r\n y */ b\r\n// c\r\n  d', 'f.c')
    expect(t.map((x) => [x.text, x.line, x.col, x.bol, x.space])).toEqual([
      ['a', 1, 1, true, false],
      ['b', 2, 7, false, true],
      ['d', 4, 3, true, true],
      ['', 0, 0, true, false]
    ])
  })
  it('splices backslash-newlines and keeps later line numbers right', () => {
    const t = tokenize('#define X 1 + \\\n 2\nY', 'f.c')
    expect(t.map((x) => [x.text, x.line])).toEqual([['#', 1], ['define', 1], ['X', 1], ['1', 1], ['+', 1], ['2', 2], ['Y', 3], ['', 0]])
  })
  it('flags an unterminated quote and a stray character for later reporting', () => {
    const t = tokenize('s = "abc\n@', 'f.c')
    expect(t[2]).toMatchObject({ kind: 'string', text: '"abc', bad: '8' })
    expect(t[3]).toMatchObject({ kind: 'other', text: '@', bad: '7', line: 2 })
  })
  it('reads L-prefixed literals and pp-numbers with signs in exponents', () => {
    expect(kinds("L'a' L\"w\" 1e+5f 0x1p-3 3x")).toEqual([
      ['char', "L'a'"], ['string', 'L"w"'], ['number', '1e+5f'], ['number', '0x1p-3'], ['number', '3x'], ['eof', '']
    ])
  })
})
