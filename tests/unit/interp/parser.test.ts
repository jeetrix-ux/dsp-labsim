import { describe, expect, it } from 'vitest'
import * as path from 'path'
import type { Expr, FunctionDef, Stmt, VarSym } from '../../../src/interp/frontend/ast'
import { evalIntConst } from '../../../src/interp/frontend/consteval'
import { Diags } from '../../../src/interp/frontend/diag'
import { parseUnit } from '../../../src/interp/frontend/parser'
import { preprocess } from '../../../src/interp/frontend/preprocessor'
import { typeToString } from '../../../src/interp/frontend/types'

const FILE = path.resolve('/proj/main.c')

function parse(src: string, dialect: 'c89' | 'c99' = 'c89') {
  const diags = new Diags(['225'])
  const pp = preprocess(FILE, { readFile: (f) => (f === FILE ? src + '\n' : null), includePaths: [], defines: ['c6748'], dialect }, diags)
  const unit = parseUnit(pp.tokens, { file: FILE, dialect, pragmas: pp.pragmas }, diags)
  return {
    unit,
    codes: diags.list.map((d) => `${d.line ?? 'end'}:${d.code}`),
    messages: diags.list.map((d) => d.message),
    fn: (name: string): FunctionDef => unit.functions.find((f) => f.sym.name === name) as FunctionDef,
    global: (name: string): VarSym => unit.objects.find((o) => o.name === name) as VarSym
  }
}

/** The expression of each expression statement directly in the function body. */
const exprs = (fn: FunctionDef): Expr[] =>
  fn.body.body.filter((s): s is Extract<Stmt, { k: 'expr' }> => s.k === 'expr').map((s) => s.expr)
/** The right-hand side of an assignment, before its implicit conversion. */
const rhs = (e: Expr): Expr => (e.k === 'assign' ? (e.value.k === 'cast' && e.value.implicit ? e.value.arg : e.value) : e)
const initValues = (v: VarSym): (bigint | null)[] =>
  v.init?.k === 'list' ? v.init.items.map((i) => evalIntConst(i.expr)) : [v.init ? evalIntConst(v.init.expr) : null]

const LAB = `#include <stdio.h>
#include <math.h>
#define N 8
#define PI 3.14159265358979323846
float x[N];
float h[3] = { 0.25f, 0.5f, 0.25f };
static int calls;
float fir(const float *in, int n)
{
    int k;
    float acc = 0;
    for (k = 0; k < 3 && k <= n; k++)
        acc += h[k] * in[n - k];
    calls++;
    return acc;
}
int main(void)
{
    int i;
    float y[N];
    for (i = 0; i < N; i++) {
        x[i] = sin(2 * PI * i / N);
        y[i] = fir(x, i);
        printf("%d %f %f\\n", i, x[i], y[i]);
    }
    return 0;
}
`

