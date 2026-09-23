import { describe, expect, it } from 'vitest'
import { runC } from '../exec/harness'

/** [format, C arguments, what TI's RTS prints] */
const CASES: [string, string, string][] = [
  ['%d|%5d|%-5d|%05d|%+d|% d|%.3d', '42, 42, 42, -42, 5, 5, 7', '42|   42|42   |-0042|+5| 5|007'],
  ['%x|%X|%#x|%#X|%o|%#o', '255, 255, 255, 255, 8, 8', 'ff|FF|0xff|0XFF|10|010'],
  ['%u|%lld|%llu', '-1, -1LL << 40, 18446744073709551615ULL', '4294967295|-1099511627776|18446744073709551615'],
  ['%hd|%hu|%hhu|%ld', '70000, 70000, 300, 123456L', '70000|4464|44|123456'],
  ['%c%c|%5s|%-5s|%.2s|%%', "'A', 'b', \"ab\", \"ab\", \"abcd\"", 'Ab|   ab|ab   |ab|%'],
  ['%p|%#p|%08x', '(void *)0x80001234, (void *)0x80001234, 0xbeef', '80001234|0x80001234|0000beef'],
  ['%f|%.2f|%.0f|%.0f', '3.14159, 0.125, 2.5, 0.5', '3.141590|0.13|3|1'],
  ['%e|%E|%.2e', '12345.678, 0.000123, 0.0', '1.234568e+04|1.230000E-04|0.00e+00'],
  ['%g|%g|%g|%g|%.3g|%G', '0.0001, 123456789.0, 100000.0, 1000000.0, 3.14159, 1e-10', '0.0001|1.23457e+08|100000|1e+06|3.14|1E-10'],
  ['%10.3f|%-8.2f|%+.1f|%5.1f', '-1.5, 3.14159, 2.25, 9.96', '    -1.500|3.14    |+2.3| 10.0'],
  ['%f|%f|%f|%F|%f', '-0.0, INFINITY, -INFINITY, INFINITY, NAN', '-0.000000|+inf|-inf|+INF|nan'],
  ['%5c|%-3c|', "'x', 'y'", '    x|y  |'],
  ['%*d|%-*d|%.*f', '4, 7, 4, 7, 2, 1.5', '   7|7   |1.50'],
  ['%a|%A', '1.0, -0.5', '0x1p+0|-0X1P-1']
]

describe('formatTI (sprintf)', () => {
  it('formats every conversion the way the C6000 RTS does', () => {
    const lines = CASES.map(([f, args], i) => `    sprintf(out[${i}], "${f}", ${args});`)
    const r = runC(`#include <stdio.h>\n#include <math.h>\nchar out[${CASES.length}][64];\nint main(void)\n{\n${lines.join('\n')}\n    return 0;\n}`)
    expect(r.result).toMatchObject({ status: 'exited', code: 0 })
    const got = CASES.map((_, i) => r.m.mem.cstring(r.g('out') + 64 * i))
    expect(got).toEqual(CASES.map((c) => c[2]))
  })

  it('returns the count, stores %n, and handles NULL strings and snprintf truncation', () => {
    const r = runC(`
#include <stdio.h>
char a[16], b[16], c[16];
int v[5];
int main(void)
{
    v[0] = sprintf(a, "x=%d%n!", 123, &v[1]);
    v[2] = sprintf(b, "a%sb", (char *)0);
    v[3] = snprintf(c, 5, "%d", 123456);
    v[4] = snprintf(0, 0, "%s", "hello");
    return 0;
}`)
    expect([0, 1, 2, 3, 4].map((i) => r.m.mem.i32(r.g('v') + 4 * i))).toEqual([6, 5, 2, 6, 5])
    expect(r.m.mem.cstring(r.g('a'))).toBe('x=123!')
    expect([...r.m.mem.read(r.g('b'), 4)]).toEqual([97, 0, 98, 0])
    expect(r.m.mem.cstring(r.g('c'))).toBe('1234')
  })

  it('reads a va_list with vsprintf', () => {
    const r = runC(`
#include <stdio.h>
#include <stdarg.h>
char out[32];
void fmt(const char *f, ...) { va_list ap; va_start(ap, f); vsprintf(out, f, ap); va_end(ap); }
int main(void) { fmt("%d-%.1f-%s", 7, 2.5, "ok"); return 0; }`)
    expect(r.m.mem.cstring(r.g('out'))).toBe('7-2.5-ok')
  })
})
