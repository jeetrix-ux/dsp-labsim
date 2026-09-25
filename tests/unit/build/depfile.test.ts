import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isStale, parseDepFile } from '../../../src/main/build/depfile'

describe('parseDepFile', () => {
  it('resolves every dependency against the build directory', () => {
    // Absolute paths as cl6x writes them on this OS.
    const abs = process.platform === 'win32' ? 'C:/' : '/'
    const text = [
      'main.obj: ../../main.c',
      `main.obj: ${abs}ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include/stdio.h`,
      `main.obj: ${abs}ws/fir\\ lowpass/coeffs.h`,
      ''
    ].join('\r\n')
    expect(parseDepFile(text, join(`${abs}ws`, 'p', '.labsim', 'Debug'))).toEqual([
      join(`${abs}ws`, 'p', 'main.c'),
      join(`${abs}ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include/stdio.h`),
      join(`${abs}ws/fir lowpass/coeffs.h`)
    ])
  })
})

describe('isStale', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'labsim-dep-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const at = (name: string, secs: number): string => {
    const p = join(dir, name)
    writeFileSync(p, name)
    utimesSync(p, secs, secs)
    return p
  }
  it('is stale when the target is missing', async () => {
    expect(await isStale(join(dir, 'x.obj'), [at('x.c', 100)])).toBe(true)
  })
  it('is stale when a dependency is newer or missing', async () => {
    const obj = at('x.obj', 200)
    expect(await isStale(obj, [at('x.c', 100), at('x.h', 300)])).toBe(true)
    expect(await isStale(obj, [at('y.c', 100), join(dir, 'gone.h')])).toBe(true)
  })
  it('is fresh when every dependency is older', async () => {
    expect(await isStale(at('x.obj', 200), [at('x.c', 100), at('x.h', 150)])).toBe(false)
  })
})