describe('parseUnit', () => {
  it('parses a typical lab program with no diagnostics', () => {
    const { unit, codes, global } = parse(LAB)
    expect(codes).toEqual([])
    expect(unit.functions.map((f) => f.sym.name)).toEqual(['fir', 'main'])
    expect(global('h').init).toMatchObject({ k: 'list', items: [{ offset: 0 }, { offset: 4 }, { offset: 8 }] })
    expect(global('calls')).toMatchObject({ storage: 'static', external: false })
    expect(typeToString(global('x').type)).toBe('float [8]')
  })

  it('types expressions per the C6000 EABI', () => {
    const src = 'int main(void) {\n char c = 1; short s = 2; long l = 3; unsigned u = 4; float f = 5; double d = 6;\n d = c + s; l = l + u; f = f * 2; d = f + d; u = c << 2;\n return 0;\n}'
    const { fn, codes } = parse(src)
    expect(codes).toEqual([])
    expect(exprs(fn('main')).map((e) => typeToString(rhs(e).type))).toEqual(['int', 'unsigned long', 'float', 'double', 'int'])
  })

  it('reads nested declarators', () => {
    const src = 'int (*fp)(int);\nint *ap[3];\nint (*pa)[3];\nchar **argv2;\nconst char *const msg = "x";\nvoid (*signal2(int, void (*)(int)))(int);\nint (*table[2])(void);'
    const { unit, codes, global } = parse(src)
    expect(codes).toEqual([])
    expect(['fp', 'ap', 'pa', 'argv2', 'msg', 'table'].map((n) => typeToString(global(n).type))).toEqual([
      'int (*)(int)', 'int *[3]', 'int (*)[3]', 'char **', 'const char *const', 'int (*[2])(void)'
    ])
    expect(typeToString(unit.funcs.find((f) => f.name === 'signal2')!.type)).toBe('void (*(int, void (*)(int)))(int)')
  })

  it('handles structs, typedefs, enums and sizeof', () => {
    const src = [
      'typedef struct { float re, im; } complex_t;',
      'struct pt { char c; double d; short s; };',
      'typedef enum { RED, GREEN = 5, BLUE } color;',
      'complex_t z = { 1.0f, -2.0f };',
      'struct pt p;',
      'struct pt *q = &p;',
      'color c = BLUE;',
      'int sizes[3] = { sizeof(complex_t), sizeof(struct pt), sizeof(color) };',
      'int main(void) { q->s = 3; z.im = z.re; return p.c; }'
    ].join('\n')
    const { codes, global } = parse(src)
    expect(codes).toEqual([])
    expect(initValues(global('sizes'))).toEqual([8n, 24n, 4n])
    expect(initValues(global('c'))).toEqual([6n])
    expect(typeToString(global('z').type)).toBe('complex_t')
  })

  it('names function-local statics like cl6x and warns about unused ones', () => {
    const { unit, codes } = parse('static int counter;\nint main(void) { static float a[8]; static int b = 3; a[0] = b + counter; return 0; }')
    expect(unit.objects.map((o) => o.linkName)).toEqual(['counter', 'a$1', 'b$2'])
    expect(codes).toEqual(['2:552-D'])
  })

  it.each([
    ['int main(void){ int a = b; return 0; }', ['1:20']],
    ['int main(void){ int a = 1\n return a; }', ['2:66', '1:179-D']],
    ['int main(void){ for(int i=0;i<3;i++) {} return i; }', ['1:29', '1:20']],
    ['int main(void){ undefined_t x; return 0; }', ['1:20']],
    ['int main(void) return 0;', ['1:131']],
    ['int main(void){ return 0; ', ['end:68']],
    ['int f(int a int b){ return a; }', ['1:18']],
    ['struct S { int a } s;\nint main(void){ return s.a; }', ['1:66-D']],
    ['int 3x;', ['1:19', '1:41']],
    ['int main(void){ long long long x; return 0; }', ['1:85']],
    ['int main(void){ int x = 0; if (x) else x = 1; return 0; }', ['1:128']],
    ['int main(void){ switch (1) { case 1: case 1: break; } return 0; }', ['1:1851']],
    ['int main(void){ goto L; return 0; }', ['1:115']],
    ['int main(void){ break; return 0; }', ['1:117']],
    ['double f(double);\nint f(int x){return x;}', ['2:148']],
    ['int x = 1;\nint x = 2;', ['2:150']],
    ['int n = 3;\nint a = n;', ['2:28']],
    ['enum E { A, B, A };', ['1:102']],
    ['int main(void){ int x = 08; return x; }', ['1:24']],
    ['int main(void){ struct T t; return 0; }', ['1:71']]
  ])('reports cl6x diagnostics: %s', (src, expected) => {
    expect(parse(src).codes).toEqual(expected)
  })

  it('prints incompatible declarations the way cl6x does', () => {
    expect(parse('double f(double);\nint f(int x){return x;}').messages).toEqual(['declaration is incompatible with "double f(double)" (declared at line 1)'])
  })

  it('accepts C99 for-loop declarations in C99 mode and scopes them to the loop', () => {
    const ok = parse('int main(void){ int s = 0; for (int i = 0; i < 3; i++) s += i; return s; }', 'c99')
    expect(ok.codes).toEqual([])
    expect(ok.fn('main').body.body[1]).toMatchObject({ k: 'for', init: { k: 'decl' } })
    expect(parse('int main(void){ for (int i = 0; i < 3; i++) {} return i; }', 'c99').codes).toEqual(['1:20'])
  })

  it('declares unknown functions implicitly (#225-D) but knows the C6000 intrinsics', () => {
    const { unit, codes } = parse('int main(void){ return foo() + _dotp2(1, 2); }')
    expect(codes).toEqual(['1:225-D'])
    expect(unit.funcs.find((f) => f.name === 'foo')).toMatchObject({ implicit: true, used: true })
    expect(unit.funcs.find((f) => f.name === '_dotp2')).toMatchObject({ library: true, used: true })
  })

  it('supports variable-length arrays', () => {
    const { fn, codes } = parse('int main(void){ int n = 4; int v[n]; v[0] = 1; return v[0] + (int)sizeof v; }')
    expect(codes).toEqual([])
    const decl = fn('main').body.body[1]
    expect(decl.k === 'decl' && decl.vars.map((v) => v.name)).toEqual(['v$len', 'v'])
  })

  it('warns about unused and set-but-unused locals like cl6x', () => {
    const src = 'int main(void)\n{\n    int a;\n    int b;\n    int c = 1;\n    int d[2];\n    int *p = &c;\n    b = 1;\n    d[0] = 1;\n    c += 1;\n    return 0;\n}'
    expect(parse(src).codes).toEqual(['3:179-D', '4:552-D', '6:552-D', '7:179-D'])
  })

  it('recovers after a syntax error and keeps parsing later functions', () => {
    expect(parse('int f(void){ return (1 + 2; }\nint g(void){ return h; }').codes).toEqual(['1:18', '2:20'])
  })

  it('reads C6000 control registers and memory intrinsics', () => {
    const { codes, global } = parse('#include <c6x.h>\nint main(void){ unsigned t = TSCL; int a[2]; CSR = CSR | 1; _amem4(&a[0]) = 5; return _dotp2(t, 1) + _extu(CSR, 22, 31) + a[0]; }')
    expect(codes).toEqual([])
    expect(global('TSCL')).toMatchObject({ cregister: true, storage: 'extern' })
  })

  it('supports compound literals, designated initialisers and stdarg', () => {
    const src = '#include <stdarg.h>\nstruct P { int x, y; };\nint sum(int n, ...) { va_list ap; int s = 0; va_start(ap, n); while (n--) s += va_arg(ap, int); va_end(ap); return s; }\nint main(void) { struct P p = (struct P){ .y = 2 }; return p.y + sum(2, 1, 2); }'
    expect(parse(src).codes).toEqual([])
  })

  it('passes pragmas through', () => {
    expect(parse('#pragma DATA_ALIGN(x, 8)\nfloat x[4];').unit.pragmas.map((p) => p.name)).toEqual(['DATA_ALIGN'])
  })
})
