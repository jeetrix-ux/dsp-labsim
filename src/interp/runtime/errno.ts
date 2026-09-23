import type { Machine } from '../exec/machine'

/** errno values of TI's C6000 EABI run-time library (errno.h). */
export const EDOM = 0x21
export const ERANGE = 0x22
export const ENOENT = 0x02
export const EFPOS = 0x98
export const EILSEQ = 0x58

export function setErrno(m: Machine, value: number): void {
  m.mem.set32(m.placement.libraryObject('errno'), value)
}
