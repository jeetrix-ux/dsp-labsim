import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseLinkerCommandFile } from '../../../src/main/build/linkerCmd'

describe('parseLinkerCommandFile', () => {
  it('reads the MEMORY and SECTIONS of the CCS C6748.cmd template', () => {
    const cmd = parseLinkerCommandFile(readFileSync(join(__dirname, '../../fixtures/ccs/C6748.cmd'), 'utf8'))
    expect(cmd.memory).toHaveLength(15)
    expect(cmd.memory[0]).toEqual({ name: 'DSPL2ROM', origin: 0x00700000, length: 0x00100000, attr: 'RWIX' })
    expect(cmd.memory.find((m) => m.name === 'SHRAM')).toEqual({ name: 'SHRAM', origin: 0x80000000, length: 0x00020000, attr: 'RWIX' })
    expect(cmd.sections.slice(0, 4)).toEqual([
      { name: '.text', region: 'SHRAM' }, { name: '.stack', region: 'SHRAM' }, { name: '.bss', region: 'SHRAM' }, { name: '.cio', region: 'SHRAM' }
    ])
    expect(cmd.sections.find((s) => s.name === '.fardata')?.region).toBe('SHRAM')
  })
  it('accepts the other common spellings', () => {
    const text = `/* test */ MEMORY { L2 (RWX) : origin = 0x11800000, length = 256K  // L2
      DDR : org = 0xC0000000 len = 0x10000000 }
      SECTIONS { .text : > L2   .cinit : load > DDR   .far > DDR }`
    const cmd = parseLinkerCommandFile(text)
    expect(cmd.memory).toEqual([
      { name: 'L2', origin: 0x11800000, length: 256 * 1024, attr: 'RWX' },
      { name: 'DDR', origin: 0xc0000000, length: 0x10000000, attr: 'RWIX' }
    ])
    expect(cmd.sections).toEqual([{ name: '.text', region: 'L2' }, { name: '.cinit', region: 'DDR' }, { name: '.far', region: 'DDR' }])
  })
})
