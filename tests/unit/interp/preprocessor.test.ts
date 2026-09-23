import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { Diags, FatalError } from '../../../src/interp/frontend/diag'
import { isBuiltinFile, preprocess, type PreprocessOptions } from '../../../src/interp/frontend/preprocessor'

const P = (f: string): string => path.resolve('/proj', f)
const NOW = new Date(2026, 8, 23, 12, 40, 11)

function pp(files: Record<string, string>, extra: Partial<PreprocessOptions> = {}) {
  const diags = new Diags(['225'])
  const full = Object.fromEntries(Object.entries(files).map(([k, v]) => [path.isAbsolute(k) ? k : P(k), v]))
  const r = preprocess(P('main.c'), { readFile: (f) => (f in full ? full[f] + '\n' : null), includePaths: [], defines: ['c6748'], dialect: 'c89', now: NOW, ...extra }, diags)
  const text = r.tokens.filter((t) => t.kind !== 'eof' && !isBuiltinFile(t.file)).map((t) => t.text).join(' ')
  const codes = diags.list.map((d) => `${d.line ?? 'end'}:${d.code}`)
  return { r, text, codes, diags }
}

describe('macro expansion', () => {
  it('expands object-like and function-like macros', () => {
    const { text, codes } = pp({ 'main.c': '#define N 8\n#define SQ(x) ((x)*(x))\nint a[N]; int b = SQ(N+1);' })
    expect(text).toBe('int a [ 8 ] ; int b = ( ( 8 + 1 ) * ( 8 + 1 ) ) ;')
    expect(codes).toEqual([])
  })
  it('stops recursion with hide sets (C standard example)', () => {
    expect(pp({ 'main.c': '#define f(a) a*g\n#define g(a) f(a)\nf(2)(9)' }).text).toBe('2 * 9 * g')
    expect(pp({ 'main.c': '#define x x+1\nx' }).text).toBe('x + 1')
  })
  it('stringizes and pastes, with empty arguments as placemarkers', () => {
    const src = '#define STR(x) #x\n#define CAT(a,b) a##b\nconst char *s = STR(a "b\\n"); int CAT(x,1) = 1; int CAT(,y) = 2;'
    expect(pp({ 'main.c': src }).text).toBe('const char * s = "a \\"b\\\\n\\"" ; int x1 = 1 ; int y = 2 ;')
  })
  it('supports variadic macros and arguments spanning lines', () => {
    const src = '#define P(fmt, ...) printf(fmt, __VA_ARGS__)\nP("%d %d",\n  1, 2);'
    expect(pp({ 'main.c': src }).text).toBe('printf ( "%d %d" , 1 , 2 ) ;')
  })
  it('gives expanded tokens the line of the invocation', () => {
    const { r } = pp({ 'main.c': '#define ZERO \\\n 0\nint x =\nZERO;' })
    const zero = r.tokens.find((t) => t.text === '0')
    expect(zero?.line).toBe(4)
  })
  it('reports argument-count problems and unterminated invocations', () => {
    expect(pp({ 'main.c': '#define F(a,b) a+b\nint x = F(1);' }).codes).toEqual(['2:55-D'])
    expect(pp({ 'main.c': '#define F(a) a\nint x = F(1,2);' }).codes).toEqual(['2:56-D'])
    expect(pp({ 'main.c': '#define F(a) a\nint x = F(1;' }).codes).toEqual(['2:276'])
  })
  it('warns about an incompatible redefinition but not an identical one', () => {
    expect(pp({ 'main.c': '#define X 1\n#define X 1\n#define X 2\nX' }).codes).toEqual(['3:48-D'])
  })
})

describe('conditional compilation', () => {
  it('evaluates #if, #elif, #else, defined and skips inactive groups entirely', () => {
    const src = '#define N 3\n#if defined(c6748) && N > 2\nA\n#elif 1\nB\n#else\nC\n#endif\n#ifdef NOPE\n#bogus\n#if 1/0\n#endif\n"unterminated\n#else\nD\n#endif\n#ifndef NOPE\nE\n#endif'
    const { text, codes } = pp({ 'main.c': src })
    expect(text).toBe('A D E')
    expect(codes).toEqual([])
  })
  it('uses 64-bit arithmetic and unsigned rules', () => {
    expect(pp({ 'main.c': '#if -1 > 0u\nU\n#endif\n#if (1 << 40) > 0\nW\n#endif\n#if \'A\' == 65\nC\n#endif' }).text).toBe('U W C')
  })
  it('reports cl6x errors for broken conditionals', () => {
    expect(pp({ 'main.c': '#if 1\nint x;' }).codes).toEqual(['1:38'])
    expect(pp({ 'main.c': '#endif\nint x;' }).codes).toEqual(['1:37'])
    expect(pp({ 'main.c': '#else\n#endif' }).codes).toEqual(['1:37', '2:37'])
    expect(pp({ 'main.c': '#if 1 +\n#endif' }).codes).toEqual(['1:29'])
    expect(pp({ 'main.c': '#if 1/0\n#endif' }).codes).toEqual(['1:40'])
  })
})

