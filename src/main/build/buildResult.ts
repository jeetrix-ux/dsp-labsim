import type { BuildResult } from '@shared/build'

export type Emit = (text: string, kind: 'out' | 'info' | 'error') => void

/** Ends a build with a LabSim message (also listed as a Problem), CCS-style. */
export function failBuild(emit: Emit, message: string): BuildResult {
  emit(message, 'error')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: false, diagnostics: [{ file: null, line: null, severity: 'error', code: 'LABSIM', message }], image: null }
}
