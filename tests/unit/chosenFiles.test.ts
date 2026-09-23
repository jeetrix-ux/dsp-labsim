import { describe, expect, it } from 'vitest'
import { ChosenFiles } from '../../src/main/chosenFiles'

describe('ChosenFiles', () => {
  it('allows only paths the save dialog returned', () => {
    const c = new ChosenFiles()
    c.add('C:\\data\\y.csv')
    expect(c.assert('c:\\DATA\\y.csv')).toBe('c:\\DATA\\y.csv')
    expect(c.assert('C:/data/./y.csv')).toBe('C:/data/./y.csv')
    expect(() => c.assert('C:\\Windows\\win.ini')).toThrow('C:\\Windows\\win.ini was not chosen in a save dialog')
  })
})