describe('directives', () => {
  it('includes project headers relative to the including file, then include paths, then built-ins', () => {
    const { text, r } = pp(
      {
        'main.c': '#include "coef.h"\n#include <shared.h>\n#include <stdbool.h>\nbool ok = true; int n = NTAPS + SHARED;',
        'coef.h': '#include "tmwtypes.h"\n#define NTAPS 51',
        'tmwtypes.h': 'typedef double real64_T;',
        [path.resolve('/inc/shared.h')]: '#pragma once\n#define SHARED 2'
      },
      { includePaths: [path.resolve('/inc')] }
    )
    expect(text).toBe('typedef double real64_T ; _Bool ok = 1 ; int n = 51 + 2 ;')
    expect(r.files).toEqual([P('main.c'), P('coef.h'), P('tmwtypes.h'), path.resolve('/inc/shared.h')])
  })
  it('honours #pragma once and include guards', () => {
    const files = { 'main.c': '#include "a.h"\n#include "a.h"\n#include "g.h"\n#include "g.h"', 'a.h': '#pragma once\nA', 'g.h': '#ifndef G\n#define G\nG1\n#endif' }
    expect(pp(files).text).toBe('A G1')
  })
  it('stops with fatal #1965 for a missing header, like cl6x', () => {
    const diags = new Diags()
    const opts = { readFile: (f: string) => (f === P('main.c') ? '#include <math.io>\nint main(void){return 0;}\n' : null), includePaths: [], defines: [], dialect: 'c89' as const }
    expect(() => preprocess(P('main.c'), opts, diags)).toThrow(FatalError)
    expect(diags.list).toEqual([{ file: P('main.c'), line: 1, severity: 'error', code: '1965', message: 'cannot open source file "math.io"', fatal: true }])
  })
  it('reports #error as fatal, #warning and unknown directives', () => {
    expect(() => pp({ 'main.c': '#error stop here\nint x;' })).toThrow(FatalError)
    expect(pp({ 'main.c': '#warning careful\n#foo\nint x;' }).codes).toEqual(['1:1181-D', '2:11-D'])
  })
  it('records pragmas, including _Pragma, and removes them from the token stream', () => {
    const { text, r } = pp({ 'main.c': '#pragma DATA_ALIGN(x, 8)\nint x;\n_Pragma("MUST_ITERATE(4)") int y;' })
    expect(text).toBe('int x ; int y ;')
    expect(r.pragmas.map((p) => [p.name, p.text, p.loc.line])).toEqual([['DATA_ALIGN', '(x, 8)', 1], ['MUST_ITERATE', '(4)', 3]])
  })
  it('applies #line', () => {
    const { r } = pp({ 'main.c': '#line 100 "orig.c"\nfoo' })
    expect(r.tokens.find((t) => t.text === 'foo')).toMatchObject({ line: 100, file: 'orig.c' })
  })
  it('reports lexical errors once, and only outside skipped groups', () => {
    expect(pp({ 'main.c': '#if 0\n"abc\n@\n#endif\nint @;\nchar *s = "x' }).codes).toEqual(['5:7', '6:8'])
  })
})

describe('predefined macros', () => {
  it('match cl6x -mv6740 in C89 and C99 mode', () => {
    const src = '__TI_COMPILER_VERSION__ __STDC_VERSION__ _TMS320C6740 __DATE__ __TIME__ __LINE__ c6748 __STDC__ __TI_EABI__'
    expect(pp({ 'main.c': src }).text).toBe('8003012 199409L 1 "Sep 23 2026" "12:40:11" 1 1 1 1')
    expect(pp({ 'main.c': '__STDC_VERSION__' }, { dialect: 'c99' }).text).toBe('199901L')
  })
  it('takes --define values', () => {
    expect(pp({ 'main.c': 'USE_Q15 EMPTY' }, { defines: ['USE_Q15=1', 'EMPTY='] }).text).toBe('1')
  })
})
