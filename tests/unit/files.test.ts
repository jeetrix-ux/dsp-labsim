import { describe, expect, it } from 'vitest'
import { basename, isTextFile, languageFor } from '@shared/files'

describe('files helpers', () => {
  it('recognises lab source and text files', () => {
    for (const f of ['main.c', 'x.H', 'C6748.cmd', 'a.asm', 'b.gel', 'exp11.map', 'notes.txt', 'data.dat', 'z.csv']) {
      expect(isTextFile(f)).toBe(true)
    }
  })
  it('rejects binaries', () => {
    for (const f of ['exp11.out', 'main.obj', 'libc.a', 'pic.png', 'noext']) expect(isTextFile(f)).toBe(false)
  })
  it('takes the basename of Windows and POSIX paths', () => {
    expect(basename('C:\\ws\\fir lowpass\\main.c')).toBe('main.c')
    expect(basename('/tmp/ws/main.c')).toBe('main.c')
  })
  it('picks the C language for .c and .h', () => {
    expect(languageFor('a\\main.c')).toBe('c')
    expect(languageFor('a\\x.h')).toBe('c')
    expect(languageFor('a\\C6748.cmd')).toBe('plaintext')
  })
})
