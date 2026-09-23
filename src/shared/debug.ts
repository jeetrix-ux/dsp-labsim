import type { ProgramImage } from './program'

export type NumberFormat = 'natural' | 'hex' | 'decimal' | 'binary' | 'char'

export interface FrameInfo {
  /** 0 is the innermost function. */
  index: number
  name: string
  file: string | null
  line: number | null
}

/** One row of the Variables or Expressions view. */
export interface VarNode {
  name: string
  /** The expression that produces this row; also used to expand it and to change its value. */
  expr: string
  type: string
  value: string
  /** `0x…` for lvalues, empty otherwise. */
  address: string
  expandable: boolean
  error?: string
}

export type StopReason = 'entry' | 'breakpoint' | 'step' | 'suspend' | 'exit' | 'halt'

/** Where a graph's Start Address expression points, or why it does not evaluate. */
export type AddressResult = { address: number } | { error: string }

export type DebugCommand =
  | { cmd: 'resume' }
  | { cmd: 'stepInto' }
  | { cmd: 'stepOver' }
  | { cmd: 'stepReturn' }
  | { cmd: 'runToLine'; file: string; line: number }
  | { cmd: 'suspend' }
  | { cmd: 'terminate' }
  | { cmd: 'setBreakpoints'; file: string; lines: number[] }
  | { cmd: 'stackFrames' }
  | { cmd: 'variables'; frame: number; formats: Record<string, NumberFormat> }
  | { cmd: 'evaluate'; frame: number; expr: string; format: NumberFormat }
  | { cmd: 'children'; frame: number; expr: string; formats: Record<string, NumberFormat> }
  | { cmd: 'assign'; frame: number; expr: string; value: string }
  | { cmd: 'readMemory'; addr: number; length: number }
  | { cmd: 'address'; frame: number; expr: string }
  | { cmd: 'input'; text: string | null }

export type DebugRequest = DebugCommand & { id: number }

export type DebugEvent =
  | { event: 'reply'; id: number; result?: unknown; error?: string }
  /** The program is loaded and about to run to main. */
  | { event: 'loaded' }
  /** It could not be compiled or loaded; the session is over. */
  | { event: 'failed'; messages: string[] }
  | { event: 'output'; text: string; stream: 'stdout' | 'stderr' }
  | { event: 'note'; text: string }
  | { event: 'running' }
  | { event: 'stopped'; reason: StopReason; file: string | null; line: number | null; message?: string; code?: number | null }
  /** The program waits for a console line (scanf, getchar, gets). */
  | { event: 'inputRequest' }
  /** The worker thread has gone (terminated, or it failed). */
  | { event: 'ended' }

/** What a debug worker needs to compile and load a project. */
export interface DebugLaunch {
  projectDir: string
  sources: string[]
  includePaths: string[]
  defines: string[]
  dialect: 'c89' | 'c99'
  diagWarnings: string[]
  image: ProgramImage
}
