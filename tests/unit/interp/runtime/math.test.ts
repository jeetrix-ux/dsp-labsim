import { describe, expect, it } from 'vitest'
import { runC } from '../exec/harness'

const doubles = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.f64(r.g(name) + 8 * i))
const ints = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.i32(r.g(name) + 4 * i))

describe('math.h edge cases follow the TI RTS', () => {
  it('returns what the board returns for domain and range errors', () => {
    const r = runC(`
#include <math.h>
#include <errno.h>
double d[12];
int e[6];
int main(void)
{
    errno = 0; d[0] = sqrt(-1.0); e[0] = errno;
    errno = 0; d[1] = log(0.0); e[1] = errno;
    errno = 0; d[2] = log(-1.0); e[2] = errno;
    errno = 0; d[3] = pow(-8.0, 1.0 / 3.0); e[3] = errno;
    errno = 0; d[4] = pow(10.0, 400.0); e[4] = errno;
    d[5] = pow(0.0, -1.0);
    errno = 0; d[6] = asin(2.0); e[5] = errno;
    d[7] = fmod(5.0, 0.0);
    d[8] = atan2(0.0, 0.0);
    d[9] = cosh(-1000.0);
    d[10] = pow(-2.0, 3.0);
    d[11] = log10(1000.0);
    return 0;
}`)
    expect(doubles(r, 'd', 12)).toEqual([0, -Infinity, -Infinity, 1, 1.7976931348623157e308, -1.7976931348623157e308, Math.PI / 2, 0, 0, -Infinity, -8, 3])
    expect(ints(r, 'e', 6)).toEqual([0x21, 0x22, 0x21, 0x21, 0x22, 0x21])
  })

  it('computes float functions in single precision and the C99 extras accurately', () => {
    const r = runC(`
#include <math.h>
float f[2];
double d[12];
int i[4];
int main(void)
{
    int ex;
    double ip;
    f[0] = sinf(1.0f);
    f[1] = sqrtf(2.0f);
    d[0] = erf(1.0);
    d[1] = erfc(3.0);
    d[2] = tgamma(5.0);
    d[3] = lgamma(10.0);
    d[4] = round(-2.5);
    d[5] = rint(2.5);
    d[6] = frexp(8.0, &ex);
    i[0] = ex;
    d[7] = ldexp(0.5, 4);
    d[8] = modf(-3.75, &ip);
    d[9] = ip;
    d[10] = nextafter(1.0, 2.0);
    d[11] = hypot(3.0, 4.0);
    i[1] = fpclassify(0.0);
    i[2] = isnan(NAN) != 0;
    i[3] = (int)lround(-2.5);
    return 0;
}`)
    expect([r.m.mem.f32(r.g('f')), r.m.mem.f32(r.g('f') + 4)]).toEqual([Math.fround(Math.sin(1)), Math.fround(Math.SQRT2)])
    const d = doubles(r, 'd', 12)
    expect(d[0]).toBeCloseTo(0.8427007929497149, 14)
    expect(d[1] / 2.209049699858544e-5).toBeCloseTo(1, 12)
    expect(d[2]).toBeCloseTo(24, 12)
    expect(d[3]).toBeCloseTo(12.801827480081469, 12)
    expect(d.slice(4)).toEqual([-3, 2, 0.5, 8, -0.75, -3, 1 + 2 ** -52, 5])
    expect(ints(r, 'i', 4)).toEqual([4, 4, 1, -3])
  })
})

describe('time.h', () => {
  it('counts seconds from 1900 and formats like the C library', () => {
    const r = runC(`
#include <time.h>
#include <string.h>
int v[6];
char text[32], stamp[32];
int main(void)
{
    time_t t = 2208988800u;
    struct tm *tm = gmtime(&t);
    v[0] = tm->tm_year;
    v[1] = tm->tm_mon;
    v[2] = tm->tm_mday;
    v[3] = tm->tm_wday;
    strcpy(text, asctime(tm));
    v[4] = mktime(tm) == t;
    strftime(stamp, sizeof stamp, "%Y-%m-%d %H:%M:%S", tm);
    v[5] = time(0) > 3900000000u;
    return 0;
}`)
    expect(ints(r, 'v', 6)).toEqual([70, 0, 1, 4, 1, 1])
    expect(r.m.mem.cstring(r.g('text'))).toBe('Thu Jan  1 00:00:00 1970\n')
    expect(r.m.mem.cstring(r.g('stamp'))).toBe('1970-01-01 00:00:00')
  })
})
