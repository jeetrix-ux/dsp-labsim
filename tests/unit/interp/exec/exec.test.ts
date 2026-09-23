import { describe, expect, it } from 'vitest'
import { build, NO_IO, runC } from './harness'
import { loadProgram } from '../../../../src/interp/run'

const ints = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.i32(r.g(name) + 4 * i))

describe('expressions', () => {
  it('wraps integer arithmetic at the declared width', () => {
    const r = runC(`
int r[12];
unsigned u[3];
long long ll[4];
int main(void)
{
    int a = 2147483647, b = -7;
    unsigned x = 0;
    short s = 32767;
    char c = 127;
    r[0] = a + 1;
    r[1] = b / 2;
    r[2] = b % 3;
    r[3] = b >> 1;
    r[4] = (unsigned)b >> 28;
    s++;
    r[5] = s;
    c += 1;
    r[6] = c;
    r[7] = 5 > 3 && 2 < 1;
    r[8] = !0.5;
    r[9] = (int)-2.7;
    r[10] = 7 / 2 * 2;
    r[11] = sizeof(long);
    u[0] = x - 1;
    u[1] = 3000000000u + 3000000000u;
    u[2] = (unsigned)-1 / 3;
    ll[0] = 2147483647LL * 3;
    ll[1] = -1LL << 40;
    ll[2] = (long long)1e18 + 1;
    ll[3] = 07 + 0x10;
    return 0;
}`)
    expect(r.result).toMatchObject({ status: 'exited', code: 0 })
    expect(ints(r, 'r', 12)).toEqual([-2147483648, -3, -1, -4, 15, -32768, -128, 0, 0, -2, 6, 4])
    expect([0, 1, 2].map((i) => r.m.mem.u32(r.g('u') + 4 * i))).toEqual([4294967295, 1705032704, 1431655765])
    expect([0, 1, 2, 3].map((i) => r.m.mem.i64(r.g('ll') + 8 * i))).toEqual([6442450941n, -1099511627776n, 1000000000000000001n, 23n])
  })

  it('does float arithmetic in single precision and double in double', () => {
    const r = runC(`
float f[4];
double d[2];
int main(void)
{
    float a = 0.1f, b = 0.2f;
    f[0] = a + b;
    f[1] = 16777216.0f + 1.0f;
    f[2] = a * 3;
    f[3] = 1.0f / 3.0f;
    d[0] = a + b;
    d[1] = 0.1 + 0.2;
    return 0;
}`)
    const fr = Math.fround
    expect([0, 1, 2, 3].map((i) => r.m.mem.f32(r.g('f') + 4 * i))).toEqual([fr(fr(0.1) + fr(0.2)), 16777216, fr(fr(0.1) * 3), fr(1 / 3)])
    expect([r.m.mem.f64(r.g('d')), r.m.mem.f64(r.g('d') + 8)]).toEqual([fr(fr(0.1) + fr(0.2)), 0.1 + 0.2])
  })

  it('handles pointers, arrays, structs by value and struct returns', () => {
    const r = runC(`
struct pt { int x; double y; };
struct pt pts[3];
int out[9];
struct pt make(int x, double y) { struct pt p; p.x = x; p.y = y; return p; }
void fill(int *p, int n) { int i; for (i = 0; i < n; i++) *p++ = i * i; }
int sum(const int *a, int n) { int s = 0; while (n--) s += a[n]; return s; }
int main(void)
{
    int local[5];
    int *q;
    struct pt t;
    fill(local, 5);
    out[0] = sum(local, 5);
    q = &local[4];
    out[1] = q - local;
    out[2] = *(q - 1);
    pts[1] = make(7, 2.5);
    t = pts[1];
    out[3] = t.x;
    out[4] = (int)(t.y * 2);
    out[5] = sizeof(struct pt);
    {
        struct pt *pp = &pts[1];
        pp->x += 3;
        out[6] = pts[1].x;
    }
    out[7] = (int)((char *)&pts[2] - (char *)&pts[0]);
    out[8] = make(4, 1.0).x;
    return 0;
}`)
    expect(r.result.status).toBe('exited')
    expect(ints(r, 'out', 9)).toEqual([30, 4, 9, 7, 5, 16, 10, 32, 4])
  })

  it('passes variadic arguments in memory, as the EABI does', () => {
    const r = runC(`
#include <stdarg.h>
double total(int n, ...)
{
    va_list ap;
    double s = 0;
    int i;
    va_start(ap, n);
    for (i = 0; i < n; i++) s += va_arg(ap, double);
    va_end(ap);
    return s;
}
long long mix(int n, ...)
{
    va_list ap;
    long long v;
    int a;
    va_start(ap, n);
    a = va_arg(ap, int);
    v = va_arg(ap, long long);
    va_end(ap);
    return v + a;
}
double t;
long long m2;
int main(void) { t = total(3, 1.5, 2.0, 0.25f); m2 = mix(2, 5, 1LL << 40); return 0; }`)
    expect(r.m.mem.f64(r.g('t'))).toBe(3.75)
    expect(r.m.mem.i64(r.g('m2'))).toBe((1n << 40n) + 5n)
  })

  it('calls through function pointers and returns main as the exit code', () => {
    const r = runC(`
int twice(int x) { return 2 * x; }
int apply(int (*f)(int), int v) { return f(v); }
int main(void) { int (*g)(int) = twice; return apply(g, 21) + (g == twice); }`)
    expect(r.result).toMatchObject({ status: 'exited', code: 43 })
  })

  it('reads and writes with _mem4 at any byte, while *(unsigned *) keeps LDW alignment', () => {
    const r = runC(`
#include <c6x.h>
unsigned char buf[8] = { 1, 2, 3, 4, 5, 6, 7, 8 };
unsigned r[2];
int main(void) { r[0] = _mem4(&buf[1]); r[1] = *(unsigned *)&buf[1]; _mem4(&buf[3]) = 0xAABBCCDD; return 0; }`)
    expect([r.m.mem.u32(r.g('r')), r.m.mem.u32(r.g('r') + 4)]).toEqual([0x05040302, 0x04030201])
    expect([...r.m.mem.read(r.g('buf'), 8)]).toEqual([1, 2, 3, 0xdd, 0xcc, 0xbb, 0xaa, 8])
  })
})

