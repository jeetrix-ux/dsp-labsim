import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertInside, listProjects, readTextFile, readTree, writeTextFile } from '../../src/main/workspace'

let ws: string
const touch = (p: string, s = ''): void => writeFileSync(join(ws, p), s)

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-unit-'))
  mkdirSync(join(ws, 'exp11'))
  touch('exp11/.project', '<x/>')
  touch('exp11/main.c', 'int main(void){return 0;}')
  mkdirSync(join(ws, 'exp11', 'Debug'))
  touch('exp11/Debug/exp11.map')
  mkdirSync(join(ws, 'exp11', '.settings'))
  mkdirSync(join(ws, 'fir lowpass'))
  touch('fir lowpass/main.c')
  mkdirSync(join(ws, 'Alpha'))
  touch('Alpha/util.h')
  mkdirSync(join(ws, 'docs'))
  touch('docs/readme.txt')
  mkdirSync(join(ws, 'RemoteSystemsTempFiles'))
  touch('RemoteSystemsTempFiles/x.c')
  mkdirSync(join(ws, '.metadata'))
  touch('.metadata/y.c')
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

describe('listProjects', () => {
  it('finds CCS projects and plain C folders, sorted case-insensitively', async () => {
    const ps = await listProjects(ws)
    expect(ps.map((p) => p.name)).toEqual(['Alpha', 'exp11', 'fir lowpass'])
    expect(ps.find((p) => p.name === 'exp11')).toEqual({ name: 'exp11', dir: join(ws, 'exp11'), isCcsProject: true })
    expect(ps.find((p) => p.name === 'Alpha')?.isCcsProject).toBe(false)
  })
})

describe('readTree', () => {
  it('hides dot entries and lists folders before files', async () => {
    const tree = await readTree(join(ws, 'exp11'))
    expect(tree.map((n) => n.name)).toEqual(['Debug', 'main.c'])
    expect(tree[0].kind).toBe('dir')
    expect(tree[0].children?.map((n) => n.name)).toEqual(['exp11.map'])
    expect(tree[1]).toEqual({ name: 'main.c', path: join(ws, 'exp11', 'main.c'), kind: 'file' })
  })
})

describe('assertInside', () => {
  it('accepts paths inside the workspace', () => {
    expect(assertInside(ws, join(ws, 'exp11', 'main.c'))).toBe(join(ws, 'exp11', 'main.c'))
  })
  it('rejects escapes and foreign absolute paths', () => {
    expect(() => assertInside(ws, join(ws, '..', 'evil.c'))).toThrow('Path outside workspace')
    const foreign = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts'
    expect(() => assertInside(ws, foreign)).toThrow('Path outside workspace')
    expect(() => assertInside(ws, join(ws + '-other', 'a.c'))).toThrow('Path outside workspace')
  })
})

describe('text files', () => {
  it('round-trips content and preserves CRLF', async () => {
    const p = join(ws, 'exp11', 'main.c')
    await writeTextFile(ws, p, 'a\r\nb\r\n')
    expect(readFileSync(p, 'utf8')).toBe('a\r\nb\r\n')
    expect(await readTextFile(ws, p)).toBe('a\r\nb\r\n')
  })
  it('refuses to write outside the workspace', async () => {
    await expect(writeTextFile(ws, join(ws, '..', 'x.c'), 'x')).rejects.toThrow('Path outside workspace')
  })
})
