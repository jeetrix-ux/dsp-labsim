import { describe, expect, it } from 'vitest'
import { runC } from '../exec/harness'

const ints = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.i32(r.g(name) + 4 * i))

describe('stdlib', () => {
  it("reproduces TI's rand() sequence", () => {
    const r = runC(`
#include <stdlib.h>
int v[7];
int main(void)
{
    int i;
    for (i = 0; i < 5; i++) v[i] = rand();
    srand(1);
    v[5] = rand();
    v[6] = RAND_MAX;
    return 0;
}`)
    expect(ints(r, 'v', 7)).toEqual([16838, 5758, 10113, 17515, 31051, 16838, 32767])
  })

  it("allocates with TI's heap algorithm inside .sysmem", () => {
    const r = runC(`
#include <stdlib.h>
#include <string.h>
unsigned a[8];
int main(void)
{
    char *p = malloc(100), *q = malloc(10), *s;
    a[0] = (unsigned)p;
    a[1] = (unsigned)q;
    free(p);
    a[2] = (unsigned)malloc(40);
    a[3] = (unsigned)malloc(5000);
    s = calloc(4, 4);
    a[4] = s[15];
    q = realloc(q, 24);
    a[5] = (unsigned)q;
    strcpy(q, "kept");
    q = realloc(q, 400);
    a[6] = strcmp(q, "kept");
    a[7] = (unsigned)memalign(64, 8) % 64;
    return 0;
}`)
    const start = r.image.heap.start
    const a = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => r.m.mem.u32(r.g('a') + 4 * i))
    expect(a[0]).toBe(start + 8)
    expect(a[1]).toBe(start + 8 + 104 + 8)
    expect(a[2]).toBe(start + 8)
    expect(a[3]).toBe(0)
    expect(a[4]).toBe(0)
    expect(a[5]).toBe(a[1])
    expect(a[6]).toBe(0)
    expect(a[7]).toBe(0)
  })

  it('converts strings to numbers like the C library', () => {
    const r = runC(`
#include <stdlib.h>
long v[8];
double d[3];
int main(void)
{
    char *end;
    v[0] = atoi("  -42xyz");
    v[1] = strtol("0x1F", &end, 0);
    v[2] = *end;
    v[3] = strtol("777", 0, 8);
    v[4] = strtol("99999999999", &end, 10);
    v[5] = (long)strtoul("-1", 0, 10);
    v[6] = atol("12abc");
    v[7] = strtol("zz", &end, 36);
    d[0] = atof(" 3.25e2");
    d[1] = strtod("1e400", &end);
    d[2] = strtod("abc", &end);
    return 0;
}`)
    expect(ints(r, 'v', 8)).toEqual([-42, 31, 0, 511, 2147483647, -1, 12, 1295])
    expect([0, 1, 2].map((i) => r.m.mem.f64(r.g('d') + 8 * i))).toEqual([325, Infinity, 0])
  })

  it('sorts and searches with the program comparator, and returns div_t by value', () => {
    const r = runC(`
#include <stdlib.h>
int v[6] = { 5, 3, 9, 1, 7, 3 };
int found[3];
int cmp(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
int main(void)
{
    int key = 7, missing = 4;
    div_t q = div(-7, 2);
    qsort(v, 6, sizeof(int), cmp);
    found[0] = (int *)bsearch(&key, v, 6, sizeof(int), cmp) - v;
    found[1] = bsearch(&missing, v, 6, sizeof(int), cmp) == 0;
    found[2] = q.quot * 10 + q.rem;
    return abs(-3) + (int)labs(-4);
}`)
    expect(ints(r, 'v', 6)).toEqual([1, 3, 3, 5, 7, 9])
    expect(ints(r, 'found', 3)).toEqual([4, 1, -31])
    expect(r.result).toMatchObject({ status: 'exited', code: 7 })
  })

  it('runs atexit functions in reverse order on exit, but not on abort', () => {
    const src = (end: string): string => `
#include <stdlib.h>
int order[2], n;
void first(void) { order[n++] = 1; }
void second(void) { order[n++] = 2; }
int main(void) { atexit(first); atexit(second); ${end}; return 9; }`
    const e = runC(src('exit(5)'))
    expect(e.result).toMatchObject({ status: 'exited', code: 5 })
    expect(ints(e, 'order', 2)).toEqual([2, 1])
    const a = runC(src('abort()'))
    expect(a.result).toMatchObject({ status: 'exited', code: null })
    expect(ints(a, 'order', 2)).toEqual([0, 0])
  })

  it('prints a failed assert on stderr and aborts', () => {
    const r = runC('#include <assert.h>\nint main(void)\n{\n    int x = 1;\n    assert(x == 2);\n    return 0;\n}')
    expect(r.stderr).toMatch(/^Assertion failed, \(x == 2\), file .*main\.c, line 5\n$/)
    expect(r.result).toMatchObject({ status: 'exited', code: null })
  })
})

describe('string.h and ctype.h', () => {
  it('matches TI return values', () => {
    const r = runC(`
#include <string.h>
#include <ctype.h>
int v[20];
char buf[32];
int main(void)
{
    char text[] = "a,b,,c";
    char *t;
    int n = 0;
    v[0] = strcmp("abc", "abd");
    v[1] = strcmp("b", "a");
    v[2] = strncmp("abcx", "abcy", 3);
    v[3] = memcmp("ab", "aZ", 2);
    v[4] = strlen("hello");
    strcpy(buf, "DSP");
    strcat(buf, "-lab");
    v[5] = strlen(buf);
    v[6] = strchr(buf, '-') - buf;
    v[7] = strstr(buf, "lab") - buf;
    for (t = strtok(text, ","); t; t = strtok(0, ",")) n++;
    v[8] = n;
    v[9] = isalpha('a');
    v[10] = isupper('A');
    v[11] = isdigit('5');
    v[12] = isspace(' ');
    v[13] = isprint(' ');
    v[14] = toupper('q');
    v[15] = ispunct('!');
    v[16] = isxdigit('F');
    v[17] = strcspn("hello", "lo");
    v[18] = strncmp(buf, "DSQ", 3);
    v[19] = strrchr("a/b/c", '/')[1] == 'c';
    return 0;
}`)
    expect(ints(r, 'v', 20)).toEqual([-1, 1, 0, 8, 5, 7, 3, 4, 3, 2, 1, 4, 8, 0x80, 81, 0x10, 0x40, 2, -1, 1])
    expect(r.m.mem.cstring(r.g('buf'))).toBe('DSP-lab')
  })

  it("returns TI's strerror texts", () => {
    const r = runC('#include <string.h>\n#include <errno.h>\nchar *s[3];\nint main(void) { s[0] = strerror(0); s[1] = strerror(EDOM); s[2] = strerror(99); return 0; }')
    expect([0, 1, 2].map((i) => r.m.mem.cstring(r.m.mem.u32(r.g('s') + 4 * i)))).toEqual(['No error', 'Domain error', 'Unknown error'])
  })
})
