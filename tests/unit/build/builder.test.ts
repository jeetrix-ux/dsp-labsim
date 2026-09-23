import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Toolchain } from '@shared/build'
import { findToolchain } from '../../../src/main/build/toolchain'
import { findSources, OUT_SUBDIR, runBuild } from '../../../src/main/build/builder'

const FIX = join(__dirname, '../../fixtures')
const tc: Toolchain | null = await findToolchain()

let ws: string
let log: { text: string; kind: string }[]
const onOutput = (text: string, kind: 'out' | 'info' | 'error'): void => { log.push({ text, kind }) }
const text = (): string => log.map((l) => l.text).join('\n')

function project(name: string, main: string, extra: Record<string, string> = {}): string {
  const dir = join(ws, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'main.c'), main)
  copyFileSync(join(FIX, 'ccs', 'C6748.cmd'), join(dir, 'C6748.cmd'))
  for (const [f, c] of Object.entries(extra)) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), c)
  }
  return dir
}

const GOOD = '#include <stdio.h>\nfloat y[8];\nstatic int n;\nint main(void)\n{\n    int i;\n    for (i = 0; i < 8; i++) y[i] = i * 0.5f;\n    n = 8;\n    printf("done %d\\n", n);\n    return 0;\n}\n'
const BAD = '#include <stdio.h>\nint main(void)\n{\n    int unused = 3;\n    z = 4;\n    return 0;\n}\n'

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-build-'))
  log = []
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

describe('findSources', () => {
  it('lists .c files, skipping Debug, Release and dot folders', async () => {
    const dir = project('p', GOOD, { 'src/fir.c': '', 'Debug/old.c': '', 'Release/r.c': '', '.labsim/x.c': '', 'notes.txt': '' })
    expect(await findSources(dir)).toEqual([join(dir, 'main.c'), join(dir, 'src', 'fir.c')])
  })
})

