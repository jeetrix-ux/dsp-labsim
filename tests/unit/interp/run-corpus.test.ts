import { describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import * as path from 'path'
import { prepare } from '../../../src/cli/prepare'
import { captureIO, LoadError, loadProgram, runProgram } from '../../../src/interp/run'
import { runBuild } from '../../../src/main/build/builder'
import { findToolchain } from '../../../src/main/build/toolchain'
import { NO_IO } from './exec/harness'

const tc = await findToolchain()

const WS = path.join(homedir(), 'workspace_v12')
const LAB = path.join(homedir(), 'dsp_ccs_lab')
const GOLDEN = path.join(__dirname, '../../fixtures/golden')
const UPDATE = !!process.env.UPDATE_GOLDEN

const projects = existsSync(WS)
  ? readdirSync(WS)
      .map((n) => path.join(WS, n))
      .filter((d) => statSync(d).isDirectory() && existsSync(path.join(d, '.project')) && path.basename(d) !== 'RemoteSystemsTempFiles')
  : []
const labFiles = existsSync(LAB) ? readdirSync(LAB).filter((f) => f.endsWith('.c')) : []

const VARIANTS: [string, string, number[]][] = [
  ['dsp_lab_ccs_exp09_15.c', 'EXPERIMENT', [9, 10, 11, 12, 13, 14, 15]],
  ['dsp_lab_exp5_filters.c', 'FILTER', [1, 2, 3, 4, 5, 6]],
  ['dsp_lab_exp5_fir_iir.c', 'FILTER', [1, 2]]
]

/** What the console shows for one run, plus how it ended. Nothing is written to the corpus folders. */
async function transcript(target: string, rewrite?: (f: string, t: string) => string): Promise<string> {
  const p = await prepare(target, { rewrite })
  if (!p.ok) return `@@ labsim: does not build\n${p.messages.join('\n')}\n`
  const cap = captureIO()
  let m
  try {
    m = loadProgram(p.program, p.image, cap.io, { maxSteps: 50_000_000 })
  } catch (e) {
    if (e instanceof LoadError) return `@@ labsim: does not load: ${e.message}${e.loc ? ` at ${path.basename(e.loc.file)}:${e.loc.line}` : ''}\n`
    throw e
  }
  const r = runProgram(m)
  let out = cap.stdout()
  if (out && !out.endsWith('\n')) out += '\n'
  const err = cap.stderr()
  if (err) out += `@@ labsim: stderr\n${err}${err.endsWith('\n') ? '' : '\n'}`
  for (const n of cap.notes) out += `@@ labsim: note: ${n}\n`
  if (r.status === 'exited') out += r.code === null ? '@@ labsim: abort\n' : `@@ labsim: exit ${r.code}\n`
  else out += `@@ labsim: halted: ${r.message} at ${path.basename(r.loc.file)}:${r.loc.line}\n`
  return out
}

function check(name: string, text: string): void {
  const file = path.join(GOLDEN, `${name}.txt`)
  if (UPDATE) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(file, text)
    return
  }
  expect(existsSync(file), `${file} is missing: run UPDATE_GOLDEN=1 npx vitest run tests/unit/interp/run-corpus.test.ts`).toBe(true)
  expect(text).toBe(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
}

describe.skipIf(projects.length === 0)('~/workspace_v12 programs run like the board', () => {
  for (const dir of projects) {
    it(path.basename(dir), async () => check(path.basename(dir), await transcript(dir)), 60_000)
  }
})

describe.skipIf(labFiles.length === 0)('~/dsp_ccs_lab programs run like the board', () => {
  for (const f of labFiles) it(f, async () => check(`lab-${f}`, await transcript(path.join(LAB, f))), 60_000)
  for (const [f, macro, values] of VARIANTS) {
    for (const v of values) {
      it(`${f} with ${macro} ${v}`, async () => {
        const rewrite = (file: string, text: string): string =>
          path.basename(file) === f ? text.replace(new RegExp(`^#define\\s+${macro}\\s+\\d+`, 'm'), `#define ${macro} ${v}`) : text
        check(`lab-${f}@${macro}=${v}`, await transcript(path.join(LAB, f), rewrite))
      }, 60_000)
    }
  }
})

describe.skipIf(!tc || projects.length === 0)('the interpreter uses the addresses of the real cl6x link', () => {
  for (const dir of projects) {
    it(path.basename(dir), async () => {
      // Build a copy in a temporary folder: nothing is ever written to ~/workspace_v12.
      const tmp = mkdtempSync(path.join(tmpdir(), 'labsim-addr-'))
      try {
        const copy = path.join(tmp, path.basename(dir))
        cpSync(dir, copy, { recursive: true, filter: (src) => !/[\\/](Debug|Release|\.labsim)$/i.test(src) })
        const built = await runBuild({ projectDir: copy, kind: 'build', toolchain: tc!, onOutput: () => {} })
        if (!built.ok) return // fft_m and idft_8_m do not build in CCS either
        const p = await prepare(copy)
        if (!p.ok) throw new Error(p.messages.join('\n'))
        const m = loadProgram(p.program, built.image!, NO_IO)
        // The TI linker drops unreferenced sections, so an object the program never uses (such as the MATLAB
        // headers' `const int BL = 51;`) has no symbol and lives in LabSim's region. Every used one must not.
        const used = p.program.units.flatMap((u) => u.objects).filter((v) => v.refs + v.sets > 0)
        expect(m.placement.unplaced.filter((n) => used.some((v) => v.linkName === n))).toEqual([])
        for (const [name, v] of p.program.globals) {
          if (v.refs + v.sets > 0) expect(m.placement.objectAddress(v), name).toBe(built.image!.globals[name].addr)
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }, 120_000)
  }
})
