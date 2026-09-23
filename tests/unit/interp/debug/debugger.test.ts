import { describe, expect, it } from 'vitest'
import type { ProgramImage } from '@shared/program'
import type { DebugCommand, DebugEvent, DebugRequest, VarNode } from '@shared/debug'
import { Debugger, type DebugChannel } from '../../../../src/interp/debug/debugger'
import { statementLines } from '../../../../src/interp/debug/lines'
import { captureIO, loadProgram } from '../../../../src/interp/run'
import { build, MAIN } from '../exec/harness'

/** Answers wait() from a script and poll() (only once the program runs) from a second queue. */
class FakeChannel implements DebugChannel {
  readonly events: DebugEvent[] = []
  private id = 0
  constructor(
    private readonly script: DebugCommand[],
    private readonly whileRunning: DebugCommand[] = []
  ) {}
  wait(): DebugRequest {
    const cmd = this.script.shift()
    if (!cmd) throw new Error(`script ended after ${JSON.stringify(this.events.slice(-2))}`)
    return { ...cmd, id: ++this.id }
  }
  poll(): DebugRequest | null {
    if (!this.events.some((e) => e.event === 'running')) return null
    const cmd = this.whileRunning.shift()
    return cmd ? { ...cmd, id: ++this.id } : null
  }
  send(event: DebugEvent): void {
    this.events.push(event)
  }
  stops(): string[] {
    return this.events.flatMap((e) => (e.event === 'stopped' ? [`${e.reason}:${e.line}`] : []))
  }
  reply(id: number): unknown {
    const r = this.events.find((e) => e.event === 'reply' && e.id === id)
    return r && r.event === 'reply' ? (r.error !== undefined ? { error: r.error } : r.result) : undefined
  }
}

function session(src: string, script: (image: ProgramImage) => DebugCommand[], whileRunning: DebugCommand[] = []): { ch: FakeChannel; stdout: string } {
  const { program, image } = build(src)
  const cap = captureIO()
  let dbg: Debugger | null = null
  const m = loadProgram(program, image, { ...cap.io, readLine: () => (dbg as Debugger).readLine() })
  const ch = new FakeChannel(script(image), whileRunning)
  dbg = new Debugger(m, ch, statementLines(program))
  dbg.run()
  return { ch, stdout: cap.stdout() }
}

const PROGRAM = [
  '#include <stdio.h>', //                  1
  'float y[4];', //                         2
  'int square(int v)', //                   3
  '{', //                                   4
  '    return v * v;', //                   5
  '}', //                                   6
  'int main(void)', //                      7
  '{', //                                   8
  '    int i;', //                          9
  '    for (i = 0; i < 4; i++) {', //       10
  '        y[i] = square(i) * 0.5f;', //    11
  '    }', //                               12
  '    printf("done %d\\n", square(3));', // 13
  '    return 0;', //                       14
  '}' //                                    15
].join('\n')

const value = (r: unknown): string => (r as VarNode).value

