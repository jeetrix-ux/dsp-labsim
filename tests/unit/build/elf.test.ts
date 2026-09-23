import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileIdOf, readElf, STB, STT } from '../../../src/main/build/elf'
import { parseGlobalSymbols, parseMemoryConfiguration } from '../../../src/main/build/mapfile'

const FIX = join(__dirname, '../../fixtures/elf')
const out = readElf(readFileSync(join(FIX, 'g.out')))
const obj = readElf(readFileSync(join(FIX, 'main.obj')))
const map = readFileSync(join(FIX, 'g.map'), 'utf8')

describe('readElf', () => {
  it('reads the header and allocated sections', () => {
    expect(out.machine).toBe(140)
    const names = out.sections.map((s) => s.name)
    for (const n of ['.text', '.stack', '.sysmem', '.far', '.fardata', '.const', '.cio']) expect(names).toContain(n)
  })
  it('agrees with the linker map on every global address', () => {
    const fromMap = parseGlobalSymbols(map)
    expect(Object.keys(fromMap).length).toBeGreaterThan(50)
    for (const s of out.symbols) {
      if ((s.bind === STB.GLOBAL || s.bind === STB.WEAK) && s.name in fromMap && s.shndx !== 0) {
        expect({ name: s.name, addr: s.value }).toEqual({ name: s.name, addr: fromMap[s.name] })
      }
    }
    expect(fromMap.x).toBeDefined()
    expect(fromMap.main).toBeDefined()
  })
  it('records sizes for globals and ties locals to their translation unit', () => {
    const x = out.symbols.find((s) => s.name === 'x')!
    expect([x.size, x.bind]).toEqual([256, STB.GLOBAL])
    const guid = fileIdOf(obj)
    expect(guid).toMatch(/^\{[0-9A-F-]+\}$/)
    const statics = out.symbols.filter((s) => s.bind === STB.LOCAL && s.fileId === guid && s.type === STT.OBJECT).map((s) => s.name)
    expect(statics).toEqual(expect.arrayContaining(['counter', 'table', 'local_static$1']))
  })
  it('rejects files that are not little-endian ELF32', () => {
    expect(() => readElf(new Uint8Array([1, 2, 3, 4]))).toThrow('Not an ELF32 little-endian file')
  })
})

describe('parseMemoryConfiguration', () => {
  it('lists the C6748 memory regions', () => {
    const mem = parseMemoryConfiguration(map)
    expect(mem).toHaveLength(15)
    expect(mem.find((m) => m.name === 'SHRAM')).toEqual({ name: 'SHRAM', origin: 0x80000000, length: 0x20000, attr: 'RWIX' })
    expect(mem.find((m) => m.name === 'DDR2')).toEqual({ name: 'DDR2', origin: 0xc0000000, length: 0x20000000, attr: 'RWIX' })
  })
})
