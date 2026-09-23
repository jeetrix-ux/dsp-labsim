import { STDLIB } from './stdlib'
import { STRING } from './string'
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = { ...STDLIB, ...STRING }

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = new Set<string>()
