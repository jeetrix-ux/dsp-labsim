import type { Machine } from '../exec/machine'

/** A runtime library function. `args` hold the named parameters (converted to their types); the rest of a variadic
 * call is in simulated memory at `va`; `ret` is where a function returning a struct writes it. */
export interface LibFunction {
  fixed: number
  variadic: boolean
  call(m: Machine, args: any[], va: number, ret: number): any
}

export const fn = (fixed: number, call: LibFunction['call']): LibFunction => ({ fixed, variadic: false, call })
export const vfn = (fixed: number, call: LibFunction['call']): LibFunction => ({ fixed, variadic: true, call })

/** Per-machine state of a runtime module, created on first use. */
export function state<T>(create: (m: Machine) => T): (m: Machine) => T {
  const all = new WeakMap<Machine, T>()
  return (m) => {
    let s = all.get(m)
    if (s === undefined) {
      s = create(m)
      all.set(m, s)
    }
    return s
  }
}
