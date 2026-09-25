import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CL6X, compareVersions, findToolchain, tiRoots } from '../../../src/main/build/toolchain'

let ti: string
function fakeCgt(dir: string): string {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', CL6X), '')
  return dir
}
beforeEach(() => { ti = mkdtempSync(join(tmpdir(), 'labsim-ti-')) })
afterEach(() => rmSync(ti, { recursive: true, force: true }))

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('8.3.12', '8.3.2')).toBeGreaterThan(0)
    expect(compareVersions('8.5.0.LTS', '8.3.12')).toBeGreaterThan(0)
    expect(compareVersions('7.4.24', '7.4.24')).toBe(0)
  })
})

describe('findToolchain', () => {
  it('finds the CGT inside a CCS install', async () => {
    const root = fakeCgt(join(ti, 'ccs1281', 'ccs', 'tools', 'compiler', 'ti-cgt-c6000_8.3.12'))
    fakeCgt(join(ti, 'ccs1281', 'ccs', 'tools', 'compiler', 'ti-cgt-arm_20.2.7.LTS'))
    const tc = await findToolchain(undefined, ti)
    expect(tc).toEqual({ root, version: '8.3.12', cl6x: join(root, 'bin', CL6X) })
  })
  it('searches every TI root for this OS', async () => {
    const root = fakeCgt(join(ti, 'ccs2000', 'ccs', 'tools', 'compiler', 'ti-cgt-c6000_8.3.13'))
    expect((await findToolchain(undefined, [join(ti, 'missing'), ti]))?.root).toBe(root)
    expect(CL6X).toBe(process.platform === 'win32' ? 'cl6x.exe' : 'cl6x')
    expect(tiRoots()).toEqual(process.platform === 'win32' ? ['C:\\ti'] : ['/Applications/ti', join(process.env.HOME ?? '', 'ti')])
  })
  it('prefers the newest of several installs, including standalone ones', async () => {
    fakeCgt(join(ti, 'ccs1281', 'ccs', 'tools', 'compiler', 'ti-cgt-c6000_8.3.12'))
    const newer = fakeCgt(join(ti, 'ti-cgt-c6000_8.5.0.LTS'))
    expect((await findToolchain(undefined, ti))?.root).toBe(newer)
  })
  it('uses a valid override and rejects an invalid one', async () => {
    const custom = fakeCgt(join(ti, 'somewhere', 'ti-cgt-c6000_7.4.24'))
    expect((await findToolchain(custom, ti))?.version).toBe('7.4.24')
    expect(await findToolchain(join(ti, 'nope'), ti)).toBeNull()
  })
  it('returns null when nothing is installed', async () => {
    expect(await findToolchain(undefined, join(ti, 'missing'))).toBeNull()
  })
})
