import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { prepare } from '../../../src/cli/prepare'
import { captureIO, loadProgram, runProgram } from '../../../src/interp/run'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'labsim-cli-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function run(target: string, rewrite?: (f: string, t: string) => string): Promise<string> {
  const p = await prepare(target, { rewrite })
  if (!p.ok) throw new Error(p.messages.join('\n'))
  const cap = captureIO()
  runProgram(loadProgram(p.program, p.image, cap.io))
  return cap.stdout()
}

describe('prepare', () => {
  it('builds a single .c file with the default C6748 memory map', async () => {
    writeFileSync(join(dir, 'solo.c'), '#include <stdio.h>\nfloat y[4];\nint main(void) { printf("%d\\n", 7); return 0; }\n')
    const p = await prepare(join(dir, 'solo.c'))
    expect(p.ok && p.image.globals.y.addr).toBeGreaterThanOrEqual(0x80000000)
    expect(await run(join(dir, 'solo.c'))).toBe('7\n')
  })
  it("builds a project folder with its own .cmd", async () => {
    writeFileSync(join(dir, 'main.c'), '#include <stdio.h>\n#include "coef.h"\nint main(void) { printf("%d\\n", K); return 0; }\n')
    writeFileSync(join(dir, 'coef.h'), '#define K 42\n')
    copyFileSync(join(__dirname, '../../fixtures/ccs/C6748.cmd'), join(dir, 'C6748.cmd'))
    expect(await run(dir)).toBe('42\n')
  })
  it('reports compile errors like cl6x', async () => {
    writeFileSync(join(dir, 'main.c'), 'int main(void)\n{\n    return x;\n}\n')
    const p = await prepare(dir)
    expect(p.ok).toBe(false)
    expect(!p.ok && p.messages).toEqual(['"main.c", line 3: error #20: identifier "x" is undefined'])
  })
  it('applies a rewrite to the sources in memory only', async () => {
    const file = join(dir, 'v.c')
    writeFileSync(file, '#include <stdio.h>\n#define V 1\nint main(void) { printf("%d\\n", V); return 0; }\n')
    expect(await run(file, (_f, t) => t.replace('#define V 1', '#define V 2'))).toBe('2\n')
  })
})