describe('statements', () => {
  it('runs loops, switch fall-through, goto and recursion', () => {
    const r = runC(`
int out[5];
int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int classify(int v)
{
    switch (v) {
    case 0: return 10;
    case 1:
    case 2: v += 100;
    case 3: return v;
    default: break;
    }
    return -1;
}
int main(void)
{
    int i, n = 0;
    for (i = 0; i < 10; i++) { if (i == 2) continue; if (i == 6) break; n += i; }
    out[0] = n;
    out[1] = fact(10);
    out[2] = classify(0) + classify(2) * 1000 + classify(9) * 100000;
    i = 0;
    do { i += 3; } while (i < 10);
    out[3] = i;
    n = 0;
again:
    n++;
    if (n < 5) goto again;
    out[4] = n;
    return 0;
}`)
    expect(ints(r, 'out', 5)).toEqual([13, 3628800, 2010, 12, 5])
  })

  it('supports VLAs, compound literals, static locals and implicit declarations', () => {
    const r = runC(`
int counter(void) { static int n = 0; return ++n; }
int out[4];
int main(void)
{
    int k = 4;
    int v[k];
    int i;
    for (i = 0; i < k; i++) v[i] = i * 10;
    out[0] = v[3] + (int)sizeof v;
    counter();
    counter();
    out[1] = counter();
    out[2] = ((int[]){ 5, 6, 7 })[2];
    out[3] = later(20);
    return 0;
}
int later(int x) { return x + 1; }`)
    expect(ints(r, 'out', 4)).toEqual([46, 3, 7, 21])
  })
})

describe('halts', () => {
  it('halts on division by zero at the line', () => {
    const r = runC('int main(void)\n{\n    int z = 0;\n    return 5 / z;\n}')
    expect(r.result).toMatchObject({ status: 'halted', message: 'Division by zero', loc: { line: 4 } })
  })
  it('halts on an illegal memory access', () => {
    const r = runC('int main(void) { int *p = (int *)0; return *p; }')
    expect(r.result).toMatchObject({ status: 'halted', message: 'Illegal memory access at 0x00000000' })
  })
  it('halts on a stack overflow with an explanation', () => {
    const r = runC('int f(int n) { int big[64]; big[0] = n; return f(n + 1) + big[0]; }\nint main(void) { return f(0); }')
    expect(r.result.status).toBe('halted')
    expect(r.result.status === 'halted' && r.result.message).toMatch(/^Stack overflow in f\(\): \.stack \(0x800 bytes\) is full/)
  })
  it('stops an endless loop at the step limit', () => {
    const r = runC('int main(void) { for (;;) {} return 0; }', { maxSteps: 1000 })
    expect(r.result).toMatchObject({ status: 'halted', steps: 1000 })
  })
  it('notes writes and reads outside a named array once, and carries on like the hardware', () => {
    const r = runC(`
float y[8];
float z;
int main(void)
{
    int i;
    for (i = 0; i <= 8; i++) y[i] = 1;
    z = y[-1] + y[8];
    return 0;
}`)
    expect(r.result.status).toBe('exited')
    expect(r.notes).toEqual(["write past end of 'y' (y[8], size 8)", "read before start of 'y' (y[-1], size 8)", "read past end of 'y' (y[8], size 8)"])
  })
  it('refuses to load a goto into a nested block', () => {
    const { program, image } = build('int main(void)\n{\n    goto inside;\n    {\n    inside:\n        return 1;\n    }\n}')
    expect(() => loadProgram(program, image, NO_IO)).toThrow('LabSim: unsupported construct goto into a nested block')
  })
})

describe('speed', () => {
  it('runs a simple loop at millions of statements per second', () => {
    const t0 = performance.now()
    const r = runC('int main(void) { int i, s = 0; for (i = 0; i < 3000000; i++) s += i & 7; return s & 0xff; }')
    const seconds = (performance.now() - t0) / 1000
    expect(r.result).toMatchObject({ status: 'exited', code: (3000000 / 8) * 28 & 0xff })
    console.log(`${(r.result.steps / seconds / 1e6).toFixed(1)} M statements/s`)
    expect(r.result.steps / seconds).toBeGreaterThan(5e6)
  })
})
