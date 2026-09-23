import type { Machine } from '../exec/machine'
import { INTRINSICS, UNSUPPORTED_INTRINSICS } from './c6x'
import { MATH } from './math'
import { PRINTF } from './printf'
import { STDIO, stdio } from './stdio'
import { STDLIB } from './stdlib'
import { STRING } from './string'
import { TIME } from './time'
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = { ...STDLIB, ...STRING, ...PRINTF, ...STDIO, ...MATH, ...TIME, ...INTRINSICS }

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = UNSUPPORTED_INTRINSICS

/** Run-time library start-up (what the RTS boot code sets up before main): the stdio FILE table. */
export function initRuntime(m: Machine): void {
  stdio(m)
}
