import { describe, expect, it } from 'vitest'
import { Inspector } from '../../../../src/interp/debug/inspect'
import type { Machine } from '../../../../src/interp/exec/machine'
import { captureIO, loadProgram, runProgram, type RunResult } from '../../../../src/interp/run'
import { build } from '../exec/harness'

const SRC = [
  'struct pt { int x; float y; };', //                              1
  'struct pt pts[2] = { { 1, 1.5f }, { 2, -0.25f } };', //          2
  'char name[8] = "dsp";', //                                       3
  'double total;', //                                               4
  'int scale(int v, float k)', //                                   5
  '{', //                                                           6
  '    int twice = v * 2;', //                                      7
  '    return (int)(twice * k);', //                                8
  '}', //                                                           9
  'int main(void)', //                                              10
  '{', //                                                           11
  '    int i;', //                                                  12
  '    int acc = 0;', //                                            13
  '    int *p = &acc;', //                                          14
  '    for (i = 0; i < 2; i++)', //                                 15
  '        acc += scale(pts[i].x, pts[i].y);', //                   16
  '    total = acc;', //                                            17
  '    return acc;', //                                             18
  '}' //                                                            19
].join('\n')

/** Runs SRC and calls `inspect` when statement `line` is about to run for the first time. */
function pauseAt(line: number, inspect: (ins: Inspector, m: Machine) => void): { r: RunResult; ins: Inspector } {
  const { program, image } = build(SRC)
  const m = loadProgram(program, image, captureIO().io)
  const ins = new Inspector(m)
  let done = false
  m.limit = m.ops + 1
  m.onLimit = () => {
    if (!done && m.loc.line === line) {
      done = true
      inspect(ins, m)
    }
    m.limit = m.ops + 1
  }
  return { r: runProgram(m), ins }
}

describe('Inspector', () => {
  it('lists frames innermost first with their current lines', () => {
    pauseAt(8, (ins) => {
      expect(ins.frames().map((f) => `${f.name}:${f.line}`)).toEqual(['scale:8', 'main:16'])
    })
  })

  it('shows the locals of each frame', () => {
    pauseAt(8, (ins) => {
      const inner = ins.variables(0)
      expect(inner.map((v) => [v.name, v.type, v.value])).toEqual([
        ['v', 'int', '1'],
        ['k', 'float', '1.5'],
        ['twice', 'int', '2']
      ])
      expect(inner[0].address).toMatch(/^0x8000[0-9A-F]{4}$/)
      const outer = ins.variables(1)
      expect(outer.map((v) => v.name)).toEqual(['i', 'acc', 'p'])
      expect(outer[2]).toMatchObject({ type: 'int *', expandable: true })
      expect(ins.children(1, 'p')).toMatchObject([{ name: '*p', value: '0' }])
    })
  })

  it('evaluates expressions, arrays, structs and char arrays', () => {
    pauseAt(8, (ins) => {
      expect(ins.evaluate(1, '*p + 3').value).toBe('3')
      expect(ins.evaluate(0, 'pts')).toMatchObject({ type: 'struct pt[2]', expandable: true })
      expect(ins.children(0, 'pts').map((c) => c.name)).toEqual(['[0]', '[1]'])
      expect(ins.children(0, 'pts[1]').map((c) => `${c.name}=${c.value}`)).toEqual(['x=2', 'y=-0.25'])
      expect(ins.evaluate(0, 'name').value).toMatch(/^0x[0-9A-F]{8} "dsp"$/)
      expect(ins.evaluate(0, 'name[0]').value).toBe("100 'd'")
      expect(ins.evaluate(0, 'v', 'hex').value).toBe('0x00000001')
      expect(ins.evaluate(0, 'k', 'hex').value).toBe('0x3FC00000')
      expect(ins.evaluate(0, '&pts[1]').type).toBe('struct pt *')
    })
  })

  it('reports errors instead of evaluating', () => {
    pauseAt(8, (ins) => {
      expect(ins.evaluate(0, 'nosuch').error).toBe('identifier "nosuch" is undefined')
      expect(ins.evaluate(0, 'scale(1, 2)').error).toBe('LabSim does not call functions from the Expressions view')
      expect(ins.evaluate(0, '*(int *)0').error).toBe('Illegal memory access at 0x00000000')
      expect(ins.evaluate(9, 'i').error).toBe('identifier "i" is undefined')
    })
  })

  it('changes a value, and the program continues with it', () => {
    const { r } = pauseAt(8, (ins) => {
      expect(ins.assign(0, 'twice', '10').value).toBe('10')
    })
    expect(r).toMatchObject({ status: 'exited', code: 14 })
  })

  it('evaluates globals after the program has ended', () => {
    const { r, ins } = pauseAt(99, () => {})
    expect(r.status).toBe('exited')
    expect(ins.frames()).toEqual([])
    expect(ins.evaluate(0, 'total').value).toBe('2')
  })
})
