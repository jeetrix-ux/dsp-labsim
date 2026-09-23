import { describe, expect, it } from 'vitest'
import { Diags, FatalError, M } from '../../../src/interp/frontend/diag'

const at = { file: 'C:/p/main.c', line: 3, col: 5 }

describe('Diags', () => {
  it('records errors and warnings in cl6x form', () => {
    const d = new Diags()
    d.error(at, M.undefinedIdent('b'))
    d.warning(at, M.unreferenced('a'))
    expect(d.list).toEqual([
      { file: 'C:/p/main.c', line: 3, severity: 'error', code: '20', message: 'identifier "b" is undefined' },
      { file: 'C:/p/main.c', line: 3, severity: 'warning', code: '179-D', message: 'variable "a" was declared but never referenced' }
    ])
    expect(d.errors).toBe(1)
  })
  it('shows remark #225 only when --diag_warning=225 promotes it', () => {
    const quiet = new Diags()
    quiet.warning(at, M.implicitFunction('foo'))
    expect(quiet.list).toEqual([])
    const loud = new Diags(['225'])
    loud.warning(at, M.implicitFunction('foo'))
    expect(loud.list[0]).toMatchObject({ severity: 'warning', code: '225-D', message: 'function "foo" declared implicitly' })
  })
  it('throws after a fatal error and marks it', () => {
    const d = new Diags()
    expect(() => d.fatal(at, M.cannotOpen('math.io'))).toThrow(FatalError)
    expect(d.list[0]).toMatchObject({ severity: 'error', code: '1965', message: 'cannot open source file "math.io"', fatal: true })
  })
  it('reports end-of-source problems without a line', () => {
    const d = new Diags()
    d.error({ file: 'C:/p/main.c', line: 0, col: 0 }, M.expected('}'))
    expect(d.list[0]).toMatchObject({ line: null, code: '68', message: 'expected a "}"' })
  })
})
