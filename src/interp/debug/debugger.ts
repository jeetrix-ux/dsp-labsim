import type { DebugEvent, DebugRequest, StopReason } from '@shared/debug'
import type { Machine } from '../exec/machine'
import type { Loc } from '../frontend/diag'
import { runProgram } from '../run'
import { Inspector } from './inspect'
import { fileKey, verifyLine, type StatementLines } from './lines'

/** How the debugger talks to the UI. In the app: a SharedArrayBuffer slot and postMessage (src/main/debug). */
export interface DebugChannel {
  /** Blocks until the next request. */
  wait(): DebugRequest
  /** A request that arrived while the program was running, or null. */
  poll(): DebugRequest | null
  send(event: DebugEvent): void
}

/** Statements between checks for Suspend and queued requests when nothing is armed. */
export const POLL_INTERVAL = 20000

interface Step {
  kind: 'entry' | 'into' | 'over' | 'return'
  file: string
  line: number
  depth: number
}

const TERMINATE = Symbol('terminate')

const CONTROL = new Set(['resume', 'stepInto', 'stepOver', 'stepReturn', 'runToLine'])

export class Debugger {
  private readonly ins: Inspector
  /** fileKey → verified breakpoint lines. */
  private readonly breakpoints = new Map<string, Set<number>>()
  private readonly keys = new Map<string, string>()
  private step: Step | null = null
  private target: { file: string; line: number } | null = null
  private suspendRequested = false
  private finished = false

  constructor(
    private readonly m: Machine,
    private readonly ch: DebugChannel,
    private readonly lines: StatementLines
  ) {
    this.ins = new Inspector(m)
  }

  /** Runs the program under the debugger until the UI terminates the session. */
  run(): void {
    const m = this.m
    m.onLimit = () => this.check()
    this.step = { kind: 'entry', file: '', line: 0, depth: 0 }
    m.limit = m.ops + 1
    try {
      const r = runProgram(m)
      this.finished = true
      if (r.status === 'exited') {
        m.frames.length = 0
        this.send({ event: 'stopped', reason: 'exit', file: null, line: null, code: r.code })
      } else this.send({ event: 'stopped', reason: 'halt', file: r.loc.file, line: r.loc.line, message: r.message })
      this.serve()
    } catch (e) {
      if (e !== TERMINATE) throw e
    }
  }

  /** The program's console input: asks the UI for a line and waits for it. */
  readLine(): string | null {
    this.send({ event: 'inputRequest' })
    for (;;) {
      const req = this.ch.wait()
      if (req.cmd === 'input') {
        this.reply(req.id, null)
        return req.text
      }
      if (req.cmd === 'terminate') {
        this.reply(req.id, null)
        throw TERMINATE
      }
      if (req.cmd === 'suspend' || CONTROL.has(req.cmd)) this.reply(req.id, null)
      else this.answer(req)
    }
  }

  private key(file: string): string {
    let k = this.keys.get(file)
    if (k === undefined) {
      k = fileKey(file)
      this.keys.set(file, k)
    }
    return k
  }

  private send(event: DebugEvent): void {
    this.ch.send(event)
  }

  private reply(id: number, result: unknown, error?: string): void {
    this.send(error === undefined ? { event: 'reply', id, result } : { event: 'reply', id, error })
  }

  /** The statement hook (Machine.onLimit): requests, then whether to stop here. */
  private check(): void {
    const m = this.m
    for (let req = this.ch.poll(); req; req = this.ch.poll()) {
      if (req.cmd === 'suspend') {
        this.suspendRequested = true
        this.reply(req.id, null)
      } else if (req.cmd === 'terminate') {
        this.reply(req.id, null)
        throw TERMINATE
      } else if (CONTROL.has(req.cmd)) this.reply(req.id, null)
      else this.answer(req)
    }
    const reason = this.reason()
    if (reason) this.pause(reason)
    m.limit = m.ops + (this.step || this.target || this.breakpoints.size > 0 ? 1 : POLL_INTERVAL)
  }

