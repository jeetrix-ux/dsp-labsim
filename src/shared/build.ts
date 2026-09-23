import type { ProgramImage } from './program'

export interface Toolchain {
  /** CGT root, e.g. C:\ti\ccs1281\ccs\tools\compiler\ti-cgt-c6000_8.3.12 */
  root: string
  version: string
  cl6x: string
}

export type Severity = 'error' | 'warning' | 'remark'

export interface Diagnostic {
  /** Absolute path, or null for linker messages without a location. */
  file: string | null
  line: number | null
  severity: Severity
  /** TI diagnostic id as printed, e.g. '20', '179-D', '10234-D'. */
  code: string
  message: string
}

export type BuildKind = 'build' | 'rebuild' | 'clean'

export interface BuildResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Linked program layout; null after a clean or a failed build. */
  image: ProgramImage | null
}

export interface BuildOutputLine {
  console: string
  text: string
  kind: 'out' | 'info' | 'error'
}
