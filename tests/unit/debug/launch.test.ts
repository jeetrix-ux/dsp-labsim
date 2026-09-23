import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProgramImage } from '@shared/program'
import { debugLaunch } from '../../../src/main/debug/launch'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'labsim-launch-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const IMAGE = { outFile: 'x.out', entry: 0, memory: [], sections: [], globals: {}, statics: {}, stack: { start: 0, size: 0 }, heap: { start: 0, size: 0 } } as ProgramImage

describe('debugLaunch', () => {
  it("collects the project's sources and compile options, without the compiler's include folder", async () => {
    writeFileSync(join(dir, 'main.c'), 'int main(void) { return 0; }\n')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'fir.c'), 'int fir;\n')
    const tc = { root: 'C:/ti/cgt', version: '8.3.12', cl6x: 'C:/ti/cgt/bin/cl6x.exe' }
    const launch = await debugLaunch(dir, IMAGE, tc)
    expect(launch.sources).toEqual([join(dir, 'main.c'), join(dir, 'src', 'fir.c')])
    expect(launch).toMatchObject({ projectDir: dir, defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'], image: IMAGE })
    expect(launch.includePaths.some((p) => p.includes('cgt'))).toBe(false)
  })
})
