import type { ProgramImage } from '@shared/program'
import type { FuncSym, FunctionDef } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import type { Program } from '../frontend/program'
import type { FunctionType } from '../frontend/types'
import { Memory, Trap, hex } from './memory'
import type { FrameScope } from './expr'
import type { Placement } from './placement'

/** CIO host file access. Paths are as the program wrote them; the implementation resolves them. */
export interface HostFiles {
  /** The whole file, or null when it cannot be read. */
  readAll(path: string): Uint8Array | null
  /** Replaces the file's contents; false when it cannot be written. */
  writeAll(path: string, data: Uint8Array): boolean
  remove(path: string): boolean
  rename(from: string, to: string): boolean
}

export interface RunIO {
  /** Program output as the CIO layer delivers it. */
  write(text: string, stream: 'stdout' | 'stderr'): void
  /** LabSim's own notes (bounds warnings, estimates): shown in the console but not program output. */
  note(text: string): void
  /** The next line typed into the console, without its newline; null at end of input. */
  readLine(): string | null
  /** Host files for fopen and friends; null when the program has no project folder. */
  files: HostFiles | null
}

/** Something a call can invoke: a compiled user function or a runtime library function. */
export interface Callable {
  readonly name: string
  /** Named parameters. A variadic callee finds the remaining arguments in memory at `va`. */
  readonly fixed: number
  readonly variadic: boolean
  /** The callee's own type, when known (calls through implicit declarations convert to it). */
  readonly type: FunctionType | null
  invoke(args: any[], va: number, retBuf: number): any
}

export interface Frame {
  fn: FunctionDef
  fp: number
  /** The statement that made the call. */
  callSite: Loc
}

/** Thrown by exit() and abort(): the program reached C$$EXIT. `code` is null after abort(). */
export class ExitSignal {
  constructor(readonly code: number | null) {}
}

/** The program cannot be loaded: an unsupported construct, or a symbol with no address. */
export class LoadError extends Error {
  constructor(
    message: string,
    readonly loc: Loc | null
  ) {
    super(message)
    this.name = 'LoadError'
  }
}

/** LabSim's own memory: string literals, runtime objects, objects the image does not place. Unused on the C6748. */
export const LABSIM_REGION = { name: 'LABSIM', origin: 0x70000000, length: 0x01000000, attr: 'RWIX' }

/** TSCL/TSCH and clock() report this many cycles per C statement executed (an estimate, not C674x timing). */
export const CYCLES_PER_STATEMENT = 4

export class Machine {
  readonly mem: Memory
  /** Stack pointer (B15) and the current frame's base. */
  sp: number
  fp: number
  /** The current frame's first variadic argument, and where it returns a struct. */
  va = 0
  retBuf = 0
  /** Value of the last `return`. */
  ret: any = undefined
  readonly stackLow: number
  readonly stackTop: number
  /** Statements executed; `poll()` runs whenever `ops` reaches `limit`. */
  ops = 0
  limit = Infinity
  /** The statement being executed. */
  loc: Loc
  gotoLabel = ''
  readonly frames: Frame[] = []
  /** Every function that has an address: compiled user functions and the library functions in use. */
  readonly functions = new Map<number, Callable>()
  /** Each compiled function's frame layout, for the debugger's Variables and Expressions. */
  readonly scopes = new Map<FunctionDef, FrameScope>()
  /** Functions registered with atexit(), in order. */
  readonly atexit: number[] = []
  /** Run by exit() after the atexit functions: the RTS cleanup that flushes open streams. */
  readonly cleanups: (() => void)[] = []
  placement!: Placement
  resolve!: (f: FuncSym, at: Loc) => Callable
  private readonly noted = new Set<string>()

  constructor(
    readonly program: Program,
    readonly image: ProgramImage,
    readonly io: RunIO
  ) {
    if (image.stack.size <= 0) throw new LoadError('LabSim: the program has no .stack section', null)
    this.mem = new Memory([...image.memory, LABSIM_REGION])
    this.stackLow = image.stack.start >>> 0
    const top = image.stack.start + image.stack.size
    this.stackTop = (top - (top % 8)) >>> 0
    this.sp = this.fp = this.stackTop
    this.loc = program.main.loc
  }

  /** Halts the target; the console shows the message with the current line. */
  trap(message: string): never {
    throw new Trap(message)
  }

  /** A LabSim note, shown once per key. */
  note(key: string, text: string): void {
    if (this.noted.has(key)) return
    this.noted.add(key)
    this.io.note(text)
  }

  /** Runs when `ops` reaches `limit`. Headless runs stop there; the debugger (Step 5) replaces `onLimit`. */
  poll(): void {
    this.onLimit()
  }

  onLimit: () => void = () => this.trap(`LabSim stopped the program after ${this.ops} statements (is it in an endless loop?)`)

  /** Calls the function at a code address (qsort comparators, atexit functions). */
  callAddress(addr: number, args: any[]): any {
    const c = this.functions.get(addr >>> 0)
    if (!c) this.trap(`Call through an invalid function pointer (0x${hex(addr)})`)
    return c.invoke(args, 0, 0)
  }

  /** exit(): the atexit functions in reverse order, then the RTS cleanup, then C$$EXIT. abort() passes null and skips both. */
  exit(code: number | null): never {
    if (code !== null) {
      for (let f = this.atexit.pop(); f !== undefined; f = this.atexit.pop()) this.callAddress(f, [])
      for (const c of this.cleanups) c()
    }
    throw new ExitSignal(code)
  }

  /** Estimated cycles since reset. */
  get cycles(): number {
    return this.ops * CYCLES_PER_STATEMENT
  }
}
