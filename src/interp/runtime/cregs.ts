import type { Machine } from '../exec/machine'
import { CYCLES_PER_STATEMENT } from '../exec/machine'
import { state } from './types'

export interface ControlRegister {
  read(): number
  write(v: number): void
}

/** CSR after reset on a C674x: CPU ID 0x14 (C674x), revision 0, EN = 1 (little-endian). */
export const CSR_RESET = 0x14000100
/** CSR bits a program can change: GIE, PGIE, SAT and PWRD. */
const CSR_WRITABLE = 0x0000fe03

const DEFAULTS: Record<string, number> = { CSR: CSR_RESET, GFPGFR: 0x0700001d }

class Registers {
  readonly values = new Map<string, number>(Object.entries(DEFAULTS))
  /** Cycle estimate when the time-stamp counter started (the first write to TSCL); null until then. */
  tscStart: number | null = null
  /** TSCH as latched by the last read of TSCL. */
  tsch = 0
}

const registers = state(() => new Registers())

const TWO_32 = 2 ** 32

/** A C674x control register (`extern __cregister volatile unsigned int X;` in c6x.h). */
export function controlRegister(m: Machine, name: string): ControlRegister {
  const r = registers(m)
  const estimate = (): number => {
    m.note('tsc', `TSCL/TSCH give an estimated cycle count (${CYCLES_PER_STATEMENT} cycles per C statement), not the C674x's real timing.`)
    return r.tscStart === null ? 0 : m.cycles - r.tscStart
  }
  switch (name) {
    case 'TSCL':
      return {
        read: () => {
          const t = estimate()
          r.tsch = Math.floor(t / TWO_32) >>> 0
          return t % TWO_32 >>> 0
        },
        write: () => {
          if (r.tscStart === null) r.tscStart = m.cycles
        }
      }
    case 'TSCH':
      return {
        read: () => {
          estimate()
          return r.tsch
        },
        write: () => {}
      }
    case 'CSR':
      return {
        read: () => r.values.get('CSR') as number,
        write: (v) => r.values.set('CSR', ((v & CSR_WRITABLE) | ((r.values.get('CSR') as number) & ~CSR_WRITABLE)) >>> 0)
      }
    default:
      return {
        read: () => r.values.get(name) ?? 0,
        write: (v) => r.values.set(name, v >>> 0)
      }
  }
}