describe('Debugger', () => {
  it('stops at main, runs to the end and stays at C$$EXIT', () => {
    const { ch, stdout } = session(PROGRAM, () => [{ cmd: 'resume' }, { cmd: 'stackFrames' }, { cmd: 'evaluate', frame: 0, expr: 'y[3]', format: 'natural' }, { cmd: 'terminate' }])
    expect(ch.stops()).toEqual(['entry:10', 'exit:null'])
    expect(ch.events.find((e) => e.event === 'stopped' && e.reason === 'exit')).toMatchObject({ code: 0 })
    expect(stdout).toBe('done 9\n')
    expect(ch.reply(2)).toEqual([])
    expect(value(ch.reply(3))).toBe('4.5')
  })

  it('stops at breakpoints and steps into, out of and over calls', () => {
    const { ch } = session(PROGRAM, () => [
      { cmd: 'setBreakpoints', file: MAIN, lines: [11] }, // 1
      { cmd: 'resume' }, // 2
      { cmd: 'variables', frame: 0, formats: {} }, // 3
      { cmd: 'stepInto' }, // 4
      { cmd: 'stackFrames' }, // 5
      { cmd: 'stepReturn' }, // 6
      { cmd: 'stepOver' }, // 7
      { cmd: 'stepOver' }, // 8
      { cmd: 'resume' }, // 9
      { cmd: 'evaluate', frame: 0, expr: 'i', format: 'natural' }, // 10
      { cmd: 'setBreakpoints', file: MAIN, lines: [] }, // 11
      { cmd: 'resume' }, // 12
      { cmd: 'terminate' }
    ])
    expect(ch.stops()).toEqual(['entry:10', 'breakpoint:11', 'step:5', 'step:10', 'step:11', 'step:10', 'breakpoint:11', 'exit:null'])
    expect(ch.reply(1)).toEqual([11])
    expect((ch.reply(3) as VarNode[]).map((v) => `${v.name}=${v.value}`)).toEqual(['i=0'])
    expect((ch.reply(5) as { name: string; line: number }[]).map((f) => `${f.name}:${f.line}`)).toEqual(['square:5', 'main:11'])
    expect(value(ch.reply(10))).toBe('2')
  })

  it('moves breakpoints to the next statement and runs to a line', () => {
    const { ch } = session(PROGRAM, () => [
      { cmd: 'setBreakpoints', file: MAIN, lines: [12, 16] },
      { cmd: 'resume' },
      { cmd: 'runToLine', file: MAIN, line: 14 },
      { cmd: 'resume' },
      { cmd: 'terminate' }
    ])
    expect(ch.reply(1)).toEqual([13, null])
    expect(ch.stops()).toEqual(['entry:10', 'breakpoint:13', 'step:14', 'exit:null'])
  })

  it('suspends an endless loop', () => {
    const src = 'int main(void)\n{\n    volatile int n = 0;\n    for (;;)\n        n++;\n    return 0;\n}'
    const { ch } = session(src, () => [{ cmd: 'resume' }, { cmd: 'terminate' }], [{ cmd: 'suspend' }])
    const stops = ch.stops()
    expect(stops[0]).toBe('entry:3')
    expect(stops[1]).toMatch(/^suspend:[45]$/)
  })

  it('asks for console input and gives the line to scanf', () => {
    const src = '#include <stdio.h>\nint main(void)\n{\n    int n = 0;\n    scanf("%d", &n);\n    printf("n=%d\\n", n * 2);\n    return 0;\n}'
    const { ch, stdout } = session(src, () => [{ cmd: 'resume' }, { cmd: 'input', text: '21' }, { cmd: 'terminate' }])
    expect(ch.events.some((e) => e.event === 'inputRequest')).toBe(true)
    expect(stdout).toBe('n=42\n')
    expect(ch.stops()).toEqual(['entry:4', 'exit:null'])
  })

  it('halts on a runtime error and keeps the frames', () => {
    const src = 'int main(void)\n{\n    int z = 0;\n    return 5 / z;\n}'
    const { ch } = session(src, () => [{ cmd: 'resume' }, { cmd: 'stackFrames' }, { cmd: 'resume' }, { cmd: 'terminate' }])
    expect(ch.stops()).toEqual(['entry:3', 'halt:4'])
    expect(ch.events.find((e) => e.event === 'stopped' && e.reason === 'halt')).toMatchObject({ message: 'Division by zero' })
    expect((ch.reply(2) as unknown[]).length).toBe(1)
    expect(ch.reply(3)).toEqual({ error: 'The program has ended. Restart it to run again.' })
  })

  it('reads memory for the graphs', () => {
    const { ch } = session(PROGRAM, (image) => [{ cmd: 'readMemory', addr: image.globals.y.addr, length: 8 }, { cmd: 'readMemory', addr: 0, length: 4 }, { cmd: 'terminate' }])
    expect(ch.reply(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(ch.reply(2)).toBeNull()
  })

  it('resolves start addresses for the graphs', () => {
    let y = 0
    const { ch } = session(PROGRAM, (image) => {
      y = image.globals.y.addr
      return [{ cmd: 'address', frame: 0, expr: 'y' }, { cmd: 'address', frame: 0, expr: 'nosuch' }, { cmd: 'terminate' }]
    })
    expect(ch.reply(1)).toEqual({ address: y })
    expect(ch.reply(2)).toMatchObject({ error: expect.stringMatching(/nosuch/) })
  })
})
