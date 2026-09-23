import { describe, expect, it } from 'vitest'
import { library } from '../../../../src/interp/frontend/program'
import { LIBRARY, UNSUPPORTED } from '../../../../src/interp/runtime/index'

describe('runtime library', () => {
  it('implements every function the built-in headers declare, or names it as unsupported', () => {
    const declared = [...library().functions]
    expect(declared.filter((f) => !(f in LIBRARY) && !UNSUPPORTED.has(f))).toEqual([])
    expect(Object.keys(LIBRARY).filter((f) => !library().functions.has(f))).toEqual([])
    expect([...UNSUPPORTED].every((f) => f.startsWith('_'))).toBe(true)
  })
})