describe('runBuild without a compiler (LabSim fallback)', () => {
  it('builds with the LabSim front-end and lays the program out in SHRAM', async () => {
    const dir = project('p', GOOD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
    const out = text()
    expect(out).toContain('this build uses the LabSim C front-end')
    expect(out).toContain('Invoking: LabSim C Front-End')
    expect(out).toContain('Finished building target: "p.out"')
    expect(out).toContain('**** Build Finished ****')
    expect(r.image?.globals.y).toMatchObject({ section: '.far', size: 32 })
    expect(r.image?.globals.y.addr).toBeGreaterThanOrEqual(0x80000000)
    expect(r.image?.statics[join(dir, 'main.c')].n).toMatchObject({ section: '.bss', size: 4 })
  })
  it('prints labsim.json problems in the Build Console', async () => {
    const dir = project('p', GOOD, { 'labsim.json': '{ "heapSize": "lots" }' })
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(true)
    expect(log).toContainEqual({ text: 'LabSim: labsim.json: heapSize must be a size such as "0x800"; ignored.', kind: 'error' })
  })
  it('reports compile errors in cl6x form', async () => {
    const dir = project('bad', BAD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toEqual([
      { file: join(dir, 'main.c'), line: 5, severity: 'error', code: '20', message: 'identifier "z" is undefined' },
      { file: join(dir, 'main.c'), line: 4, severity: 'warning', code: '179-D', message: 'variable "unused" was declared but never referenced' }
    ])
    const out = text()
    expect(out).toContain('"../../main.c", line 5: error #20: identifier "z" is undefined')
    expect(out).toContain('1 error detected in the compilation of "../../main.c".')
    expect(out).toContain('Build stopped: 1 file failed to compile; "bad.out" not built.')
  })
  it('reports unresolved functions like the TI linker', async () => {
    const r = await runBuild({ projectDir: project('undef', 'int helper(int);\nint main(void)\n{\n    return helper(2);\n}\n'), kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics.map((d) => d.code)).toEqual(['10234-D', '10234-D', '10010'])
    expect(r.diagnostics[0].message).toBe('unresolved symbol helper, first referenced in ./main.obj')
    expect(text()).toContain('error #10010: errors encountered during linking; "undef.out" not built')
  })
})

describe.skipIf(!tc)('runBuild with cl6x', () => {
  it('builds, reports CCS-style console output and returns the program image', async () => {
    const dir = project('good', GOOD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
    const out = text()
    expect(out).not.toContain("LabSim's own front-end cannot run it")
    expect(log[0].text).toBe('**** Build of configuration Debug for project good ****')
    expect(out).toContain('Building file: "../../main.c"')
    expect(out).toContain('Invoking: C6000 Compiler')
    expect(out).toContain('Finished building: "../../main.c"')
    expect(out).toContain('Building target: "good.out"')
    expect(out).toContain('Invoking: C6000 Linker')
    expect(out).toContain('<Linking>')
    expect(out).toContain('Finished building target: "good.out"')
    expect(log.at(-1)?.text).toBe('**** Build Finished ****')
    expect(existsSync(join(dir, OUT_SUBDIR, 'good.out'))).toBe(true)
    expect(existsSync(join(dir, 'Debug'))).toBe(false)
    expect(r.image?.globals.y.size).toBe(32)
    expect(Object.keys(r.image?.statics[join(dir, 'main.c')] ?? {})).toEqual(['n'])
  }, 60_000)

  it('does nothing on a second build and recompiles after an edit', async () => {
    const dir = project('inc', GOOD)
    await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    log = []
    const again = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(again.ok).toBe(true)
    expect(again.image).not.toBeNull()
    expect(text()).not.toContain('Invoking: C6000 Compiler')
    expect(text()).toContain("'inc.out' is up to date.")
    const future = Date.now() / 1000 + 10
    utimesSync(join(dir, 'main.c'), future, future)
    log = []
    await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(text()).toContain('Invoking: C6000 Compiler')
    expect(text()).toContain('Invoking: C6000 Linker')
  }, 90_000)

  it('reports compile errors, skips the link and keeps warnings across builds', async () => {
    const dir = project('bad', BAD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(false)
    expect(r.image).toBeNull()
    expect(r.diagnostics).toContainEqual({ file: join(dir, 'main.c'), line: 5, severity: 'error', code: '20', message: 'identifier "z" is undefined' })
    expect(r.diagnostics.some((d) => d.severity === 'warning' && d.code === '179-D')).toBe(true)
    expect(log.some((l) => l.kind === 'error' && l.text.includes('error #20'))).toBe(true)
    expect(text()).not.toContain('Invoking: C6000 Linker')
    expect(text()).toContain('"bad.out" not built')
  }, 60_000)

  it('keeps diagnostics of files that were not recompiled', async () => {
    const dir = project('warn', '#include <stdio.h>\nint main(void)\n{\n    int unused = 3;\n    return 0;\n}\n')
    const first = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(first.diagnostics.map((d) => d.code)).toEqual(['179-D'])
    const second = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(second.diagnostics.map((d) => d.code)).toEqual(['179-D'])
  }, 60_000)

  it('cleans and rebuilds', async () => {
    const dir = project('cr', GOOD)
    await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    log = []
    const c = await runBuild({ projectDir: dir, kind: 'clean', toolchain: tc, onOutput })
    expect(c.ok).toBe(true)
    expect(existsSync(join(dir, OUT_SUBDIR))).toBe(false)
    expect(log[0].text).toBe('**** Clean-only build of configuration Debug for project cr ****')
    log = []
    const rb = await runBuild({ projectDir: dir, kind: 'rebuild', toolchain: tc, onOutput })
    expect(rb.ok).toBe(true)
    expect(text()).toContain('Invoking: C6000 Compiler')
  }, 90_000)

  it('handles a project folder with a space in its name', async () => {
    const r = await runBuild({ projectDir: project('fir lowpass', GOOD), kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(true)
    expect(text()).toContain('Building target: "fir lowpass.out"')
  }, 60_000)

  it('fails clearly without a linker command file', async () => {
    const dir = project('nocmd', GOOD)
    rmSync(join(dir, 'C6748.cmd'))
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.message.includes('No linker command file'))).toBe(true)
  }, 60_000)

  it("warns when LabSim's front-end cannot read a program that cl6x builds", async () => {
    const src = 'struct flags { unsigned a : 3; } f;\nint main(void)\n{\n    f.a = 1;\n    return f.a;\n}\n'
    const r = await runBuild({ projectDir: project('bits', src), kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(true)
    expect(text()).toContain("LabSim: cl6x built this program, but LabSim's own front-end cannot run it yet")
    expect(text()).toContain('unsupported construct bit-field')
  }, 60_000)
})
