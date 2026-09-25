import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() } }))
const { menuTemplate } = await import('../../src/main/menu')

type Item = { label?: string; role?: string; accelerator?: string; submenu?: Item[] }
const send = () => () => {}
const labels = (t: Item[]) => t.map((m) => m.label)
const find = (t: Item[], label: string): Item | undefined => t.find((m) => m.label === label)
const flat = (t: Item[]): Item[] => t.flatMap((m) => [m, ...flat(m.submenu ?? [])])

describe('application menu', () => {
  it('matches CCS on Windows', () => {
    const t = menuTemplate('win32', send) as Item[]
    expect(labels(t)).toEqual(['File', 'Edit', 'View', 'Project', 'Run', 'Tools', 'Window'])
    expect(flat(find(t, 'File')!.submenu!).some((m) => m.role === 'quit')).toBe(true)
    expect(flat(find(t, 'Window')!.submenu!).some((m) => m.label === 'Preferences...')).toBe(true)
  })

  it('puts Settings and Quit in a DSP LabSim menu on macOS', () => {
    const t = menuTemplate('darwin', send) as Item[]
    expect(labels(t)).toEqual(['DSP LabSim', 'File', 'Edit', 'View', 'Project', 'Run', 'Tools', 'Window'])
    const app = find(t, 'DSP LabSim')!.submenu!
    expect(app.find((m) => m.label === 'Settings...')?.accelerator).toBe('Cmd+,')
    expect(app.some((m) => m.role === 'quit')).toBe(true)
    // Not twice: File has no Exit and Window no Preferences on macOS.
    expect(flat(find(t, 'File')!.submenu!).some((m) => m.role === 'quit')).toBe(false)
    expect(flat(find(t, 'Window')!.submenu!).some((m) => m.label === 'Preferences...')).toBe(false)
  })

  it('has undo, redo and select-all on macOS so Cmd shortcuts work in every text field', () => {
    const edit = find(menuTemplate('darwin', send) as Item[], 'Edit')!.submenu!
    expect(edit.map((m) => m.role).filter(Boolean)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  })
})
