import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadSettings, resolveWorkspace, saveSettings } from '../../src/main/settings'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'labsim-home-')) })
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('settings', () => {
  it('returns {} for a missing or corrupt file', async () => {
    expect(await loadSettings(join(home, 'nope.json'))).toEqual({})
  })
  it('round-trips', async () => {
    const f = join(home, 'cfg', 'settings.json')
    await saveSettings(f, { workspace: 'C:\\ws' })
    expect(await loadSettings(f)).toEqual({ workspace: 'C:\\ws' })
  })
})

describe('resolveWorkspace', () => {
  it('prefers the override, then settings, then ~/workspace_v12', async () => {
    const a = join(home, 'a'); const b = join(home, 'b'); const v12 = join(home, 'workspace_v12')
    for (const d of [a, b, v12]) mkdirSync(d)
    expect(await resolveWorkspace({ workspace: b }, home, a)).toBe(a)
    expect(await resolveWorkspace({ workspace: b }, home)).toBe(b)
    expect(await resolveWorkspace({ workspace: join(home, 'missing') }, home)).toBe(v12)
  })
  it('creates ~/labsim_workspace when nothing else exists', async () => {
    const ws = await resolveWorkspace({}, home)
    expect(ws).toBe(join(home, 'labsim_workspace'))
    expect(existsSync(ws)).toBe(true)
  })
})
