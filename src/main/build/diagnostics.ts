import * as path from 'path'
import type { Diagnostic, Severity } from '@shared/build'

const LOCATED = /^"(.+?)", line (\d+): (fatal error|error|warning|remark) #(\d+(?:-D)?): (.*)$/
const UNLOCATED = /^(fatal error|error|warning|remark) #(\d+(?:-D)?): (.*)$/
const UNDEFINED_ROW = /^\s+(\S+)\s+(.+?)\s*$/

const severity = (s: string): Severity => (s === 'fatal error' ? 'error' : (s as Severity))

/** Parses cl6x compiler/linker output (run with --diag_wrap=off --display_error_number). */
export function parseDiagnostics(output: string, cwd: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const lines = output.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m = LOCATED.exec(line)
    if (m) {
      out.push({ file: path.resolve(cwd, m[1]), line: Number(m[2]), severity: severity(m[3]), code: m[4], message: m[5] })
      continue
    }
    m = UNLOCATED.exec(line)
    if (m) {
      out.push({ file: null, line: null, severity: severity(m[1]), code: m[2], message: m[3] })
      continue
    }
    if (/^\s*undefined\s+first referenced/.test(line)) {
      // Skip the "symbol  in file" line and the dashes, then read rows until a blank line.
      i += 2
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') {
        i++
        const row = UNDEFINED_ROW.exec(lines[i])
        if (row) {
          out.push({ file: null, line: null, severity: 'error', code: '10234-D', message: `unresolved symbol ${row[1]}, first referenced in ${row[2]}` })
        }
      }
    }
  }
  return out
}
