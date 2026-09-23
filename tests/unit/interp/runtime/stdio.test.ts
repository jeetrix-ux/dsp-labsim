import { describe, expect, it } from 'vitest'
import type { HostFiles } from '../../../../src/interp/exec/machine'
import { loadProgram, runProgram } from '../../../../src/interp/run'
import { build, NO_IO, runC } from '../exec/harness'

function memoryFiles(initial: Record<string, string> = {}): HostFiles & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  const text = (d: Uint8Array): string => String.fromCharCode(...d)
  return {
    files,
    readAll: (p) => (files.has(p) ? Uint8Array.from([...files.get(p)!].map((c) => c.charCodeAt(0))) : null),
    writeAll: (p, d) => {
      files.set(p, text(d))
      return true
    },
    remove: (p) => files.delete(p),
    rename: (a, b) => {
      if (!files.has(a)) return false
      files.set(b, files.get(a)!)
      files.delete(a)
      return true
    }
  }
}

describe('console output', () => {
  it('prints through a line-buffered stdout and flushes at exit', () => {
    const r = runC('#include <stdio.h>\nint n;\nint main(void) { n = printf("x=%d y=%.2f\\n", 42, 1.5); printf("tail"); return 0; }')
    expect(r.stdout).toBe('x=42 y=1.50\ntail')
    expect(r.m.mem.i32(r.g('n'))).toBe(12)
  })

  it('loses unflushed output on abort(), as on the board', () => {
    const r = runC('#include <stdio.h>\n#include <stdlib.h>\nint main(void) { printf("line\\n"); printf("lost"); abort(); return 0; }')
    expect(r.stdout).toBe('line\n')
  })

  it("takes stdout's 257-byte buffer from the heap on first use", () => {
    const r = runC('#include <stdio.h>\n#include <stdlib.h>\nunsigned p;\nint main(void) { printf("hi\\n"); p = (unsigned)malloc(4); return 0; }')
    expect(r.m.mem.u32(r.g('p'))).toBe(r.image.heap.start + 8 + 264 + 8)
  })

  it('prints nothing when the heap cannot hold the stdout buffer', () => {
    const r = runC('#include <stdio.h>\nint a, b;\nint main(void) { a = printf("hello\\n"); b = printf("%d\\n", 5); return 0; }', { heap: 0x100 })
    expect(r.stdout).toBe('')
    expect([r.m.mem.i32(r.g('a')), r.m.mem.i32(r.g('b'))]).toEqual([6, -1])
  })

  it('writes puts, putchar, stderr and perror', () => {
    const r = runC(`
#include <stdio.h>
#include <errno.h>
int n;
int main(void)
{
    n = puts("one");
    putchar('2');
    putchar('\\n');
    fputs("warn\\n", stderr);
    fprintf(stderr, "%s!\\n", "err");
    errno = EDOM;
    perror("sqrt");
    return 0;
}`)
    expect(r.stdout).toBe('one\n2\n')
    expect(r.stderr).toBe('warn\nerr!\nsqrt: Domain error\n')
    expect(r.m.mem.i32(r.g('n'))).toBe(4)
  })
})

describe('console input', () => {
  it('reads with scanf and getchar from console lines and returns EOF at the end', () => {
    const r = runC(`
#include <stdio.h>
int a, k, eof;
float f;
char s[16], c;
int main(void)
{
    k = scanf("%d %f %s", &a, &f, s);
    scanf(" %c", &c);
    eof = scanf("%d", &a);
    return 0;
}`, { input: ['12 3.5 word', 'X'] })
    expect([r.m.mem.i32(r.g('k')), r.m.mem.i32(r.g('a')), r.m.mem.i32(r.g('eof'))]).toEqual([3, 12, -1])
    expect(r.m.mem.f32(r.g('f'))).toBe(3.5)
    expect(r.m.mem.cstring(r.g('s'))).toBe('word')
    expect(r.m.mem.u8(r.g('c'))).toBe(88)
  })

  it('flushes a pending prompt before waiting for input', () => {
    const { program, image } = build('#include <stdio.h>\nint n;\nint main(void) { printf("Enter n: "); scanf("%d", &n); printf("n=%d\\n", n); return 0; }')
    const events: string[] = []
    const m = loadProgram(program, image, {
      ...NO_IO,
      write: (t) => events.push(t),
      readLine: () => {
        events.push('<read>')
        return '7'
      }
    })
    expect(runProgram(m)).toMatchObject({ status: 'exited', code: 0 })
    expect(events).toEqual(['Enter n: ', '<read>', 'n=7\n'])
  })

  it('parses with sscanf: %i, scan sets, widths, suppression and %n', () => {
    const r = runC(`
#include <stdio.h>
int v[5];
char s1[8], s2[8];
int main(void)
{
    v[0] = sscanf("0x1f -7 abc,defgh", "%i %d %[a-z],%3s", &v[1], &v[2], s1, s2);
    v[3] = sscanf("5 6", "%*d %d%n", &v[4], &v[1]);
    return 0;
}`)
    expect([0, 1, 2, 3, 4].map((i) => r.m.mem.i32(r.g('v') + 4 * i))).toEqual([4, 3, -7, 1, 6])
    expect([r.m.mem.cstring(r.g('s1')), r.m.mem.cstring(r.g('s2'))]).toEqual(['abc', 'def'])
  })
})

describe('host files (CIO)', () => {
  it('writes, reads back and reports missing files', () => {
    const host = memoryFiles({ 'in.txt': '3 4\n' })
    const r = runC(`
#include <stdio.h>
char line[32];
int v[4];
float back[2];
int main(void)
{
    float w[2] = { 1.5f, -2.0f };
    FILE *fp = fopen("out.txt", "w");
    fprintf(fp, "v=%d\\n", 5);
    fclose(fp);
    fp = fopen("out.txt", "r");
    fgets(line, sizeof line, fp);
    v[0] = fgetc(fp);
    v[1] = feof(fp) != 0;
    fclose(fp);
    v[2] = fopen("nope.txt", "r") == 0;
    fp = fopen("in.txt", "r");
    fscanf(fp, "%d", &v[3]);
    fclose(fp);
    fp = fopen("data.bin", "wb");
    fwrite(w, sizeof(float), 2, fp);
    fclose(fp);
    fp = fopen("data.bin", "rb");
    fread(back, sizeof(float), 2, fp);
    fseek(fp, 0, SEEK_END);
    v[0] = v[0] * 100 + (int)ftell(fp);
    fclose(fp);
    return 0;
}`, { files: host })
    expect(host.files.get('out.txt')).toBe('v=5\n')
    expect(r.m.mem.cstring(r.g('line'))).toBe('v=5\n')
    expect([0, 1, 2, 3].map((i) => r.m.mem.i32(r.g('v') + 4 * i))).toEqual([-100 + 8, 1, 1, 3])
    expect([r.m.mem.f32(r.g('back')), r.m.mem.f32(r.g('back') + 4)]).toEqual([1.5, -2])
  })

  it('returns NULL from fopen when the program has no project folder', () => {
    const r = runC('#include <stdio.h>\nint ok;\nint main(void) { ok = fopen("x.txt", "w") == 0; return 0; }')
    expect(r.m.mem.i32(r.g('ok'))).toBe(1)
  })
})
