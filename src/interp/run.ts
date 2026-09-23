import type { ProgramImage } from '@shared/program'
import type { FuncSym } from './frontend/ast'
import type { Loc } from './frontend/diag'
import { library, type Program } from './frontend/program'
import { ExitSignal, LoadError, Machine, type Callable, type HostFiles, type RunIO } from './exec/machine'
import { Trap } from './exec/memory'
import { Placement } from './exec/placement'
import { FunctionCode } from './exec/stmt'
import { initRuntime, LIBRARY, UNSUPPORTED } from './runtime/index'

export { LoadError, Machine } from './exec/machine'
export type { HostFiles, RunIO } from './exec/machine'

export type RunResult =
  | { status: 'exited'; code: number | null; steps: number }
  | { status: 'halted'; message: string; loc: Loc; steps: number }

export interface LoadOptions {
  /** Stop after this many statements: a guard against endless loops in headless runs. */
  maxSteps?: number
}

/**
 * Loads a linked program: lays it out at the image's addresses, runs its static initialisers (what .cinit does on
 * the board) and compiles every function. Throws LoadError for constructs LabSim cannot run.
 */
export function loadProgram(program: Program, image: ProgramImage, io: RunIO, opts: LoadOptions = {}): Machine {
  const m = new Machine(program, image, io)
  if (opts.maxSteps !== undefined) m.limit = opts.maxSteps
  const placement = new Placement(m)
  m.placement = placement

  const byName = new Map<string, FunctionCode>()
  const statics = new Map<FuncSym, FunctionCode>()
  const compiled: FunctionCode[] = []
  for (const u of program.units) {
    for (const def of u.functions) {
      const c = new FunctionCode(m, def)
      compiled.push(c)
      if (def.sym.external) byName.set(def.sym.name, c)
      else statics.set(def.sym, c)
      m.functions.set(placement.functionAddress(def.sym), c)
    }
  }

  const libs = new Map<string, Callable>()
  const prototypes = library().prototypes
  m.resolve = (f, at) => {
    const own = f.external ? byName.get(f.name) : statics.get(f)
    if (own) return own
    const known = libs.get(f.name)
    if (known) return known
    const lib = LIBRARY[f.name]
    if (!lib || UNSUPPORTED.has(f.name)) {
      throw new LoadError(`LabSim: unsupported construct ${f.name}() (not in LabSim's runtime library yet)`, at)
    }
    const c: Callable = {
      name: f.name,
      fixed: lib.fixed,
      variadic: lib.variadic,
      type: prototypes.get(f.name) ?? null,
      invoke: (args, va, ret) => lib.call(m, args, va, ret)
    }
    libs.set(f.name, c)
    m.functions.set(placement.functionAddress(f), c)
    return c
  }

  placement.initialize()
  initRuntime(m)
  for (const c of compiled) c.compile()
  return m
}

/** Runs main to C$$EXIT, or until the target halts. */
export function runProgram(m: Machine): RunResult {
  try {
    const main = m.resolve(m.program.main.sym, m.program.main.loc)
    const r = main.invoke([], 0, 0)
    m.exit(typeof r === 'number' ? r | 0 : typeof r === 'bigint' ? Number(BigInt.asIntN(32, r)) : 0)
  } catch (e) {
    if (e instanceof ExitSignal) return { status: 'exited', code: e.code, steps: m.ops }
    if (e instanceof Trap) return { status: 'halted', message: e.message, loc: m.loc, steps: m.ops }
    throw e
  }
}

/** RunIO that keeps the output in memory: for tests, goldens and the CLI. */
export function captureIO(
  input: string[] = [],
  files: HostFiles | null = null
): { io: RunIO; stdout: () => string; stderr: () => string; notes: string[] } {
  let out = ''
  let err = ''
  const notes: string[] = []
  const lines = [...input]
  return {
    io: {
      write: (text, stream) => {
        if (stream === 'stdout') out += text
        else err += text
      },
      note: (text) => notes.push(text),
      readLine: () => lines.shift() ?? null,
      files
    },
    stdout: () => out,
    stderr: () => err,
    notes
  }
}
