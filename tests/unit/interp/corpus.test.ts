import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { findSources } from '../../../src/main/build/builder'
import { compileUnit, linkProgram, type CompileOptions } from '../../../src/interp/frontend/program'

const WS = join(homedir(), 'workspace_v12')
const LAB = join(homedir(), 'dsp_ccs_lab')

const projects = existsSync(WS)
  ? readdirSync(WS)
      .map((n) => join(WS, n))
      .filter((d) => statSync(d).isDirectory() && !basename(d).startsWith('.') && basename(d) !== 'RemoteSystemsTempFiles')
  : []
const labFiles = existsSync(LAB) ? readdirSync(LAB).filter((f) => f.endsWith('.c')).map((f) => join(LAB, f)) : []

/** Errors cl6x itself reports for these projects: `line:code`. */
const KNOWN: Record<string, string[]> = {
  fft_m: ['2:1965'],
  idft_8_m: ['33:29', '34:29']
}

/** Lab files whose experiment is chosen with a #define, and every value it takes. */
const VARIANTS: [string, string, number[]][] = [
  ['dsp_lab_ccs_exp09_15.c', 'EXPERIMENT', [9, 10, 11, 12, 13, 14, 15]],
  ['dsp_lab_exp5_filters.c', 'FILTER', [1, 2, 3, 4, 5, 6]],
  ['dsp_lab_exp5_fir_iir.c', 'FILTER', [1, 2]]
]

function options(dir: string, rewrite?: (text: string) => string): CompileOptions {
  return {
    readFile: (f) => {
      try {
        const text = readFileSync(f, 'utf8')
        return rewrite ? rewrite(text) : text
      } catch {
        return null
      }
    },
    includePaths: [dir],
    defines: ['c6748'],
    dialect: 'c89',
    diagWarnings: ['225']
  }
}

function check(sources: string[], opts: CompileOptions, known: string[] = []): void {
  const results = sources.map((s) => compileUnit(s, opts))
  const errors = results.flatMap((r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line ?? 'end'}:${d.code}`))
  expect(errors).toEqual(known)
  if (errors.length === 0) expect(linkProgram(results.map((r) => r.unit!)).problems).toEqual([])
}

describe.skipIf(projects.length === 0)('~/workspace_v12 corpus', () => {
  for (const dir of projects) {
    it(basename(dir), async () => {
      const sources = await findSources(dir)
      if (sources.length > 0) check(sources, options(dir), KNOWN[basename(dir)])
    })
  }
})

describe.skipIf(labFiles.length === 0)('~/dsp_ccs_lab corpus', () => {
  for (const file of labFiles) it(basename(file), () => check([file], options(dirname(file))))
  for (const [name, macro, values] of VARIANTS) {
    for (const value of values) {
      it(`${name} with ${macro} ${value}`, () => {
        const file = join(LAB, name)
        const rewrite = (text: string): string => text.replace(new RegExp(`^#define\\s+${macro}\\s+\\d+`, 'm'), `#define ${macro} ${value}`)
        check([file], options(LAB, rewrite))
      })
    }
  }
})
