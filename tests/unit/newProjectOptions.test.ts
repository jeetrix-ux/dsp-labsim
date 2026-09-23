import { describe, expect, it } from 'vitest'
import { NEW_PROJECT_DEFAULTS, validateNewProject } from '@shared/newProject'

const ok = { name: 'lab1', ...NEW_PROJECT_DEFAULTS }

describe('validateNewProject', () => {
  it('accepts CCS-style names and the defaults', () => {
    expect(NEW_PROJECT_DEFAULTS).toEqual({ heapSize: '0x800', stackSize: '0x800', optLevel: 'off', defines: ['c6748'] })
    expect(validateNewProject(ok)).toBeNull()
    expect(validateNewProject({ ...ok, name: 'fir_filter-2.v1' })).toBeNull()
    expect(validateNewProject({ ...ok, heapSize: '4096', defines: ['c6748', 'USE_Q15=1'] })).toBeNull()
  })

  it('explains what is wrong', () => {
    expect(validateNewProject({ ...ok, name: '' })).toBe('Enter a project name.')
    expect(validateNewProject({ ...ok, name: 'my lab' })).toBe(
      'A project name starts with a letter or _ and uses only letters, digits, _, - and . (at most 64 characters).'
    )
    expect(validateNewProject({ ...ok, heapSize: '2k' })).toBe('Heap size must be a number such as 0x800.')
    expect(validateNewProject({ ...ok, stackSize: '' })).toBe('Stack size must be a number such as 0x800.')
    expect(validateNewProject({ ...ok, optLevel: '4' as never })).toBe('Optimization level must be off, 0, 1, 2 or 3.')
    expect(validateNewProject({ ...ok, defines: ['c6748', '2bad'] })).toBe("'2bad' is not a valid predefined symbol.")
  })
})
