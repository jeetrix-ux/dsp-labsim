import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Diags } from '../../../src/interp/frontend/diag'
import { BUILTIN_HEADERS, PRELUDE } from '../../../src/interp/frontend/headers'
import { tokenize } from '../../../src/interp/frontend/lexer'
import { isBuiltinFile, preprocess, type Macro } from '../../../src/interp/frontend/preprocessor'

interface TiMacro { params: string[] | null; body: string[]; predefined: boolean }

function parsePpm(text: string): Map<string, TiMacro> {
  const out = new Map<string, TiMacro>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^#define (\w+)(\(([^)]*)\))?(?: (.*?))?(?:\t\/\* (.*) \*\/)?$/.exec(line)
    if (!m) continue
    const params = m[2] ? m[3].split(',').map((p) => p.trim()).filter(Boolean) : null
    const body = tokenize(m[4] ?? '', 'ti').filter((t) => t.kind !== 'eof').map((t) => t.text)
    out.set(m[1], { params, body, predefined: m[5] === undefined || m[5] === 'Predefined' })
  }
  return out
}

const TI = parsePpm(readFileSync(join(__dirname, '../../fixtures/ti/headers.ppm'), 'utf8'))
const SUPPORTED = Object.keys(BUILTIN_HEADERS).filter((h) => h !== PRELUDE && !BUILTIN_HEADERS[h].includes('#error'))

function ours(): Map<string, Macro> {
  const src = SUPPORTED.map((h) => `#include <${h}>`).join('\n')
  const diags = new Diags()
  const r = preprocess('/t/all.c', { readFile: (f) => (f === '/t/all.c' ? src : null), includePaths: [], defines: ['c6748'], dialect: 'c89' }, diags)
  expect(diags.list).toEqual([])
  return r.macros
}

/** Macros LabSim defines differently on purpose, because TI's versions call compiler internals. */
const DELIBERATE = new Set(['va_start', 'va_arg', 'offsetof', 'signbit', 'CLOCKS_PER_SEC'])

describe('built-in headers', () => {
  it('predefine exactly the macros cl6x -mv6740 predefines, with the same values', () => {
    const mine = [...ours().values()].filter((m) => m.origin !== 'source')
    const tiNames = [...TI].filter(([, m]) => m.predefined).map(([n]) => n)
    expect(mine.map((m) => m.name).sort()).toEqual(tiNames.sort())
    for (const m of mine) {
      if (m.name === '__DATE__' || m.name === '__TIME__') continue
      expect([m.name, m.body.map((t) => t.text)]).toEqual([m.name, TI.get(m.name)?.body])
    }
  })
  it('give every macro they share with TI the same parameters and body', () => {
    const mismatches: string[] = []
    for (const m of ours().values()) {
      if (m.origin !== 'source' || !isBuiltinFile(m.loc.file) || DELIBERATE.has(m.name)) continue
      const ti = TI.get(m.name)
      if (!ti) continue
      const same = JSON.stringify(ti.params) === JSON.stringify(m.params) && ti.body.join(' ') === m.body.map((t) => t.text).join(' ')
      if (!same) mismatches.push(`${m.name}: TI ${ti.body.join(' ')} / LabSim ${m.body.map((t) => t.text).join(' ')}`)
    }
    expect(mismatches).toEqual([])
  })
  it('define the macros lab programs use', () => {
    const m = ours()
    for (const name of ['M_PI', 'M_SQRT2', 'HUGE_VAL', 'RAND_MAX', 'EOF', 'NULL', 'stdout', 'INT_MAX', 'UINT_MAX', 'CHAR_BIT', 'FLT_EPSILON', 'DBL_MAX', 'INT32_MAX', 'UINT16_MAX', 'bool', 'true', 'assert', 'EXIT_SUCCESS', 'SEEK_SET', '_IONBF']) {
      expect(m.has(name), name).toBe(true)
    }
  })
  it('reject unsupported standard headers with a clear #error', () => {
    expect(BUILTIN_HEADERS['complex.h']).toContain('#error LabSim does not support <complex.h>')
  })
})
