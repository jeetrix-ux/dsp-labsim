import { describe, expect, it } from 'vitest'
import { ChosenFiles } from '../../src/main/chosenFiles'

describe('ChosenFiles', () => {
  it.runIf(process.platform === 'win32')('allows only paths the save dialog returned (Windows: any case)', () => {
    const c = new ChosenFiles()
    c.add('C:\\data\\y.csv')
    expect(c.assert('c:\\DATA\\y.csv')).toBe('c:\\DATA\\y.csv')
    expect(c.assert('C:/data/./y.csv')).toBe('C:/data/./y.csv')
    expect(() => c.assert('C:\\Windows\\win.ini')).toThrow('C:\\Windows\\win.ini was not chosen in a save dialog')
  })

  it.runIf(process.platform !== 'win32')('allows only paths the save dialog returned (macOS)', () => {
    const c = new ChosenFiles()
    c.add('/tmp/data/y.csv')
    expect(c.assert('/tmp/data/./y.csv')).toBe('/tmp/data/./y.csv')
    expect(() => c.assert('/etc/hosts')).toThrow('/etc/hosts was not chosen in a save dialog')
  })
})
