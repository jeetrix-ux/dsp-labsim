import { describe, expect, it } from 'vitest'
import { basename, isTextFile, joinPath, languageFor, pathSep, samePath, toModelPath } from '@shared/files'

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

describe('paths on either OS', () => {
  it('joins with the separator the folder already uses', () => {
    expect(pathSep('C:\\ws\\lab1')).toBe('\\')
    expect(pathSep('/Users/amy/workspace_v12/lab1')).toBe('/')
    expect(joinPath('C:\\ws\\lab1', 'main.c')).toBe('C:\\ws\\lab1\\main.c')
    expect(joinPath('/Users/amy/ws/lab1', 'main.c')).toBe('/Users/amy/ws/lab1/main.c')
    expect(joinPath('/Users/amy/ws/lab1/', 'main.c')).toBe('/Users/amy/ws/lab1/main.c')
  })

  it('compares paths without caring about separators or case', () => {
    expect(samePath('C:\\ws\\Lab1\\main.c', 'c:/ws/lab1/main.c')).toBe(true)
    expect(samePath('/Users/amy/ws/main.c', '/Users/amy/ws/Main.c')).toBe(true)
    expect(samePath('/a/b.c', '/a/c.c')).toBe(false)
  })

  it('makes Monaco URIs for Windows and POSIX paths', () => {
    expect(toModelPath('C:\\ws\\lab1\\main.c')).toBe('file:///C:/ws/lab1/main.c')
    expect(toModelPath('/Users/amy/ws/main.c')).toBe('file:///Users/amy/ws/main.c')
  })
})
