import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { compileUnit, linkProgram, type Program } from '../../../src/interp/frontend/program'
import { layoutProgram, TEXT_ESTIMATE } from '../../../src/main/build/fallbackImage'
import { parseLinkerCommandFile } from '../../../src/main/build/linkerCmd'

const CMD = parseLinkerCommandFile(readFileSync(path.join(__dirname, '../../fixtures/ccs/C6748.cmd'), 'utf8'))
const FILE = path.resolve('/proj/main.c')

function program(src: string): Program {
  const r = compileUnit(FILE, { readFile: (f) => (f === FILE ? src : null), includePaths: [], defines: ['c6748'], dialect: 'c89', diagWarnings: [] })
  const link = linkProgram([r.unit!])
  expect(link.problems).toEqual([])
  return link.program!
}

const SRC = [
  'float x[64];',
  'float h[3] = { 1, 2, 1 };',
  'static int counter;',
  'static const short table[4] = { 1, 2, 3, 4 };',
  'int n = 5;',
  'int main(void) { static float ls[8]; ls[0] = x[0] + h[1] + table[2] + counter + n; return (int)ls[0]; }'
].join('\n')

describe('layoutProgram', () => {
  it('places objects in the sections cl6x uses, in SECTIONS order inside SHRAM', () => {
    const { image, error } = layoutProgram(program(SRC), CMD, { heapSize: 0x800, stackSize: 0x800, outFile: 'p.out' })
    expect(error).toBeNull()
    expect(image!.sections.map((s) => s.name)).toEqual(['.text', '.stack', '.bss', '.cio', '.const', '.sysmem', '.far', '.neardata', '.fardata'])
    expect(image!.sections[0]).toEqual({ name: '.text', addr: 0x80000000, size: TEXT_ESTIMATE, nobits: false })
    expect(image!.stack).toEqual({ start: 0x80000000 + TEXT_ESTIMATE, size: 0x800 })
    expect(image!.heap.size).toBe(0x800)
    expect(image!.globals.x).toMatchObject({ section: '.far', size: 256 })
    expect(image!.globals.h).toMatchObject({ section: '.fardata', size: 12 })
    expect(image!.globals.n).toMatchObject({ section: '.neardata', size: 4 })
    expect(image!.statics[FILE].counter).toMatchObject({ section: '.bss', size: 4 })
    expect(image!.statics[FILE].table).toMatchObject({ section: '.const', size: 8 })
    expect(image!.statics[FILE]['ls$1']).toMatchObject({ section: '.far', size: 32 })
    expect(image!.entry).toBe(0x80000000)
    expect(image!.globals._c_int00.addr).toBe(0x80000000)
    const sorted = [...image!.sections].sort((a, b) => a.addr - b.addr)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].addr).toBeGreaterThanOrEqual(sorted[i - 1].addr + sorted[i - 1].size)
    const last = sorted[sorted.length - 1]
    expect(last.addr + last.size).toBeLessThanOrEqual(0x80020000)
  })
  it('fails like the TI linker when the data does not fit', () => {
    const { image, error } = layoutProgram(program('float big[40000];\nint main(void) { big[1] = 2; return 0; }'), CMD, { heapSize: 0x800, stackSize: 0x800, outFile: 'p.out' })
    expect(image).toBeNull()
    expect(error).toMatch(/^error #10099-D: program will not fit into available memory\. .*placement fails for section "\.far" size 0x27100/)
  })
})
