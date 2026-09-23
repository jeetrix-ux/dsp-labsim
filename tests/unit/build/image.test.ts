import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileIdOf, readElf } from '../../../src/main/build/elf'
import { buildProgramImage, loadProgramImage } from '../../../src/main/build/image'
import { parseGlobalSymbols } from '../../../src/main/build/mapfile'

const FIX = join(__dirname, '../../fixtures/elf')
const SRC = 'C:\\ws\\g\\main.c'
const map = readFileSync(join(FIX, 'g.map'), 'utf8')
const image = buildProgramImage(
  readElf(readFileSync(join(FIX, 'g.out'))),
  map,
  [{ source: SRC, fileId: fileIdOf(readElf(readFileSync(join(FIX, 'main.obj')))) }],
  join(FIX, 'g.out')
)

describe('buildProgramImage', () => {
  it('places user globals where the linker put them', () => {
    const fromMap = parseGlobalSymbols(map)
    for (const n of ['x', 'h', 'big', 'pts', 'main']) expect(image.globals[n].addr).toBe(fromMap[n])
    expect(image.globals.x).toMatchObject({ size: 256, section: '.far', kind: 'object' })
    expect(image.globals.big).toMatchObject({ size: 16000, kind: 'object' })
    expect(image.globals.h.section).toBe('.fardata')
    expect(image.globals.main.kind).toBe('func')
  })
  it('groups statics by source file', () => {
    const s = image.statics[SRC]
    expect(Object.keys(s).sort()).toEqual(['counter', 'local_static$1', 'table'])
    expect(s.table).toMatchObject({ size: 8, section: '.const' })
    expect(s['local_static$1'].size).toBe(32)
  })
  it('finds stack, heap, entry point and memory map', () => {
    expect(image.stack.size).toBe(0x800)
    expect(image.heap.size).toBe(0x800)
    expect(image.stack.start).toBe(image.sections.find((x) => x.name === '.stack')!.addr)
    expect(image.entry).toBe(parseGlobalSymbols(map)._c_int00)
    expect(image.memory.map((m) => m.name)).toContain('SHRAM')
  })
})

describe('loadProgramImage', () => {
  it('reads the files and produces the same image', async () => {
    const loaded = await loadProgramImage(join(FIX, 'g.out'), join(FIX, 'g.map'), [{ source: SRC, objPath: join(FIX, 'main.obj') }])
    expect(loaded).toEqual(image)
  })
})
