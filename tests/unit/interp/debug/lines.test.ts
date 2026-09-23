import { describe, expect, it } from 'vitest'
import { Diags } from '../../../../src/interp/frontend/diag'
import { parseExpression } from '../../../../src/interp/frontend/parser'
import { typeToString } from '../../../../src/interp/frontend/types'
import { fileKey, statementLines, verifyLine } from '../../../../src/interp/debug/lines'
import { build, MAIN } from '../exec/harness'

const SRC = [
  'int sq(int v)', //         1
  '{', //                     2
  '    return v * v;', //     3
  '}', //                     4
  '', //                      5
  'int main(void)', //        6
  '{', //                     7
  '    int i;', //            8
  '    int s = 0;', //        9
  '    /* comment */', //     10
  '    for (i = 0; i < 3; i++)', // 11
  '        s += sq(i);', //   12
  '    do { s--; } while (s > 100);', // 13
  '    return s;', //         14
  '}' //                      15
].join('\n')

describe('statementLines', () => {
  it('lists the lines where the executor stops, per file', () => {
    const { program } = build(SRC)
    expect(statementLines(program).get(fileKey(MAIN))).toEqual([3, 4, 9, 11, 12, 13, 14, 15])
  })

  it('moves a breakpoint on a line without code to the next statement', () => {
    const lines = statementLines(build(SRC).program)
    expect([5, 8, 10, 11, 16].map((l) => verifyLine(lines, MAIN, l))).toEqual([9, 9, 11, 11, null])
    expect(verifyLine(lines, MAIN.toUpperCase().replace(/\\/g, '/'), 12)).toBe(12)
    expect(verifyLine(lines, 'C:\\other.c', 3)).toBeNull()
  })
})

describe('parseExpression', () => {
  const { program } = build('typedef struct { float re, im; } cplx;\ncplx z;\nint g[4];\nint main(void) { int k = 2; return g[k]; }')
  const unit = program.units[0]
  const locals = program.main.locals

  it('types an expression over globals, locals and typedefs', () => {
    const diags = new Diags([])
    const e = parseExpression('g[k] * 2 + z.re', unit, locals, diags)
    expect(diags.list).toEqual([])
    expect(typeToString(e!.type)).toBe('float')
    expect(typeToString(parseExpression('(cplx *)&g', unit, [], diags)!.type)).toBe('cplx *')
  })

  it('reports cl6x errors for unknown names and bad syntax', () => {
    const d1 = new Diags([])
    parseExpression('nosuch + 1', unit, [], d1)
    expect(d1.list.map((d) => d.message)).toEqual(['identifier "nosuch" is undefined'])
    const d2 = new Diags([])
    expect(parseExpression('g[', unit, [], d2)).toBeNull()
    expect(d2.errors).toBeGreaterThan(0)
    const d3 = new Diags([])
    expect(parseExpression('1 2', unit, [], d3)).toBeNull()
  })
})
