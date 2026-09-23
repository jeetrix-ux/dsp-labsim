import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { compileUnit } from '../../../src/interp/frontend/program'

interface Reported {
  line: number | null
  severity: 'error' | 'warning'
  code: string
  message: string
}
interface Case {
  name: string
  source: string
  cl6x: Reported[]
}

const CASES: Case[] = JSON.parse(readFileSync(path.join(__dirname, '../../fixtures/diag/cl6x-cases.json'), 'utf8'))

/** Warnings LabSim reproduces; cl6x's flow-analysis warnings (#112-D, #551-D, #994-D, #154-D) are not. */
const IMPLEMENTED_WARNINGS = new Set([
  '1-D', '161-D', '225-D', '179-D', '552-D', '1238-D', '48-D', '1696-D', '2097-D', '40-D', '118-D', '121-D', '145-D', '169-D', '515-D',
  '522-D', '177-D', '69-D', '70-D', '43-D', '1219-D', '139-D', '1181-D', '66-D'
])

/** Cases where cl6x lists its errors in an order LabSim cannot follow; LabSim's first error must still be one cl6x reports. */
const ORDER_DIFFERS: Record<string, string> = {
  p9: 'cl6x reports the errors caused by an unterminated macro call before the call itself'
}

const FILE = path.resolve('/labsim/case.c')
const key = (d: { line: number | null; code: string; message: string }): string => `${d.line ?? 'end'}:${d.code}: ${d.message}`

describe('front-end diagnostics match cl6x 8.3.12', () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.source.split('\n').join(' | ').slice(0, 70)}`, () => {
      const ours = compileUnit(FILE, { readFile: (f) => (f === FILE ? c.source : null), includePaths: [], defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'] }).diagnostics
      const expected = c.cl6x.filter((d) => d.severity === 'error').map(key)
      const got = ours.filter((d) => d.severity === 'error').map(key)
      if (c.name in ORDER_DIFFERS) {
        expect(expected).toContain(got[0])
        return
      }
      if (expected.length > 1) {
        expect(got[0]).toBe(expected[0])
        return
      }
      expect(got).toEqual(expected)
      const warnings = (list: { severity: string; line: number | null; code: string; message: string }[]): string[] =>
        list.filter((d) => d.severity === 'warning' && IMPLEMENTED_WARNINGS.has(d.code)).map(key).sort()
      expect(warnings(ours)).toEqual(warnings(c.cl6x))
    })
  }
})
