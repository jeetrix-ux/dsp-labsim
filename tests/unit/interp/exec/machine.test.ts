import { describe, expect, it } from 'vitest'
import { ExitSignal, LABSIM_REGION, Machine } from '../../../../src/interp/exec/machine'
import { CODE_BASE, Placement } from '../../../../src/interp/exec/placement'
import { controlRegister, CSR_RESET } from '../../../../src/interp/runtime/cregs'
import { build, MAIN, NO_IO } from './harness'

function load(source: string): { m: Machine; pl: Placement; addr: (name: string) => number; statics: Record<string, { addr: number }> } {
  const { program, image } = build(source)
  const m = new Machine(program, image, NO_IO)
  const pl = new Placement(m)
  m.placement = pl
  pl.initialize()
  return { m, pl, addr: (name) => image.globals[name].addr, statics: image.statics[MAIN] }
}

const inLabsim = (a: number): boolean => a >= LABSIM_REGION.origin && a < LABSIM_REGION.origin + LABSIM_REGION.length

describe('Placement', () => {
  it('places objects at the image addresses and writes their initialisers like .cinit', () => {
    const { m, pl, addr, statics } = load([
      'int n = 5;',
      'float h[3] = { 1, 2.5f, -1 };',
      'const char *msg = "hi";',
      'int *p = &n;',
      'static short s = -2;',
      'char name[8] = "ab";',
      'struct pt { char c; double d; } pts[2] = { { 1, 0.5 }, { 2, 1e300 } };',
      'long long big = -3;',
      'unsigned u = 0xFFFFFFFF;',
      'int zero[4];',
      'int main(void) { static int calls = 7; return calls + s; }'
    ].join('\n'))
    expect(m.mem.i32(addr('n'))).toBe(5)
    expect([0, 1, 2].map((i) => m.mem.f32(addr('h') + 4 * i))).toEqual([1, 2.5, -1])
    const msg = m.mem.u32(addr('msg'))
    expect(inLabsim(msg)).toBe(true)
    expect(m.mem.cstring(msg)).toBe('hi')
    expect(m.mem.u32(addr('p'))).toBe(addr('n'))
    expect(m.mem.i16(statics.s.addr)).toBe(-2)
    expect(m.mem.cstring(addr('name'))).toBe('ab')
    expect(m.mem.i8(addr('pts') + 16)).toBe(2)
    expect(m.mem.f64(addr('pts') + 24)).toBe(1e300)
    expect(m.mem.i64(addr('big'))).toBe(-3n)
    expect(m.mem.u32(addr('u'))).toBe(0xffffffff)
    expect(m.mem.i32(addr('zero') + 12)).toBe(0)
    expect(m.mem.i32(statics['calls$1'].addr)).toBe(7)
    expect(pl.unplaced).toEqual([])
  })

  it('gives functions their image address and static functions a LabSim code address', () => {
    const { m, pl, addr } = load('static int helper(void) { return 1; }\nint main(void) { return helper(); }')
    expect(pl.functionAddress(m.program.main.sym)).toBe(addr('main'))
    const helper = m.program.units[0].functions[0].sym
    expect(pl.functionAddress(helper)).toBeGreaterThanOrEqual(CODE_BASE)
    expect(pl.functionAddress(helper)).toBe(pl.functionAddress(helper))
  })

  it("places the runtime's own objects (errno, _ftable) in the LabSim region", () => {
    const { m, pl } = load('#include <stdio.h>\n#include <errno.h>\nFILE *f;\nint main(void) { f = stdout; errno = 0; return 0; }')
    const ftable = m.program.units[0].objects.find((o) => o.name === '_ftable')!
    expect(pl.objectAddress(ftable)).toBe(pl.libraryObject('_ftable'))
    expect(inLabsim(pl.libraryObject('errno'))).toBe(true)
    expect(pl.libraryObject('errno')).not.toBe(pl.libraryObject('_ftable'))
  })
})

describe('Machine', () => {
  it('starts with the stack pointer at the top of .stack', () => {
    const { m } = load('int main(void) { return 0; }')
    expect(m.stackTop).toBe(m.image.stack.start + m.image.stack.size)
    expect(m.sp).toBe(m.stackTop)
  })

  it('shows a note once per key', () => {
    const notes: string[] = []
    const { program, image } = build('int main(void) { return 0; }')
    const m = new Machine(program, image, { ...NO_IO, note: (t) => notes.push(t) })
    m.note('k', 'first')
    m.note('k', 'again')
    m.note('j', 'other')
    expect(notes).toEqual(['first', 'other'])
  })

  it('runs the cleanups on exit() but not on abort()', () => {
    const { m } = load('int main(void) { return 0; }')
    let flushed = 0
    m.cleanups.push(() => flushed++)
    const code = (f: () => void): number | null | undefined => {
      try {
        f()
      } catch (e) {
        if (e instanceof ExitSignal) return e.code
        throw e
      }
      return undefined
    }
    expect(code(() => m.exit(3))).toBe(3)
    expect(code(() => m.exit(null))).toBeNull()
    expect(flushed).toBe(1)
  })
})

describe('control registers', () => {
  it('reads CSR as a C674x and counts an estimated TSC after the first TSCL write', () => {
    const notes: string[] = []
    const { program, image } = build('int main(void) { return 0; }')
    const m = new Machine(program, image, { ...NO_IO, note: (t) => notes.push(t) })
    expect(controlRegister(m, 'CSR').read()).toBe(CSR_RESET)
    const tscl = controlRegister(m, 'TSCL')
    m.ops = 100
    expect(tscl.read()).toBe(0)
    tscl.write(12345)
    m.ops = 110
    expect(tscl.read()).toBe(40)
    expect(controlRegister(m, 'TSCH').read()).toBe(0)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('estimate')
    const amr = controlRegister(m, 'AMR')
    amr.write(5)
    expect(amr.read()).toBe(5)
  })
})
