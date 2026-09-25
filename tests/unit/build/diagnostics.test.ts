import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { parseDiagnostics } from '../../../src/main/build/diagnostics'

// Real paths on this OS: the parser resolves cl6x's relative file names with `path`.
const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws'
const CWD = join(ROOT, 'bad', '.labsim', 'Debug')
const MAIN = join(ROOT, 'bad', 'main.c')

const COMPILE = [
  '"../../main.c", line 6: error #20: identifier "y" is undefined',
  '"../../main.c", line 7: warning #551-D: variable "x" is used before its value is set',
  '"../../main.c", line 8: error #66: expected a ";"',
  '"../../main.c", line 5: warning #179-D: variable "unused" was declared but never referenced',
  '2 errors detected in the compilation of "../../main.c".',
  '',
  '>> Compilation failure'
].join('\r\n')

const LINK = [
  '<Linking>',
  '',
  ' undefined  first referenced                                                                         ',
  '  symbol        in file                                                                              ',
  ' ---------  ----------------                                                                         ',
  ' main       C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12\\lib\\rts6740_elf.lib<args_main.c.obj>',
  ' helper     ./util.obj                                                                           ',
  '',
  'error #10234-D: unresolved symbols remain',
  'error #10010: errors encountered during linking; "bad.out" not built',
  '',
  '>> Compilation failure'
].join('\n')

describe('parseDiagnostics', () => {
  it('parses located compiler errors and warnings', () => {
    expect(parseDiagnostics(COMPILE, CWD)).toEqual([
      { file: MAIN, line: 6, severity: 'error', code: '20', message: 'identifier "y" is undefined' },
      { file: MAIN, line: 7, severity: 'warning', code: '551-D', message: 'variable "x" is used before its value is set' },
      { file: MAIN, line: 8, severity: 'error', code: '66', message: 'expected a ";"' },
      { file: MAIN, line: 5, severity: 'warning', code: '179-D', message: 'variable "unused" was declared but never referenced' }
    ])
  })
  it('turns the undefined-symbol table and linker errors into diagnostics', () => {
    expect(parseDiagnostics(LINK, CWD)).toEqual([
      { file: null, line: null, severity: 'error', code: '10234-D', message: 'unresolved symbol main, first referenced in C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12\\lib\\rts6740_elf.lib<args_main.c.obj>' },
      { file: null, line: null, severity: 'error', code: '10234-D', message: 'unresolved symbol helper, first referenced in ./util.obj' },
      { file: null, line: null, severity: 'error', code: '10234-D', message: 'unresolved symbols remain' },
      { file: null, line: null, severity: 'error', code: '10010', message: 'errors encountered during linking; "bad.out" not built' }
    ])
  })
  it('maps fatal errors to errors and keeps remarks', () => {
    const d = parseDiagnostics('"../../a.c", line 1: fatal error #1965: cannot open source file "nope.h"\n"../../a.c", line 2: remark #1532-D: (ULP 5.1) Detected sprintf', CWD)
    expect(d.map((x) => [x.severity, x.code])).toEqual([['error', '1965'], ['remark', '1532-D']])
  })
})
