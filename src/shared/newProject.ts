/** File > New > CCS Project: the options the wizard asks for, written to the project's labsim.json. */

export type OptLevel = 'off' | '0' | '1' | '2' | '3'
export const OPT_LEVELS: OptLevel[] = ['off', '0', '1', '2', '3']

export interface NewProjectOptions {
  name: string
  heapSize: string
  stackSize: string
  optLevel: OptLevel
  /** Predefined symbols (--define), e.g. c6748 or N=64. */
  defines: string[]
}

/** What CCS 12 sets for a new TMS320C6748 project. */
export const NEW_PROJECT_DEFAULTS: Omit<NewProjectOptions, 'name'> = { heapSize: '0x800', stackSize: '0x800', optLevel: 'off', defines: ['c6748'] }

export const PROJECT_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
export const SIZE = /^(0x[0-9a-f]+|\d+)$/i
export const SYMBOL = /^[A-Za-z_]\w*(=\S*)?$/

export function validateNewProject(o: NewProjectOptions): string | null {
  if (!o.name) return 'Enter a project name.'
  if (!PROJECT_NAME.test(o.name)) return 'A project name starts with a letter or _ and uses only letters, digits, _, - and . (at most 64 characters).'
  if (!SIZE.test(o.heapSize)) return 'Heap size must be a number such as 0x800.'
  if (!SIZE.test(o.stackSize)) return 'Stack size must be a number such as 0x800.'
  if (!OPT_LEVELS.includes(o.optLevel)) return 'Optimization level must be off, 0, 1, 2 or 3.'
  const bad = o.defines.find((d) => !SYMBOL.test(d))
  return bad === undefined ? null : `'${bad}' is not a valid predefined symbol.`
}
