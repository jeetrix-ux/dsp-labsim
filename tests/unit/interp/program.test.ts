import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { compileUnit, library, linkProgram, type CompileOptions } from '../../../src/interp/frontend/program'
import { typeToString } from '../../../src/interp/frontend/types'

const P = (f: string): string => path.resolve('/proj', f)

function opts(files: Record<string, string>): CompileOptions {
  const full = Object.fromEntries(Object.entries(files).map(([k, v]) => [P(k), v]))
  return { readFile: (f) => (f in full ? full[f] + '\n' : null), includePaths: [P('.')], defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'] }
}

function build(files: Record<string, string>, sources: string[]) {
  const o = opts(files)
  const results = sources.map((s) => compileUnit(P(s), o))
  for (const r of results) expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return linkProgram(results.map((r) => r.unit!))
}

describe('compileUnit', () => {
  it('returns the unit, its diagnostics and the files it read', () => {
    const r = compileUnit(P('main.c'), opts({ 'main.c': '#include "coef.h"\nint main(void){ return N; }', 'coef.h': '#define N 3' }))
    expect(r.unit?.functions.map((f) => f.sym.name)).toEqual(['main'])
    expect(r.files).toEqual([P('main.c'), P('coef.h')])
    expect(r.diagnostics).toEqual([])
  })
  it('returns no unit after an error or a fatal error', () => {
    expect(compileUnit(P('main.c'), opts({ 'main.c': 'int main(void){ return x; }' })).unit).toBeNull()
    const fatal = compileUnit(P('main.c'), opts({ 'main.c': '#include <math.io>\nint main(void){ return 0; }' }))
    expect(fatal.unit).toBeNull()
    expect(fatal.diagnostics[0]).toMatchObject({ code: '1965', fatal: true })
  })
})

describe('linkProgram', () => {
  it('resolves globals and functions across translation units', () => {
    const files = {
      'main.c': '#include "fir.h"\nextern float coeffs[3];\nint main(void){ float y = fir(1.0f); return (int)(y + coeffs[0]); }',
      'fir.h': 'float fir(float x);',
      'fir.c': 'float coeffs[3] = { 1, 2, 3 };\nstatic float state;\nfloat fir(float x){ state = x * coeffs[1]; return state; }'
    }
    const link = build(files, ['main.c', 'fir.c'])
    expect(link.problems).toEqual([])
    expect(link.program?.globals.get('coeffs')?.file).toBe(P('fir.c'))
    expect([...(link.program?.functions.keys() ?? [])].sort()).toEqual(['fir', 'main'])
    expect(link.program?.main.sym.name).toBe('main')
  })
  it('accepts library functions, intrinsics and tentative definitions in several files', () => {
    const files = {
      'main.c': '#include <stdio.h>\n#include <math.h>\nint n;\nint main(void){ printf("%f\\n", sin(1.0)); return _dotp2(n, 1); }',
      'b.c': 'int n;'
    }
    expect(build(files, ['main.c', 'b.c']).problems).toEqual([])
  })
  it('reports unresolved symbols, a missing main and duplicate definitions', () => {
    expect(build({ 'main.c': 'int helper(int);\nint main(void){ return helper(1); }' }, ['main.c']).problems).toEqual([
      { kind: 'unresolved', name: 'helper', file: P('main.c') }
    ])
    expect(build({ 'lib.c': 'int twice(int x){ return 2 * x; }' }, ['lib.c']).problems).toEqual([
      { kind: 'unresolved', name: 'main', file: 'rts6740_elf.lib<args_main.c.obj>' }
    ])
    expect(build({ 'a.c': 'int x = 1;\nint main(void){ return x; }', 'b.c': 'int x = 2;' }, ['a.c', 'b.c']).problems).toEqual([
      { kind: 'redefined', name: 'x', first: P('a.c'), second: P('b.c') }
    ])
  })
})

describe('library', () => {
  it('lists what the LabSim runtime provides, from its built-in headers', () => {
    const lib = library()
    for (const f of ['printf', 'puts', 'sin', 'sinf', 'sqrt', 'atan2', 'malloc', 'free', 'rand', 'memcpy', 'strlen', 'clock', '_dotp2', '_extu', '_nassert']) {
      expect(lib.functions.has(f), f).toBe(true)
    }
    for (const o of ['_ftable', 'errno', 'CSR', 'TSCL', 'TSCH']) expect(lib.objects.has(o), o).toBe(true)
  })
  it('gives the real prototype of every library function', () => {
    const { prototypes } = library()
    expect(typeToString(prototypes.get('sqrt')!)).toBe('double (double)')
    expect(typeToString(prototypes.get('printf')!)).toBe('int (const char *, ...)')
    expect(typeToString(prototypes.get('_dotp2')!)).toBe('int (int, int)')
    expect(prototypes.size).toBe(library().functions.size)
  })
})
