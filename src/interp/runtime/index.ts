import type { Machine } from '../exec/machine'
import { PRINTF } from './printf'
import { STDIO, stdio } from './stdio'
import { STDLIB } from './stdlib'
import { STRING } from './string'
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = { ...STDLIB, ...STRING, ...PRINTF, ...STDIO }

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = new Set<string>()

/** Run-time library start-up (what the RTS boot code sets up before main): the stdio FILE table. */
export function initRuntime(m: Machine): void {
  stdio(m)
}
