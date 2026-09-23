import { readFileSync } from 'fs'
import * as path from 'path'
import { expect } from 'vitest'
import type { ProgramImage } from '@shared/program'
import type { RunIO } from '../../../../src/interp/exec/machine'
import { compileUnit, linkProgram, type Program } from '../../../../src/interp/frontend/program'
import { layoutProgram } from '../../../../src/main/build/fallbackImage'
import { parseLinkerCommandFile } from '../../../../src/main/build/linkerCmd'

export const MAIN = path.resolve('/proj/main.c')
const CMD = parseLinkerCommandFile(readFileSync(path.join(__dirname, '../../../fixtures/ccs/C6748.cmd'), 'utf8'))

export const NO_IO: RunIO = { write: () => {}, note: () => {}, readLine: () => null, files: null }

export interface BuildOptions {
  dialect?: 'c89' | 'c99'
  heap?: number
  stack?: number
}

/** Compiles and links main.c (plus other files by name) and lays the program out like the fallback linker. */
export function build(source: string, others: Record<string, string> = {}, opts: BuildOptions = {}): { program: Program; image: ProgramImage } {
  const files: Record<string, string> = { [MAIN]: source }
  for (const [name, text] of Object.entries(others)) files[path.resolve('/proj', name)] = text
  const read = (f: string): string | null => (f in files ? files[f] + '\n' : null)
  const units = Object.keys(files)
    .filter((f) => f.endsWith('.c'))
    .map((f) => {
      const r = compileUnit(f, { readFile: read, includePaths: [path.resolve('/proj')], defines: ['c6748'], dialect: opts.dialect ?? 'c89', diagWarnings: ['225'] })
      expect(r.diagnostics.filter((d) => d.severity === 'error'), f).toEqual([])
      return r.unit!
    })
  const link = linkProgram(units)
  expect(link.problems).toEqual([])
  const layout = layoutProgram(link.program!, CMD, { heapSize: opts.heap ?? 0x800, stackSize: opts.stack ?? 0x800, outFile: 'main.out' })
  expect(layout.error).toBeNull()
  return { program: link.program!, image: layout.image! }
}