  private reason(): StopReason | null {
    const loc = this.m.loc
    const depth = this.m.frames.length
    if (this.suspendRequested) {
      this.suspendRequested = false
      return 'suspend'
    }
    const file = this.key(loc.file)
    const s = this.step
    if (s) {
      if (s.kind === 'entry') return 'entry'
      const moved = loc.line !== s.line || file !== s.file
      if (s.kind === 'into' && (moved || depth !== s.depth)) return 'step'
      if (s.kind === 'over' && (depth < s.depth || (depth === s.depth && moved))) return 'step'
      if (s.kind === 'return' && depth < s.depth) return 'step'
    }
    if (this.target && this.target.file === file && this.target.line === loc.line) return 'step'
    if (this.breakpoints.get(file)?.has(loc.line)) return 'breakpoint'
    return null
  }

  private pause(reason: StopReason): void {
    this.step = null
    this.target = null
    const loc: Loc = this.m.loc
    this.send({ event: 'stopped', reason, file: loc.file, line: loc.line })
    this.serve()
  }

  /** Answers requests while stopped; returns when the program should continue. */
  private serve(): void {
    for (;;) {
      const req = this.ch.wait()
      if (req.cmd === 'terminate') {
        this.reply(req.id, null)
        throw TERMINATE
      }
      if (req.cmd === 'suspend') {
        this.reply(req.id, null)
        continue
      }
      if (!CONTROL.has(req.cmd)) {
        this.answer(req)
        continue
      }
      if (this.finished) {
        this.reply(req.id, undefined, 'The program has ended. Restart it to run again.')
        continue
      }
      const error = this.control(req)
      if (error) {
        this.reply(req.id, undefined, error)
        continue
      }
      this.reply(req.id, null)
      this.send({ event: 'running' })
      return
    }
  }

  private control(req: DebugRequest): string | null {
    const loc = this.m.loc
    const here = { file: this.key(loc.file), line: loc.line, depth: this.m.frames.length }
    switch (req.cmd) {
      case 'stepInto':
        this.step = { kind: 'into', ...here }
        return null
      case 'stepOver':
        this.step = { kind: 'over', ...here }
        return null
      case 'stepReturn':
        this.step = { kind: 'return', ...here }
        return null
      case 'runToLine': {
        const line = verifyLine(this.lines, req.file, req.line)
        if (line === null) return 'There is no code at or after that line.'
        this.target = { file: this.key(req.file), line }
        return null
      }
      default:
        return null
    }
  }

  private answer(req: DebugRequest): void {
    try {
      switch (req.cmd) {
        case 'setBreakpoints': {
          const verified = req.lines.map((l) => verifyLine(this.lines, req.file, l))
          const set = new Set(verified.filter((l): l is number => l !== null))
          if (set.size > 0) this.breakpoints.set(this.key(req.file), set)
          else this.breakpoints.delete(this.key(req.file))
          this.m.limit = Math.min(this.m.limit, this.m.ops + 1)
          this.reply(req.id, verified)
          return
        }
        case 'stackFrames':
          this.reply(req.id, this.ins.frames())
          return
        case 'variables':
          this.reply(req.id, this.ins.variables(req.frame, req.formats))
          return
        case 'evaluate':
          this.reply(req.id, this.ins.evaluate(req.frame, req.expr, req.format))
          return
        case 'children':
          this.reply(req.id, this.ins.children(req.frame, req.expr, req.formats))
          return
        case 'assign':
          this.reply(req.id, this.ins.assign(req.frame, req.expr, req.value))
          return
        case 'readMemory': {
          const bytes = this.m.mem.peek(req.addr, req.length)
          this.reply(req.id, bytes ? [...bytes] : null)
          return
        }
        case 'address':
          this.reply(req.id, this.ins.address(req.frame, req.expr))
          return
        case 'input':
          this.reply(req.id, undefined, 'The program is not waiting for input.')
          return
        default:
          this.reply(req.id, undefined, `unexpected request ${req.cmd}`)
      }
    } catch (e) {
      this.reply(req.id, undefined, e instanceof Error ? e.message : String(e))
    }
  }
}
