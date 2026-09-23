# Step 3: C Front-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the lab's C programs exactly the way `cl6x -mv6740` (CGT 8.3.12) does: preprocess, parse, type-check and link. The result is a typed AST that the Step 4 executor runs. When TI's compiler is missing, the same front-end drives a fallback build with cl6x-style diagnostics and a synthetic memory layout.

**Architecture:** `src/interp/frontend/` is plain TypeScript with no Electron dependency. The pipeline runs `tokenize` (pp-tokens), then `preprocess` (macros, includes, conditionals, LabSim's built-in headers), then `parseUnit`. `parseUnit` is a recursive-descent parser that calls `Sema` to type every expression, insert implicit conversions and report cl6x's diagnostics, and it calls `lowerInit` to flatten initialisers. `compileUnit` wraps the pipeline for one `.c` file and `linkProgram` resolves the translation units. `src/main/build/fallback.ts` uses these, together with a linker-command-file reader and a synthetic layout, when `cl6x` is absent. After every real `cl6x` build it also checks that LabSim can read the program.

**Tech Stack:** TypeScript 5.9 (strict), vitest 4.1, Node `path`. No new dependencies.

## Global Constraints

- The interpreter (`src/interp/`) has no Electron dependency. It may import Node's `path` and the `@shared/*` types.
- Target model is the C6000 EABI, little-endian:
  - `char` is 8 bits and **signed**; `short` 16; `int` 32; **`long` 32**; `long long` 64.
  - `__int40_t` holds 40 bits in 8 bytes.
  - `float` 32; `double` and `long double` 64; pointers 32.
- Diagnostics use cl6x's numbers and wording, e.g. `"file", line N: error #20: identifier "b" is undefined`.
  - Discretionary diagnostics keep the `-D` suffix.
  - #225 is a remark. It shows as a warning only when `--diag_warning=225` is given, which CCS always passes.
  - A diagnostic at end of input prints as `At end of source: …`.
- The C dialect follows the project setting. The default is relaxed C89 (`__STDC_VERSION__` = `199409L`), where `for (int i …)` is **error #29**. C99 (`--c99`) allows it. The other C99 features are accepted in both modes: mixed declarations, `//`, `long long`, `_Bool`, `inline`, designated initialisers, compound literals and VLAs.
- Standard and TI headers resolve to LabSim's built-in versions. Every macro that LabSim and TI both define has TI's exact value, except the ones listed as deliberate differences in the header test. `tests/fixtures/ti/headers.ppm` is the reference.
- The C6000 intrinsics (`_dotp2`, `_pack2`, `_extu` …) are declared in every translation unit even without `#include <c6x.h>`, the same as cl6x.
- A construct cl6x accepts but LabSim cannot run yet is reported as `error #LABSIM: LabSim: unsupported construct <what>`. This covers bit-fields, anonymous struct/union members, statement expressions, `asm`, wide string literals and unsupported headers.
- Never write to `~/workspace_v12` or `~/dsp_ccs_lab`; the corpus tests only read them.
- Write files that contain backslashes with the Write/Edit tools, never with Git Bash heredocs (they collapse `\\`).

## File Structure

| File | Responsibility |
|---|---|
| `src/interp/frontend/diag.ts` | `Loc`, `Diags` sink (remark promotion, fatal errors), `M` catalogue of cl6x messages |
| `src/interp/frontend/lexer.ts` | `Token`, `tokenize` (line splicing, comments, pp-numbers, literals, punctuators) |
| `src/interp/frontend/literals.ts` | Numeric, character and string literal decoding |
| `src/interp/frontend/headers.ts` | LabSim's built-in headers and the intrinsic prelude |
| `src/interp/frontend/ppexpr.ts` | `#if` expression evaluation |
| `src/interp/frontend/preprocessor.ts` | Macros (hide sets), `#include`, conditionals, pragmas, predefined macros |
| `src/interp/frontend/types.ts` | C types, EABI sizes and alignment, record layout, conversions, compatibility, `typeToString` |
| `src/interp/frontend/ast.ts` | Symbols, typed expressions, statements, initialisers, functions, translation units |
| `src/interp/frontend/consteval.ts` | Constant expressions (integer, floating, address constants) |
| `src/interp/frontend/sema.ts` | Expression typing, implicit conversions, cl6x diagnostics |
| `src/interp/frontend/initializer.ts` | Designated and brace-elided initialisers, flattened to `{offset, type, expr}` |
| `src/interp/frontend/parser.ts` | Declarations, declarators, statements, expressions, scopes, usage warnings |
| `src/interp/frontend/program.ts` | `compileUnit`, `linkProgram`, `library()` |
| `src/main/build/sources.ts` | `findSources`, `OUT_SUBDIR` (moved out of `builder.ts`) |
| `src/main/build/buildResult.ts` | `failBuild` console helper shared by both build paths |
| `src/main/build/linkerCmd.ts` | Reads `MEMORY`/`SECTIONS` from a `.cmd` file |
| `src/main/build/fallbackImage.ts` | Synthetic linker: places objects in sections and regions, producing a `ProgramImage` |
| `src/main/build/fallback.ts` | Fallback build, cl6x-style rendering, front-end check after real builds |
| `scripts/capture-cl6x-diagnostics.mjs` | Regenerates the cl6x reference diagnostics fixture |

---
### Task 1: Diagnostics and the lexer

**Files:**
- Modify: `tsconfig.node.json` (include `src/interp/**/*`)
- Create: `src/interp/frontend/diag.ts`
- Create: `src/interp/frontend/lexer.ts`
- Test: `tests/unit/interp/diag.test.ts`, `tests/unit/interp/lexer.test.ts`

**Interfaces:**
- Produces:
  - `Loc {file, line, col}`, where line 0 means end of source.
  - `Msg = readonly [code, text]`.
  - `FrontDiagnostic extends Diagnostic {fatal?}` and `FatalError`.
  - `class Diags { list; errors; error(at, msg); warning(at, msg); fatal(at, msg): never }`.
  - `M` message catalogue and `type Punct`.
  - `Token {kind, text, file, line, col, space, bol, hide?, bad?, placemarker?}`, `tokenize(source, file): Token[]`, where the last token is `eof` with line 0.
  - `loc(token): Loc`.

- [ ] **Step 1: Include the interpreter in the Node tsconfig**

In `tsconfig.node.json` change the `include` line to:

```json
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "src/interp/**/*", "tests/**/*", "*.config.ts"]
```

- [ ] **Step 2: Write the failing tests**

```ts path=tests/unit/interp/diag.test.ts
import { describe, expect, it } from 'vitest'
import { Diags, FatalError, M } from '../../../src/interp/frontend/diag'

const at = { file: 'C:/p/main.c', line: 3, col: 5 }

describe('Diags', () => {
  it('records errors and warnings in cl6x form', () => {
    const d = new Diags()
    d.error(at, M.undefinedIdent('b'))
    d.warning(at, M.unreferenced('a'))
    expect(d.list).toEqual([
      { file: 'C:/p/main.c', line: 3, severity: 'error', code: '20', message: 'identifier "b" is undefined' },
      { file: 'C:/p/main.c', line: 3, severity: 'warning', code: '179-D', message: 'variable "a" was declared but never referenced' }
    ])
    expect(d.errors).toBe(1)
  })
  it('shows remark #225 only when --diag_warning=225 promotes it', () => {
    const quiet = new Diags()
    quiet.warning(at, M.implicitFunction('foo'))
    expect(quiet.list).toEqual([])
    const loud = new Diags(['225'])
    loud.warning(at, M.implicitFunction('foo'))
    expect(loud.list[0]).toMatchObject({ severity: 'warning', code: '225-D', message: 'function "foo" declared implicitly' })
  })
  it('throws after a fatal error and marks it', () => {
    const d = new Diags()
    expect(() => d.fatal(at, M.cannotOpen('math.io'))).toThrow(FatalError)
    expect(d.list[0]).toMatchObject({ severity: 'error', code: '1965', message: 'cannot open source file "math.io"', fatal: true })
  })
  it('reports end-of-source problems without a line', () => {
    const d = new Diags()
    d.error({ file: 'C:/p/main.c', line: 0, col: 0 }, M.expected('}'))
    expect(d.list[0]).toMatchObject({ line: null, code: '68', message: 'expected a "}"' })
  })
})
```

```ts path=tests/unit/interp/lexer.test.ts
import { describe, expect, it } from 'vitest'
import { tokenize } from '../../../src/interp/frontend/lexer'

const kinds = (src: string): [string, string][] => tokenize(src, 'f.c').map((t) => [t.kind, t.text])

describe('tokenize', () => {
  it('splits identifiers, numbers, strings, characters and punctuators', () => {
    expect(kinds('int x=0x1F+.5e-3;s="a\\"b";c=\'\\n\';')).toEqual([
      ['ident', 'int'], ['ident', 'x'], ['punct', '='], ['number', '0x1F'], ['punct', '+'], ['number', '.5e-3'], ['punct', ';'],
      ['ident', 's'], ['punct', '='], ['string', '"a\\"b"'], ['punct', ';'],
      ['ident', 'c'], ['punct', '='], ['char', "'\\n'"], ['punct', ';'], ['eof', '']
    ])
  })
  it('takes the longest punctuator', () => {
    expect(kinds('a<<=b->c...d##e').map((k) => k[1])).toEqual(['a', '<<=', 'b', '->', 'c', '...', 'd', '##', 'e', ''])
  })
  it('tracks lines, columns, line starts and spacing through comments and CRLF', () => {
    const t = tokenize('a /* x\r\n y */ b\r\n// c\r\n  d', 'f.c')
    expect(t.map((x) => [x.text, x.line, x.col, x.bol, x.space])).toEqual([
      ['a', 1, 1, true, false],
      ['b', 2, 7, false, true],
      ['d', 4, 3, true, true],
      ['', 0, 0, true, false]
    ])
  })
  it('splices backslash-newlines and keeps later line numbers right', () => {
    const t = tokenize('#define X 1 + \\\n 2\nY', 'f.c')
    expect(t.map((x) => [x.text, x.line])).toEqual([['#', 1], ['define', 1], ['X', 1], ['1', 1], ['+', 1], ['2', 2], ['Y', 3], ['', 0]])
  })
  it('flags an unterminated quote and a stray character for later reporting', () => {
    const t = tokenize('s = "abc\n@', 'f.c')
    expect(t[2]).toMatchObject({ kind: 'string', text: '"abc', bad: '8' })
    expect(t[3]).toMatchObject({ kind: 'other', text: '@', bad: '7', line: 2 })
  })
  it('reads L-prefixed literals and pp-numbers with signs in exponents', () => {
    expect(kinds("L'a' L\"w\" 1e+5f 0x1p-3 3x")).toEqual([
      ['char', "L'a'"], ['string', 'L"w"'], ['number', '1e+5f'], ['number', '0x1p-3'], ['number', '3x'], ['eof', '']
    ])
  })
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/diag.test.ts tests/unit/interp/lexer.test.ts`
Expected: FAIL, because the modules `diag` and `lexer` do not exist.

- [ ] **Step 4: Implement the diagnostics sink and catalogue**

```ts path=src/interp/frontend/diag.ts
import type { Diagnostic } from '@shared/build'

/** A position in a source file (1-based). line 0 means "at end of source". */
export interface Loc {
  file: string
  line: number
  col: number
}

/** A cl6x diagnostic number (with -D when discretionary) and its text. */
export type Msg = readonly [code: string, text: string]

export interface FrontDiagnostic extends Diagnostic {
  /** Catastrophic: compilation stopped here (cl6x prints "fatal error"). */
  fatal?: boolean
}

/** Thrown after a fatal diagnostic; ends the translation unit. */
export class FatalError extends Error {}

/** Numbers cl6x treats as remarks unless promoted with --diag_warning (CCS promotes 225). */
const REMARKS = new Set(['225'])

export class Diags {
  readonly list: FrontDiagnostic[] = []
  private readonly promoted: Set<string>

  constructor(diagWarnings: readonly string[] = []) {
    this.promoted = new Set(diagWarnings)
  }

  get errors(): number {
    return this.list.filter((d) => d.severity === 'error').length
  }

  error(at: Loc, [code, text]: Msg): void {
    this.push(at, 'error', code, text)
  }

  warning(at: Loc, [code, text]: Msg): void {
    const n = code.replace(/-D$/, '')
    if (REMARKS.has(n) && !this.promoted.has(n)) return
    this.push(at, 'warning', code, text)
  }

  fatal(at: Loc, [code, text]: Msg): never {
    this.push(at, 'error', code, text).fatal = true
    throw new FatalError(text)
  }

  private push(at: Loc, severity: 'error' | 'warning', code: string, message: string): FrontDiagnostic {
    const d: FrontDiagnostic = { file: at.file, line: at.line > 0 ? at.line : null, severity, code, message }
    this.list.push(d)
    return d
  }
}

const EXPECTED = { ')': '18', ']': '17', '(': '126', ';': '66', '}': '68', '{': '131', ',': '255', ':': '54' } as const
export type Punct = keyof typeof EXPECTED

const dis = (d: boolean, n: string): string => (d ? `${n}-D` : n)

/** cl6x 8.3 diagnostics: number and exact text, checked against the real compiler. */
export const M = {
  // lexical and preprocessing
  unrecognizedToken: (): Msg => ['7', 'unrecognized token'],
  missingQuote: (): Msg => ['8', 'missing closing quote'],
  unknownDirective: (): Msg => ['11-D', 'unrecognized preprocessing directive'],
  expectedFileName: (): Msg => ['13', 'expected a file name'],
  extraTextAfterNumber: (): Msg => ['19', 'extra text after expected end of number'],
  invalidOctal: (): Msg => ['24', 'invalid octal digit'],
  errorDirective: (text: string): Msg => ['35', `#error directive: ${text}`],
  ifMissing: (): Msg => ['37', 'the #if for this directive is missing'],
  endifMissing: (): Msg => ['38', 'the #endif for this directive is missing'],
  ppDivByZero: (): Msg => ['40', 'division by zero'],
  macroRedefined: (name: string, line: number): Msg => ['48-D', `incompatible redefinition of macro "${name}" (declared at line ${line})`],
  macroFewArgs: (name: string): Msg => ['55-D', `too few arguments in invocation of macro "${name}"`],
  macroManyArgs: (name: string): Msg => ['56-D', `too many arguments in invocation of macro "${name}"`],
  invalidFloat: (): Msg => ['168', 'invalid floating constant'],
  macroUnterminated: (): Msg => ['276', 'improperly terminated macro invocation'],
  warningDirective: (text: string): Msg => ['1181-D', `#warning directive: ${text}`],
  multichar: (): Msg => ['1696-D', 'multicharacter character literal (potential portability problem)'],
  cannotOpen: (name: string): Msg => ['1965', `cannot open source file "${name}"`],
  // syntax
  expected: (what: Punct): Msg => [EXPECTED[what], `expected a "${what}"`],
  expectedSemicolonD: (): Msg => ['66-D', 'expected a ";"'],
  expectedExpression: (): Msg => ['29', 'expected an expression'],
  expectedIdentifier: (): Msg => ['41', 'expected an identifier'],
  badTypeCombination: (): Msg => ['85', 'invalid combination of type specifiers'],
  expectedWhile: (): Msg => ['113', 'expected "while"'],
  expectedStatement: (): Msg => ['128', 'expected a statement'],
  // declarations
  undefinedIdent: (name: string): Msg => ['20', `identifier "${name}" is undefined`],
  notConstant: (): Msg => ['28', 'expression must have a constant value'],
  incompleteType: (): Msg => ['71', 'incomplete type is not allowed'],
  arraySizeNotPositive: (): Msg => ['95', 'the size of an array must be greater than zero'],
  redeclared: (name: string): Msg => ['102', `"${name}" has already been declared in the current scope`],
  incompatibleDecl: (decl: string, line: number): Msg => ['148', `declaration is incompatible with "${decl}" (declared at line ${line})`],
  incompatibleImplicit: (name: string, line: number): Msg => ['148', `declaration is incompatible with previous "${name}" (declared at line ${line})`],
  alreadyInitialized: (name: string): Msg => ['150', `variable "${name}" has already been initialized`],
  functionRedefined: (name: string): Msg => ['247', `function "${name}" has already been defined`],
  implicitFunction: (name: string): Msg => ['225-D', `function "${name}" declared implicitly`],
  // expressions
  integralRequired: (): Msg => ['31', 'expression must have integral type'],
  arithRequired: (): Msg => ['32', 'expression must have arithmetic type'],
  divByZero: (): Msg => ['40-D', 'division by zero'],
  arithOrPointerRequired: (): Msg => ['42', 'expression must have arithmetic or pointer type'],
  incompatibleOperands: (a: string, b: string, d: boolean): Msg => [dis(d, '43'), `operand types are incompatible ("${a}" and "${b}")`],
  pointerRequired: (): Msg => ['45', 'expression must have pointer type'],
  signChange: (): Msg => ['69-D', 'integer conversion resulted in a change of sign'],
  truncation: (): Msg => ['70-D', 'integer conversion resulted in truncation'],
  derefNonPointer: (): Msg => ['76', 'operand of "*" must be a pointer'],
  notCallable: (): Msg => ['110', 'expression preceding parentheses of apparent call must have (pointer-to-) function type'],
  noField: (kind: 'struct' | 'union', tag: string, field: string): Msg => ['137', `${kind} "${tag}" has no field "${field}"`],
  notModifiable: (d: boolean): Msg => [dis(d, '138'), 'expression must be a modifiable lvalue'],
  registerAddress: (): Msg => ['139-D', 'taking the address of a register variable is not allowed'],
  tooManyArgs: (): Msg => ['141', 'too many arguments in function call'],
  pointerToObjectRequired: (): Msg => ['143', 'expression must have pointer-to-object type'],
  structRequired: (): Msg => ['156', 'expression must have struct or union type'],
  lvalueRequired: (): Msg => ['160', 'expression must be an lvalue or a function designator'],
  tooFewArgs: (): Msg => ['167', 'too few arguments in function call'],
  invalidConversion: (): Msg => ['173', 'invalid type conversion'],
  subscriptRange: (): Msg => ['177-D', 'subscript out of range'],
  voidPointerArith: (): Msg => ['1219-D', 'arithmetic on pointer to void or function type'],
  // conversions: an error, or the -D warning when only discretionary
  badReturn: (d: boolean): Msg => [dis(d, '121'), 'return value type does not match the function type'],
  badInit: (from: string, to: string, d: boolean): Msg => [dis(d, '145'), `a value of type "${from}" cannot be used to initialize an entity of type "${to}"`],
  badArg: (from: string, to: string, d: boolean): Msg => [dis(d, '169'), `argument of type "${from}" is incompatible with parameter of type "${to}"`],
  badAssign: (from: string, to: string, d: boolean): Msg => [dis(d, '515'), `a value of type "${from}" cannot be assigned to an entity of type "${to}"`],
  // statements
  labelUndefined: (name: string): Msg => ['115', `label "${name}" was referenced but not defined`],
  continueOutside: (): Msg => ['116', 'a continue statement may only be used within a loop'],
  breakOutside: (): Msg => ['117', 'a break statement may only be used within a loop or switch'],
  returnValueMissing: (fn: string): Msg => ['118-D', `non-void function "${fn}" should return a value`],
  caseOutside: (): Msg => ['122', 'a case label may only be used within a switch'],
  defaultOutside: (): Msg => ['123', 'a default label may only be used within a switch'],
  duplicateDefault: (): Msg => ['125', 'default label has already appeared in this switch'],
  labelRedefined: (name: string): Msg => ['249', `label "${name}" has already been defined`],
  duplicateCase: (line: number): Msg => ['1851', `case label value has already appeared in this switch at line ${line}`],
  // initialisers
  braceExpected: (): Msg => ['522-D', 'initialization with "{...}" expected for aggregate object'],
  excessInit: (): Msg => ['1238-D', 'excess initializers are ignored'],
  stringTooLong: (): Msg => ['2097-D', 'string literal too long -- excess characters ignored'],
  // usage
  unreferenced: (name: string): Msg => ['179-D', `variable "${name}" was declared but never referenced`],
  setNotUsed: (name: string): Msg => ['552-D', `variable "${name}" was set but never used`],
  // LabSim's own limits
  unsupported: (what: string): Msg => ['LABSIM', `LabSim: unsupported construct ${what}`]
}
```

- [ ] **Step 5: Implement the lexer**

```ts path=src/interp/frontend/lexer.ts
import type { Loc } from './diag'

export type TokenKind = 'ident' | 'number' | 'char' | 'string' | 'punct' | 'other' | 'eof'

export interface Token {
  kind: TokenKind
  text: string
  file: string
  /** 1-based; 0 for the end-of-file token. */
  line: number
  col: number
  /** Whitespace or a comment comes before the token. */
  space: boolean
  /** First token of its source line (a '#' here starts a directive). */
  bol: boolean
  /** Macros that must not expand this token again (the C standard's hide set). */
  hide?: ReadonlySet<string>
  /** Lexical error, reported only if the token survives preprocessing: 7 unrecognized token, 8 missing quote. */
  bad?: '7' | '8'
  /** Stands for an empty macro argument next to ##. */
  placemarker?: boolean
}

export const loc = (t: Token): Loc => ({ file: t.file, line: t.line, col: t.col })

const PUNCT3 = new Set(['...', '<<=', '>>='])
const PUNCT2 = new Set(['->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=', '##'])
const PUNCT1 = new Set('[](){}.&*+-~!/%<>^|?:;=,#'.split(''))

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const isIdStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_')
const isIdChar = (c: string | undefined): boolean => isIdStart(c) || isDigit(c)

/** Splits C source into preprocessing tokens. Backslash-newlines are spliced and comments become whitespace. */
export function tokenize(source: string, file: string): Token[] {
  // Translation phases 1-2, remembering where each remaining character came from.
  const text = source.replace(/\r\n?/g, '\n')
  const chars: string[] = []
  const lines: number[] = []
  const cols: number[] = []
  let line = 1
  let col = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\' && text[i + 1] === '\n') {
      i++
      line++
      col = 1
      continue
    }
    chars.push(c)
    lines.push(line)
    cols.push(col)
    if (c === '\n') {
      line++
      col = 1
    } else col++
  }
  const s = chars.join('')

  const out: Token[] = []
  let bol = true
  let space = false
  let i = 0
  const push = (kind: TokenKind, start: number, bad?: '7' | '8'): void => {
    const t: Token = { kind, text: s.slice(start, i), file, line: lines[start], col: cols[start], space, bol }
    if (bad) t.bad = bad
    out.push(t)
    bol = false
    space = false
  }

  while (i < s.length) {
    const c = s[i]
    if (c === '\n') {
      i++
      bol = true
      space = false
      continue
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i++
      space = true
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      space = true
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end < 0 ? s.length : end + 2
      space = true
      continue
    }
    const start = i
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
      i++
      while (i < s.length) {
        const d = s[i]
        if ((d === '+' || d === '-') && 'eEpP'.includes(s[i - 1])) i++
        else if (isIdChar(d) || d === '.') i++
        else break
      }
      push('number', start)
      continue
    }
    if (c === '"' || c === "'" || (c === 'L' && (s[i + 1] === '"' || s[i + 1] === "'"))) {
      const quote = c === 'L' ? s[i + 1] : c
      i += c === 'L' ? 2 : 1
      let closed = false
      while (i < s.length && s[i] !== '\n') {
        if (s[i] === '\\' && i + 1 < s.length && s[i + 1] !== '\n') {
          i += 2
          continue
        }
        if (s[i++] === quote) {
          closed = true
          break
        }
      }
      push(quote === '"' ? 'string' : 'char', start, closed ? undefined : '8')
      continue
    }
    if (isIdStart(c)) {
      while (isIdChar(s[i])) i++
      push('ident', start)
      continue
    }
    if (PUNCT3.has(s.slice(i, i + 3))) i += 3
    else if (PUNCT2.has(s.slice(i, i + 2))) i += 2
    else if (PUNCT1.has(c)) i++
    else {
      i++
      push('other', start, '7')
      continue
    }
    push('punct', start)
  }
  out.push({ kind: 'eof', text: '', file, line: 0, col: 0, space: false, bol: true })
  return out
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run tests/unit/interp/diag.test.ts tests/unit/interp/lexer.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add tsconfig.node.json src/interp tests/unit/interp
git commit -m "feat(interp): cl6x diagnostic catalogue and C lexer"
```

---
### Task 2: Literals, built-in headers and the preprocessor

**Files:**
- Create: `src/interp/frontend/literals.ts`, `src/interp/frontend/headers.ts`, `src/interp/frontend/ppexpr.ts`, `src/interp/frontend/preprocessor.ts`
- Create: `tests/fixtures/ti/headers.ppm`, generated with cl6x
- Test: `tests/unit/interp/literals.test.ts`, `tests/unit/interp/preprocessor.test.ts`, `tests/unit/interp/headers.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `Diags`, `M`, `Loc`, `FatalError`
  - `Token`, `tokenize`, `loc`
- Produces:
  - `parseNumber(text): NumberLiteral`, a union of:
    - `{kind:'int', value, unsigned, longs, decimal}`
    - `{kind:'float', value, suffix}`
    - `{kind:'error', error:'octal'|'float'|'extra'}`
  - `parseChar(text): {value, chars, wide}` and `parseString(text): {units, wide}`
  - `BUILTIN_DIR = '<builtin>'`, `PRELUDE`, `BUILTIN_HEADERS: Record<string, string>`
  - `evalPpExpr(tokens, diags, at): boolean`
  - `preprocess(mainFile, opts: PreprocessOptions, diags): PreprocessResult {tokens, pragmas, macros, files}`
  - `Macro {name, params, variadic, body, loc, origin}` and `Pragma {name, text, loc}`
  - `isBuiltinFile(file)`, `builtinHeaderPath(name)`
  - `PreprocessOptions {readFile(file): string|null, includePaths, defines, dialect, now?}`

- [ ] **Step 1: Generate the TI macro reference fixture**

This needs cl6x. It records every macro TI's own headers define, with their values:

```bash
mkdir -p tests/fixtures/ti
CGT=/c/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12
T=$(mktemp -d)
printf '#include <assert.h>\n#include <ctype.h>\n#include <errno.h>\n#include <float.h>\n#include <limits.h>\n#include <math.h>\n#include <stdarg.h>\n#include <stdbool.h>\n#include <stddef.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <time.h>\n#include <c6x.h>\nint main(void){return 0;}\n' > $T/all.c
(cd $T && $CGT/bin/cl6x -mv6740 --include_path=$CGT/include --define=c6748 --preproc_macros=all.ppm all.c)
cp $T/all.ppm tests/fixtures/ti/headers.ppm
grep -c 'Predefined' tests/fixtures/ti/headers.ppm
```

Expected: 688 lines in the file, 59 of them marked `/* Predefined */`.

- [ ] **Step 2: Write the failing tests**

```ts path=tests/unit/interp/literals.test.ts
import { describe, expect, it } from 'vitest'
import { parseChar, parseNumber, parseString } from '../../../src/interp/frontend/literals'

describe('parseNumber', () => {
  it('decodes integer constants with their radix and suffix', () => {
    expect(parseNumber('42')).toEqual({ kind: 'int', value: 42n, unsigned: false, longs: 0, decimal: true })
    expect(parseNumber('0x1Fu')).toEqual({ kind: 'int', value: 31n, unsigned: true, longs: 0, decimal: false })
    expect(parseNumber('017')).toMatchObject({ value: 15n, decimal: false })
    expect(parseNumber('0b101')).toMatchObject({ value: 5n })
    expect(parseNumber('10UL')).toMatchObject({ value: 10n, unsigned: true, longs: 1 })
    expect(parseNumber('5ll')).toMatchObject({ longs: 2 })
    expect(parseNumber('0')).toMatchObject({ value: 0n })
  })
  it('decodes floating constants, rounding f-suffixed ones to single precision', () => {
    expect(parseNumber('1.5f')).toEqual({ kind: 'float', value: 1.5, suffix: 'f' })
    expect(parseNumber('0.1f')).toMatchObject({ value: Math.fround(0.1) })
    expect(parseNumber('1e3')).toEqual({ kind: 'float', value: 1000, suffix: '' })
    expect(parseNumber('.5L')).toEqual({ kind: 'float', value: 0.5, suffix: 'l' })
    expect(parseNumber('2.')).toMatchObject({ value: 2 })
    expect(parseNumber('0x1p-3')).toMatchObject({ value: 0.125 })
  })
  it('classifies the errors cl6x reports', () => {
    expect(parseNumber('08')).toEqual({ kind: 'error', error: 'octal' })
    expect(parseNumber('1.0e')).toEqual({ kind: 'error', error: 'float' })
    expect(parseNumber('3x')).toEqual({ kind: 'error', error: 'extra' })
    expect(parseNumber('1uu')).toEqual({ kind: 'error', error: 'extra' })
  })
})

describe('parseChar and parseString', () => {
  it('decodes escapes; plain char is signed on the C6000', () => {
    expect(parseChar("'a'")).toEqual({ value: 97, chars: 1, wide: false })
    expect(parseChar("'\\n'").value).toBe(10)
    expect(parseChar("'\\xff'").value).toBe(-1)
    expect(parseChar("'\\377'").value).toBe(-1)
    expect(parseChar("'\\0'").value).toBe(0)
    expect(parseChar("'ab'")).toEqual({ value: 0x6162, chars: 2, wide: false })
    expect(parseChar("L'a'")).toEqual({ value: 97, chars: 1, wide: true })
  })
  it('decodes strings into bytes, UTF-8 for non-ASCII', () => {
    expect(parseString('"a\\tb\\0c"').units).toEqual([97, 9, 98, 0, 99])
    expect(parseString('"\\x41\\101\\"\\\\"').units).toEqual([65, 65, 34, 92])
    expect(parseString('"°"').units).toEqual([0xc2, 0xb0])
    expect(parseString('"abc').units).toEqual([97, 98, 99])
  })
})
```

```ts path=tests/unit/interp/preprocessor.test.ts
import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { Diags, FatalError } from '../../../src/interp/frontend/diag'
import { isBuiltinFile, preprocess, type PreprocessOptions } from '../../../src/interp/frontend/preprocessor'

const P = (f: string): string => path.resolve('/proj', f)
const NOW = new Date(2026, 8, 23, 12, 40, 11)

function pp(files: Record<string, string>, extra: Partial<PreprocessOptions> = {}) {
  const diags = new Diags(['225'])
  const full = Object.fromEntries(Object.entries(files).map(([k, v]) => [path.isAbsolute(k) ? k : P(k), v]))
  const r = preprocess(P('main.c'), { readFile: (f) => full[f] ?? null, includePaths: [], defines: ['c6748'], dialect: 'c89', now: NOW, ...extra }, diags)
  const text = r.tokens.filter((t) => t.kind !== 'eof' && !isBuiltinFile(t.file)).map((t) => t.text).join(' ')
  const codes = diags.list.map((d) => `${d.line ?? 'end'}:${d.code}`)
  return { r, text, codes, diags }
}

describe('macro expansion', () => {
  it('expands object-like and function-like macros', () => {
    const { text, codes } = pp({ 'main.c': '#define N 8\n#define SQ(x) ((x)*(x))\nint a[N]; int b = SQ(N+1);' })
    expect(text).toBe('int a [ 8 ] ; int b = ( ( 8 + 1 ) * ( 8 + 1 ) ) ;')
    expect(codes).toEqual([])
  })
  it('stops recursion with hide sets (C standard example)', () => {
    expect(pp({ 'main.c': '#define f(a) a*g\n#define g(a) f(a)\nf(2)(9)' }).text).toBe('2 * 9 * g')
    expect(pp({ 'main.c': '#define x x+1\nx' }).text).toBe('x + 1')
  })
  it('stringizes and pastes, with empty arguments as placemarkers', () => {
    const src = '#define STR(x) #x\n#define CAT(a,b) a##b\nconst char *s = STR(a "b\\n"); int CAT(x,1) = 1; int CAT(,y) = 2;'
    expect(pp({ 'main.c': src }).text).toBe('const char * s = "a \\"b\\\\n\\"" ; int x1 = 1 ; int y = 2 ;')
  })
  it('supports variadic macros and arguments spanning lines', () => {
    const src = '#define P(fmt, ...) printf(fmt, __VA_ARGS__)\nP("%d %d",\n  1, 2);'
    expect(pp({ 'main.c': src }).text).toBe('printf ( "%d %d" , 1 , 2 ) ;')
  })
  it('gives expanded tokens the line of the invocation', () => {
    const { r } = pp({ 'main.c': '#define ZERO \\\n 0\nint x =\nZERO;' })
    const zero = r.tokens.find((t) => t.text === '0')
    expect(zero?.line).toBe(4)
  })
  it('reports argument-count problems and unterminated invocations', () => {
    expect(pp({ 'main.c': '#define F(a,b) a+b\nint x = F(1);' }).codes).toEqual(['2:55-D'])
    expect(pp({ 'main.c': '#define F(a) a\nint x = F(1,2);' }).codes).toEqual(['2:56-D'])
    expect(pp({ 'main.c': '#define F(a) a\nint x = F(1;' }).codes).toEqual(['2:276'])
  })
  it('warns about an incompatible redefinition but not an identical one', () => {
    expect(pp({ 'main.c': '#define X 1\n#define X 1\n#define X 2\nX' }).codes).toEqual(['3:48-D'])
  })
})

describe('conditional compilation', () => {
  it('evaluates #if, #elif, #else, defined and skips inactive groups entirely', () => {
    const src = '#define N 3\n#if defined(c6748) && N > 2\nA\n#elif 1\nB\n#else\nC\n#endif\n#ifdef NOPE\n#bogus\n#if 1/0\n#endif\n"unterminated\n#else\nD\n#endif\n#ifndef NOPE\nE\n#endif'
    const { text, codes } = pp({ 'main.c': src })
    expect(text).toBe('A D E')
    expect(codes).toEqual([])
  })
  it('uses 64-bit arithmetic and unsigned rules', () => {
    expect(pp({ 'main.c': '#if -1 > 0u\nU\n#endif\n#if (1 << 40) > 0\nW\n#endif\n#if \'A\' == 65\nC\n#endif' }).text).toBe('U W C')
  })
  it('reports cl6x errors for broken conditionals', () => {
    expect(pp({ 'main.c': '#if 1\nint x;' }).codes).toEqual(['1:38'])
    expect(pp({ 'main.c': '#endif\nint x;' }).codes).toEqual(['1:37'])
    expect(pp({ 'main.c': '#else\n#endif' }).codes).toEqual(['1:37', '2:37'])
    expect(pp({ 'main.c': '#if 1 +\n#endif' }).codes).toEqual(['1:29'])
    expect(pp({ 'main.c': '#if 1/0\n#endif' }).codes).toEqual(['1:40'])
  })
})

describe('directives', () => {
  it('includes project headers relative to the including file, then include paths, then built-ins', () => {
    const { text, r } = pp(
      {
        'main.c': '#include "coef.h"\n#include <shared.h>\n#include <stdbool.h>\nbool ok = true; int n = NTAPS + SHARED;',
        'coef.h': '#include "tmwtypes.h"\n#define NTAPS 51',
        'tmwtypes.h': 'typedef double real64_T;',
        [path.resolve('/inc/shared.h')]: '#pragma once\n#define SHARED 2'
      },
      { includePaths: [path.resolve('/inc')] }
    )
    expect(text).toBe('typedef double real64_T ; _Bool ok = 1 ; int n = 51 + 2 ;')
    expect(r.files).toEqual([P('main.c'), P('coef.h'), P('tmwtypes.h'), path.resolve('/inc/shared.h')])
  })
  it('honours #pragma once and include guards', () => {
    const files = { 'main.c': '#include "a.h"\n#include "a.h"\n#include "g.h"\n#include "g.h"', 'a.h': '#pragma once\nA', 'g.h': '#ifndef G\n#define G\nG1\n#endif' }
    expect(pp(files).text).toBe('A G1')
  })
  it('stops with fatal #1965 for a missing header, like cl6x', () => {
    const diags = new Diags()
    const opts = { readFile: (f: string) => (f === P('main.c') ? '#include <math.io>\nint main(void){return 0;}' : null), includePaths: [], defines: [], dialect: 'c89' as const }
    expect(() => preprocess(P('main.c'), opts, diags)).toThrow(FatalError)
    expect(diags.list).toEqual([{ file: P('main.c'), line: 1, severity: 'error', code: '1965', message: 'cannot open source file "math.io"', fatal: true }])
  })
  it('reports #error as fatal, #warning and unknown directives', () => {
    expect(() => pp({ 'main.c': '#error stop here\nint x;' })).toThrow(FatalError)
    expect(pp({ 'main.c': '#warning careful\n#foo\nint x;' }).codes).toEqual(['1:1181-D', '2:11-D'])
  })
  it('records pragmas, including _Pragma, and removes them from the token stream', () => {
    const { text, r } = pp({ 'main.c': '#pragma DATA_ALIGN(x, 8)\nint x;\n_Pragma("MUST_ITERATE(4)") int y;' })
    expect(text).toBe('int x ; int y ;')
    expect(r.pragmas.map((p) => [p.name, p.text, p.loc.line])).toEqual([['DATA_ALIGN', '(x, 8)', 1], ['MUST_ITERATE', '(4)', 3]])
  })
  it('applies #line', () => {
    const { r } = pp({ 'main.c': '#line 100 "orig.c"\nfoo' })
    expect(r.tokens.find((t) => t.text === 'foo')).toMatchObject({ line: 100, file: 'orig.c' })
  })
  it('reports lexical errors once, and only outside skipped groups', () => {
    expect(pp({ 'main.c': '#if 0\n"abc\n@\n#endif\nint @;\nchar *s = "x' }).codes).toEqual(['5:7', '6:8'])
  })
})

describe('predefined macros', () => {
  it('match cl6x -mv6740 in C89 and C99 mode', () => {
    const src = '__TI_COMPILER_VERSION__ __STDC_VERSION__ _TMS320C6740 __DATE__ __TIME__ __LINE__ c6748 __STDC__ __TI_EABI__'
    expect(pp({ 'main.c': src }).text).toBe('8003012 199409L 1 "Sep 23 2026" "12:40:11" 1 1 1 1')
    expect(pp({ 'main.c': '__STDC_VERSION__' }, { dialect: 'c99' }).text).toBe('199901L')
  })
  it('takes --define values', () => {
    expect(pp({ 'main.c': 'USE_Q15 EMPTY' }, { defines: ['USE_Q15=1', 'EMPTY='] }).text).toBe('1')
  })
})
```

```ts path=tests/unit/interp/headers.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Diags } from '../../../src/interp/frontend/diag'
import { BUILTIN_HEADERS, PRELUDE } from '../../../src/interp/frontend/headers'
import { tokenize } from '../../../src/interp/frontend/lexer'
import { isBuiltinFile, preprocess, type Macro } from '../../../src/interp/frontend/preprocessor'

interface TiMacro { params: string[] | null; body: string[]; predefined: boolean }

function parsePpm(text: string): Map<string, TiMacro> {
  const out = new Map<string, TiMacro>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^#define (\w+)(\(([^)]*)\))?(?: (.*?))?(?:\t\/\* (.*) \*\/)?$/.exec(line)
    if (!m) continue
    const params = m[2] ? m[3].split(',').map((p) => p.trim()).filter(Boolean) : null
    const body = tokenize(m[4] ?? '', 'ti').filter((t) => t.kind !== 'eof').map((t) => t.text)
    out.set(m[1], { params, body, predefined: m[5] === undefined || m[5] === 'Predefined' })
  }
  return out
}

const TI = parsePpm(readFileSync(join(__dirname, '../../fixtures/ti/headers.ppm'), 'utf8'))
const SUPPORTED = Object.keys(BUILTIN_HEADERS).filter((h) => h !== PRELUDE && !BUILTIN_HEADERS[h].includes('#error'))

function ours(): Map<string, Macro> {
  const src = SUPPORTED.map((h) => `#include <${h}>`).join('\n')
  const diags = new Diags()
  const r = preprocess('/t/all.c', { readFile: (f) => (f === '/t/all.c' ? src : null), includePaths: [], defines: ['c6748'], dialect: 'c89' }, diags)
  expect(diags.list).toEqual([])
  return r.macros
}

/** Macros LabSim defines differently on purpose, because TI's versions call compiler internals. */
const DELIBERATE = new Set(['va_start', 'va_arg', 'offsetof', 'signbit', 'CLOCKS_PER_SEC'])

describe('built-in headers', () => {
  it('predefine exactly the macros cl6x -mv6740 predefines, with the same values', () => {
    const mine = [...ours().values()].filter((m) => m.origin !== 'source')
    const tiNames = [...TI].filter(([, m]) => m.predefined).map(([n]) => n)
    expect(mine.map((m) => m.name).sort()).toEqual(tiNames.sort())
    for (const m of mine) {
      if (m.name === '__DATE__' || m.name === '__TIME__') continue
      expect([m.name, m.body.map((t) => t.text)]).toEqual([m.name, TI.get(m.name)?.body])
    }
  })
  it('give every macro they share with TI the same parameters and body', () => {
    const mismatches: string[] = []
    for (const m of ours().values()) {
      if (m.origin !== 'source' || !isBuiltinFile(m.loc.file) || DELIBERATE.has(m.name)) continue
      const ti = TI.get(m.name)
      if (!ti) continue
      const same = JSON.stringify(ti.params) === JSON.stringify(m.params) && ti.body.join(' ') === m.body.map((t) => t.text).join(' ')
      if (!same) mismatches.push(`${m.name}: TI ${ti.body.join(' ')} / LabSim ${m.body.map((t) => t.text).join(' ')}`)
    }
    expect(mismatches).toEqual([])
  })
  it('define the macros lab programs use', () => {
    const m = ours()
    for (const name of ['M_PI', 'M_SQRT2', 'HUGE_VAL', 'RAND_MAX', 'EOF', 'NULL', 'stdout', 'INT_MAX', 'UINT_MAX', 'CHAR_BIT', 'FLT_EPSILON', 'DBL_MAX', 'INT32_MAX', 'UINT16_MAX', 'bool', 'true', 'assert', 'EXIT_SUCCESS', 'SEEK_SET', '_IONBF']) {
      expect(m.has(name), name).toBe(true)
    }
  })
  it('reject unsupported standard headers with a clear #error', () => {
    expect(BUILTIN_HEADERS['complex.h']).toContain('#error LabSim does not support <complex.h>')
  })
})
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/literals.test.ts tests/unit/interp/preprocessor.test.ts tests/unit/interp/headers.test.ts`
Expected: FAIL, because the modules `literals`, `preprocessor` and `headers` do not exist.

- [ ] **Step 4: Implement literal decoding**

```ts path=src/interp/frontend/literals.ts
/** A pp-number decoded, before C typing (which depends on its value and the dialect). */
export type NumberLiteral =
  | { kind: 'int'; value: bigint; unsigned: boolean; longs: 0 | 1 | 2; decimal: boolean }
  | { kind: 'float'; value: number; suffix: '' | 'f' | 'l' }
  | { kind: 'error'; error: 'octal' | 'float' | 'extra' }

const INT_RE = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uU]?(?:ll|LL|[lL])?[uU]?)$/
const DEC_FLOAT_RE = /^([0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?)([fFlL]?)$/
const HEX_FLOAT_RE = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?[0-9]+)([fFlL]?)$/

function parseFloating(text: string, hex: boolean): NumberLiteral {
  const bad: NumberLiteral = { kind: 'error', error: 'float' }
  let value: number
  let suffix: string
  if (hex) {
    const m = HEX_FLOAT_RE.exec(text)
    if (!m || (!m[1] && !m[2])) return bad
    const frac = m[2] ?? ''
    value = (parseInt((m[1] || '') + frac || '0', 16) / 16 ** frac.length) * 2 ** Number(m[3])
    suffix = m[4]
  } else {
    const m = DEC_FLOAT_RE.exec(text)
    if (!m || !/[0-9]/.test(m[1].split(/[eE]/)[0])) return bad
    value = Number(m[1])
    suffix = m[2]
  }
  const s = suffix.toLowerCase() as '' | 'f' | 'l'
  return { kind: 'float', value: s === 'f' ? Math.fround(value) : value, suffix: s }
}

export function parseNumber(text: string): NumberLiteral {
  const hex = /^0[xX]/.test(text)
  const binary = /^0[bB]/.test(text)
  if (hex ? /[.pP]/.test(text) : !binary && /[.eE]/.test(text)) return parseFloating(text, hex)
  const m = INT_RE.exec(text)
  if (!m || (m[2].match(/u/gi)?.length ?? 0) > 1) return { kind: 'error', error: 'extra' }
  const digits = m[1]
  const octal = !hex && !binary && digits.length > 1 && digits[0] === '0'
  if (octal && /[89]/.test(digits)) return { kind: 'error', error: 'octal' }
  const value = octal ? BigInt('0o' + digits.slice(1)) : BigInt(digits)
  const suffix = m[2].toLowerCase()
  return {
    kind: 'int',
    value,
    unsigned: suffix.includes('u'),
    longs: suffix.includes('ll') ? 2 : suffix.includes('l') ? 1 : 0,
    decimal: !hex && !binary && !octal
  }
}

const SIMPLE: Record<string, number> = { n: 10, t: 9, v: 11, b: 8, r: 13, f: 12, a: 7, '\\': 92, "'": 39, '"': 34, '?': 63 }
const encoder = new TextEncoder()

/** Decodes the inside of a character constant or string literal: bytes (UTF-8) for narrow, 16-bit units for wide. */
function decodeEscapes(body: string, wide: boolean): number[] {
  const mask = wide ? 0xffff : 0xff
  const out: number[] = []
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') {
      const code = body.codePointAt(i) as number
      if (code > 0xffff) i++
      if (code < 0x80 || wide) out.push(code & 0xffff)
      else out.push(...encoder.encode(String.fromCodePoint(code)))
      continue
    }
    const e = body[++i]
    if (e === undefined) break
    if (e in SIMPLE) out.push(SIMPLE[e])
    else if (e >= '0' && e <= '7') {
      let v = 0
      let n = 0
      while (n < 3 && body[i] >= '0' && body[i] <= '7') {
        v = v * 8 + Number(body[i])
        i++
        n++
      }
      i--
      out.push(v & mask)
    } else if (e === 'x') {
      let v = 0
      while (/[0-9a-fA-F]/.test(body[i + 1] ?? '')) v = (v * 16 + parseInt(body[++i], 16)) % 0x100000000
      out.push(v & mask)
    } else out.push(e.charCodeAt(0) & mask)
  }
  return out
}

function inside(text: string, quote: string): { body: string; wide: boolean } {
  const wide = text.startsWith('L')
  const open = wide ? 2 : 1
  const closed = text.length > open && text.endsWith(quote)
  return { body: text.slice(open, closed ? -1 : undefined), wide }
}

export interface CharLiteral {
  value: number
  chars: number
  wide: boolean
}

export function parseChar(text: string): CharLiteral {
  const { body, wide } = inside(text, "'")
  const units = decodeEscapes(body, wide)
  if (wide) return { value: units[0] ?? 0, chars: units.length, wide }
  if (units.length <= 1) {
    const b = units[0] ?? 0
    return { value: b >= 128 ? b - 256 : b, chars: units.length, wide }
  }
  let v = 0
  for (const b of units) v = ((v << 8) | b) | 0
  return { value: v, chars: units.length, wide }
}

export function parseString(text: string): { units: number[]; wide: boolean } {
  const { body, wide } = inside(text, '"')
  return { units: decodeEscapes(body, wide), wide }
}
```

- [ ] **Step 5: Implement the built-in headers**

```ts path=src/interp/frontend/headers.ts
/** Directory shown for LabSim's own headers, e.g. "<builtin>/stdio.h". */
export const BUILTIN_DIR = '<builtin>'

/** Read before every translation unit: cl6x knows the C6000 intrinsics without any #include. */
export const PRELUDE = '__labsim_intrinsics.h'

const SIZE_T = String.raw`#ifndef _LABSIM_SIZE_T
#define _LABSIM_SIZE_T
typedef unsigned int size_t;
#endif`

const NULL_DEF = String.raw`#ifndef NULL
#define NULL 0
#endif`

/** From TI's c6x.h (CGT 8.3), the C62x/C64x/C64x+/C674x intrinsics. */
const INTRINSICS = String.raw`unsigned _extu(unsigned, unsigned, unsigned);
int _ext(int, unsigned, unsigned);
unsigned _set(unsigned, unsigned, unsigned);
unsigned _clr(unsigned, unsigned, unsigned);
unsigned _extur(unsigned, int);
int _extr(int, int);
unsigned _setr(unsigned, int);
unsigned _clrr(unsigned, int);
int _sadd(int, int);
int _ssub(int, int);
int _sshl(int, unsigned);
int _add2(int, int);
int _sub2(int, int);
unsigned _subc(unsigned, unsigned);
unsigned _lmbd(unsigned, unsigned);
int _abs(int);
__int40_t _labs(__int40_t);
unsigned _norm(int);
int _smpy(int, int);
int _smpyhl(int, int);
int _smpylh(int, int);
int _smpyh(int, int);
int _mpy(int, int);
int _mpyus(unsigned, int);
int _mpysu(int, unsigned);
unsigned _mpyu(unsigned, unsigned);
int _mpyhl(int, int);
int _mpyhuls(unsigned, int);
int _mpyhslu(int, unsigned);
unsigned _mpyhlu(unsigned, unsigned);
int _mpylh(int, int);
int _mpyluhs(unsigned, int);
int _mpylshu(int, unsigned);
unsigned _mpylhu(unsigned, unsigned);
int _mpyh(int, int);
int _mpyhus(unsigned, int);
int _mpyhsu(int, unsigned);
unsigned _mpyhu(unsigned, unsigned);
__int40_t _lsadd(int, __int40_t);
__int40_t _lssub(int, __int40_t);
int _sat(__int40_t);
unsigned _lnorm(__int40_t);
double _fabs(double);
float _fabsf(float);
long long _mpyidll(int, int);
int _spint(float);
int _dpint(double);
float _rcpsp(float);
double _rcpdp(double);
float _rsqrsp(float);
double _rsqrdp(double);
unsigned _hi(double);
float _hif(double);
unsigned _hill(long long);
unsigned _lo(double);
float _lof(double);
unsigned _loll(long long);
double _itod(unsigned, unsigned);
double _ftod(float, float);
long long _itoll(unsigned, unsigned);
float _itof(unsigned);
unsigned _ftoi(float);
__int40_t _dtol(double);
double _ltod(__int40_t);
long long _dtoll(double);
double _lltod(long long);
int _add4(int, int);
int _avg2(int, int);
unsigned _avgu4(unsigned, unsigned);
int _cmpeq2(int, int);
int _cmpeq4(int, int);
int _cmpgt2(int, int);
unsigned _cmpgtu4(unsigned, unsigned);
int _dotp2(int, int);
int _dotpn2(int, int);
int _dotpnrsu2(int, unsigned);
int _dotprsu2(int, unsigned);
int _dotpsu4(int, unsigned);
unsigned _dotpu4(unsigned, unsigned);
int _gmpy4(int, int);
__int40_t _ldotp2(int, int);
int _max2(int, int);
unsigned _maxu4(unsigned, unsigned);
int _min2(int, int);
unsigned _minu4(unsigned, unsigned);
long long _mpy2ll(int, int);
long long _mpyhill(int, int);
int _mpyhir(int, int);
long long _mpylill(int, int);
int _mpylir(int, int);
long long _mpysu4ll(int, unsigned);
long long _mpyu4ll(unsigned, unsigned);
unsigned _pack2(unsigned, unsigned);
unsigned _packh2(unsigned, unsigned);
unsigned _packh4(unsigned, unsigned);
unsigned _packhl2(unsigned, unsigned);
unsigned _packl4(unsigned, unsigned);
unsigned _packlh2(unsigned, unsigned);
unsigned _rotl(unsigned, unsigned);
int _sadd2(int, int);
unsigned _saddu4(unsigned, unsigned);
int _saddus2(unsigned, int);
unsigned _shlmb(unsigned, unsigned);
int _shr2(int, unsigned);
unsigned _shrmb(unsigned, unsigned);
unsigned _shru2(unsigned, unsigned);
long long _smpy2ll(int, int);
int _spack2(int, int);
unsigned _spacku4(int, int);
int _sshvl(int, int);
int _sshvr(int, int);
int _sub4(int, int);
int _subabs4(int, int);
int _abs2(int);
unsigned _bitc4(unsigned);
unsigned _bitr(unsigned);
unsigned _deal(unsigned);
int _mvd(int);
unsigned _shfl(unsigned);
unsigned _swap4(unsigned);
unsigned _unpkhu4(unsigned);
unsigned _unpklu4(unsigned);
unsigned _xpnd2(unsigned);
unsigned _xpnd4(unsigned);
long long _addsub(int, int);
long long _addsub2(unsigned, unsigned);
long long _cmpy(unsigned, unsigned);
unsigned _cmpyr(unsigned, unsigned);
unsigned _cmpyr1(unsigned, unsigned);
long long _ddotph2(long long, unsigned);
unsigned _ddotph2r(long long, unsigned);
long long _ddotpl2(long long, unsigned);
unsigned _ddotpl2r(long long, unsigned);
long long _ddotp4(unsigned, unsigned);
long long _dpack2(unsigned, unsigned);
long long _dpackx2(unsigned, unsigned);
long long _dmv(unsigned, unsigned);
double _fdmv(float, float);
unsigned _gmpy(unsigned, unsigned);
long long _mpy32ll(int, int);
int _mpy32(int, int);
long long _mpy32su(int, unsigned);
long long _mpy32us(unsigned, int);
long long _mpy32u(unsigned, unsigned);
long long _mpy2ir(unsigned, int);
unsigned _rpack2(unsigned, unsigned);
long long _saddsub(int, int);
long long _saddsub2(unsigned, unsigned);
long long _shfl3(unsigned, unsigned);
int _smpy32(int, int);
int _ssub2(int, int);
unsigned _xormpy(unsigned, unsigned);
void _nassert(int);`

const CREGISTERS = [
  'AMR', 'CSR', 'IFR', 'ISR', 'ICR', 'IER', 'ISTP', 'IRP', 'NRP', 'GFPGFR', 'DIER', 'FADCR', 'FAUCR', 'FMCR', 'DESR', 'DETR',
  'REP', 'TSCL', 'TSCH', 'ARP', 'ILC', 'RILC', 'PCE1', 'DNUM', 'SSR', 'GPLYA', 'GPLYB', 'TSR', 'ITSR', 'NTSR', 'ECR', 'EFR',
  'IERR', 'DMSG', 'CMSG', 'DT_DMA_ADDR', 'DT_DMA_DATA', 'DT_DMA_CNTL', 'TCU_CNTL', 'RTDX_REC_CNTL'
]

const C6X = String.raw`#ifndef _LABSIM_C6X_H
#define _LABSIM_C6X_H
typedef double __float2_t;
${CREGISTERS.map((r) => `extern __cregister volatile unsigned int ${r};`).join('\n')}
#ifndef _cmplt2
#define _cmplt2(src1, src2) _cmpgt2((src2), (src1))
#endif
#ifndef _cmpltu4
#define _cmpltu4(src1, src2) _cmpgtu4((src2), (src1))
#endif
#ifndef _dotpnrus2
#define _dotpnrus2(src1, src2) _dotpnrsu2((src2), (src1))
#endif
#ifndef _dotpus4
#define _dotpus4(src1, src2) _dotpsu4((src2), (src1))
#endif
#ifndef _mpyihll
#define _mpyihll(src1, src2) _mpyhill((src2), (src1))
#endif
#ifndef _mpyihr
#define _mpyihr(src1, src2) _mpyhir((src2), (src1))
#endif
#ifndef _mpyilll
#define _mpyilll(src1, src2) _mpylill((src2), (src1))
#endif
#ifndef _mpyilr
#define _mpyilr(src1, src2) _mpylir((src2), (src1))
#endif
#ifndef _mpyus4ll
#define _mpyus4ll(src1, src2) _mpysu4ll((src2), (src1))
#endif
#ifndef _saddsu2
#define _saddsu2(src1, src2) _saddus2((src2), (src1))
#endif
#ifndef _swap2
#define _swap2(src) _packlh2((src), (src))
#endif
#define SAVE_AMR(temp_AMR) do { temp_AMR = AMR; AMR = 0; } while (0)
#define RESTORE_AMR(temp_AMR) do { AMR = temp_AMR; } while (0)
#define SAVE_SAT(temp_SAT) do { temp_SAT = _extu(CSR, 22, 31); } while (0)
#define RESTORE_SAT(temp_SAT) do { CSR = _clr(CSR, 9, 9); temp_SAT = _sshl(temp_SAT, 31); } while (0)
#define DATA_IS_ALIGNED_2(x) (_nassert(((unsigned int)(x) & 0x1) == 0))
#define DATA_IS_ALIGNED_4(x) (_nassert(((unsigned int)(x) & 0x3) == 0))
#define DATA_IS_ALIGNED_8(x) (_nassert(((unsigned int)(x) & 0x7) == 0))
#endif`

const MATH_1 = [
  'acos', 'asin', 'atan', 'ceil', 'cos', 'cosh', 'exp', 'fabs', 'floor', 'log', 'log10', 'sin', 'sinh', 'sqrt', 'tan', 'tanh',
  'acosh', 'asinh', 'atanh', 'cbrt', 'erf', 'erfc', 'exp2', 'expm1', 'lgamma', 'log1p', 'log2', 'logb', 'nearbyint', 'rint',
  'round', 'tgamma', 'trunc'
]
const MATH_2 = ['atan2', 'fmod', 'pow', 'copysign', 'fdim', 'fmax', 'fmin', 'hypot', 'nextafter', 'remainder']
const CLASSIFY = ['__fpclassify', '__isfinite', '__isinf', '__isnan', '__isnormal']

function mathDeclarations(): string {
  const out: string[] = []
  for (const [t, s] of [['double', ''], ['float', 'f']]) {
    for (const f of MATH_1) out.push(`${t} ${f}${s}(${t});`)
    for (const f of MATH_2) out.push(`${t} ${f}${s}(${t}, ${t});`)
    out.push(
      `${t} fma${s}(${t}, ${t}, ${t});`,
      `${t} frexp${s}(${t}, int *);`,
      `${t} ldexp${s}(${t}, int);`,
      `${t} modf${s}(${t}, ${t} *);`,
      `${t} remquo${s}(${t}, ${t}, int *);`,
      `${t} scalbn${s}(${t}, int);`,
      `${t} scalbln${s}(${t}, long);`,
      `${t} nan${s}(const char *);`,
      `int ilogb${s}(${t});`,
      `long lrint${s}(${t});`,
      `long lround${s}(${t});`,
      `long long llrint${s}(${t});`,
      `long long llround${s}(${t});`,
      `int __signbit${s}(${t});`
    )
    for (const c of CLASSIFY) out.push(`int ${c}${s}(${t});`)
  }
  for (const c of CLASSIFY) out.push(`int ${c}l(long double);`)
  return out.join('\n')
}

const HEADERS: Record<string, string> = {
  [PRELUDE]: INTRINSICS,

  'assert.h': String.raw`#ifndef _ASSERT
#define _ASSERT
void _assert(int, const char *);
#define _STR(x) __STR(x)
#define __STR(x) #x
#endif
#undef assert
#ifdef NDEBUG
#define assert(_ignore) ((void)0)
#else
#define assert(_expr) _assert((_expr) != 0, "Assertion failed, (" _STR(_expr) "), file " __FILE__ ", line " _STR(__LINE__) "\n")
#endif`,

  'ctype.h': String.raw`#ifndef _LABSIM_CTYPE_H
#define _LABSIM_CTYPE_H
int isalnum(int);
int isalpha(int);
int isascii(int);
int isblank(int);
int iscntrl(int);
int isdigit(int);
int isgraph(int);
int islower(int);
int isprint(int);
int ispunct(int);
int isspace(int);
int isupper(int);
int isxdigit(int);
int toascii(int);
int tolower(int);
int toupper(int);
#endif`,

  'errno.h': String.raw`#ifndef _LABSIM_ERRNO_H
#define _LABSIM_ERRNO_H
extern int errno;
#define EDOM 0x0021
#define ERANGE 0x0022
#define EILSEQ 0x0058
#endif`,

  'float.h': String.raw`#ifndef _LABSIM_FLOAT_H
#define _LABSIM_FLOAT_H
#define FLT_RADIX 2
#define FLT_ROUNDS 1
#define FLT_EVAL_METHOD (-1)
#define FLT_MANT_DIG 24
#define FLT_DIG 6
#define FLT_DECIMAL_DIG 9
#define FLT_MIN_EXP (-125)
#define FLT_MIN_10_EXP (-37)
#define FLT_MAX_EXP 128
#define FLT_MAX_10_EXP 38
#define FLT_EPSILON 1.192092896E-07F
#define FLT_MIN 1.175494351E-38F
#define FLT_MAX 3.402823466E+38F
#define DBL_MANT_DIG 53
#define DBL_DIG 15
#define DBL_DECIMAL_DIG 17
#define DBL_MIN_EXP (-1021)
#define DBL_MIN_10_EXP (-307)
#define DBL_MAX_EXP 1024
#define DBL_MAX_10_EXP 308
#define DBL_EPSILON 2.2204460492503131E-16
#define DBL_MIN 2.2250738585072014E-308
#define DBL_MAX 1.7976931348623157E+308
#define LDBL_MANT_DIG 53
#define LDBL_DIG 15
#define LDBL_DECIMAL_DIG 17
#define LDBL_MIN_EXP (-1021)
#define LDBL_MIN_10_EXP (-307)
#define LDBL_MAX_EXP 1024
#define LDBL_MAX_10_EXP 308
#define LDBL_EPSILON 2.2204460492503131E-16L
#define LDBL_MIN 2.2250738585072014E-308L
#define LDBL_MAX 1.7976931348623157E+308L
#define DECIMAL_DIG (LDBL_DECIMAL_DIG)
#endif`,

  'iso646.h': String.raw`#ifndef _LABSIM_ISO646_H
#define _LABSIM_ISO646_H
#define and &&
#define and_eq &=
#define bitand &
#define bitor |
#define compl ~
#define not !
#define not_eq !=
#define or ||
#define or_eq |=
#define xor ^
#define xor_eq ^=
#endif`,

  'limits.h': String.raw`#ifndef _LABSIM_LIMITS_H
#define _LABSIM_LIMITS_H
#define CHAR_BIT 8
#define SCHAR_MAX 127
#define SCHAR_MIN (-SCHAR_MAX-1)
#define UCHAR_MAX 255
#define CHAR_MAX (SCHAR_MAX)
#define CHAR_MIN (SCHAR_MIN)
#define MB_LEN_MAX 1
#define SHRT_MAX 32767
#define SHRT_MIN (-SHRT_MAX-1)
#define USHRT_MAX 65535
#define INT_MAX 2147483647
#define INT_MIN (-INT_MAX-1)
#define UINT_MAX 4294967295U
#define LONG_MAX 2147483647
#define LONG_MIN (-LONG_MAX-1)
#define ULONG_MAX 4294967295U
#define LLONG_MAX 9223372036854775807
#define LLONG_MIN (-LLONG_MAX-1)
#define ULLONG_MAX 18446744073709551615U
#endif`,

  'math.h': String.raw`#ifndef _LABSIM_MATH_H
#define _LABSIM_MATH_H
#define HUGE_VAL ((double)__INFINITY__)
#define HUGE_VALF (__INFINITY__)
#define HUGE_VALL ((long double)__INFINITY__)
#define INFINITY (__INFINITY__)
#define NAN (__NAN__)
#define FP_INFINITE 1
#define FP_NAN 2
#define FP_NORMAL 3
#define FP_ZERO 4
#define FP_SUBNORMAL 5
#define MATH_ERRNO 1
#define MATH_ERREXCEPT 2
#define math_errhandling (MATH_ERRNO)
#define M_E 2.7182818284590452354
#define M_LOG2E 1.4426950408889634074
#define M_LOG10E 0.43429448190325182765
#define M_LN2 0.69314718055994530942
#define M_LN10 2.30258509299404568402
#define M_PI 3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962
#define M_1_PI 0.31830988618379067154
#define M_2_PI 0.63661977236758134308
#define M_2_SQRTPI 1.12837916709551257390
#define M_SQRT2 1.41421356237309504880
#define M_SQRT1_2 0.70710678118654752440
#define fpclassify(x) (sizeof(x) == sizeof(double) ? __fpclassify(x) : sizeof(x) == sizeof(float) ? __fpclassifyf(x) : __fpclassifyl(x))
#define isfinite(x) (sizeof(x) == sizeof(double) ? __isfinite(x) : sizeof(x) == sizeof(float) ? __isfinitef(x) : __isfinitel(x))
#define isinf(x) (sizeof(x) == sizeof(double) ? __isinf(x) : sizeof(x) == sizeof(float) ? __isinff(x) : __isinfl(x))
#define isnan(x) (sizeof(x) == sizeof(double) ? __isnan(x) : sizeof(x) == sizeof(float) ? __isnanf(x) : __isnanl(x))
#define isnormal(x) (sizeof(x) == sizeof(double) ? __isnormal(x) : sizeof(x) == sizeof(float) ? __isnormalf(x) : __isnormall(x))
#define signbit(x) (sizeof(x) == sizeof(float) ? __signbitf(x) : __signbit(x))
#define isunordered(x,y) (isnan(x) || isnan(y))
#define isgreater(x,y) (!isunordered((x), (y)) && (x) > (y))
#define isgreaterequal(x,y) (!isunordered((x), (y)) && (x) >= (y))
#define isless(x,y) (!isunordered((x), (y)) && (x) < (y))
#define islessequal(x,y) (!isunordered((x), (y)) && (x) <= (y))
#define islessgreater(x,y) (!isunordered((x), (y)) && ((x) > (y) || (y) > (x)))
${mathDeclarations()}
#endif`,

  'stdarg.h': String.raw`#ifndef _LABSIM_STDARG_H
#define _LABSIM_STDARG_H
typedef char *va_list;
#define va_start(_ap, _parmN) __builtin_va_start(_ap, _parmN)
#define va_arg(_ap, _type) __builtin_va_arg(_ap, _type)
#define va_end(_ap) ((void)0)
#define va_copy(_dst, _src) ((_dst)=(_src))
#endif`,

  'stdbool.h': String.raw`#ifndef _LABSIM_STDBOOL_H
#define _LABSIM_STDBOOL_H
#define bool _Bool
#define true 1
#define false 0
#define __bool_true_false_are_defined 1
#endif`,

  'stddef.h': String.raw`#ifndef _LABSIM_STDDEF_H
#define _LABSIM_STDDEF_H
${SIZE_T}
typedef int ptrdiff_t;
#ifndef _LABSIM_WCHAR_T
#define _LABSIM_WCHAR_T
typedef unsigned short wchar_t;
#endif
${NULL_DEF}
#define offsetof(_type, _ident) ((size_t)&(((_type *)0)->_ident))
#endif`,

  'stdint.h': String.raw`#ifndef _LABSIM_STDINT_H
#define _LABSIM_STDINT_H
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef signed char int_least8_t;
typedef unsigned char uint_least8_t;
typedef short int_least16_t;
typedef unsigned short uint_least16_t;
typedef int int_least32_t;
typedef unsigned int uint_least32_t;
typedef long long int_least64_t;
typedef unsigned long long uint_least64_t;
typedef int int_fast8_t;
typedef unsigned int uint_fast8_t;
typedef int int_fast16_t;
typedef unsigned int uint_fast16_t;
typedef int int_fast32_t;
typedef unsigned int uint_fast32_t;
typedef long long int_fast64_t;
typedef unsigned long long uint_fast64_t;
typedef int intptr_t;
typedef unsigned int uintptr_t;
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
#define INT8_MIN (-0x7f-1)
#define INT8_MAX 0x7f
#define UINT8_MAX 0xff
#define INT16_MIN (-0x7fff-1)
#define INT16_MAX 0x7fff
#define UINT16_MAX 0xffff
#define INT32_MIN (-0x7fffffff-1)
#define INT32_MAX 0x7fffffff
#define UINT32_MAX 0xffffffffU
#define INT64_MIN (-0x7fffffffffffffffLL-1)
#define INT64_MAX 0x7fffffffffffffffLL
#define UINT64_MAX 0xffffffffffffffffULL
#define INT_LEAST8_MIN INT8_MIN
#define INT_LEAST8_MAX INT8_MAX
#define UINT_LEAST8_MAX UINT8_MAX
#define INT_LEAST16_MIN INT16_MIN
#define INT_LEAST16_MAX INT16_MAX
#define UINT_LEAST16_MAX UINT16_MAX
#define INT_LEAST32_MIN INT32_MIN
#define INT_LEAST32_MAX INT32_MAX
#define UINT_LEAST32_MAX UINT32_MAX
#define INT_LEAST64_MIN INT64_MIN
#define INT_LEAST64_MAX INT64_MAX
#define UINT_LEAST64_MAX UINT64_MAX
#define INT_FAST8_MIN INT32_MIN
#define INT_FAST8_MAX INT32_MAX
#define UINT_FAST8_MAX UINT32_MAX
#define INT_FAST16_MIN INT32_MIN
#define INT_FAST16_MAX INT32_MAX
#define UINT_FAST16_MAX UINT32_MAX
#define INT_FAST32_MIN INT32_MIN
#define INT_FAST32_MAX INT32_MAX
#define UINT_FAST32_MAX UINT32_MAX
#define INT_FAST64_MIN INT64_MIN
#define INT_FAST64_MAX INT64_MAX
#define UINT_FAST64_MAX UINT64_MAX
#define INTPTR_MIN INT32_MIN
#define INTPTR_MAX INT32_MAX
#define UINTPTR_MAX UINT32_MAX
#define INTMAX_MIN INT64_MIN
#define INTMAX_MAX INT64_MAX
#define UINTMAX_MAX UINT64_MAX
#define PTRDIFF_MIN INT32_MIN
#define PTRDIFF_MAX INT32_MAX
#define SIG_ATOMIC_MIN INT32_MIN
#define SIG_ATOMIC_MAX INT32_MAX
#define SIZE_MAX UINT32_MAX
#define RSIZE_MAX (SIZE_MAX >> 1)
#define WINT_MIN 0
#define WINT_MAX INT32_MAX
#define INT8_C(c) ((int_least8_t)(c))
#define UINT8_C(c) ((uint_least8_t)(c))
#define INT16_C(c) ((int_least16_t)(c))
#define UINT16_C(c) ((uint_least16_t)(c))
#define INT32_C(c) ((int_least32_t)(c))
#define UINT32_C(c) ((uint_least32_t)(c))
#define INT64_C(c) ((int_least64_t)(c))
#define UINT64_C(c) ((uint_least64_t)(c))
#define INTMAX_C(c) ((intmax_t)(c))
#define UINTMAX_C(c) ((uintmax_t)(c))
#endif`,

  'stdio.h': String.raw`#ifndef _LABSIM_STDIO_H
#define _LABSIM_STDIO_H
${SIZE_T}
${NULL_DEF}
struct __sFILE {
  int fd;
  unsigned char *buf;
  unsigned char *pos;
  unsigned char *bufend;
  unsigned char *buff_stop;
  unsigned int flags;
};
typedef struct __sFILE FILE;
typedef long fpos_t;
extern FILE _ftable[];
#define stdin (&_ftable[0])
#define stdout (&_ftable[1])
#define stderr (&_ftable[2])
#define EOF (-1)
#define BUFSIZ 256
#define FILENAME_MAX 256
#define TMP_MAX 65535
#define SEEK_SET (0x0000)
#define SEEK_CUR (0x0001)
#define SEEK_END (0x0002)
#define _IOFBF 0x0001
#define _IOLBF 0x0002
#define _IONBF 0x0004
int printf(const char *, ...);
int fprintf(FILE *, const char *, ...);
int sprintf(char *, const char *, ...);
int snprintf(char *, size_t, const char *, ...);
int vprintf(const char *, char *);
int vfprintf(FILE *, const char *, char *);
int vsprintf(char *, const char *, char *);
int vsnprintf(char *, size_t, const char *, char *);
int scanf(const char *, ...);
int fscanf(FILE *, const char *, ...);
int sscanf(const char *, const char *, ...);
int puts(const char *);
int fputs(const char *, FILE *);
int putchar(int);
int fputc(int, FILE *);
int putc(int, FILE *);
int getchar(void);
int fgetc(FILE *);
int getc(FILE *);
char *fgets(char *, int, FILE *);
char *gets(char *);
int ungetc(int, FILE *);
FILE *fopen(const char *, const char *);
FILE *freopen(const char *, const char *, FILE *);
int fclose(FILE *);
int fflush(FILE *);
size_t fread(void *, size_t, size_t, FILE *);
size_t fwrite(const void *, size_t, size_t, FILE *);
int fseek(FILE *, long, int);
long ftell(FILE *);
void rewind(FILE *);
int fgetpos(FILE *, fpos_t *);
int fsetpos(FILE *, const fpos_t *);
int feof(FILE *);
int ferror(FILE *);
void clearerr(FILE *);
int remove(const char *);
int rename(const char *, const char *);
void perror(const char *);
int setvbuf(FILE *, char *, int, size_t);
void setbuf(FILE *, char *);
#endif`,

  'stdlib.h': String.raw`#ifndef _LABSIM_STDLIB_H
#define _LABSIM_STDLIB_H
${SIZE_T}
${NULL_DEF}
#define EXIT_FAILURE 1
#define EXIT_SUCCESS 0
#define MB_CUR_MAX 1
#define RAND_MAX 32767
typedef struct { int quot; int rem; } div_t;
typedef struct { long quot; long rem; } ldiv_t;
typedef struct { long long quot; long long rem; } lldiv_t;
int abs(int);
long labs(long);
long long llabs(long long);
div_t div(int, int);
ldiv_t ldiv(long, long);
lldiv_t lldiv(long long, long long);
int atoi(const char *);
long atol(const char *);
long long atoll(const char *);
double atof(const char *);
long strtol(const char *, char **, int);
unsigned long strtoul(const char *, char **, int);
long long strtoll(const char *, char **, int);
unsigned long long strtoull(const char *, char **, int);
double strtod(const char *, char **);
float strtof(const char *, char **);
int rand(void);
void srand(unsigned int);
void *malloc(size_t);
void *calloc(size_t, size_t);
void *realloc(void *, size_t);
void free(void *);
void *memalign(size_t, size_t);
void exit(int);
void abort(void);
int atexit(void (*)(void));
void qsort(void *, size_t, size_t, int (*)(const void *, const void *));
void *bsearch(const void *, const void *, size_t, size_t, int (*)(const void *, const void *));
char *getenv(const char *);
int system(const char *);
#endif`,

  'string.h': String.raw`#ifndef _LABSIM_STRING_H
#define _LABSIM_STRING_H
${SIZE_T}
${NULL_DEF}
void *memcpy(void *, const void *, size_t);
void *memmove(void *, const void *, size_t);
void *memset(void *, int, size_t);
int memcmp(const void *, const void *, size_t);
void *memchr(const void *, int, size_t);
char *strcpy(char *, const char *);
char *strncpy(char *, const char *, size_t);
char *strcat(char *, const char *);
char *strncat(char *, const char *, size_t);
int strcmp(const char *, const char *);
int strncmp(const char *, const char *, size_t);
int strcoll(const char *, const char *);
size_t strxfrm(char *, const char *, size_t);
char *strchr(const char *, int);
char *strrchr(const char *, int);
char *strstr(const char *, const char *);
char *strpbrk(const char *, const char *);
size_t strspn(const char *, const char *);
size_t strcspn(const char *, const char *);
char *strtok(char *, const char *);
size_t strlen(const char *);
char *strerror(int);
#endif`,

  'time.h': String.raw`#ifndef _LABSIM_TIME_H
#define _LABSIM_TIME_H
${SIZE_T}
${NULL_DEF}
typedef unsigned int clock_t;
typedef unsigned int time_t;
struct tm {
  int tm_sec;
  int tm_min;
  int tm_hour;
  int tm_mday;
  int tm_mon;
  int tm_year;
  int tm_wday;
  int tm_yday;
  int tm_isdst;
};
/* The LCDK's C6748 runs at 300 MHz; clock() counts CPU cycles. */
#define CLOCKS_PER_SEC ((clock_t)300000000)
clock_t clock(void);
time_t time(time_t *);
double difftime(time_t, time_t);
time_t mktime(struct tm *);
char *asctime(const struct tm *);
char *ctime(const time_t *);
struct tm *gmtime(const time_t *);
struct tm *localtime(const time_t *);
size_t strftime(char *, size_t, const char *, const struct tm *);
#endif`,

  'c6x.h': C6X
}

for (const h of ['complex.h', 'fenv.h', 'inttypes.h', 'locale.h', 'setjmp.h', 'signal.h', 'tgmath.h', 'wchar.h', 'wctype.h']) {
  HEADERS[h] = `#error LabSim does not support <${h}> yet`
}

export const BUILTIN_HEADERS: Readonly<Record<string, string>> = HEADERS
```

- [ ] **Step 6: Implement `#if` evaluation**

```ts path=src/interp/frontend/ppexpr.ts
import { M, type Diags, type Loc } from './diag'
import type { Token } from './lexer'
import { parseChar, parseNumber } from './literals'

interface Val {
  v: bigint
  u: boolean
}

class Fail extends Error {}

const BINARY: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10
}

/** Evaluates a #if expression (macros expanded, `defined` replaced) in 64-bit intmax_t arithmetic. */
export function evalPpExpr(toks: Token[], diags: Diags, at: Loc): boolean {
  const p = new PpExpr(toks, diags, at)
  try {
    const v = p.cond(true)
    if (!p.done()) throw new Fail()
    return v.v !== 0n
  } catch (e) {
    if (!(e instanceof Fail)) throw e
    diags.error(at, M.expectedExpression())
    return false
  }
}

const wrap = (v: bigint, u: boolean): Val => ({ v: u ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v), u })
const bool = (c: boolean): Val => ({ v: c ? 1n : 0n, u: false })

class PpExpr {
  private i = 0

  constructor(
    private readonly toks: Token[],
    private readonly diags: Diags,
    private readonly at: Loc
  ) {}

  done(): boolean {
    return this.i >= this.toks.length
  }

  private peek(): Token | undefined {
    return this.toks[this.i]
  }

  cond(live: boolean): Val {
    const c = this.binary(1, live)
    if (this.peek()?.text !== '?') return c
    this.i++
    const a = this.cond(live && c.v !== 0n)
    if (this.peek()?.text !== ':') throw new Fail()
    this.i++
    const b = this.cond(live && c.v === 0n)
    return wrap(c.v !== 0n ? a.v : b.v, a.u || b.u)
  }

  private binary(min: number, live: boolean): Val {
    let left = this.unary(live)
    for (;;) {
      const op = this.peek()
      const prec = op && op.kind === 'punct' ? BINARY[op.text] : undefined
      if (!op || prec === undefined || prec < min) return left
      this.i++
      const rightLive = op.text === '&&' ? live && left.v !== 0n : op.text === '||' ? live && left.v === 0n : live
      const right = this.binary(prec + 1, rightLive)
      left = this.apply(op.text, left, right, rightLive)
    }
  }

  private apply(op: string, a: Val, b: Val, live: boolean): Val {
    const u = a.u || b.u
    const x = u ? BigInt.asUintN(64, a.v) : a.v
    const y = u ? BigInt.asUintN(64, b.v) : b.v
    switch (op) {
      case '||': return bool(a.v !== 0n || b.v !== 0n)
      case '&&': return bool(a.v !== 0n && b.v !== 0n)
      case '|': return wrap(x | y, u)
      case '^': return wrap(x ^ y, u)
      case '&': return wrap(x & y, u)
      case '==': return bool(x === y)
      case '!=': return bool(x !== y)
      case '<': return bool(x < y)
      case '>': return bool(x > y)
      case '<=': return bool(x <= y)
      case '>=': return bool(x >= y)
      case '<<': return wrap(a.v << (b.v & 63n), a.u)
      case '>>': return wrap((a.u ? BigInt.asUintN(64, a.v) : a.v) >> (b.v & 63n), a.u)
      case '+': return wrap(x + y, u)
      case '-': return wrap(x - y, u)
      case '*': return wrap(x * y, u)
      default:
        if (y === 0n) {
          if (live) this.diags.error(this.at, M.ppDivByZero())
          return { v: 0n, u }
        }
        return wrap(op === '/' ? x / y : x % y, u)
    }
  }

  private unary(live: boolean): Val {
    const t = this.peek()
    if (!t) throw new Fail()
    this.i++
    if (t.kind === 'punct') {
      if (t.text === '(') {
        const v = this.cond(live)
        if (this.peek()?.text !== ')') throw new Fail()
        this.i++
        return v
      }
      if (t.text === '+' || t.text === '-' || t.text === '~' || t.text === '!') {
        const v = this.unary(live)
        if (t.text === '+') return v
        if (t.text === '-') return wrap(-v.v, v.u)
        if (t.text === '~') return wrap(~v.v, v.u)
        return bool(v.v === 0n)
      }
    }
    if (t.kind === 'number') {
      const n = parseNumber(t.text)
      if (n.kind !== 'int') throw new Fail()
      return wrap(n.value, n.unsigned || n.value > 0x7fffffffffffffffn)
    }
    if (t.kind === 'char') return { v: BigInt(parseChar(t.text).value), u: false }
    if (t.kind === 'ident') return { v: 0n, u: false }
    throw new Fail()
  }
}
```

- [ ] **Step 7: Implement the preprocessor**

```ts path=src/interp/frontend/preprocessor.ts
import * as path from 'path'
import { M, type Diags, type Loc } from './diag'
import { BUILTIN_DIR, BUILTIN_HEADERS, PRELUDE } from './headers'
import { loc, tokenize, type Token } from './lexer'
import { evalPpExpr } from './ppexpr'

export interface Macro {
  name: string
  /** Parameter names (the variadic one is __VA_ARGS__); null for an object-like macro. */
  params: string[] | null
  variadic: boolean
  body: Token[]
  loc: Loc
  origin: 'predefined' | 'command-line' | 'source'
}

export interface Pragma {
  name: string
  text: string
  loc: Loc
}

export interface PreprocessOptions {
  /** Reads a project file; null when it does not exist. */
  readFile(file: string): string | null
  /** Directories searched for #include after the including file's own (the compiler's include directory excluded). */
  includePaths: string[]
  /** --define values such as "c6748" or "N=8". */
  defines: string[]
  dialect: 'c89' | 'c99'
  now?: Date
}

export interface PreprocessResult {
  tokens: Token[]
  pragmas: Pragma[]
  macros: Map<string, Macro>
  /** Project files read, main file first. */
  files: string[]
}

export const builtinHeaderPath = (name: string): string => `${BUILTIN_DIR}/${name}`
export const isBuiltinFile = (file: string): boolean => file.startsWith(BUILTIN_DIR + '/')

/** What cl6x -mv6740 (CGT 8.3.12) predefines, from --preproc_macros. */
const PREDEFINED: [string, string][] = [
  ['_LITTLE_ENDIAN', '1'], ['_TMS320C6400', '1'], ['_TMS320C6400_PLUS', '1'], ['_TMS320C64_PLUS', '1'],
  ['_TMS320C6700', '1'], ['_TMS320C6700_PLUS', '1'], ['_TMS320C6740', '1'], ['_TMS320C67_PLUS', '1'], ['_TMS320C6X', '1'],
  ['__CHAR16_TYPE__', 'unsigned short'], ['__CHAR32_TYPE__', 'unsigned int'], ['__CHAR_BIT__', '8'],
  ['__COMPILER_VERSION__', '8003012'], ['__EDG_PTRDIFF_TYPE__', 'int'], ['__EDG_SIZE_TYPE__', 'unsigned int'],
  ['__EDG_VERSION__', '413'], ['__ELF__', '1'], ['__INT_MAX__', '2147483647'], ['__LITTLE_ENDIAN__', '1'],
  ['__LONG_LONG_MAX__', '9223372036854775807'], ['__LONG_MAX__', '2147483647'], ['__PTRDIFF_T_TYPE__', 'int'],
  ['__SCHAR_MAX__', '127'], ['__SHRT_MAX__', '32767'], ['__SIZEOF_DOUBLE__', '8'], ['__SIZEOF_FLOAT__', '4'],
  ['__SIZEOF_INT__', '4'], ['__SIZEOF_LONG_DOUBLE__', '8'], ['__SIZEOF_LONG_LONG__', '8'], ['__SIZEOF_LONG__', '4'],
  ['__SIZEOF_PTRDIFF_T__', '4'], ['__SIZEOF_SHORT__', '2'], ['__SIZEOF_SIZE_T__', '4'], ['__SIZEOF_WCHAR_T__', '2'],
  ['__SIZEOF_WINT_T__', '2'], ['__SIZE_T_TYPE__', 'unsigned'], ['__STDC_HOSTED__', '1'], ['__STDC_NO_THREADS__', '1'],
  ['__STDC__', '1'], ['__TI_32BIT_LONG__', '1'], ['__TI_C99_COMPLEX_ENABLED__', '1'], ['__TI_COMPILER_VERSION__', '8003012'],
  ['__TI_EABI__', '1'], ['__TI_ELFABI__', '1'], ['__TI_GNU_ATTRIBUTE_SUPPORT__', '1'], ['__TI_INT40_T__', '1'],
  ['__TI_NO_PARALLEL_LOADS', '1'], ['__TI_STRICT_ANSI_MODE__', '0'], ['__TI_STRICT_FP_MODE__', '1'], ['__TI_TLS__', '1'],
  ['__TI_WCHAR_T_BITS__', '16'], ['__TMS320C6X__', '1'], ['__VERSION__', '"EDG gcc 4.8 mode"'],
  ['__WCHAR_T_TYPE__', 'unsigned short'], ['__edg_front_end__', '1'], ['__little_endian__', '1'], ['__signed_chars__', '1']
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Cond {
  loc: Loc
  active: boolean
  /** Some group of this #if chain was already taken. */
  taken: boolean
  parentActive: boolean
}

interface Source {
  file: string
  toks: Token[]
  i: number
  /** Tokens produced by macro expansion; the next one is last. */
  pending: Token[]
  conds: Cond[]
  /** Expanding a macro argument or a directive line: no directives, ends at the list's end. */
  isList: boolean
}

const joinTokens = (toks: Token[]): string => toks.map((t, k) => (k > 0 && t.space ? ' ' : '') + t.text).join('')
const isPunct = (t: Token | null | undefined, text: string): boolean => !!t && t.kind === 'punct' && t.text === text

function sameMacro(a: Macro, b: Macro): boolean {
  if (JSON.stringify(a.params) !== JSON.stringify(b.params) || a.variadic !== b.variadic) return false
  if (a.body.length !== b.body.length) return false
  return a.body.every((t, k) => t.text === b.body[k].text && (k === 0 || t.space === b.body[k].space))
}

export function preprocess(mainFile: string, opts: PreprocessOptions, diags: Diags): PreprocessResult {
  return new Preprocessor(opts, diags).run(mainFile)
}

class Preprocessor {
  private readonly macros = new Map<string, Macro>()
  private readonly out: Token[] = []
  private readonly pragmas: Pragma[] = []
  private readonly files: string[] = []
  private readonly once = new Set<string>()
  private readonly cache = new Map<string, string | null>()
  private depth = 0
  private src: Source = { file: '', toks: [], i: 0, pending: [], conds: [], isList: true }

  constructor(
    private readonly opts: PreprocessOptions,
    private readonly diags: Diags
  ) {}

  run(mainFile: string): PreprocessResult {
    this.predefine()
    const text = this.read(mainFile)
    if (text === null) this.diags.fatal({ file: mainFile, line: 0, col: 0 }, M.cannotOpen(mainFile))
    this.include(builtinHeaderPath(PRELUDE), BUILTIN_HEADERS[PRELUDE])
    this.include(mainFile, text)
    this.out.push({ kind: 'eof', text: '', file: mainFile, line: 0, col: 0, space: false, bol: true })
    return { tokens: this.out, pragmas: this.pragmas, macros: this.macros, files: this.files }
  }

  private predefine(): void {
    const now = this.opts.now ?? new Date()
    const two = (n: number): string => String(n).padStart(2, '0')
    for (const [name, body] of PREDEFINED) this.defineText(name, body, 'predefined')
    this.defineText('__STDC_VERSION__', this.opts.dialect === 'c99' ? '199901L' : '199409L', 'predefined')
    this.defineText('__DATE__', `"${MONTHS[now.getMonth()]} ${String(now.getDate()).padStart(2, ' ')} ${now.getFullYear()}"`, 'predefined')
    this.defineText('__TIME__', `"${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}"`, 'predefined')
    for (const d of this.opts.defines) {
      const eq = d.indexOf('=')
      this.defineText(eq < 0 ? d : d.slice(0, eq), eq < 0 ? '1' : d.slice(eq + 1), 'command-line')
    }
  }

  private defineText(name: string, body: string, origin: Macro['origin']): void {
    const file = '<command-line>'
    const toks = tokenize(body, file).filter((t) => t.kind !== 'eof')
    this.macros.set(name, { name, params: null, variadic: false, body: toks, loc: { file, line: 0, col: 0 }, origin })
  }

  private read(file: string): string | null {
    if (!this.cache.has(file)) this.cache.set(file, this.opts.readFile(file))
    return this.cache.get(file) ?? null
  }

  private include(file: string, text: string): void {
    if (this.depth >= 100) this.diags.fatal(loc(this.src.toks[Math.max(0, this.src.i - 1)]), M.unsupported('#include nested more than 100 deep'))
    if (!isBuiltinFile(file)) this.files.push(file)
    const saved = this.src
    this.src = { file, toks: tokenize(text, file), i: 0, pending: [], conds: [], isList: false }
    this.depth++
    try {
      this.loop()
      for (const c of this.src.conds) this.diags.error(c.loc, M.endifMissing())
    } finally {
      this.depth--
      this.src = saved
    }
  }

  private loop(): void {
    const s = this.src
    for (;;) {
      if (s.pending.length === 0) {
        const t = s.toks[s.i]
        if (t.kind === 'eof') return
        if (t.bol && isPunct(t, '#')) {
          s.i++
          this.directive(t)
          continue
        }
      }
      const t = this.take()
      if (!this.active()) continue
      if (t.kind === 'ident' && this.expand(t)) continue
      this.emit(t)
    }
  }

  private take(): Token {
    const s = this.src
    return s.pending.length > 0 ? (s.pending.pop() as Token) : s.toks[s.i++]
  }

  /** The next token, or null at the end of the input or before a directive. */
  private peek(): Token | null {
    const s = this.src
    if (s.pending.length > 0) return s.pending[s.pending.length - 1]
    const t = s.toks[s.i]
    if (!t || t.kind === 'eof' || (!s.isList && t.bol && isPunct(t, '#'))) return null
    return t
  }

  private pushBack(toks: Token[]): void {
    for (let k = toks.length - 1; k >= 0; k--) this.src.pending.push(toks[k])
  }

  private active(): boolean {
    const c = this.src.conds
    return c.length === 0 || c[c.length - 1].active
  }

  private emit(t: Token): void {
    if (t.bad) this.diags.error(loc(t), t.bad === '7' ? M.unrecognizedToken() : M.missingQuote())
    this.out.push(t)
  }

  // ---------------------------------------------------------------- directives

  private readLine(): Token[] {
    const s = this.src
    const line: Token[] = []
    while (s.toks[s.i].kind !== 'eof' && !s.toks[s.i].bol) line.push(s.toks[s.i++])
    return line
  }

  private directive(hash: Token): void {
    const line = this.readLine()
    if (line.length === 0) return
    const [name, ...rest] = line
    const at = loc(name)
    if (name.kind === 'ident') {
      switch (name.text) {
        case 'if':
          return this.pushCond(at, () => this.evalIf(rest, at))
        case 'ifdef':
        case 'ifndef':
          return this.pushCond(at, () => {
            const id = rest[0]
            if (!id || id.kind !== 'ident') {
              this.diags.error(at, M.expectedIdentifier())
              return false
            }
            return this.macros.has(id.text) === (name.text === 'ifdef')
          })
        case 'elif':
          return this.elif(at, rest)
        case 'else':
          return this.elseGroup(at)
        case 'endif':
          if (!this.src.conds.pop()) this.diags.error(at, M.ifMissing())
          return
      }
    }
    if (!this.active()) return
    if (name.kind === 'number') return this.lineDirective(line, hash)
    switch (name.text) {
      case 'define':
        return this.define(rest, name)
      case 'undef':
        if (rest[0]?.kind === 'ident') this.macros.delete(rest[0].text)
        else this.diags.error(at, M.expectedIdentifier())
        return
      case 'include':
        return this.includeDirective(rest, name)
      case 'error':
        return this.diags.fatal(at, M.errorDirective(joinTokens(rest)))
      case 'warning':
        this.diags.warning(at, M.warningDirective(joinTokens(rest)))
        return
      case 'pragma':
        return this.pragma(rest, at)
      case 'line':
        return this.lineDirective(rest, hash)
      case 'ident':
      case 'sccs':
        return
    }
    this.diags.error(at, M.unknownDirective())
  }

  private pushCond(at: Loc, test: () => boolean): void {
    const parentActive = this.active()
    const value = parentActive ? test() : false
    this.src.conds.push({ loc: at, active: parentActive && value, taken: value, parentActive })
  }

  private elif(at: Loc, rest: Token[]): void {
    const c = this.src.conds[this.src.conds.length - 1]
    if (!c) {
      this.diags.error(at, M.ifMissing())
      return
    }
    if (c.taken || !c.parentActive) {
      c.active = false
      return
    }
    c.active = c.taken = this.evalIf(rest, at)
  }

  private elseGroup(at: Loc): void {
    const c = this.src.conds[this.src.conds.length - 1]
    if (!c) {
      this.diags.error(at, M.ifMissing())
      return
    }
    c.active = c.parentActive && !c.taken
    c.taken = true
  }

  private evalIf(rest: Token[], at: Loc): boolean {
    const replaced: Token[] = []
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i]
      if (t.kind === 'ident' && t.text === 'defined') {
        const paren = isPunct(rest[i + 1], '(')
        const id = rest[i + (paren ? 2 : 1)]
        const v = !!id && id.kind === 'ident' && this.macros.has(id.text)
        replaced.push({ ...t, kind: 'number', text: v ? '1' : '0' })
        i += paren ? (isPunct(rest[i + 3], ')') ? 3 : 2) : 1
        continue
      }
      replaced.push(t)
    }
    return evalPpExpr(this.expandList(replaced), this.diags, at)
  }

  private define(rest: Token[], d: Token): void {
    const id = rest[0]
    if (!id || id.kind !== 'ident') {
      this.diags.error(loc(d), M.expectedIdentifier())
      return
    }
    let params: string[] | null = null
    let variadic = false
    let i = 1
    if (isPunct(rest[1], '(') && !rest[1].space) {
      params = []
      i = 2
      if (isPunct(rest[i], ')')) i++
      else {
        for (;;) {
          const p = rest[i]
          if (isPunct(p, '...')) {
            variadic = true
            params.push('__VA_ARGS__')
          } else if (p?.kind === 'ident') params.push(p.text)
          else {
            this.diags.error(loc(p ?? id), M.expectedIdentifier())
            return
          }
          i++
          if (isPunct(rest[i], ',') && !variadic) {
            i++
            continue
          }
          if (isPunct(rest[i], ')')) {
            i++
            break
          }
          this.diags.error(loc(rest[i] ?? id), M.expected(')'))
          return
        }
      }
    }
    const macro: Macro = { name: id.text, params, variadic, body: rest.slice(i), loc: loc(id), origin: 'source' }
    const old = this.macros.get(id.text)
    if (old && !sameMacro(old, macro)) this.diags.warning(loc(id), M.macroRedefined(id.text, old.loc.line))
    this.macros.set(id.text, macro)
  }

  private includeDirective(rest: Token[], d: Token): void {
    const toks = rest[0] && rest[0].kind !== 'string' && !isPunct(rest[0], '<') ? this.expandList(rest) : rest
    let name: string | null = null
    let quoted = false
    if (toks[0]?.kind === 'string') {
      name = toks[0].text.slice(1, -1)
      quoted = true
    } else if (isPunct(toks[0], '<')) {
      const close = toks.findIndex((t, k) => k > 0 && isPunct(t, '>'))
      if (close > 0) name = joinTokens(toks.slice(1, close))
    }
    if (!name) {
      this.diags.error(loc(d), M.expectedFileName())
      return
    }
    const found = this.resolve(name, quoted)
    if (!found) this.diags.fatal(loc(d), M.cannotOpen(name))
    if (this.once.has(found.file)) return
    this.include(found.file, found.text)
  }

  private resolve(name: string, quoted: boolean): { file: string; text: string } | null {
    const dirs: string[] = []
    if (quoted && !isBuiltinFile(this.src.file)) dirs.push(path.dirname(this.src.file))
    dirs.push(...this.opts.includePaths)
    for (const dir of dirs) {
      const file = path.resolve(dir, name)
      const text = this.read(file)
      if (text !== null) return { file, text }
    }
    const key = name.replace(/\\/g, '/')
    if (!Object.hasOwn(BUILTIN_HEADERS, key) || key === PRELUDE) return null
    return { file: builtinHeaderPath(key), text: BUILTIN_HEADERS[key] }
  }

  private pragma(rest: Token[], at: Loc): void {
    if (rest[0]?.text === 'once') {
      this.once.add(this.src.file)
      return
    }
    this.pragmas.push({ name: rest[0]?.text ?? '', text: joinTokens(rest.slice(1)), loc: at })
  }

  private lineDirective(rest: Token[], hash: Token): void {
    const toks = this.expandList(rest)
    const n = toks[0]?.kind === 'number' ? Number(toks[0].text) : NaN
    if (!Number.isInteger(n)) {
      this.diags.error(loc(hash), M.expectedExpression())
      return
    }
    const file = toks[1]?.kind === 'string' ? toks[1].text.slice(1, -1) : null
    const delta = n - (hash.line + 1)
    const s = this.src
    for (let k = s.i; k < s.toks.length && s.toks[k].kind !== 'eof'; k++) {
      s.toks[k] = { ...s.toks[k], line: s.toks[k].line + delta, ...(file !== null ? { file } : {}) }
    }
  }

  // ---------------------------------------------------------------- macro expansion

  /** Fully expands a token list on its own (macro arguments, #if and #include lines). */
  private expandList(toks: Token[]): Token[] {
    const saved = this.src
    const eof: Token = { kind: 'eof', text: '', file: saved.file, line: 0, col: 0, space: false, bol: true }
    this.src = { file: saved.file, toks: [...toks, eof], i: 0, pending: [], conds: [], isList: true }
    const out: Token[] = []
    try {
      for (;;) {
        const t = this.take()
        if (t.kind === 'eof') break
        if (t.kind === 'ident' && this.expand(t)) continue
        out.push(t)
      }
    } finally {
      this.src = saved
    }
    return out
  }

  /** Expands `t` if it names a macro, pushing the result back for rescanning. */
  private expand(t: Token): boolean {
    const name = t.text
    if (t.hide?.has(name)) return false
    if (name === '__FILE__') {
      this.pushBack([{ ...t, kind: 'string', text: JSON.stringify(t.file), hide: undefined }])
      return true
    }
    if (name === '__LINE__') {
      this.pushBack([{ ...t, kind: 'number', text: String(t.line), hide: undefined }])
      return true
    }
    if (name === '_Pragma') return this.pragmaOperator(t)
    const m = this.macros.get(name)
    if (!m) return false
    if (m.params === null) {
      this.pushBack(this.subst(m, [], new Set([...(t.hide ?? []), name]), t))
      return true
    }
    if (!isPunct(this.peek(), '(')) return false
    this.take()
    const args = this.readArgs(m, t)
    if (!args) return true
    const hide = new Set([...(t.hide ?? [])].filter((h) => args.rparen.hide?.has(h)))
    hide.add(name)
    this.pushBack(this.subst(m, args.list, hide, t))
    return true
  }

  private pragmaOperator(t: Token): boolean {
    if (!isPunct(this.peek(), '(')) return false
    this.take()
    const str = this.peek()
    if (str?.kind === 'string') this.take()
    if (isPunct(this.peek(), ')')) this.take()
    if (str?.kind === 'string') {
      const text = str.text.slice(1, -1).replace(/\\(["\\])/g, '$1')
      const toks = tokenize(text, t.file).filter((x) => x.kind !== 'eof')
      this.pragmas.push({ name: toks[0]?.text ?? '', text: joinTokens(toks.slice(1)), loc: loc(t) })
    }
    return true
  }

  private readArgs(m: Macro, at: Token): { list: Token[][]; rparen: Token } | null {
    const n = (m.params as string[]).length
    const list: Token[][] = [[]]
    let depth = 0
    for (;;) {
      const t = this.peek()
      if (!t) {
        this.diags.error(loc(at), M.macroUnterminated())
        return null
      }
      this.take()
      if (isPunct(t, '(')) depth++
      else if (isPunct(t, ')')) {
        if (depth === 0) return { list: this.fixArgs(m, at, list), rparen: t }
        depth--
      } else if (isPunct(t, ',') && depth === 0 && !(m.variadic && list.length === n)) {
        list.push([])
        continue
      }
      list[list.length - 1].push(t)
    }
  }

  private fixArgs(m: Macro, at: Token, list: Token[][]): Token[][] {
    const n = (m.params as string[]).length
    if (n === 0 && list.length === 1 && list[0].length === 0) return []
    if (list.length < n) {
      if (!(m.variadic && list.length === n - 1)) this.diags.error(loc(at), M.macroFewArgs(m.name))
      while (list.length < n) list.push([])
    } else if (list.length > n) {
      this.diags.error(loc(at), M.macroManyArgs(m.name))
      list.length = n
    }
    return list
  }

  private subst(m: Macro, args: Token[][], hide: Set<string>, at: Token): Token[] {
    const params = m.params ?? []
    const argIndex = (t: Token | undefined): number => (t && t.kind === 'ident' ? params.indexOf(t.text) : -1)
    const expanded = new Map<number, Token[]>()
    const expandedArg = (k: number): Token[] => {
      if (!expanded.has(k)) expanded.set(k, this.expandList(args[k]))
      return expanded.get(k) as Token[]
    }
    const placemarker = (t: Token): Token => ({ ...t, kind: 'other', text: '', placemarker: true, bad: undefined })
    const body = m.body
    const out: Token[] = []
    for (let i = 0; i < body.length; i++) {
      const t = body[i]
      if (m.params && isPunct(t, '#') && argIndex(body[i + 1]) >= 0) {
        out.push(this.stringize(args[argIndex(body[i + 1])], t))
        i++
        continue
      }
      if (isPunct(t, '##') && out.length > 0 && i + 1 < body.length) {
        const rhs = body[i + 1]
        const k = argIndex(rhs)
        const right = k >= 0 ? (args[k].length > 0 ? args[k] : [placemarker(rhs)]) : [rhs]
        i++
        out[out.length - 1] = this.paste(out[out.length - 1], right[0])
        out.push(...right.slice(1))
        continue
      }
      const k = argIndex(t)
      if (k >= 0) {
        const raw = isPunct(body[i + 1], '##')
        const toks = raw ? args[k] : expandedArg(k)
        if (toks.length === 0) {
          if (raw) out.push(placemarker(t))
          continue
        }
        out.push({ ...toks[0], space: t.space }, ...toks.slice(1))
        continue
      }
      out.push(t)
    }
    return out
      .filter((tok) => !tok.placemarker)
      .map((tok, n) => ({
        ...tok,
        file: at.file,
        line: at.line,
        col: at.col,
        bol: false,
        space: n === 0 ? at.space : tok.space,
        hide: new Set([...(tok.hide ?? []), ...hide])
      }))
  }

  private stringize(toks: Token[], at: Token): Token {
    let s = ''
    toks.forEach((t, k) => {
      if (k > 0 && t.space) s += ' '
      s += t.kind === 'string' || t.kind === 'char' ? t.text.replace(/[\\"]/g, (c) => '\\' + c) : t.text
    })
    return { ...at, kind: 'string', text: `"${s}"`, hide: undefined }
  }

  private paste(a: Token, b: Token): Token {
    if (a.placemarker) return { ...b, space: a.space }
    if (b.placemarker) return a
    const toks = tokenize(a.text + b.text, a.file).filter((t) => t.kind !== 'eof')
    const first = toks[0] ?? a
    return { ...a, kind: first.kind, text: first.text, bad: first.bad }
  }
}
```

- [ ] **Step 8: Run the tests and see them pass**

Run: `npx vitest run tests/unit/interp/literals.test.ts tests/unit/interp/preprocessor.test.ts tests/unit/interp/headers.test.ts`
Expected: PASS. If `define exactly the macros cl6x -mv6740 predefines` fails, the error shows which name is missing or extra. Fix `PREDEFINED`, not the fixture.

- [ ] **Step 9: Commit**

```bash
git add src/interp tests/unit/interp tests/fixtures/ti
git commit -m "feat(interp): preprocessor with cl6x predefines and TI-compatible built-in headers"
```

---
### Task 3: C types for the C6000 EABI

**Files:**
- Create: `src/interp/frontend/types.ts`
- Test: `tests/unit/interp/types.test.ts`

**Interfaces:**
- Consumes: `Loc` (Task 1). A type-only import of `Expr` and `VarSym` from `ast.ts` (Task 4). TypeScript allows a type-only cycle, and until Task 4 the import is only a type reference, so vitest does not load it.
- Produces:
  - `Type`, one of `VoidType | IntType | FloatType | PointerType | ArrayType | FunctionType | RecordType | ErrorType`.
    - Every type carries optional `const`, `volatile` and `alias` (the typedef name, used only in messages).
  - `IntName`, `Param {name, type, loc}`, `Member {name, type, offset}`, `RecordDef {kind, tag, members, size, align, id}`.
  - `T` singletons: `void error bool char schar uchar short ushort int uint long ulong llong ullong int40 uint40 float double ldouble`.
  - Constructors: `intType(name)`, `pointerTo`, `arrayOf`, `withQuals`, `unqual`.
  - Predicates: `isInteger isFloating isArithmetic isPointer isScalar isRecord isAggregate isComplete isCharArray`.
  - Sizing: `sizeOf`, `alignOf`, `alignUp`.
  - Conversions and comparison: `promote`, `usualArith`, `compatible`, `compatibleUnqual`, `typeToString(t, inner?)`.
  - Records: `newRecord(kind, tag)`, `completeRecord(def, fields)`.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/types.test.ts
import { describe, expect, it } from 'vitest'
import {
  T, alignOf, arrayOf, compatible, completeRecord, isComplete, newRecord, pointerTo, promote, sizeOf, typeToString,
  usualArith, withQuals, type Type
} from '../../../src/interp/frontend/types'

const fn = (ret: Type, params: Type[], variadic = false, prototyped = true): Type => ({
  kind: 'function', ret, params: params.map((type) => ({ name: null, type, loc: null })), variadic, prototyped
})

describe('EABI sizes and alignment', () => {
  it('uses the C6000 model: 32-bit long, 40-bit int in 8 bytes, 64-bit double', () => {
    const rows: [Type, number, number][] = [
      [T.bool, 1, 1], [T.char, 1, 1], [T.short, 2, 2], [T.int, 4, 4], [T.long, 4, 4], [T.llong, 8, 8], [T.int40, 8, 8],
      [T.float, 4, 4], [T.double, 8, 8], [T.ldouble, 8, 8], [pointerTo(T.char), 4, 4], [arrayOf(T.short, 5), 10, 2]
    ]
    for (const [t, size, align] of rows) expect([typeToString(t), sizeOf(t), alignOf(t)]).toEqual([typeToString(t), size, align])
  })
  it('lays out structs and unions with natural alignment', () => {
    const s = newRecord('struct', 'pt')
    completeRecord(s, [{ name: 'c', type: T.char }, { name: 'd', type: T.double }, { name: 's', type: T.short }])
    expect(s.members?.map((m) => m.offset)).toEqual([0, 8, 16])
    expect([s.size, s.align]).toEqual([24, 8])
    const u = newRecord('union', 'u')
    completeRecord(u, [{ name: 'i', type: T.int }, { name: 'b', type: arrayOf(T.char, 6) }])
    expect([u.size, u.align, u.members?.[1].offset]).toEqual([8, 4, 0])
    const flex = newRecord('struct', 'f')
    completeRecord(flex, [{ name: 'n', type: T.int }, { name: 'data', type: arrayOf(T.float, null) }])
    expect(flex.size).toBe(4)
    expect(isComplete({ kind: 'struct', def: newRecord('struct', 'x') })).toBe(false)
  })
})

describe('conversions', () => {
  it('promotes small integers and enums to int', () => {
    expect(promote(T.char)).toBe(T.int)
    expect(promote(T.ushort)).toBe(T.int)
    expect(promote(T.bool)).toBe(T.int)
    expect(promote({ ...T.int, enumTag: 'E' })).toBe(T.int)
    expect(promote(T.uint)).toBe(T.uint)
  })
  it('applies the usual arithmetic conversions with a 32-bit long', () => {
    expect(usualArith(T.int, T.float)).toBe(T.float)
    expect(usualArith(T.float, T.double)).toBe(T.double)
    expect(usualArith(T.char, T.short)).toBe(T.int)
    expect(usualArith(T.int, T.uint)).toBe(T.uint)
    expect(usualArith(T.long, T.uint)).toBe(T.ulong)
    expect(usualArith(T.llong, T.ulong)).toBe(T.llong)
    expect(usualArith(T.int40, T.uint)).toBe(T.int40)
    expect(usualArith(T.ullong, T.llong)).toBe(T.ullong)
  })
})

describe('compatibility', () => {
  it('follows C rules for qualifiers, arrays, records and prototypes', () => {
    expect(compatible(T.int, { ...T.int, enumTag: 'E' })).toBe(true)
    expect(compatible(T.char, T.schar)).toBe(false)
    expect(compatible(T.int, withQuals(T.int, { const: true }))).toBe(false)
    expect(compatible(arrayOf(T.int, null), arrayOf(T.int, 4))).toBe(true)
    expect(compatible(arrayOf(T.int, 3), arrayOf(T.int, 4))).toBe(false)
    expect(compatible(fn(T.int, []), fn(T.int, [T.int], false, true))).toBe(false)
    expect(compatible(fn(T.int, [], false, false), fn(T.int, [T.int]))).toBe(true)
    const a = newRecord('struct', 'a')
    expect(compatible({ kind: 'struct', def: a }, { kind: 'struct', def: newRecord('struct', 'a') })).toBe(false)
  })
})

describe('typeToString', () => {
  it('prints types the way cl6x messages do', () => {
    const s = newRecord('struct', 'S')
    const anon = newRecord('struct', null)
    const rows: [Type, string][] = [
      [pointerTo(T.int), 'int *'],
      [pointerTo(withQuals(T.char, { const: true })), 'const char *'],
      [withQuals(pointerTo(withQuals(T.char, { const: true })), { const: true }), 'const char *const'],
      [pointerTo(arrayOf(T.int, 3)), 'int (*)[3]'],
      [pointerTo(fn(T.int, [T.int])), 'int (*)(int)'],
      [arrayOf(pointerTo(T.int), 3), 'int *[3]'],
      [fn(T.double, [T.double]), 'double (double)'],
      [fn(T.void, []), 'void (void)'],
      [fn(T.int, [], false, false), 'int ()'],
      [fn(T.int, [pointerTo(withQuals(T.char, { const: true }))], true), 'int (const char *, ...)'],
      [{ kind: 'struct', def: s }, 'struct S'],
      [{ kind: 'struct', def: anon }, 'struct <unnamed>'],
      [T.uint, 'unsigned int'],
      [{ ...T.double, alias: 'real64_T' }, 'real64_T'],
      [pointerTo({ ...T.double, alias: 'real64_T' }), 'real64_T *'],
      [{ ...T.int, enumTag: 'color' }, 'enum color']
    ]
    for (const [t, text] of rows) expect(typeToString(t)).toBe(text)
    expect(typeToString(fn(T.double, [T.double]), 'f')).toBe('double f(double)')
    expect(typeToString(T.int, 'x')).toBe('int x')
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/types.test.ts`
Expected: FAIL, because the module `types` does not exist.

- [ ] **Step 3: Implement the type system**

```ts path=src/interp/frontend/types.ts
import type { Expr, VarSym } from './ast'
import type { Loc } from './diag'

export type IntName =
  | '_Bool' | 'char' | 'signed char' | 'unsigned char' | 'short' | 'unsigned short' | 'int' | 'unsigned int'
  | 'long' | 'unsigned long' | '__int40_t' | 'unsigned __int40_t' | 'long long' | 'unsigned long long'

interface Quals {
  const?: boolean
  volatile?: boolean
  /** Typedef name the type was written with; only for messages ("real64_T"). */
  alias?: string
}

export interface VoidType extends Quals {
  kind: 'void'
}
export interface IntType extends Quals {
  kind: 'int'
  name: IntName
  size: number
  signed: boolean
  /** Conversion rank (C 6.3.1.1). */
  rank: number
  /** Value bits: 8, 16, 32, 40 or 64. */
  bits: number
  /** Set when the type is an enum, for messages. */
  enumTag?: string
}
export interface FloatType extends Quals {
  kind: 'float'
  name: 'float' | 'double' | 'long double'
  size: number
}
export interface PointerType extends Quals {
  kind: 'pointer'
  to: Type
}
export interface ArrayType extends Quals {
  kind: 'array'
  of: Type
  /** null: incomplete (`int a[]`) or variable-length. */
  length: number | null
  /** Variable-length array: its size expression and the hidden variable holding the length. */
  vla?: { expr: Expr; len: VarSym | null }
}
export interface Param {
  name: string | null
  type: Type
  loc: Loc | null
}
export interface FunctionType extends Quals {
  kind: 'function'
  ret: Type
  params: Param[]
  variadic: boolean
  /** false for `int f()` (no prototype). */
  prototyped: boolean
}
export interface Member {
  name: string
  type: Type
  offset: number
}
export interface RecordDef {
  kind: 'struct' | 'union'
  tag: string | null
  /** null until the definition's closing brace. */
  members: Member[] | null
  size: number
  align: number
  id: number
}
export interface RecordType extends Quals {
  kind: 'struct' | 'union'
  def: RecordDef
}
export interface ErrorType extends Quals {
  kind: 'error'
}
export type Type = VoidType | IntType | FloatType | PointerType | ArrayType | FunctionType | RecordType | ErrorType

const INTS: Record<IntName, { size: number; signed: boolean; rank: number; bits: number }> = {
  _Bool: { size: 1, signed: false, rank: 0, bits: 8 },
  char: { size: 1, signed: true, rank: 1, bits: 8 },
  'signed char': { size: 1, signed: true, rank: 1, bits: 8 },
  'unsigned char': { size: 1, signed: false, rank: 1, bits: 8 },
  short: { size: 2, signed: true, rank: 2, bits: 16 },
  'unsigned short': { size: 2, signed: false, rank: 2, bits: 16 },
  int: { size: 4, signed: true, rank: 3, bits: 32 },
  'unsigned int': { size: 4, signed: false, rank: 3, bits: 32 },
  long: { size: 4, signed: true, rank: 4, bits: 32 },
  'unsigned long': { size: 4, signed: false, rank: 4, bits: 32 },
  __int40_t: { size: 8, signed: true, rank: 5, bits: 40 },
  'unsigned __int40_t': { size: 8, signed: false, rank: 5, bits: 40 },
  'long long': { size: 8, signed: true, rank: 6, bits: 64 },
  'unsigned long long': { size: 8, signed: false, rank: 6, bits: 64 }
}

const intCache = new Map<IntName, IntType>()
export function intType(name: IntName): IntType {
  let t = intCache.get(name)
  if (!t) {
    t = { kind: 'int', name, ...INTS[name] }
    intCache.set(name, t)
  }
  return t
}

export const T = {
  void: { kind: 'void' } as VoidType,
  error: { kind: 'error' } as ErrorType,
  bool: intType('_Bool'),
  char: intType('char'),
  schar: intType('signed char'),
  uchar: intType('unsigned char'),
  short: intType('short'),
  ushort: intType('unsigned short'),
  int: intType('int'),
  uint: intType('unsigned int'),
  long: intType('long'),
  ulong: intType('unsigned long'),
  int40: intType('__int40_t'),
  uint40: intType('unsigned __int40_t'),
  llong: intType('long long'),
  ullong: intType('unsigned long long'),
  float: { kind: 'float', name: 'float', size: 4 } as FloatType,
  double: { kind: 'float', name: 'double', size: 8 } as FloatType,
  ldouble: { kind: 'float', name: 'long double', size: 8 } as FloatType
}

export const pointerTo = (to: Type): PointerType => ({ kind: 'pointer', to })
export const arrayOf = (of: Type, length: number | null): ArrayType => ({ kind: 'array', of, length })

/** Adds qualifiers; on an array they apply to the element type, as in C. */
export function withQuals(t: Type, q: { const?: boolean; volatile?: boolean }): Type {
  if (!q.const && !q.volatile) return t
  if (t.kind === 'array') return { ...t, of: withQuals(t.of, q) }
  return { ...t, const: t.const || q.const || undefined, volatile: t.volatile || q.volatile || undefined }
}

/** The type without qualifiers or typedef name. */
export function unqual(t: Type): Type {
  if (!t.const && !t.volatile && !t.alias) return t
  const copy: Type = { ...t }
  delete copy.const
  delete copy.volatile
  delete copy.alias
  return t.kind === 'int' && !t.enumTag ? intType(t.name) : copy
}

export const isInteger = (t: Type): t is IntType => t.kind === 'int'
export const isFloating = (t: Type): t is FloatType => t.kind === 'float'
export const isArithmetic = (t: Type): t is IntType | FloatType => t.kind === 'int' || t.kind === 'float'
export const isPointer = (t: Type): t is PointerType => t.kind === 'pointer'
export const isScalar = (t: Type): boolean => isArithmetic(t) || isPointer(t)
export const isRecord = (t: Type): t is RecordType => t.kind === 'struct' || t.kind === 'union'
export const isAggregate = (t: Type): boolean => t.kind === 'array' || isRecord(t)
export const isCharArray = (t: Type): t is ArrayType =>
  t.kind === 'array' && t.of.kind === 'int' && (t.of.name === 'char' || t.of.name === 'signed char' || t.of.name === 'unsigned char')

export function isComplete(t: Type): boolean {
  switch (t.kind) {
    case 'void':
      return false
    case 'array':
      return t.length !== null || !!t.vla
    case 'struct':
    case 'union':
      return t.def.members !== null
    default:
      return true
  }
}

export const alignUp = (n: number, a: number): number => Math.ceil(n / a) * a

export function sizeOf(t: Type): number {
  switch (t.kind) {
    case 'int':
    case 'float':
      return t.size
    case 'pointer':
      return 4
    case 'array':
      return t.length === null ? 0 : t.length * sizeOf(t.of)
    case 'struct':
    case 'union':
      return t.def.size
    default:
      return 1
  }
}

export function alignOf(t: Type): number {
  switch (t.kind) {
    case 'int':
    case 'float':
      return t.size
    case 'pointer':
      return 4
    case 'array':
      return alignOf(t.of)
    case 'struct':
    case 'union':
      return t.def.align
    default:
      return 1
  }
}

/** Integer promotions: every type of lower rank than int fits in int on the C6000. */
export function promote(t: Type): Type {
  if (t.kind === 'int' && (t.rank < INTS.int.rank || t.enumTag)) return T.int
  return unqual(t)
}

const floatRank = (t: Type): number => (t.kind !== 'float' ? 0 : t.name === 'long double' ? 3 : t.name === 'double' ? 2 : 1)

export function usualArith(a: Type, b: Type): Type {
  if (a.kind === 'error' || b.kind === 'error') return T.error
  if (a.kind === 'float' || b.kind === 'float') return unqual(floatRank(a) >= floatRank(b) ? a : b)
  const x = promote(a) as IntType
  const y = promote(b) as IntType
  if (x.name === y.name) return x
  if (x.signed === y.signed) return x.rank >= y.rank ? x : y
  const [s, u] = x.signed ? [x, y] : [y, x]
  if (u.rank >= s.rank) return u
  if (s.bits > u.bits) return s
  return intType(`unsigned ${s.name}` as IntName)
}

/** C compatibility including qualifiers. */
export function compatible(a: Type, b: Type): boolean {
  if (!!a.const !== !!b.const || !!a.volatile !== !!b.volatile) return false
  return compatibleUnqual(a, b)
}

/** C compatibility ignoring the top-level qualifiers of a and b. */
export function compatibleUnqual(a: Type, b: Type): boolean {
  if (a.kind === 'error' || b.kind === 'error') return true
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'void':
      return true
    case 'int':
      return a.name === (b as IntType).name
    case 'float':
      return a.name === (b as FloatType).name
    case 'pointer':
      return compatible(a.to, (b as PointerType).to)
    case 'array': {
      const y = b as ArrayType
      return compatible(a.of, y.of) && (a.length === null || y.length === null || a.length === y.length)
    }
    case 'struct':
    case 'union':
      return a.def === (b as RecordType).def
    case 'function': {
      const y = b as FunctionType
      if (!compatibleUnqual(a.ret, y.ret)) return false
      if (!a.prototyped || !y.prototyped) return true
      return (
        a.variadic === y.variadic &&
        a.params.length === y.params.length &&
        a.params.every((p, i) => compatibleUnqual(p.type, y.params[i].type))
      )
    }
  }
}

const quals = (t: Type): string => (t.const ? 'const ' : '') + (t.volatile ? 'volatile ' : '')

/** The type as cl6x prints it in messages; `inner` is the declarator text (a name, or "*" while recursing). */
export function typeToString(t: Type, inner = ''): string {
  const join = (base: string): string => (inner ? `${base} ${inner}` : base)
  if (t.alias) return join(quals(t) + t.alias)
  switch (t.kind) {
    case 'pointer': {
      const q = [t.const ? 'const' : '', t.volatile ? 'volatile' : ''].filter(Boolean).join(' ')
      let s = '*' + q + (q && inner ? ' ' : '') + inner
      if (t.to.kind === 'array' || t.to.kind === 'function') s = `(${s})`
      return typeToString(t.to, s)
    }
    case 'array':
      return typeToString(t.of, `${inner}[${t.length ?? ''}]`)
    case 'function': {
      const params = !t.prototyped
        ? ''
        : t.params.length === 0 && !t.variadic
          ? 'void'
          : [...t.params.map((p) => typeToString(p.type)), ...(t.variadic ? ['...'] : [])].join(', ')
      return typeToString(t.ret, `${inner}(${params})`)
    }
    case 'int':
      return join(quals(t) + (t.enumTag ? `enum ${t.enumTag}` : t.name))
    case 'float':
      return join(quals(t) + t.name)
    case 'void':
      return join(quals(t) + 'void')
    case 'struct':
    case 'union':
      return join(`${quals(t)}${t.kind} ${t.def.tag ?? '<unnamed>'}`)
    default:
      return join('<error-type>')
  }
}

let nextRecordId = 1
export function newRecord(kind: 'struct' | 'union', tag: string | null): RecordDef {
  return { kind, tag, members: null, size: 0, align: 1, id: nextRecordId++ }
}

/** Lays out the members (EABI natural alignment) and marks the record complete. */
export function completeRecord(def: RecordDef, fields: { name: string; type: Type }[]): void {
  const members: Member[] = []
  let offset = 0
  let size = 0
  let align = 1
  for (const f of fields) {
    const a = alignOf(f.type)
    align = Math.max(align, a)
    if (def.kind === 'union') {
      members.push({ name: f.name, type: f.type, offset: 0 })
      size = Math.max(size, sizeOf(f.type))
    } else {
      offset = alignUp(offset, a)
      members.push({ name: f.name, type: f.type, offset })
      offset += sizeOf(f.type)
      size = offset
    }
  }
  def.members = members
  def.align = align
  def.size = alignUp(size, align)
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/types.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interp/frontend/types.ts tests/unit/interp/types.test.ts
git commit -m "feat(interp): C6000 EABI type model"
```

---
### Task 4: Typed AST, constant evaluation and expression semantics

**Files:**
- Create: `src/interp/frontend/ast.ts`, `src/interp/frontend/consteval.ts`, `src/interp/frontend/sema.ts`
- Test: `tests/unit/interp/sema.test.ts`, `tests/unit/interp/consteval.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `Diags`, `M`, `Loc`, `Msg`
  - Task 2: `parseChar`, `parseString`, `NumberLiteral`, `Pragma`
  - Task 3: everything in `types.ts`
- Produces:
  - `ast.ts`:
    - symbols: `VarSym`, `FuncSym`, `TypedefSym`, `EnumConstSym`, `Sym`
    - operators: `BinOp`, `CompoundOp`
    - nodes: `Expr` (discriminated by `k`), `Stmt`, `Block`, `CaseStmt`, `DefaultStmt`, `LabelStmt`, `GotoStmt`
    - initialisers: `Init`, `InitItem`
    - program: `FunctionDef`, `TranslationUnit`
  - `consteval.ts`:
    - `evalConst(e): ConstValue | null`, where `ConstValue` is one of `{k:'int', value}`, `{k:'float', value}` or `{k:'addr', base, offset}`
    - `evalIntConst(e): bigint | null`
    - `wrapInt(v, t)`
  - `sema.ts`:
    - `new Sema(diags, dialect)` with methods `rvalue, convert, promoteArg, convertFor, varRef, funcRef, number, char, string, unary, binary, cond, comma, assign, compound, incdec, addr, deref, index, member, arrow, call, cast, sizeofType, sizeofExpr, condition, switchValue, returnValue, memAccess, vaStart, vaArg`
    - helpers `isLvalue(e)`, `isNullPointerConstant(e)` and `MEM_INTRINSICS`
    - type `ConvContext`

- [ ] **Step 1: Write the failing tests**

```ts path=tests/unit/interp/sema.test.ts
import { describe, expect, it } from 'vitest'
import type { Expr, FuncSym, VarSym } from '../../../src/interp/frontend/ast'
import { Diags } from '../../../src/interp/frontend/diag'
import { Sema } from '../../../src/interp/frontend/sema'
import { T, arrayOf, completeRecord, newRecord, pointerTo, typeToString, withQuals, type FunctionType, type Type } from '../../../src/interp/frontend/types'

const L = { file: 'f.c', line: 1, col: 1 }
let nextId = 0
function v(name: string, type: Type, storage: VarSym['storage'] = 'auto'): VarSym {
  return { kind: 'var', name, linkName: name, type, loc: L, storage, external: false, file: 'f.c', init: null, defined: true, cregister: false, register: false, hidden: false, refs: 0, sets: 0, id: nextId++ }
}
function f(name: string, type: FunctionType): FuncSym {
  return { kind: 'func', name, type, loc: L, file: 'f.c', external: true, def: null, implicit: false, library: false, used: false }
}
const int = (n: number, type: Type = T.int): Expr => ({ k: 'int', loc: L, type, value: BigInt(n) })
const flt = (x: number, type: Type = T.double): Expr => ({ k: 'float', loc: L, type, value: x })
const proto = (ret: Type, params: Type[], variadic = false): FunctionType => ({
  kind: 'function', ret, params: params.map((type) => ({ name: null, type, loc: null })), variadic, prototyped: true
})
function sema(): { s: Sema; codes: () => string[] } {
  const diags = new Diags()
  return { s: new Sema(diags, 'c89'), codes: () => diags.list.map((d) => d.code) }
}
const rec = (): Type => {
  const def = newRecord('struct', 'S')
  completeRecord(def, [{ name: 'a', type: T.int }])
  return { kind: 'struct', def }
}

describe('expression typing', () => {
  it('applies the usual arithmetic conversions with explicit implicit casts', () => {
    const { s, codes } = sema()
    const sum = s.binary('+', s.varRef(v('c', T.char), L), s.varRef(v('f', T.float), L), L)
    expect(sum.type).toBe(T.float)
    expect(sum).toMatchObject({ k: 'binary', left: { k: 'cast', implicit: true, type: T.float } })
    expect(s.binary('+', s.varRef(v('a', T.char), L), s.varRef(v('b', T.short), L), L).type).toBe(T.int)
    expect(s.binary('<', int(1), flt(2), L)).toMatchObject({ type: T.int, left: { type: T.double } })
    expect(s.binary('<<', s.varRef(v('u', T.uchar), L), s.varRef(v('l', T.llong), L), L).type).toBe(T.int)
    expect(codes()).toEqual([])
  })
  it('scales pointer arithmetic and decays arrays', () => {
    const { s } = sema()
    const p = v('p', pointerTo(T.int))
    const q = v('q', pointerTo(T.int))
    expect(s.binary('+', s.varRef(p, L), int(2), L)).toMatchObject({ k: 'ptradd', scale: 4, sub: false })
    expect(s.binary('-', s.varRef(p, L), s.varRef(q, L), L)).toMatchObject({ k: 'ptrdiff', scale: 4, type: T.int })
    const a = v('a', arrayOf(T.float, 8))
    const e = s.index(s.varRef(a, L), int(3), L)
    expect(e).toMatchObject({ k: 'deref', type: T.float, arg: { k: 'ptradd', scale: 4, ptr: { k: 'decay' } } })
  })
  it('gives member access the member type and keeps const', () => {
    const { s } = sema()
    const sv = v('s', withQuals(rec(), { const: true }))
    const m = s.member(s.varRef(sv, L), 'a', L)
    expect(typeToString(m.type)).toBe('const int')
    const ps = v('ps', pointerTo(rec()))
    expect(s.arrow(s.varRef(ps, L), 'a', L)).toMatchObject({ k: 'member', member: { name: 'a', offset: 0 }, base: { k: 'deref' } })
  })
})

describe('cl6x diagnostics', () => {
  const cases: [string, (s: Sema) => unknown, string[]][] = [
    ['% needs integers', (s) => s.binary('%', int(1), flt(2), L), ['31']],
    ['pointer + pointer', (s) => s.binary('+', s.varRef(v('p', pointerTo(T.int)), L), s.varRef(v('q', pointerTo(T.int)), L), L), ['31']],
    ['pointer * int', (s) => s.binary('*', s.varRef(v('p', pointerTo(T.int)), L), int(2), L), ['32']],
    ['-pointer', (s) => s.unary('-', s.varRef(v('p', pointerTo(T.int)), L), L), ['32']],
    ['!struct', (s) => s.unary('!', s.varRef(v('s', rec()), L), L), ['42']],
    ['assign to a constant', (s) => s.assign(int(3), int(4), L), ['138']],
    ['assign to const', (s) => s.assign(s.varRef(v('c', withQuals(T.int, { const: true })), L), int(2), L), ['138-D']],
    ['assign to an array', (s) => s.assign(s.varRef(v('a', arrayOf(T.int, 3)), L), int(0), L), ['138']],
    ['int = char *', (s) => s.assign(s.varRef(v('x', T.int), L), s.varRef(v('p', pointerTo(T.char)), L), L), ['515-D']],
    ['int * = float', (s) => s.assign(s.varRef(v('p', pointerTo(T.int)), L), s.varRef(v('f', T.float), L), L), ['515']],
    ['struct = int', (s) => s.assign(s.varRef(v('s', rec()), L), int(1), L), ['515']],
    ['*int', (s) => s.deref(s.varRef(v('x', T.int), L), L), ['76']],
    ['call an int', (s) => s.call(s.varRef(v('x', T.int), L), [], L), ['110']],
    ['x.y on an int', (s) => s.member(s.varRef(v('x', T.int), L), 'y', L), ['156']],
    ['s->a on a struct', (s) => s.arrow(s.varRef(v('s', rec()), L), 'a', L), ['45']],
    ['no such field', (s) => s.member(s.varRef(v('s', rec()), L), 'b', L), ['137']],
    ['pointer == double', (s) => s.binary('==', s.varRef(v('p', pointerTo(T.int)), L), flt(1), L), ['43']],
    ['int * == float *', (s) => s.binary('==', s.varRef(v('p', pointerTo(T.int)), L), s.varRef(v('q', pointerTo(T.float)), L), L), ['43-D']],
    ['(int)struct', (s) => s.cast(T.int, s.varRef(v('s', rec()), L), L), ['173']],
    ['(int *)1.5', (s) => s.cast(pointerTo(T.int), flt(1.5), L), ['173']],
    ['&3', (s) => s.addr(int(3), L), ['160']],
    ['3[4]', (s) => s.index(int(3), int(4), L), ['143']],
    ['a[1.0]', (s) => s.index(s.varRef(v('a', arrayOf(T.int, 2)), L), flt(1), L), ['31']],
    ['void * ++', (s) => s.incdec('++', s.varRef(v('p', pointerTo(T.void)), L), false, L), ['1219-D']],
    ['1 / 0', (s) => s.binary('/', int(1), int(0), L), ['40-D']],
    ['a[5] on int a[3]', (s) => s.index(s.varRef(v('a', arrayOf(T.int, 3)), L), int(5), L), ['177-D']],
    ['&register', (s) => s.addr(s.varRef({ ...v('r', T.int), register: true }, L), L), ['139-D']],
    ['if (struct)', (s) => s.condition(s.varRef(v('s', rec()), L)), ['42']],
    ['switch (float)', (s) => s.switchValue(flt(1)), ['31']],
    ['sizeof incomplete', (s) => s.sizeofType({ kind: 'struct', def: newRecord('struct', 'X') }, L), ['71']],
    ['x ? 1 : ptr', (s) => s.cond(s.varRef(v('x', T.int), L), s.varRef(v('x', T.int), L), s.varRef(v('q', pointerTo(T.float)), L), L), ['43-D']],
    ['return 1 in void', (s) => s.returnValue(T.void, 'f', int(1), L), ['121-D']],
    ['return; in int', (s) => s.returnValue(T.int, 'main', null, L), ['118-D']],
    ['return struct as int', (s) => s.returnValue(T.int, 'f', s.varRef(v('s', rec()), L), L), ['121']]
  ]
  for (const [name, build, expected] of cases) {
    it(name, () => {
      const { s, codes } = sema()
      build(s)
      expect(codes()).toEqual(expected)
    })
  }
})

describe('calls', () => {
  it('converts prototyped arguments and promotes variadic ones', () => {
    const { s, codes } = sema()
    const printf = f('printf', proto(T.int, [pointerTo(withQuals(T.char, { const: true }))], true))
    const str = s.string(['"x=%f %d\\n"'], L)
    const call = s.call(s.funcRef(printf, L), [str, s.varRef(v('x', T.float), L), s.varRef(v('c', T.char), L)], L)
    expect(call).toMatchObject({ k: 'call', fn: printf, type: T.int })
    if (call.k !== 'call') throw new Error('not a call')
    expect(call.args.map((a) => typeToString(a.type))).toEqual(['const char *', 'double', 'int'])
    expect(printf.used).toBe(true)
    expect(codes()).toEqual([])
  })
  it('checks the argument count and types', () => {
    const two = f('f', proto(T.int, [T.int, T.int]))
    const ptr = f('g', proto(T.int, [pointerTo(T.int)]))
    const run = (build: (s: Sema) => unknown): string[] => {
      const { s, codes } = sema()
      build(s)
      return codes()
    }
    expect(run((s) => s.call(s.funcRef(two, L), [int(1)], L))).toEqual(['167'])
    expect(run((s) => s.call(s.funcRef(two, L), [int(1), int(2), int(3)], L))).toEqual(['141'])
    expect(run((s) => s.call(s.funcRef(ptr, L), [flt(3)], L))).toEqual(['169'])
    expect(run((s) => s.call(s.funcRef(ptr, L), [s.varRef(v('x', T.int), L)], L))).toEqual(['169-D'])
    expect(run((s) => s.call(s.funcRef(ptr, L), [int(0)], L))).toEqual([])
  })
})

describe('constant conversions', () => {
  it('warns about a change of sign or truncation, like cl6x', () => {
    const run = (e: Expr, to: Type): string[] => {
      const { s, codes } = sema()
      s.convertFor(e, to, 'init')
      return codes()
    }
    expect(run(int(-1), T.uint)).toEqual(['69-D'])
    expect(run(int(300), T.uchar)).toEqual(['70-D'])
    expect(run(int(0x6162), T.char)).toEqual(['70-D'])
    expect(run(int(100), T.char)).toEqual([])
    expect(run(int(5), pointerTo(T.int))).toEqual(['145-D'])
  })
})

describe('usage tracking for #179-D and #552-D', () => {
  it('counts a plain assignment as a set, not a use', () => {
    const { s } = sema()
    const x = v('x', T.int)
    s.assign(s.varRef(x, L), int(1), L)
    expect([x.refs, x.sets]).toEqual([0, 1])
    const a = v('a', arrayOf(T.int, 2))
    s.assign(s.index(s.varRef(a, L), int(0), L), int(1), L)
    expect([a.refs, a.sets]).toEqual([0, 1])
  })
  it('counts compound assignment, ++ and stores through a pointer as uses', () => {
    const { s } = sema()
    const y = v('y', T.int)
    s.compound('+=', s.varRef(y, L), int(1), L)
    s.incdec('++', s.varRef(y, L), false, L)
    expect(y.refs).toBe(2)
    const p = v('p', pointerTo(T.int))
    s.assign(s.deref(s.varRef(p, L), L), int(1), L)
    expect([p.refs, p.sets]).toEqual([1, 0])
  })
})

describe('literals', () => {
  it('types integer constants by value and dialect', () => {
    const { s } = sema()
    const lit = (value: bigint, decimal = true, unsigned = false, longs: 0 | 1 | 2 = 0): Type =>
      s.number({ kind: 'int', value, decimal, unsigned, longs }, L).type
    expect(lit(5n)).toBe(T.int)
    expect(lit(3000000000n)).toBe(T.ulong)
    expect(lit(3000000000n, false)).toBe(T.uint)
    expect(lit(5n, true, true)).toBe(T.uint)
    expect(lit(5n, true, false, 2)).toBe(T.llong)
    expect(new Sema(new Diags(), 'c99').number({ kind: 'int', value: 3000000000n, decimal: true, unsigned: false, longs: 0 }, L).type).toBe(T.llong)
  })
  it('makes string literals char arrays including the NUL, and warns on multichar constants', () => {
    const diags = new Diags()
    const s = new Sema(diags, 'c89')
    const str = s.string(['"ab"', '"c"'], L)
    expect(str).toMatchObject({ k: 'string', bytes: [97, 98, 99, 0] })
    expect(typeToString(str.type)).toBe('char [4]')
    expect(s.char("'ab'", L)).toMatchObject({ k: 'int', value: 0x6162n, type: T.int })
    expect(diags.list.map((d) => d.code)).toEqual(['1696-D'])
  })
})
```

```ts path=tests/unit/interp/consteval.test.ts
import { describe, expect, it } from 'vitest'
import type { Expr, VarSym } from '../../../src/interp/frontend/ast'
import { evalConst, evalIntConst } from '../../../src/interp/frontend/consteval'
import { Diags } from '../../../src/interp/frontend/diag'
import { Sema } from '../../../src/interp/frontend/sema'
import { T, arrayOf, completeRecord, newRecord, pointerTo, type Type } from '../../../src/interp/frontend/types'

const L = { file: 'f.c', line: 1, col: 1 }
const s = new Sema(new Diags(), 'c89')
const int = (n: number, type: Type = T.int): Expr => ({ k: 'int', loc: L, type, value: BigInt(n) })
const flt = (x: number, type: Type = T.double): Expr => ({ k: 'float', loc: L, type, value: x })
function v(name: string, type: Type, storage: VarSym['storage']): VarSym {
  return { kind: 'var', name, linkName: name, type, loc: L, storage, external: true, file: 'f.c', init: null, defined: true, cregister: false, register: false, hidden: false, refs: 0, sets: 0, id: 0 }
}

describe('evalConst', () => {
  it('folds integer arithmetic with wrap-around at the type width', () => {
    expect(evalIntConst(s.binary('+', int(0x7fffffff), int(1), L))).toBe(-2147483648n)
    expect(evalIntConst(s.binary('*', int(6), int(7), L))).toBe(42n)
    expect(evalIntConst(s.binary('<', int(-1), int(0, T.uint), L))).toBe(0n)
    expect(evalIntConst(s.binary('>>', int(-8), int(1), L))).toBe(-4n)
    expect(evalIntConst(s.binary('/', int(1), int(0), L))).toBeNull()
  })
  it('converts between integer and floating constants like the C6000', () => {
    expect(evalIntConst(s.cast(T.int, flt(-2.7), L))).toBe(-2n)
    expect(evalIntConst(s.cast(T.char, int(200), L))).toBe(-56n)
    expect(evalIntConst(s.cast(T.bool, flt(0.5), L))).toBe(1n)
    expect(evalConst(s.binary('*', flt(1.5, T.float), flt(2, T.float), L))).toEqual({ k: 'float', value: 3 })
    expect(evalConst(s.cast(T.float, flt(0.1), L))).toEqual({ k: 'float', value: Math.fround(0.1) })
  })
  it('short-circuits && and ?: without needing the other operand', () => {
    const x = s.varRef(v('x', T.int, 'auto'), L)
    expect(evalIntConst(s.binary('&&', int(0), x, L))).toBe(0n)
    expect(evalIntConst(s.cond(int(0), x, int(2), L))).toBe(2n)
    expect(evalIntConst(x)).toBeNull()
  })
  it('computes address constants for static objects only', () => {
    const g = v('g', arrayOf(T.int, 4), 'global')
    expect(evalConst(s.addr(s.index(s.varRef(g, L), int(2), L), L))).toEqual({ k: 'addr', base: g, offset: 8 })
    expect(evalConst(s.rvalue(s.varRef(g, L)))).toEqual({ k: 'addr', base: g, offset: 0 })
    expect(evalConst(s.addr(s.varRef(v('a', T.int, 'auto'), L), L))).toBeNull()
  })
  it('evaluates the offsetof pattern to an integer', () => {
    const def = newRecord('struct', 'S')
    completeRecord(def, [{ name: 'c', type: T.char }, { name: 'd', type: T.double }])
    const nullS = s.cast(pointerTo({ kind: 'struct', def }), int(0), L)
    expect(evalIntConst(s.cast(T.uint, s.addr(s.arrow(nullS, 'd', L), L), L))).toBe(8n)
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/sema.test.ts tests/unit/interp/consteval.test.ts`
Expected: FAIL, because the modules `ast`, `sema` and `consteval` do not exist.

- [ ] **Step 3: Define the AST**

```ts path=src/interp/frontend/ast.ts
import type { Loc } from './diag'
import type { Pragma } from './preprocessor'
import type { FunctionType, Member, Type } from './types'

/** An object: global, file static, function-local static, parameter or automatic variable. */
export interface VarSym {
  kind: 'var'
  name: string
  /** Name in the linked image: `name`, or `name$N` for a function-local static (as cl6x names it). */
  linkName: string
  type: Type
  loc: Loc
  storage: 'global' | 'static' | 'extern' | 'auto' | 'param'
  /** Has external linkage (visible to other translation units). */
  external: boolean
  /** Main source file of the translation unit that declared it. */
  file: string
  init: Init | null
  /** A definition rather than only an `extern` declaration. */
  defined: boolean
  /** Declared `__cregister` (a C6000 control register such as TSCL or CSR). */
  cregister: boolean
  register: boolean
  /** Compiler-generated (VLA length, compound literal, poisoned undefined name): no usage warnings. */
  hidden: boolean
  /** Uses as a value, and plain `=` stores, for cl6x's #179-D and #552-D warnings. */
  refs: number
  sets: number
  /** Unique within the translation unit. */
  id: number
}

export interface FuncSym {
  kind: 'func'
  name: string
  type: FunctionType
  loc: Loc
  file: string
  external: boolean
  def: FunctionDef | null
  /** Declared implicitly by a call (cl6x #225-D). */
  implicit: boolean
  /** Declared by a LabSim built-in header or the intrinsic prelude: provided by the runtime. */
  library: boolean
  used: boolean
}

export interface TypedefSym {
  kind: 'typedef'
  name: string
  type: Type
  loc: Loc
}

export interface EnumConstSym {
  kind: 'enum'
  name: string
  value: bigint
  loc: Loc
}

export type Sym = VarSym | FuncSym | TypedefSym | EnumConstSym

export type BinOp = '*' | '/' | '%' | '+' | '-' | '<<' | '>>' | '<' | '>' | '<=' | '>=' | '==' | '!=' | '&' | '^' | '|'
export type CompoundOp = '*=' | '/=' | '%=' | '+=' | '-=' | '<<=' | '>>=' | '&=' | '^=' | '|='

interface E {
  loc: Loc
  type: Type
}

/**
 * A typed expression. Implicit conversions are explicit `cast` nodes (implicit: true), arrays used as values are
 * `decay` nodes and function designators used as values are `addr` nodes. `a[i]` is `deref(ptradd(a, i))` and
 * `p->m` is `member(deref(p), m)`. Lvalues: var, deref, member of an lvalue, string, compoundLit.
 */
export type Expr =
  | (E & { k: 'int'; value: bigint })
  | (E & { k: 'float'; value: number })
  | (E & { k: 'string'; bytes: number[] })
  | (E & { k: 'var'; sym: VarSym })
  | (E & { k: 'func'; sym: FuncSym })
  | (E & { k: 'unary'; op: '-' | '+' | '~' | '!'; arg: Expr })
  | (E & { k: 'deref'; arg: Expr })
  | (E & { k: 'addr'; arg: Expr })
  | (E & { k: 'binary'; op: BinOp; left: Expr; right: Expr })
  | (E & { k: 'ptradd'; ptr: Expr; index: Expr; scale: number; sub: boolean })
  | (E & { k: 'ptrdiff'; left: Expr; right: Expr; scale: number })
  | (E & { k: 'logical'; op: '&&' | '||'; left: Expr; right: Expr })
  | (E & { k: 'assign'; target: Expr; value: Expr })
  | (E & { k: 'compound'; op: CompoundOp; target: Expr; value: Expr; opType: Type; scale: number })
  | (E & { k: 'incdec'; op: '++' | '--'; prefix: boolean; target: Expr; scale: number })
  | (E & { k: 'cond'; test: Expr; then: Expr; else: Expr })
  | (E & { k: 'comma'; left: Expr; right: Expr })
  | (E & { k: 'call'; callee: Expr; args: Expr[]; fn: FuncSym | null })
  | (E & { k: 'member'; base: Expr; member: Member })
  | (E & { k: 'cast'; arg: Expr; implicit: boolean })
  | (E & { k: 'decay'; arg: Expr })
  | (E & { k: 'compoundLit'; obj: VarSym; init: Init })
  | (E & { k: 'vaStart'; ap: Expr; last: VarSym | null })
  | (E & { k: 'vaArg'; ap: Expr })
  | (E & { k: 'error' })

/** One store of an aggregate initialiser: a scalar, a struct copy, or a string into a char array (bytes truncated to the array). */
export interface InitItem {
  offset: number
  type: Type
  expr: Expr
}

/** `list`: zero the object, then apply the items in order. */
export type Init = { k: 'expr'; expr: Expr } | { k: 'list'; items: InitItem[] }

interface S {
  loc: Loc
}
export type Block = S & { k: 'block'; body: Stmt[]; end: Loc }
export type CaseStmt = S & { k: 'case'; value: bigint; body: Stmt }
export type DefaultStmt = S & { k: 'default'; body: Stmt }
export type LabelStmt = S & { k: 'label'; name: string; body: Stmt }
export type GotoStmt = S & { k: 'goto'; label: string; target: LabelStmt | null }

export type Stmt =
  | (S & { k: 'expr'; expr: Expr })
  /** Automatic variables to create and initialise, in order (a VLA's hidden length variable comes before the array). */
  | (S & { k: 'decl'; vars: VarSym[] })
  | Block
  | (S & { k: 'if'; test: Expr; then: Stmt; else: Stmt | null })
  | (S & { k: 'while'; test: Expr; body: Stmt })
  | (S & { k: 'do'; body: Stmt; test: Expr })
  | (S & { k: 'for'; init: Stmt | null; test: Expr | null; step: Expr | null; body: Stmt })
  | (S & { k: 'switch'; test: Expr; body: Stmt; cases: CaseStmt[]; default: DefaultStmt | null })
  | CaseStmt
  | DefaultStmt
  | (S & { k: 'break' })
  | (S & { k: 'continue' })
  | (S & { k: 'return'; value: Expr | null })
  | GotoStmt
  | LabelStmt
  | (S & { k: 'empty' })

export interface FunctionDef {
  sym: FuncSym
  params: VarSym[]
  body: Block
  /** Every automatic object of the body (declared variables, VLA lengths, compound literals). */
  locals: VarSym[]
  /** Function-local statics (also listed in the unit's objects). */
  statics: VarSym[]
  loc: Loc
  /** The closing brace: CCS stops here when stepping out of the function. */
  end: Loc
}

export interface TranslationUnit {
  file: string
  functions: FunctionDef[]
  /** Objects with static storage declared in the unit, including extern declarations and function-local statics. */
  objects: VarSym[]
  /** Every function declared in the unit, implicitly or not. */
  funcs: FuncSym[]
  pragmas: Pragma[]
}
```

- [ ] **Step 4: Implement constant evaluation**

```ts path=src/interp/frontend/consteval.ts
import type { Expr, FuncSym, VarSym } from './ast'
import { isFloating, isInteger, isPointer, type IntType, type Type } from './types'

export type ConstBase = VarSym | FuncSym | Extract<Expr, { k: 'string' }>

export type ConstValue =
  | { k: 'int'; value: bigint }
  | { k: 'float'; value: number }
  /** An address constant; base null is the null pointer (or an integer cast to a pointer). */
  | { k: 'addr'; base: ConstBase | null; offset: number }

export function wrapInt(v: bigint, t: IntType): bigint {
  if (t.name === '_Bool') return v !== 0n ? 1n : 0n
  return t.signed ? BigInt.asIntN(t.bits, v) : BigInt.asUintN(t.bits, v)
}

const roundTo = (v: number, t: Type): number => (t.kind === 'float' && t.name === 'float' ? Math.fround(v) : v)
const bool = (c: boolean): ConstValue => ({ k: 'int', value: c ? 1n : 0n })
const num = (v: ConstValue): number | null => (v.k === 'int' ? Number(v.value) : v.k === 'float' ? v.value : null)

function truth(v: ConstValue): boolean {
  if (v.k === 'int') return v.value !== 0n
  if (v.k === 'float') return v.value !== 0
  return v.base !== null || v.offset !== 0
}

export function evalIntConst(e: Expr): bigint | null {
  const v = evalConst(e)
  return v && v.k === 'int' ? v.value : null
}

/** The value of a constant expression, or null when it is not constant (C 6.6). */
export function evalConst(e: Expr): ConstValue | null {
  switch (e.k) {
    case 'int':
      return { k: 'int', value: isInteger(e.type) ? wrapInt(e.value, e.type) : e.value }
    case 'float':
      return { k: 'float', value: roundTo(e.value, e.type) }
    case 'cast':
      return convert(evalConst(e.arg), e.type)
    case 'unary': {
      const v = evalConst(e.arg)
      if (!v) return null
      if (e.op === '!') return bool(!truth(v))
      if (v.k === 'addr') return null
      if (v.k === 'float') return { k: 'float', value: roundTo(e.op === '-' ? -v.value : v.value, e.type) }
      const x = e.op === '-' ? -v.value : e.op === '~' ? ~v.value : v.value
      return { k: 'int', value: wrapInt(x, e.type as IntType) }
    }
    case 'binary':
      return binary(e)
    case 'logical': {
      const a = evalConst(e.left)
      if (!a) return null
      if (e.op === '&&' && !truth(a)) return bool(false)
      if (e.op === '||' && truth(a)) return bool(true)
      const b = evalConst(e.right)
      return b ? bool(truth(b)) : null
    }
    case 'cond': {
      const c = evalConst(e.test)
      return c ? evalConst(truth(c) ? e.then : e.else) : null
    }
    case 'ptradd': {
      const p = evalConst(e.ptr)
      const i = evalConst(e.index)
      if (!p || p.k !== 'addr' || !i || i.k !== 'int') return null
      const d = Number(i.value) * e.scale
      return { k: 'addr', base: p.base, offset: p.offset + (e.sub ? -d : d) }
    }
    case 'addr':
    case 'decay':
      return addressOf(e.arg)
    default:
      return null
  }
}

function addressOf(e: Expr): ConstValue | null {
  switch (e.k) {
    case 'var':
      return e.sym.storage === 'auto' || e.sym.storage === 'param' ? null : { k: 'addr', base: e.sym, offset: 0 }
    case 'func':
      return { k: 'addr', base: e.sym, offset: 0 }
    case 'string':
      return { k: 'addr', base: e, offset: 0 }
    case 'member': {
      const b = addressOf(e.base)
      return b && b.k === 'addr' ? { ...b, offset: b.offset + e.member.offset } : null
    }
    case 'deref': {
      const p = evalConst(e.arg)
      return p && p.k === 'addr' ? p : null
    }
    case 'compoundLit':
      return e.obj.storage === 'static' ? { k: 'addr', base: e.obj, offset: 0 } : null
    default:
      return null
  }
}

function convert(v: ConstValue | null, to: Type): ConstValue | null {
  if (!v) return null
  if (isInteger(to)) {
    if (v.k === 'int') return { k: 'int', value: wrapInt(v.value, to) }
    if (v.k === 'float') {
      if (to.name === '_Bool') return bool(v.value !== 0)
      return Number.isFinite(v.value) ? { k: 'int', value: wrapInt(BigInt(Math.trunc(v.value)), to) } : null
    }
    if (v.base === null) return { k: 'int', value: wrapInt(BigInt(v.offset), to) }
    return to.name === '_Bool' ? bool(true) : null
  }
  if (isFloating(to)) {
    const n = num(v)
    return n === null ? null : { k: 'float', value: roundTo(n, to) }
  }
  if (isPointer(to)) {
    if (v.k === 'int') return { k: 'addr', base: null, offset: Number(BigInt.asUintN(32, v.value)) }
    return v.k === 'addr' ? v : null
  }
  return null
}

function compare(op: string, x: number | bigint, y: number | bigint): boolean {
  switch (op) {
    case '<': return x < y
    case '>': return x > y
    case '<=': return x <= y
    case '>=': return x >= y
    case '==': return x === y
    default: return x !== y
  }
}

function binary(e: Extract<Expr, { k: 'binary' }>): ConstValue | null {
  const a = evalConst(e.left)
  const b = evalConst(e.right)
  if (!a || !b) return null
  const cmp = ['<', '>', '<=', '>=', '==', '!='].includes(e.op)
  if (a.k === 'addr' || b.k === 'addr') {
    if (a.k !== 'addr' || b.k !== 'addr' || a.base !== b.base || !cmp) return null
    return bool(compare(e.op, a.offset, b.offset))
  }
  if (a.k === 'float' || b.k === 'float') {
    const x = num(a) as number
    const y = num(b) as number
    if (cmp) return bool(compare(e.op, x, y))
    let r: number
    switch (e.op) {
      case '+': r = x + y; break
      case '-': r = x - y; break
      case '*': r = x * y; break
      case '/': r = x / y; break
      default: return null
    }
    return { k: 'float', value: roundTo(r, e.type) }
  }
  const x = a.value
  const y = b.value
  if (cmp) return bool(compare(e.op, x, y))
  const t = e.type as IntType
  let r: bigint
  switch (e.op) {
    case '+': r = x + y; break
    case '-': r = x - y; break
    case '*': r = x * y; break
    case '/':
      if (y === 0n) return null
      r = x / y
      break
    case '%':
      if (y === 0n) return null
      r = x % y
      break
    case '<<': r = x << (y & 63n); break
    case '>>': r = x >> (y & 63n); break
    case '&': r = x & y; break
    case '|': r = x | y; break
    default: r = x ^ y
  }
  return { k: 'int', value: wrapInt(r, t) }
}
```

- [ ] **Step 5: Implement expression semantics**

```ts path=src/interp/frontend/sema.ts
import type { BinOp, CompoundOp, Expr, FuncSym, VarSym } from './ast'
import { evalIntConst } from './consteval'
import { M, type Diags, type Loc, type Msg } from './diag'
import { parseChar, parseString, type NumberLiteral } from './literals'
import {
  T, arrayOf, compatibleUnqual, intType, isArithmetic, isComplete, isFloating, isInteger, isPointer, isRecord, isScalar,
  pointerTo, promote, sizeOf, typeToString, unqual, usualArith, withQuals,
  type IntName, type IntType, type PointerType, type Type
} from './types'

export type ConvContext = 'assign' | 'init' | 'arg' | 'return'

const errorExpr = (loc: Loc): Expr => ({ k: 'error', loc, type: T.error })
const isErr = (...es: Expr[]): boolean => es.some((e) => e.type.kind === 'error')

export function isLvalue(e: Expr): boolean {
  switch (e.k) {
    case 'var':
    case 'deref':
    case 'string':
    case 'compoundLit':
      return true
    case 'member':
      return isLvalue(e.base)
    default:
      return false
  }
}

/** An integer constant 0, possibly cast to an integer or to void *. */
export function isNullPointerConstant(e: Expr): boolean {
  let x = e
  while (x.k === 'cast' && (isInteger(x.type) || (isPointer(x.type) && x.type.to.kind === 'void'))) x = x.arg
  return isInteger(x.type) && evalIntConst(x) === 0n
}

/** The variable a plain `=` stores into, when the store does not go through a pointer. */
function storedVar(e: Expr): VarSym | null {
  switch (e.k) {
    case 'var':
      return e.sym
    case 'member':
      return storedVar(e.base)
    case 'deref': {
      const p = e.arg.k === 'ptradd' ? e.arg.ptr : e.arg
      return p.k === 'decay' ? storedVar(p.arg) : null
    }
    default:
      return null
  }
}

const DEC_C89: IntName[] = ['int', 'long', 'unsigned long', 'long long', 'unsigned long long']
const DEC_C99: IntName[] = ['int', 'long', 'long long', 'unsigned long long']
const NON_DEC: IntName[] = ['int', 'unsigned int', 'long', 'unsigned long', 'long long', 'unsigned long long']
const UNSIGNED: IntName[] = ['unsigned int', 'unsigned long', 'unsigned long long']

const cnst = (t: Type): Type => withQuals(t, { const: true })
const MEM_TYPES: Record<string, Type> = {
  _mem2: T.ushort, _amem2: T.ushort, _mem4: T.uint, _amem4: T.uint, _mem8: T.ullong, _amem8: T.ullong,
  _memd8: T.double, _amemd8: T.double, _mem4_const: cnst(T.uint), _amem4_const: cnst(T.uint),
  _mem8_const: cnst(T.ullong), _amem8_const: cnst(T.ullong), _memd8_const: cnst(T.double), _amemd8_const: cnst(T.double)
}
/** TI's unaligned/aligned memory-access intrinsics: `_amem4(p)` is an lvalue. */
export const MEM_INTRINSICS: ReadonlySet<string> = new Set(Object.keys(MEM_TYPES))

function convMsg(ctx: ConvContext, from: Type, to: Type, d: boolean): Msg {
  const f = typeToString(from)
  const t = typeToString(to)
  switch (ctx) {
    case 'assign': return M.badAssign(f, t, d)
    case 'init': return M.badInit(f, t, d)
    case 'arg': return M.badArg(f, t, d)
    default: return M.badReturn(d)
  }
}

/** Builds typed expression nodes, inserting conversions and reporting cl6x's diagnostics. */
export class Sema {
  constructor(
    readonly diags: Diags,
    private readonly dialect: 'c89' | 'c99'
  ) {}

  private fail(at: Loc, m: Msg): Expr {
    this.diags.error(at, m)
    return errorExpr(at)
  }

  // ------------------------------------------------------------ conversions

  /** Arrays decay to a pointer to their first element; functions to a pointer to the function. */
  rvalue(e: Expr): Expr {
    if (e.type.kind === 'array') return { k: 'decay', loc: e.loc, type: pointerTo(e.type.of), arg: e }
    if (e.type.kind === 'function') return { k: 'addr', loc: e.loc, type: pointerTo(e.type), arg: e }
    return e
  }

  /** An implicit conversion node when the (unqualified) types differ. */
  convert(e: Expr, to: Type): Expr {
    const target = unqual(to)
    if (e.type.kind === 'error' || target.kind === 'error' || compatibleUnqual(e.type, target)) return e
    return { k: 'cast', loc: e.loc, type: target, arg: e, implicit: true }
  }

  /** Default argument promotions, for variadic and unprototyped arguments. */
  promoteArg(e: Expr): Expr {
    const r = this.rvalue(e)
    if (r.type.kind === 'float' && r.type.name === 'float') return this.convert(r, T.double)
    if (r.type.kind === 'int') return this.convert(r, promote(r.type))
    return r
  }

  /** Conversion as if by assignment (assign, initialise, pass, return), with cl6x's diagnostics. */
  convertFor(e: Expr, to: Type, ctx: ConvContext): Expr {
    const r = this.rvalue(e)
    if (isErr(r) || to.kind === 'error') return r
    const c = this.compat(unqual(to), r)
    if (c === 'error') return this.fail(r.loc, convMsg(ctx, r.type, to, false))
    if (c === 'warn') this.diags.warning(r.loc, convMsg(ctx, r.type, to, true))
    if (isInteger(to) && to.name !== '_Bool' && isInteger(r.type)) this.checkFits(r, to)
    return this.convert(r, to)
  }

  private compat(to: Type, from: Expr): 'ok' | 'warn' | 'error' {
    const f = from.type
    if (f.kind === 'void') return 'error'
    if (isArithmetic(to) && isArithmetic(f)) return 'ok'
    if (to.kind === 'int' && to.name === '_Bool' && isPointer(f)) return 'ok'
    if (isRecord(to) || isRecord(f)) return compatibleUnqual(to, f) ? 'ok' : 'error'
    if (isPointer(to)) {
      if (isPointer(f)) {
        const tp = to.to
        const fp = f.to
        const keepsQuals = (!fp.const || !!tp.const) && (!fp.volatile || !!tp.volatile)
        if (tp.kind === 'void' || fp.kind === 'void' || compatibleUnqual(tp, fp)) return keepsQuals ? 'ok' : 'warn'
        return 'warn'
      }
      if (isInteger(f)) return isNullPointerConstant(from) ? 'ok' : 'warn'
      return 'error'
    }
    if (isInteger(to) && isPointer(f)) return 'warn'
    return 'error'
  }

  /** #69-D / #70-D when an integer constant does not fit the target type. */
  private checkFits(e: Expr, to: IntType): void {
    const v = evalIntConst(e)
    if (v === null) return
    const b = BigInt(to.bits)
    const lo = to.signed ? -(1n << (b - 1n)) : 0n
    const hi = to.signed ? (1n << (b - 1n)) - 1n : (1n << b) - 1n
    if (v >= lo && v <= hi) return
    const fitsBits = v >= -(1n << (b - 1n)) && v <= (1n << b) - 1n
    this.diags.warning(e.loc, fitsBits ? M.signChange() : M.truncation())
  }

  // ------------------------------------------------------------ primaries

  varRef(sym: VarSym, at: Loc): Expr {
    sym.refs++
    return { k: 'var', loc: at, type: sym.type, sym }
  }

  funcRef(sym: FuncSym, at: Loc): Expr {
    sym.used = true
    return { k: 'func', loc: at, type: sym.type, sym }
  }

  number(lit: NumberLiteral, at: Loc): Expr {
    if (lit.kind === 'error') return errorExpr(at)
    if (lit.kind === 'float') {
      const type = lit.suffix === 'f' ? T.float : lit.suffix === 'l' ? T.ldouble : T.double
      return { k: 'float', loc: at, type, value: lit.value }
    }
    let names = lit.unsigned ? UNSIGNED : lit.decimal ? (this.dialect === 'c99' ? DEC_C99 : DEC_C89) : NON_DEC
    if (lit.longs === 1) names = names.filter((n) => n.includes('long'))
    if (lit.longs === 2) names = names.filter((n) => n.includes('long long'))
    let type: IntType = T.ullong
    for (const n of names) {
      const t = intType(n)
      const max = t.signed ? (1n << BigInt(t.bits - 1)) - 1n : (1n << BigInt(t.bits)) - 1n
      if (lit.value <= max) {
        type = t
        break
      }
    }
    return { k: 'int', loc: at, type, value: BigInt.asUintN(64, lit.value) }
  }

  char(text: string, at: Loc): Expr {
    const c = parseChar(text)
    if (c.chars > 1 && !c.wide) this.diags.warning(at, M.multichar())
    return { k: 'int', loc: at, type: c.wide ? T.ushort : T.int, value: BigInt(c.value) }
  }

  string(texts: string[], at: Loc): Expr {
    const bytes: number[] = []
    for (const t of texts) {
      const s = parseString(t)
      if (s.wide) return this.fail(at, M.unsupported('wide string literal'))
      bytes.push(...s.units)
    }
    bytes.push(0)
    return { k: 'string', loc: at, type: arrayOf(T.char, bytes.length), bytes }
  }

  // ------------------------------------------------------------ operators

  unary(op: '-' | '+' | '~' | '!', e: Expr, at: Loc): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return errorExpr(at)
    if (op === '!') {
      if (!isScalar(r.type)) return this.fail(at, M.arithOrPointerRequired())
      return { k: 'unary', op, loc: at, type: T.int, arg: r }
    }
    if (op === '~' ? !isInteger(r.type) : !isArithmetic(r.type)) return this.fail(at, op === '~' ? M.integralRequired() : M.arithRequired())
    const t = promote(r.type)
    return { k: 'unary', op, loc: at, type: t, arg: this.convert(r, t) }
  }

  binary(op: BinOp | '&&' | '||', left: Expr, right: Expr, at: Loc): Expr {
    const a = this.rvalue(left)
    const b = this.rvalue(right)
    if (isErr(a, b)) return errorExpr(at)
    const ta = a.type
    const tb = b.type
    switch (op) {
      case '&&':
      case '||':
        if (!isScalar(ta) || !isScalar(tb)) return this.fail(at, M.arithOrPointerRequired())
        return { k: 'logical', op, loc: at, type: T.int, left: a, right: b }
      case '*':
      case '/':
        if (!isArithmetic(ta) || !isArithmetic(tb)) return this.fail(at, M.arithRequired())
        return this.arith(op, a, b, at)
      case '%':
      case '&':
      case '^':
      case '|':
        if (!isInteger(ta) || !isInteger(tb)) return this.fail(at, M.integralRequired())
        return this.arith(op, a, b, at)
      case '<<':
      case '>>': {
        if (!isInteger(ta) || !isInteger(tb)) return this.fail(at, M.integralRequired())
        const t = promote(ta)
        return { k: 'binary', op, loc: at, type: t, left: this.convert(a, t), right: this.convert(b, promote(tb)) }
      }
      case '+':
        if (isPointer(ta) || isPointer(tb)) {
          const [p, i] = isPointer(ta) ? [a, b] : [b, a]
          if (!isInteger(i.type)) return this.fail(at, M.integralRequired())
          return this.ptrAdd(p, i, false, at)
        }
        if (!isArithmetic(ta) || !isArithmetic(tb)) return this.fail(at, M.arithOrPointerRequired())
        return this.arith(op, a, b, at)
      case '-':
        if (isPointer(ta) && isPointer(tb)) return { k: 'ptrdiff', loc: at, type: T.int, left: a, right: b, scale: this.scale(ta, at) }
        if (isPointer(ta)) return isInteger(tb) ? this.ptrAdd(a, b, true, at) : this.fail(at, M.integralRequired())
        if (isPointer(tb)) return this.fail(at, M.integralRequired())
        if (!isArithmetic(ta) || !isArithmetic(tb)) return this.fail(at, M.arithOrPointerRequired())
        return this.arith(op, a, b, at)
      default:
        return this.compare(op, a, b, at)
    }
  }

  private arith(op: BinOp, a: Expr, b: Expr, at: Loc): Expr {
    const t = usualArith(a.type, b.type)
    if ((op === '/' || op === '%') && isInteger(t) && evalIntConst(b) === 0n) this.diags.warning(at, M.divByZero())
    return { k: 'binary', op, loc: at, type: t, left: this.convert(a, t), right: this.convert(b, t) }
  }

  private scale(p: PointerType, at: Loc): number {
    if (p.to.kind === 'void' || p.to.kind === 'function') {
      this.diags.warning(at, M.voidPointerArith())
      return 1
    }
    if (!isComplete(p.to)) {
      this.diags.error(at, M.incompleteType())
      return 1
    }
    return sizeOf(p.to)
  }

  private ptrAdd(p: Expr, i: Expr, sub: boolean, at: Loc): Expr {
    const pt = p.type as PointerType
    return { k: 'ptradd', loc: at, type: unqual(pt), ptr: p, index: this.convert(i, promote(i.type)), scale: this.scale(pt, at), sub }
  }

  private compare(op: BinOp, a: Expr, b: Expr, at: Loc): Expr {
    const ta = a.type
    const tb = b.type
    const names = (): [string, string] => [typeToString(ta), typeToString(tb)]
    if (isArithmetic(ta) && isArithmetic(tb)) {
      const t = usualArith(ta, tb)
      return { k: 'binary', op, loc: at, type: T.int, left: this.convert(a, t), right: this.convert(b, t) }
    }
    if (!isScalar(ta) || !isScalar(tb)) return this.fail(at, M.arithOrPointerRequired())
    if (isPointer(ta) && isPointer(tb)) {
      if (!(ta.to.kind === 'void' || tb.to.kind === 'void' || compatibleUnqual(ta.to, tb.to))) this.diags.warning(at, M.incompatibleOperands(...names(), true))
      return { k: 'binary', op, loc: at, type: T.int, left: a, right: this.convert(b, ta) }
    }
    const [p, o] = isPointer(ta) ? [a, b] : [b, a]
    if (isFloating(o.type)) return this.fail(at, M.incompatibleOperands(...names(), false))
    if (!isNullPointerConstant(o) || (op !== '==' && op !== '!=')) this.diags.warning(at, M.incompatibleOperands(...names(), true))
    const c = (e: Expr): Expr => (e === p ? e : this.convert(e, p.type))
    return { k: 'binary', op, loc: at, type: T.int, left: c(a), right: c(b) }
  }

  cond(test: Expr, thenE: Expr, elseE: Expr, at: Loc): Expr {
    const c = this.rvalue(test)
    const x = this.rvalue(thenE)
    const y = this.rvalue(elseE)
    if (isErr(c, x, y)) return errorExpr(at)
    if (!isScalar(c.type)) return this.fail(at, M.arithOrPointerRequired())
    const tx = x.type
    const ty = y.type
    const warn = (): void => this.diags.warning(at, M.incompatibleOperands(typeToString(tx), typeToString(ty), true))
    let t: Type
    if (isArithmetic(tx) && isArithmetic(ty)) t = usualArith(tx, ty)
    else if (tx.kind === 'void' && ty.kind === 'void') t = T.void
    else if (isRecord(tx) && compatibleUnqual(tx, ty)) t = unqual(tx)
    else if (isPointer(tx) && isPointer(ty)) {
      const q = { const: tx.to.const || ty.to.const, volatile: tx.to.volatile || ty.to.volatile }
      if (tx.to.kind === 'void' || ty.to.kind === 'void') t = pointerTo(withQuals(T.void, q))
      else {
        if (!compatibleUnqual(tx.to, ty.to)) warn()
        t = pointerTo(withQuals(unqual(tx.to), q))
      }
    } else if (isPointer(tx) && isInteger(ty)) {
      if (!isNullPointerConstant(y)) warn()
      t = unqual(tx)
    } else if (isInteger(tx) && isPointer(ty)) {
      if (!isNullPointerConstant(x)) warn()
      t = unqual(ty)
    } else return this.fail(at, M.incompatibleOperands(typeToString(tx), typeToString(ty), false))
    const conv = (e: Expr): Expr => (t.kind === 'void' ? e : this.convert(e, t))
    return { k: 'cond', loc: at, type: t, test: c, then: conv(x), else: conv(y) }
  }

  comma(left: Expr, right: Expr, at: Loc): Expr {
    const r = this.rvalue(right)
    return { k: 'comma', loc: at, type: unqual(r.type), left, right: r }
  }

  // ------------------------------------------------------------ assignment

  private modifiable(e: Expr, at: Loc): boolean {
    const t = e.type
    if (!isLvalue(e) || t.kind === 'array' || t.kind === 'function' || t.kind === 'void') {
      this.diags.error(at, M.notModifiable(false))
      return false
    }
    if (t.const) {
      this.diags.error(at, M.notModifiable(true))
      return false
    }
    return true
  }

  assign(target: Expr, value: Expr, at: Loc): Expr {
    if (isErr(target, value)) return errorExpr(at)
    if (!this.modifiable(target, at)) return errorExpr(at)
    const v = this.convertFor(value, target.type, 'assign')
    const stored = storedVar(target)
    if (stored) {
      stored.refs--
      stored.sets++
    }
    return { k: 'assign', loc: at, type: unqual(target.type), target, value: v }
  }

  compound(op: CompoundOp, target: Expr, value: Expr, at: Loc): Expr {
    if (isErr(target, value)) return errorExpr(at)
    if (!this.modifiable(target, at)) return errorExpr(at)
    const tt = unqual(target.type)
    const v = this.rvalue(value)
    const base = op.slice(0, -1) as BinOp
    if (isPointer(tt) && (base === '+' || base === '-')) {
      if (!isInteger(v.type)) return this.fail(at, M.integralRequired())
      return { k: 'compound', op, loc: at, type: tt, target, value: this.convert(v, promote(v.type)), opType: tt, scale: this.scale(tt, at) }
    }
    const integral = base === '%' || base === '<<' || base === '>>' || base === '&' || base === '^' || base === '|'
    const ok = integral ? isInteger(tt) && isInteger(v.type) : isArithmetic(tt) && isArithmetic(v.type)
    if (!ok) return this.fail(at, integral ? M.integralRequired() : base === '+' || base === '-' ? M.arithOrPointerRequired() : M.arithRequired())
    const shift = base === '<<' || base === '>>'
    const opType = shift ? promote(tt) : usualArith(tt, v.type)
    if ((base === '/' || base === '%') && isInteger(opType) && evalIntConst(v) === 0n) this.diags.warning(at, M.divByZero())
    return { k: 'compound', op, loc: at, type: tt, target, value: this.convert(v, shift ? promote(v.type) : opType), opType, scale: 0 }
  }

  incdec(op: '++' | '--', target: Expr, prefix: boolean, at: Loc): Expr {
    if (isErr(target)) return errorExpr(at)
    if (!this.modifiable(target, at)) return errorExpr(at)
    const t = unqual(target.type)
    if (!isScalar(t)) return this.fail(at, M.arithOrPointerRequired())
    return { k: 'incdec', op, prefix, loc: at, type: t, target, scale: isPointer(t) ? this.scale(t, at) : 0 }
  }

  // ------------------------------------------------------------ memory access

  addr(e: Expr, at: Loc): Expr {
    if (isErr(e)) return errorExpr(at)
    if (e.k !== 'func' && !isLvalue(e)) return this.fail(at, M.lvalueRequired())
    if (e.k === 'var' && e.sym.register) this.diags.warning(at, M.registerAddress())
    return { k: 'addr', loc: at, type: pointerTo(e.type), arg: e }
  }

  deref(e: Expr, at: Loc): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return errorExpr(at)
    if (!isPointer(r.type)) return this.fail(at, M.derefNonPointer())
    return { k: 'deref', loc: at, type: r.type.to, arg: r }
  }

  index(base: Expr, idx: Expr, at: Loc): Expr {
    const a = this.rvalue(base)
    const i = this.rvalue(idx)
    if (isErr(a, i)) return errorExpr(at)
    let p: Expr
    let n: Expr
    let written: Expr
    if (isPointer(a.type)) [p, n, written] = [a, i, base]
    else if (isPointer(i.type)) [p, n, written] = [i, a, idx]
    else return this.fail(at, M.pointerToObjectRequired())
    if (!isInteger(n.type)) return this.fail(at, M.integralRequired())
    if (written.type.kind === 'array' && written.type.length !== null) {
      const k = evalIntConst(n)
      if (k !== null && (k < 0n || k >= BigInt(written.type.length))) this.diags.warning(at, M.subscriptRange())
    }
    const sum = this.ptrAdd(p, n, false, at)
    return { k: 'deref', loc: at, type: (p.type as PointerType).to, arg: sum }
  }

  member(base: Expr, name: string, at: Loc): Expr {
    if (isErr(base)) return errorExpr(at)
    const t = base.type
    if (!isRecord(t)) return this.fail(at, M.structRequired())
    if (!t.def.members) return this.fail(at, M.incompleteType())
    const m = t.def.members.find((x) => x.name === name)
    if (!m) return this.fail(at, M.noField(t.def.kind, t.def.tag ?? '<unnamed>', name))
    return { k: 'member', loc: at, type: withQuals(m.type, { const: t.const, volatile: t.volatile }), base, member: m }
  }

  arrow(base: Expr, name: string, at: Loc): Expr {
    const r = this.rvalue(base)
    if (isErr(r)) return errorExpr(at)
    if (!isPointer(r.type)) return this.fail(at, M.pointerRequired())
    return this.member({ k: 'deref', loc: at, type: r.type.to, arg: r }, name, at)
  }

  /** `_amem4(p)` and friends: an lvalue of the intrinsic's type at p. */
  memAccess(name: string, arg: Expr, at: Loc): Expr {
    const r = this.rvalue(arg)
    if (isErr(r)) return errorExpr(at)
    if (!isPointer(r.type)) return this.fail(at, M.pointerRequired())
    const t = MEM_TYPES[name]
    return { k: 'deref', loc: at, type: t, arg: { k: 'cast', loc: at, type: pointerTo(t), arg: r, implicit: false } }
  }

  // ------------------------------------------------------------ calls and casts

  call(callee: Expr, args: Expr[], at: Loc): Expr {
    if (isErr(callee)) return errorExpr(at)
    const fn = callee.k === 'func' ? callee.sym : null
    const c = this.rvalue(callee)
    if (!isPointer(c.type) || c.type.to.kind !== 'function') return this.fail(at, M.notCallable())
    const ft = c.type.to
    let converted: Expr[]
    if (ft.prototyped) {
      if (args.length < ft.params.length) this.diags.error(at, M.tooFewArgs())
      else if (args.length > ft.params.length && !ft.variadic) this.diags.error(at, M.tooManyArgs())
      converted = args.map((a, i) => (i < ft.params.length ? this.convertFor(a, ft.params[i].type, 'arg') : this.promoteArg(a)))
    } else converted = args.map((a) => this.promoteArg(a))
    return { k: 'call', loc: at, type: unqual(ft.ret), callee: c, args: converted, fn }
  }

  cast(to: Type, e: Expr, at: Loc): Expr {
    const r = this.rvalue(e)
    if (isErr(r) || to.kind === 'error') return errorExpr(at)
    const t = unqual(to)
    if (t.kind === 'void') return { k: 'cast', loc: at, type: T.void, arg: r, implicit: false }
    const ok =
      isScalar(t) && isScalar(r.type) && !(isPointer(t) && isFloating(r.type)) && !(isFloating(t) && isPointer(r.type))
    if (!ok && !(isRecord(t) && compatibleUnqual(t, r.type))) return this.fail(at, M.invalidConversion())
    return { k: 'cast', loc: at, type: t, arg: r, implicit: false }
  }

  sizeofType(t: Type, at: Loc): Expr {
    if (t.kind === 'array' && t.vla?.len) {
      const len: Expr = { k: 'var', loc: at, type: T.uint, sym: t.vla.len }
      return { k: 'binary', op: '*', loc: at, type: T.uint, left: len, right: { k: 'int', loc: at, type: T.uint, value: BigInt(sizeOf(t.of)) } }
    }
    if (t.kind !== 'void' && t.kind !== 'function' && t.kind !== 'error' && !isComplete(t)) return this.fail(at, M.incompleteType())
    return { k: 'int', loc: at, type: T.uint, value: BigInt(sizeOf(t)) }
  }

  sizeofExpr(e: Expr, at: Loc): Expr {
    return isErr(e) ? errorExpr(at) : this.sizeofType(e.type, at)
  }

  // ------------------------------------------------------------ statements

  /** Controlling expression of if/while/do/for/?: — any scalar. */
  condition(e: Expr): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return r
    return isScalar(r.type) ? r : this.fail(r.loc, M.arithOrPointerRequired())
  }

  switchValue(e: Expr): Expr {
    const r = this.rvalue(e)
    if (isErr(r)) return r
    return isInteger(r.type) ? this.convert(r, promote(r.type)) : this.fail(r.loc, M.integralRequired())
  }

  returnValue(ret: Type, fnName: string, value: Expr | null, at: Loc): Expr | null {
    if (value === null) {
      if (ret.kind !== 'void') this.diags.warning(at, M.returnValueMissing(fnName))
      return null
    }
    if (ret.kind === 'void') {
      const r = this.rvalue(value)
      if (!isErr(r) && r.type.kind !== 'void') this.diags.warning(at, M.badReturn(true))
      return r
    }
    return this.convertFor(value, ret, 'return')
  }

  vaStart(ap: Expr, last: Expr, at: Loc): Expr {
    if (isErr(ap) || !this.modifiable(ap, at)) return errorExpr(at)
    return { k: 'vaStart', loc: at, type: T.void, ap, last: last.k === 'var' ? last.sym : null }
  }

  vaArg(ap: Expr, t: Type, at: Loc): Expr {
    if (isErr(ap) || !this.modifiable(ap, at)) return errorExpr(at)
    return { k: 'vaArg', loc: at, type: unqual(t), ap }
  }
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run tests/unit/interp/sema.test.ts tests/unit/interp/consteval.test.ts tests/unit/interp/types.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/interp/frontend tests/unit/interp
git commit -m "feat(interp): typed AST, constant evaluation and cl6x expression semantics"
```

---
### Task 5: Initialisers

**Files:**
- Create: `src/interp/frontend/initializer.ts`
- Test: `tests/unit/interp/initializer.test.ts`

**Interfaces:**
- Consumes (Task 4): `Sema.convert`, `Sema.convertFor`, `Sema.diags`; `Init`, `InitItem`, `Expr`; and everything in `types.ts`.
- Produces:
  - `Designator`, one of `{k:'index', index, loc}` or `{k:'field', name, loc}`.
  - `InitSyntaxItem {designators, init}`.
  - `InitSyntax`, one of `{k:'expr', expr, loc}` or `{k:'list', items, loc}`.
  - `lowerInit(sema, type, syntax): {init: Init, type}`. It completes `T x[] = …` to a sized array.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/initializer.test.ts
import { describe, expect, it } from 'vitest'
import type { Expr, Init, VarSym } from '../../../src/interp/frontend/ast'
import { evalConst } from '../../../src/interp/frontend/consteval'
import { Diags } from '../../../src/interp/frontend/diag'
import { lowerInit, type Designator, type InitSyntax } from '../../../src/interp/frontend/initializer'
import { Sema } from '../../../src/interp/frontend/sema'
import { T, arrayOf, completeRecord, newRecord, typeToString, type Type } from '../../../src/interp/frontend/types'

const L = { file: 'f.c', line: 1, col: 1 }
const n = (x: number): InitSyntax => ({ k: 'expr', expr: { k: 'int', loc: L, type: T.int, value: BigInt(x) }, loc: L })
const x = (e: Expr): InitSyntax => ({ k: 'expr', expr: e, loc: L })
const fld = (name: string): Designator => ({ k: 'field', name, loc: L })
const idx = (index: number): Designator => ({ k: 'index', index, loc: L })
const list = (...items: (InitSyntax | [Designator[], InitSyntax])[]): InitSyntax => ({
  k: 'list', loc: L, items: items.map((i) => (Array.isArray(i) ? { designators: i[0], init: i[1] } : { designators: [], init: i }))
})
const str = (text: string): InitSyntax => {
  const bytes = [...Buffer.from(text, 'latin1'), 0]
  return x({ k: 'string', loc: L, type: arrayOf(T.char, bytes.length), bytes })
}
const value = (e: Expr): number | string => {
  const v = evalConst(e)
  return v && v.k !== 'addr' ? Number(v.value) : e.k
}
const rows = (init: Init): (number | string)[][] =>
  init.k === 'list' ? init.items.map((i) => [i.offset, typeToString(i.type), value(i.expr)]) : [[typeToString(init.expr.type), value(init.expr)]]

function lower(type: Type, syntax: InitSyntax): { rows: (number | string)[][]; type: string; codes: string[] } {
  const diags = new Diags()
  const r = lowerInit(new Sema(diags, 'c89'), type, syntax)
  return { rows: rows(r.init), type: typeToString(r.type), codes: diags.list.map((d) => d.code) }
}

const point = (): Type => {
  const def = newRecord('struct', 'P')
  completeRecord(def, [{ name: 'x', type: T.int }, { name: 'y', type: T.float }])
  return { kind: 'struct', def }
}

describe('lowerInit', () => {
  it('completes an incomplete array from its initialiser', () => {
    expect(lower(arrayOf(T.int, null), list(n(1), n(2), n(3)))).toEqual({
      rows: [[0, 'int', 1], [4, 'int', 2], [8, 'int', 3]], type: 'int [3]', codes: []
    })
  })
  it('elides braces across nested arrays and honours inner braces', () => {
    const m = arrayOf(arrayOf(T.int, 3), 2)
    expect(lower(m, list(n(1), n(2), n(3), n(4))).rows.map((r) => r[0])).toEqual([0, 4, 8, 12])
    expect(lower(m, list(list(n(1)), list(n(4), n(5)))).rows.map((r) => r[0])).toEqual([0, 12, 16])
  })
  it('applies designators and continues after them', () => {
    expect(lower(point(), list([[fld('y')], n(2)], [[fld('x')], n(1)])).rows).toEqual([[4, 'float', 2], [0, 'int', 1]])
    expect(lower(arrayOf(T.int, 5), list([[idx(3)], n(7)], n(8)))).toMatchObject({ rows: [[12, 'int', 7], [16, 'int', 8]], type: 'int [5]' })
    expect(lower(arrayOf(T.int, null), list([[idx(4)], n(1)])).type).toBe('int [5]')
    expect(lower(arrayOf(point(), 2), list([[idx(1), fld('y')], n(3)])).rows).toEqual([[12, 'float', 3]])
  })
  it('initialises char arrays from strings, like cl6x', () => {
    expect(lower(arrayOf(T.char, null), str('hi'))).toMatchObject({ rows: [[0, 'char [3]', 'string']], type: 'char [3]', codes: [] })
    expect(lower(arrayOf(T.char, 2), str('ab')).codes).toEqual([])
    expect(lower(arrayOf(T.char, 3), str('abcd')).codes).toEqual(['2097-D'])
    expect(lower(arrayOf(T.char, null), list(str('ok'))).type).toBe('char [3]')
    expect(lower(arrayOf(arrayOf(T.char, 4), 2), list(str('ab'), str('cd'))).rows.map((r) => r[0])).toEqual([0, 4])
  })
  it('warns once about excess initialisers', () => {
    expect(lower(arrayOf(T.int, 2), list(n(1), n(2), n(3), n(4)))).toMatchObject({ codes: ['1238-D'], rows: [[0, 'int', 1], [4, 'int', 2]] })
    expect(lower(T.int, list(n(1), n(2)))).toEqual({ rows: [['int', 1]], type: 'int', codes: ['1238-D'] })
  })
  it('treats an array initialised from an expression as cl6x does (#522-D then #145-D)', () => {
    const a: VarSym = { kind: 'var', name: 'a', linkName: 'a', type: arrayOf(T.int, 2), loc: L, storage: 'auto', external: false, file: 'f.c', init: null, defined: true, cregister: false, register: false, hidden: false, refs: 0, sets: 0, id: 0 }
    expect(lower(arrayOf(T.int, 2), x({ k: 'var', loc: L, type: a.type, sym: a })).codes).toEqual(['522-D', '145-D'])
  })
  it('fills arrays of structs with brace elision', () => {
    expect(lower(arrayOf(point(), 2), list(list(n(1), n(2)), n(3), n(4))).rows.map((r) => r[0])).toEqual([0, 4, 8, 12])
  })
  it('initialises the first union member unless designated', () => {
    const def = newRecord('union', 'U')
    completeRecord(def, [{ name: 'i', type: T.int }, { name: 'f', type: T.float }])
    const u: Type = { kind: 'union', def }
    expect(lower(u, list(n(5))).rows).toEqual([[0, 'int', 5]])
    expect(lower(u, list([[fld('f')], n(2)])).rows).toEqual([[0, 'float', 2]])
  })
  it('reports unknown fields with cl6x #137', () => {
    expect(lower(point(), list([[fld('z')], n(1)])).codes).toEqual(['137'])
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/initializer.test.ts`
Expected: FAIL, because the module `initializer` does not exist.

- [ ] **Step 3: Implement initialiser lowering**

```ts path=src/interp/frontend/initializer.ts
import type { Expr, Init, InitItem } from './ast'
import { M, type Loc } from './diag'
import type { Sema } from './sema'
import {
  T, arrayOf, compatibleUnqual, isAggregate, isCharArray, isRecord, sizeOf, unqual, withQuals,
  type ArrayType, type Type
} from './types'

export type Designator = { k: 'index'; index: number; loc: Loc } | { k: 'field'; name: string; loc: Loc }

export interface InitSyntaxItem {
  designators: Designator[]
  init: InitSyntax
}

/** An initialiser as written: expressions are typed but not yet converted. */
export type InitSyntax = { k: 'expr'; expr: Expr; loc: Loc } | { k: 'list'; items: InitSyntaxItem[]; loc: Loc }

type StringExpr = Extract<Expr, { k: 'string' }>

class Cursor {
  private i = 0
  constructor(private readonly items: InitSyntaxItem[]) {}
  get done(): boolean {
    return this.i >= this.items.length
  }
  peek(): InitSyntaxItem {
    return this.items[this.i]
  }
  next(): InitSyntaxItem {
    return this.items[this.i++]
  }
}

const zero = (loc: Loc): Expr => ({ k: 'int', loc, type: T.int, value: 0n })

function complete(type: Type, count: number): Type {
  return type.kind === 'array' && type.length === null && !type.vla ? { ...type, length: count } : type
}

/** The sub-object `index` of an aggregate and its byte offset. */
function sub(type: Type, index: number, offset: number): [Type, number] {
  if (type.kind === 'array') return [type.of, offset + index * sizeOf(type.of)]
  if (!isRecord(type) || !type.def.members) return [T.error, offset]
  const m = type.def.members[index]
  return [withQuals(m.type, { const: type.const, volatile: type.volatile }), offset + m.offset]
}

class Builder {
  readonly items: InitItem[] = []

  constructor(private readonly sema: Sema) {}

  /** Fills an aggregate from `cur`; `braced` when `cur` is the object's own brace list. Returns the elements initialised. */
  fill(type: Type, cur: Cursor, offset: number, braced: boolean): number {
    const members = isRecord(type) ? (type.def.members?.length ?? 0) : 0
    const limit = type.kind === 'array' ? (type.length ?? Infinity) : type.kind === 'union' ? Math.min(1, members) : members
    let index = 0
    let count = 0
    let warned = false
    while (!cur.done) {
      const item = cur.peek()
      if (item.designators.length > 0) {
        if (!braced) break
        cur.next()
        const at = this.designate(type, offset, item.designators, item.init)
        if (at !== null) {
          index = at + 1
          count = Math.max(count, index)
        }
        continue
      }
      if (index >= limit) {
        if (!braced) break
        if (!warned) this.sema.diags.warning(item.init.loc, M.excessInit())
        warned = true
        cur.next()
        continue
      }
      const [st, so] = sub(type, index, offset)
      this.element(st, so, cur)
      index++
      count = Math.max(count, index)
    }
    return count
  }

  /** One element from the cursor: a whole item, or several items under brace elision. */
  private element(type: Type, offset: number, cur: Cursor): void {
    const item = cur.peek()
    if (item.init.k === 'list' || !isAggregate(type)) {
      cur.next()
      this.value(type, offset, item.init)
      return
    }
    const e = item.init.expr
    if ((isCharArray(type) && e.k === 'string') || (isRecord(type) && compatibleUnqual(type, e.type))) {
      cur.next()
      this.value(type, offset, item.init)
      return
    }
    this.fill(type, cur, offset, false)
  }

  /** A brace list for an aggregate; `{"text"}` initialises a char array from the string. Returns the elements initialised. */
  braced(type: Type, list: Extract<InitSyntax, { k: 'list' }>, offset: number): number {
    const first = list.items[0]
    if (isCharArray(type) && first && first.designators.length === 0 && first.init.k === 'expr' && first.init.expr.k === 'string') {
      if (list.items.length > 1) this.sema.diags.warning(list.items[1].init.loc, M.excessInit())
      return this.string(type, offset, first.init.expr)
    }
    return this.fill(type, new Cursor(list.items), offset, true)
  }

  /** The object at `offset` from one complete initialiser. */
  value(type: Type, offset: number, syn: InitSyntax): void {
    if (syn.k === 'list') {
      if (isAggregate(type)) {
        this.braced(type, syn, offset)
        return
      }
      if (syn.items.length === 0) {
        this.items.push({ offset, type: unqual(type), expr: this.sema.convert(zero(syn.loc), type) })
        return
      }
      this.value(type, offset, syn.items[0].init)
      if (syn.items.length > 1) this.sema.diags.warning(syn.items[1].init.loc, M.excessInit())
      return
    }
    const e = syn.expr
    if (isCharArray(type) && e.k === 'string') {
      this.string(type, offset, e)
      return
    }
    if (isAggregate(type) && !(isRecord(type) && compatibleUnqual(type, e.type))) {
      this.fill(type, new Cursor([{ designators: [], init: syn }]), offset, false)
      return
    }
    this.items.push({ offset, type: unqual(type), expr: this.sema.convertFor(e, type, 'init') })
  }

  /** A string literal into a char array; returns the length it gives the array. */
  string(type: ArrayType, offset: number, e: StringExpr): number {
    const length = type.length ?? e.bytes.length
    if (e.bytes.length - 1 > length) this.sema.diags.warning(e.loc, M.stringTooLong())
    this.items.push({ offset, type: arrayOf(type.of, length), expr: e })
    return length
  }

  private designate(type: Type, offset: number, ds: Designator[], init: InitSyntax): number | null {
    const d = ds[0]
    let index: number
    if (d.k === 'index') {
      if (type.kind !== 'array') {
        this.sema.diags.error(d.loc, M.pointerToObjectRequired())
        return null
      }
      if (type.length !== null && d.index >= type.length) {
        this.sema.diags.warning(d.loc, M.excessInit())
        return null
      }
      index = d.index
    } else {
      if (!isRecord(type) || !type.def.members) {
        this.sema.diags.error(d.loc, M.structRequired())
        return null
      }
      index = type.def.members.findIndex((m) => m.name === d.name)
      if (index < 0) {
        this.sema.diags.error(d.loc, M.noField(type.def.kind, type.def.tag ?? '<unnamed>', d.name))
        return null
      }
    }
    const [st, so] = sub(type, index, offset)
    if (ds.length > 1) this.designate(st, so, ds.slice(1), init)
    else this.value(st, so, init)
    return index
  }
}

/** Lowers the initialiser of an object of `type`; `int a[] = {…}` and `char s[] = "…"` get their length. */
export function lowerInit(sema: Sema, type: Type, syntax: InitSyntax): { init: Init; type: Type } {
  const b = new Builder(sema)
  if (syntax.k === 'expr') {
    const e = syntax.expr
    if (!isAggregate(type) || isRecord(type)) return { init: { k: 'expr', expr: sema.convertFor(e, type, 'init') }, type }
    if (isCharArray(type) && e.k === 'string') {
      const length = b.string(type, 0, e)
      return { init: { k: 'list', items: b.items }, type: complete(type, length) }
    }
    sema.diags.warning(syntax.loc, M.braceExpected())
    const count = b.fill(type, new Cursor([{ designators: [], init: syntax }]), 0, false)
    return { init: { k: 'list', items: b.items }, type: complete(type, count) }
  }
  if (!isAggregate(type)) {
    b.value(type, 0, syntax)
    return { init: { k: 'expr', expr: b.items[0]?.expr ?? sema.convert(zero(syntax.loc), type) }, type }
  }
  const count = b.braced(type, syntax, 0)
  return { init: { k: 'list', items: b.items }, type: complete(type, count) }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/initializer.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interp/frontend/initializer.ts tests/unit/interp/initializer.test.ts
git commit -m "feat(interp): designated and brace-elided initialisers"
```

---
### Task 6: The parser

**Files:**
- Create: `src/interp/frontend/parser.ts`
- Test: `tests/unit/interp/parser.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 1-2: `Token`, `Diags`, `M`, `preprocess` (tests only), `isBuiltinFile`, `Pragma`, `parseNumber`
  - Tasks 3-5: types, AST, `Sema`, `MEM_INTRINSICS`, `evalConst`, `evalIntConst`, `lowerInit`, `InitSyntax`
- Produces: `parseUnit(tokens, {file, dialect, pragmas?}, diags): TranslationUnit`. It also sets:
  - `FuncSym.def`, `VarSym.refs` and `VarSym.sets`;
  - `name$N` link names for function-local statics.

**How recovery works (matches cl6x on the reference cases):**
- A missing punctuator throws, and the parser skips to the next `;` (consumed) or `}` (left) at the same nesting.
- At file scope a balanced `{…}` block is skipped too.
- A missing operand reports #29 and returns an error node, which suppresses follow-on errors.
- An undeclared name is reported once (#20), then remembered as a poisoned symbol.
- `unknown_t x;` is read as a declaration with an unknown type, reported as #20 on the type name.
- In C89 a declaration in a `for` initialiser reports #29 at the type and is skipped to its `;`.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/parser.test.ts
import { describe, expect, it } from 'vitest'
import * as path from 'path'
import type { Expr, FunctionDef, Stmt, VarSym } from '../../../src/interp/frontend/ast'
import { evalIntConst } from '../../../src/interp/frontend/consteval'
import { Diags } from '../../../src/interp/frontend/diag'
import { parseUnit } from '../../../src/interp/frontend/parser'
import { preprocess } from '../../../src/interp/frontend/preprocessor'
import { typeToString } from '../../../src/interp/frontend/types'

const FILE = path.resolve('/proj/main.c')

function parse(src: string, dialect: 'c89' | 'c99' = 'c89') {
  const diags = new Diags(['225'])
  const pp = preprocess(FILE, { readFile: (f) => (f === FILE ? src : null), includePaths: [], defines: ['c6748'], dialect }, diags)
  const unit = parseUnit(pp.tokens, { file: FILE, dialect, pragmas: pp.pragmas }, diags)
  return {
    unit,
    codes: diags.list.map((d) => `${d.line ?? 'end'}:${d.code}`),
    messages: diags.list.map((d) => d.message),
    fn: (name: string): FunctionDef => unit.functions.find((f) => f.sym.name === name) as FunctionDef,
    global: (name: string): VarSym => unit.objects.find((o) => o.name === name) as VarSym
  }
}

/** The expression of each expression statement directly in the function body. */
const exprs = (fn: FunctionDef): Expr[] =>
  fn.body.body.filter((s): s is Extract<Stmt, { k: 'expr' }> => s.k === 'expr').map((s) => s.expr)
/** The right-hand side of an assignment, before its implicit conversion. */
const rhs = (e: Expr): Expr => (e.k === 'assign' ? (e.value.k === 'cast' && e.value.implicit ? e.value.arg : e.value) : e)
const initValues = (v: VarSym): (bigint | null)[] =>
  v.init?.k === 'list' ? v.init.items.map((i) => evalIntConst(i.expr)) : [v.init ? evalIntConst(v.init.expr) : null]

const LAB = `#include <stdio.h>
#include <math.h>
#define N 8
#define PI 3.14159265358979323846
float x[N];
float h[3] = { 0.25f, 0.5f, 0.25f };
static int calls;
float fir(const float *in, int n)
{
    int k;
    float acc = 0;
    for (k = 0; k < 3 && k <= n; k++)
        acc += h[k] * in[n - k];
    calls++;
    return acc;
}
int main(void)
{
    int i;
    float y[N];
    for (i = 0; i < N; i++) {
        x[i] = sin(2 * PI * i / N);
        y[i] = fir(x, i);
        printf("%d %f %f\\n", i, x[i], y[i]);
    }
    return 0;
}
`

describe('parseUnit', () => {
  it('parses a typical lab program with no diagnostics', () => {
    const { unit, codes, global } = parse(LAB)
    expect(codes).toEqual([])
    expect(unit.functions.map((f) => f.sym.name)).toEqual(['fir', 'main'])
    expect(global('h').init).toMatchObject({ k: 'list', items: [{ offset: 0 }, { offset: 4 }, { offset: 8 }] })
    expect(global('calls')).toMatchObject({ storage: 'static', external: false })
    expect(typeToString(global('x').type)).toBe('float [8]')
  })

  it('types expressions per the C6000 EABI', () => {
    const src = 'int main(void) {\n char c = 1; short s = 2; long l = 3; unsigned u = 4; float f = 5; double d = 6;\n d = c + s; l = l + u; f = f * 2; d = f + d; u = c << 2;\n return 0;\n}'
    const { fn, codes } = parse(src)
    expect(codes).toEqual([])
    expect(exprs(fn('main')).map((e) => typeToString(rhs(e).type))).toEqual(['int', 'unsigned long', 'float', 'double', 'int'])
  })

  it('reads nested declarators', () => {
    const src = 'int (*fp)(int);\nint *ap[3];\nint (*pa)[3];\nchar **argv2;\nconst char *const msg = "x";\nvoid (*signal2(int, void (*)(int)))(int);\nint (*table[2])(void);'
    const { unit, codes, global } = parse(src)
    expect(codes).toEqual([])
    expect(['fp', 'ap', 'pa', 'argv2', 'msg', 'table'].map((n) => typeToString(global(n).type))).toEqual([
      'int (*)(int)', 'int *[3]', 'int (*)[3]', 'char **', 'const char *const', 'int (*[2])(void)'
    ])
    expect(typeToString(unit.funcs.find((f) => f.name === 'signal2')!.type)).toBe('void (*(int, void (*)(int)))(int)')
  })

  it('handles structs, typedefs, enums and sizeof', () => {
    const src = [
      'typedef struct { float re, im; } complex_t;',
      'struct pt { char c; double d; short s; };',
      'typedef enum { RED, GREEN = 5, BLUE } color;',
      'complex_t z = { 1.0f, -2.0f };',
      'struct pt p;',
      'struct pt *q = &p;',
      'color c = BLUE;',
      'int sizes[3] = { sizeof(complex_t), sizeof(struct pt), sizeof(color) };',
      'int main(void) { q->s = 3; z.im = z.re; return p.c; }'
    ].join('\n')
    const { codes, global } = parse(src)
    expect(codes).toEqual([])
    expect(initValues(global('sizes'))).toEqual([8n, 24n, 4n])
    expect(initValues(global('c'))).toEqual([6n])
    expect(typeToString(global('z').type)).toBe('complex_t')
  })

  it('names function-local statics like cl6x and warns about unused ones', () => {
    const { unit, codes } = parse('static int counter;\nint main(void) { static float a[8]; static int b = 3; a[0] = b + counter; return 0; }')
    expect(unit.objects.map((o) => o.linkName)).toEqual(['counter', 'a$1', 'b$2'])
    expect(codes).toEqual(['2:552-D'])
  })

  it.each([
    ['int main(void){ int a = b; return 0; }', ['1:20']],
    ['int main(void){ int a = 1\n return a; }', ['2:66', '1:179-D']],
    ['int main(void){ for(int i=0;i<3;i++) {} return i; }', ['1:29', '1:20']],
    ['int main(void){ undefined_t x; return 0; }', ['1:20']],
    ['int main(void) return 0;', ['1:131']],
    ['int main(void){ return 0; ', ['end:68']],
    ['int f(int a int b){ return a; }', ['1:18']],
    ['struct S { int a } s;\nint main(void){ return s.a; }', ['1:66-D']],
    ['int 3x;', ['1:19', '1:41']],
    ['int main(void){ long long long x; return 0; }', ['1:85']],
    ['int main(void){ int x = 0; if (x) else x = 1; return 0; }', ['1:128']],
    ['int main(void){ switch (1) { case 1: case 1: break; } return 0; }', ['1:1851']],
    ['int main(void){ goto L; return 0; }', ['1:115']],
    ['int main(void){ break; return 0; }', ['1:117']],
    ['double f(double);\nint f(int x){return x;}', ['2:148']],
    ['int x = 1;\nint x = 2;', ['2:150']],
    ['int n = 3;\nint a = n;', ['2:28']],
    ['enum E { A, B, A };', ['1:102']],
    ['int main(void){ int x = 08; return x; }', ['1:24']],
    ['int main(void){ struct T t; return 0; }', ['1:71']]
  ])('reports cl6x diagnostics: %s', (src, expected) => {
    expect(parse(src).codes).toEqual(expected)
  })

  it('prints incompatible declarations the way cl6x does', () => {
    expect(parse('double f(double);\nint f(int x){return x;}').messages).toEqual(['declaration is incompatible with "double f(double)" (declared at line 1)'])
  })

  it('accepts C99 for-loop declarations in C99 mode and scopes them to the loop', () => {
    const ok = parse('int main(void){ int s = 0; for (int i = 0; i < 3; i++) s += i; return s; }', 'c99')
    expect(ok.codes).toEqual([])
    expect(ok.fn('main').body.body[1]).toMatchObject({ k: 'for', init: { k: 'decl' } })
    expect(parse('int main(void){ for (int i = 0; i < 3; i++) {} return i; }', 'c99').codes).toEqual(['1:20'])
  })

  it('declares unknown functions implicitly (#225-D) but knows the C6000 intrinsics', () => {
    const { unit, codes } = parse('int main(void){ return foo() + _dotp2(1, 2); }')
    expect(codes).toEqual(['1:225-D'])
    expect(unit.funcs.find((f) => f.name === 'foo')).toMatchObject({ implicit: true, used: true })
    expect(unit.funcs.find((f) => f.name === '_dotp2')).toMatchObject({ library: true, used: true })
  })

  it('supports variable-length arrays', () => {
    const { fn, codes } = parse('int main(void){ int n = 4; int v[n]; v[0] = 1; return v[0] + (int)sizeof v; }')
    expect(codes).toEqual([])
    const decl = fn('main').body.body[1]
    expect(decl.k === 'decl' && decl.vars.map((v) => v.name)).toEqual(['v$len', 'v'])
  })

  it('warns about unused and set-but-unused locals like cl6x', () => {
    const src = 'int main(void)\n{\n    int a;\n    int b;\n    int c = 1;\n    int d[2];\n    int *p = &c;\n    b = 1;\n    d[0] = 1;\n    c += 1;\n    return 0;\n}'
    expect(parse(src).codes).toEqual(['3:179-D', '4:552-D', '6:552-D', '7:179-D'])
  })

  it('recovers after a syntax error and keeps parsing later functions', () => {
    expect(parse('int f(void){ return (1 + 2; }\nint g(void){ return h; }').codes).toEqual(['1:18', '2:20'])
  })

  it('reads C6000 control registers and memory intrinsics', () => {
    const { codes, global } = parse('#include <c6x.h>\nint main(void){ unsigned t = TSCL; int a[2]; CSR = CSR | 1; _amem4(&a[0]) = 5; return _dotp2(t, 1) + _extu(CSR, 22, 31) + a[0]; }')
    expect(codes).toEqual([])
    expect(global('TSCL')).toMatchObject({ cregister: true, storage: 'extern' })
  })

  it('supports compound literals, designated initialisers and stdarg', () => {
    const src = '#include <stdarg.h>\nstruct P { int x, y; };\nint sum(int n, ...) { va_list ap; int s = 0; va_start(ap, n); while (n--) s += va_arg(ap, int); va_end(ap); return s; }\nint main(void) { struct P p = (struct P){ .y = 2 }; return p.y + sum(2, 1, 2); }'
    expect(parse(src).codes).toEqual([])
  })

  it('passes pragmas through', () => {
    expect(parse('#pragma DATA_ALIGN(x, 8)\nfloat x[4];').unit.pragmas.map((p) => p.name)).toEqual(['DATA_ALIGN'])
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/parser.test.ts`
Expected: FAIL, because the module `parser` does not exist.

- [ ] **Step 3: Implement the parser**

```ts path=src/interp/frontend/parser.ts
import type { BinOp, Block, CaseStmt, CompoundOp, DefaultStmt, Expr, FuncSym, FunctionDef, GotoStmt, Init, LabelStmt, Stmt, Sym, TranslationUnit, VarSym } from './ast'
import { evalConst, evalIntConst } from './consteval'
import { M, type Diags, type Loc, type Msg, type Punct } from './diag'
import { lowerInit, type Designator, type InitSyntax, type InitSyntaxItem } from './initializer'
import { loc as tokLoc, type Token } from './lexer'
import { parseNumber, type NumberLiteral } from './literals'
import { isBuiltinFile, type Pragma } from './preprocessor'
import { MEM_INTRINSICS, Sema } from './sema'
import {
  T, alignOf, arrayOf, compatible, completeRecord, isComplete, isInteger, isRecord, newRecord, pointerTo, typeToString, withQuals,
  type FunctionType, type Param, type RecordDef, type Type
} from './types'

export interface ParseOptions {
  /** Main source file of the translation unit. */
  file: string
  dialect: 'c89' | 'c99'
  pragmas?: Pragma[]
}

/** Thrown after a syntax error; the parser skips to the end of the statement or declaration. */
const ABORT = Symbol('syntax error')

const K = { VOID: 1, BOOL: 1 << 2, CHAR: 1 << 4, SHORT: 1 << 6, INT: 1 << 8, LONG: 1 << 10, FLOAT: 1 << 12, DOUBLE: 1 << 14, SIGNED: 1 << 17, UNSIGNED: 1 << 18, INT40: 1 << 19 }

const TYPE_WORDS = new Map<string, number>([
  ['void', K.VOID], ['_Bool', K.BOOL], ['char', K.CHAR], ['short', K.SHORT], ['int', K.INT], ['long', K.LONG],
  ['float', K.FLOAT], ['double', K.DOUBLE], ['signed', K.SIGNED], ['__signed', K.SIGNED], ['__signed__', K.SIGNED],
  ['unsigned', K.UNSIGNED], ['__int40_t', K.INT40]
])

/** Valid type-specifier combinations (C 6.7.2), keyed by the sum of the words' flags. */
const COMBOS = new Map<number, Type>()
const combo = (t: Type, ...sums: number[]): void => sums.forEach((s) => COMBOS.set(s, t))
combo(T.void, K.VOID)
combo(T.bool, K.BOOL)
combo(T.char, K.CHAR)
combo(T.schar, K.SIGNED + K.CHAR)
combo(T.uchar, K.UNSIGNED + K.CHAR)
combo(T.short, K.SHORT, K.SHORT + K.INT, K.SIGNED + K.SHORT, K.SIGNED + K.SHORT + K.INT)
combo(T.ushort, K.UNSIGNED + K.SHORT, K.UNSIGNED + K.SHORT + K.INT)
combo(T.int, K.INT, K.SIGNED, K.SIGNED + K.INT)
combo(T.uint, K.UNSIGNED, K.UNSIGNED + K.INT)
combo(T.long, K.LONG, K.LONG + K.INT, K.SIGNED + K.LONG, K.SIGNED + K.LONG + K.INT)
combo(T.ulong, K.UNSIGNED + K.LONG, K.UNSIGNED + K.LONG + K.INT)
combo(T.llong, 2 * K.LONG, 2 * K.LONG + K.INT, K.SIGNED + 2 * K.LONG, K.SIGNED + 2 * K.LONG + K.INT)
combo(T.ullong, K.UNSIGNED + 2 * K.LONG, K.UNSIGNED + 2 * K.LONG + K.INT)
combo(T.float, K.FLOAT)
combo(T.double, K.DOUBLE)
combo(T.ldouble, K.LONG + K.DOUBLE)
combo(T.int40, K.INT40, K.SIGNED + K.INT40)
combo(T.uint40, K.UNSIGNED + K.INT40)

const STORAGE = new Set(['typedef', 'extern', 'static', 'auto', 'register'])
const QUALIFIERS = new Set(['const', '__const', 'volatile', '__volatile__', 'restrict', '__restrict', '__restrict__'])
/** TI and GNU words that only give hints: accepted and ignored. */
const HINTS = new Set(['inline', '__inline', '__inline__', 'interrupt', '__interrupt', 'near', 'far', '__near', '__far'])
const ATTRIBUTE = new Set(['__attribute__', '__attribute'])
const DECL_START = new Set([...STORAGE, ...QUALIFIERS, ...HINTS, ...ATTRIBUTE, ...TYPE_WORDS.keys(), 'struct', 'union', 'enum', 'cregister', '__cregister'])
const KEYWORDS = new Set([
  ...DECL_START, 'break', 'case', 'continue', 'default', 'do', 'else', 'for', 'goto', 'if', 'return', 'sizeof', 'switch', 'while',
  '_Alignof', '__alignof__', 'asm', '__asm', '__asm__'
])

const PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10
}
const ASSIGN_OPS = new Set(['=', '*=', '/=', '%=', '+=', '-=', '<<=', '>>=', '&=', '^=', '|='])
/** Tokens a failed operand leaves for the enclosing construct. */
const CLOSERS = new Set([';', ')', ']', '}', ',', ':'])

interface Spec {
  type: Type
  storage: 'typedef' | 'extern' | 'static' | 'auto' | 'register' | null
  cregister: boolean
}

interface Declarator {
  name: string | null
  tok: Token | null
  type: Type
}

interface Tag {
  kind: 'struct' | 'union' | 'enum'
  def: RecordDef | null
}

interface SwitchCtx {
  type: Type
  cases: CaseStmt[]
  lines: Map<bigint, number>
  default: DefaultStmt | null
}

interface FnCtx {
  sym: FuncSym
  ret: Type
  scope: Scope
  locals: VarSym[]
  /** Declared locals and local statics, for #179-D and #552-D. */
  declared: VarSym[]
  statics: VarSym[]
  labels: Map<string, LabelStmt>
  gotos: GotoStmt[]
  loops: number
  switches: SwitchCtx[]
}

class Scope {
  readonly syms = new Map<string, Sym>()
  readonly tags = new Map<string, Tag>()

  constructor(readonly parent: Scope | null) {}

  lookup(name: string): Sym | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const found = s.syms.get(name)
      if (found) return found
    }
    return undefined
  }

  lookupTag(name: string): Tag | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const found = s.tags.get(name)
      if (found) return found
    }
    return undefined
  }
}

export function parseUnit(tokens: Token[], opts: ParseOptions, diags: Diags): TranslationUnit {
  return new Parser(tokens, opts, diags).unit()
}

class Parser {
  private pos = 0
  private readonly sema: Sema
  private readonly file = new Scope(null)
  private scope: Scope
  private fn: FnCtx | null = null
  private readonly literals = new Map<Token, NumberLiteral>()
  private readonly objects: VarSym[] = []
  private readonly funcs: FuncSym[] = []
  private readonly functions: FunctionDef[] = []
  private staticCount = 0
  private varCount = 0

  constructor(
    private readonly toks: Token[],
    private readonly opts: ParseOptions,
    private readonly diags: Diags
  ) {
    this.sema = new Sema(diags, opts.dialect)
    this.scope = this.file
    // Translation phase 7: every pp-number must be a valid constant.
    for (const t of toks) {
      if (t.kind !== 'number') continue
      const n = parseNumber(t.text)
      this.literals.set(t, n)
      if (n.kind === 'error') diags.error(tokLoc(t), n.error === 'octal' ? M.invalidOctal() : n.error === 'float' ? M.invalidFloat() : M.extraTextAfterNumber())
    }
  }

  unit(): TranslationUnit {
    while (this.tok.kind !== 'eof') {
      const start = this.pos
      try {
        this.externalDeclaration()
      } catch (e) {
        if (e !== ABORT) throw e
        this.recover(true)
        if (this.pos === start) this.next()
      }
    }
    for (const v of this.objects) {
      if (v.type.kind === 'array' && v.type.length === null && !v.type.vla && v.defined) v.type = { ...v.type, length: 1 }
    }
    this.usageWarnings(this.objects.filter((v) => v.storage === 'static' && v.linkName === v.name))
    return { file: this.opts.file, functions: this.functions, objects: this.objects, funcs: this.funcs, pragmas: this.opts.pragmas ?? [] }
  }

  // ------------------------------------------------------------ tokens

  private get tok(): Token {
    return this.toks[this.pos]
  }

  private peekTok(n = 1): Token {
    return this.toks[Math.min(this.pos + n, this.toks.length - 1)]
  }

  private next(): Token {
    const t = this.toks[this.pos]
    if (t.kind !== 'eof') this.pos++
    return t
  }

  private is(text: string, t: Token = this.tok): boolean {
    return (t.kind === 'punct' || t.kind === 'ident') && t.text === text
  }

  private accept(text: string): boolean {
    if (!this.is(text)) return false
    this.next()
    return true
  }

  private at(t: Token = this.tok): Loc {
    return tokLoc(t)
  }

  private abort(m: Msg, t: Token = this.tok): never {
    this.diags.error(this.at(t), m)
    throw ABORT
  }

  private expect(text: Punct): void {
    if (!this.accept(text)) this.abort(M.expected(text))
  }

  private isIdentifier(t: Token): boolean {
    return t.kind === 'ident' && !KEYWORDS.has(t.text)
  }

  private isTypedefName(t: Token): boolean {
    return t.kind === 'ident' && this.scope.lookup(t.text)?.kind === 'typedef'
  }

  private isDeclarationStart(t: Token = this.tok): boolean {
    return t.kind === 'ident' && (DECL_START.has(t.text) || this.isTypedefName(t))
  }

  /** `unknown_t x` — an undeclared name used as a type, which cl6x reports as #20. */
  private unknownTypeAhead(): boolean {
    const t = this.tok
    return this.isIdentifier(t) && !this.scope.lookup(t.text) && this.isIdentifier(this.peekTok())
  }

  /** Skips to the end of the current statement: past a ';', or up to a '}' (at file scope, past a balanced block). */
  private recover(top: boolean): void {
    let depth = 0
    for (;;) {
      const t = this.tok
      if (t.kind === 'eof') return
      if (t.kind === 'punct') {
        if (t.text === '(' || t.text === '[' || t.text === '{') depth++
        else if (t.text === ')' || t.text === ']') depth = Math.max(0, depth - 1)
        else if (t.text === '}') {
          if (depth === 0) {
            if (top) this.next()
            return
          }
          depth--
          if (depth === 0 && top) {
            this.next()
            return
          }
        } else if (t.text === ';' && depth === 0) {
          this.next()
          return
        }
      }
      this.next()
    }
  }

  /** After an opening '(' : skips past the matching ')'. */
  private skipBalanced(): void {
    let depth = 1
    while (depth > 0 && this.tok.kind !== 'eof') {
      if (this.is('(')) depth++
      else if (this.is(')')) depth--
      this.next()
    }
  }

  private skipAttribute(): void {
    this.next()
    if (!this.accept('(')) return
    this.skipBalanced()
  }

  // ------------------------------------------------------------ declarations

  private externalDeclaration(): void {
    if (this.accept(';')) return
    if (this.is('asm') || this.is('__asm') || this.is('__asm__')) this.abort(M.unsupported('asm statement'))
    if (this.unknownTypeAhead()) {
      this.unknownTypeDeclaration()
      return
    }
    const spec = this.declSpecifiers()
    if (this.accept(';')) return
    for (let first = true; ; first = false) {
      const d = this.declarator(spec.type, 'named')
      if (first && d.type.kind === 'function' && !this.is(';') && !this.is(',') && !this.is('=')) {
        this.functionDefinition(spec, d)
        return
      }
      this.declare(spec, d)
      if (!this.accept(',')) break
    }
    this.expect(';')
  }

  private unknownTypeDeclaration(): Stmt {
    const t = this.next()
    this.diags.error(this.at(t), M.undefinedIdent(t.text))
    const spec: Spec = { type: T.error, storage: null, cregister: false }
    for (;;) {
      this.declare(spec, this.declarator(T.error, 'named'))
      if (!this.accept(',')) break
    }
    this.expect(';')
    return { k: 'decl', loc: this.at(t), vars: [] }
  }

  private declSpecifiers(): Spec {
    let storage: Spec['storage'] = null
    let cregister = false
    let isConst = false
    let isVolatile = false
    let counter = 0
    let base: Type | null = null
    for (;;) {
      const t = this.tok
      if (t.kind !== 'ident') break
      const w = t.text
      if (STORAGE.has(w)) {
        storage = w as Spec['storage']
        this.next()
      } else if (w === '__cregister' || w === 'cregister') {
        cregister = true
        this.next()
      } else if (w === 'const' || w === '__const') {
        isConst = true
        this.next()
      } else if (w === 'volatile' || w === '__volatile__') {
        isVolatile = true
        this.next()
      } else if (QUALIFIERS.has(w) || HINTS.has(w)) this.next()
      else if (ATTRIBUTE.has(w)) this.skipAttribute()
      else if (w === 'struct' || w === 'union' || w === 'enum') {
        if (counter !== 0 || base) this.abort(M.badTypeCombination())
        this.next()
        base = w === 'enum' ? this.enumSpecifier() : this.recordSpecifier(w)
      } else if (counter === 0 && !base && this.isTypedefName(t)) {
        base = { ...(this.scope.lookup(w) as Extract<Sym, { kind: 'typedef' }>).type, alias: w }
        this.next()
      } else {
        const inc = TYPE_WORDS.get(w)
        if (inc === undefined) break
        if (base) this.abort(M.badTypeCombination())
        counter += inc
        if (!COMBOS.has(counter)) this.abort(M.badTypeCombination())
        this.next()
      }
    }
    const type = base ?? (counter === 0 ? T.int : (COMBOS.get(counter) as Type))
    return { type: withQuals(type, { const: isConst, volatile: isVolatile }), storage, cregister }
  }

  private recordSpecifier(kind: 'struct' | 'union'): Type {
    while (ATTRIBUTE.has(this.tok.text) && this.tok.kind === 'ident') this.skipAttribute()
    let tag: string | null = null
    if (this.isIdentifier(this.tok)) tag = this.next().text
    if (!this.is('{')) {
      if (tag === null) this.abort(M.expectedIdentifier())
      const found = this.is(';') ? this.scope.tags.get(tag) : this.scope.lookupTag(tag)
      if (found && found.kind === kind && found.def) return { kind, def: found.def }
      const def = newRecord(kind, tag)
      this.scope.tags.set(tag, { kind, def })
      return { kind, def }
    }
    this.next()
    const existing = tag !== null ? this.scope.tags.get(tag) : undefined
    let def: RecordDef
    if (existing && existing.kind === kind && existing.def && existing.def.members === null) def = existing.def
    else {
      def = newRecord(kind, tag)
      if (tag !== null) this.scope.tags.set(tag, { kind, def })
    }
    const fields: { name: string; type: Type }[] = []
    while (!this.is('}') && this.tok.kind !== 'eof') {
      const spec = this.declSpecifiers()
      if (this.accept(';')) {
        if (isRecord(spec.type) && spec.type.def.tag === null) this.abort(M.unsupported('anonymous struct or union member'))
        continue
      }
      for (;;) {
        const d = this.declarator(spec.type, 'named')
        if (this.is(':')) this.abort(M.unsupported('bit-field'))
        fields.push({ name: d.name as string, type: d.type })
        if (!this.accept(',')) break
      }
      if (!this.accept(';')) {
        if (this.is('}')) this.diags.warning(this.at(), M.expectedSemicolonD())
        else this.abort(M.expected(';'))
      }
    }
    this.expect('}')
    completeRecord(def, fields)
    return { kind, def }
  }

  private enumSpecifier(): Type {
    let tag: string | null = null
    if (this.isIdentifier(this.tok)) tag = this.next().text
    const type: Type = { ...T.int, enumTag: tag ?? '<unnamed>' }
    if (!this.is('{')) {
      if (tag === null) this.abort(M.expectedIdentifier())
      if (!this.scope.lookupTag(tag)) this.scope.tags.set(tag, { kind: 'enum', def: null })
      return type
    }
    this.next()
    if (tag !== null) this.scope.tags.set(tag, { kind: 'enum', def: null })
    let value = 0n
    while (!this.is('}')) {
      const id = this.next()
      if (!this.isIdentifier(id)) this.abort(M.expectedIdentifier(), id)
      if (this.accept('=')) {
        const e = this.conditional()
        const v = evalIntConst(e)
        if (v !== null) value = v
        else if (e.type.kind !== 'error') this.diags.error(e.loc, M.notConstant())
      }
      if (this.scope.syms.has(id.text)) this.diags.error(this.at(id), M.redeclared(id.text))
      this.scope.syms.set(id.text, { kind: 'enum', name: id.text, value, loc: this.at(id) })
      value++
      if (!this.accept(',')) break
    }
    this.expect('}')
    return type
  }

  private declarator(base: Type, mode: 'named' | 'param' | 'abstract'): Declarator {
    let type = this.pointers(base)
    if (this.is('(') && this.nestedAhead(mode)) {
      const start = this.pos
      this.next()
      this.skipBalanced()
      const outer = this.typeSuffix(type)
      const end = this.pos
      this.pos = start + 1
      const inner = this.declarator(outer, mode)
      this.expect(')')
      this.pos = end
      return inner
    }
    let tok: Token | null = null
    if (mode !== 'abstract' && this.isIdentifier(this.tok) && !(mode === 'param' && this.isTypedefName(this.tok))) tok = this.next()
    else if (mode === 'named') this.abort(M.expectedIdentifier())
    type = this.typeSuffix(type)
    while (this.tok.kind === 'ident' && ATTRIBUTE.has(this.tok.text)) this.skipAttribute()
    return { name: tok ? tok.text : null, tok, type }
  }

  /** After `(` in a declarator: a nested declarator rather than a parameter list. */
  private nestedAhead(mode: 'named' | 'param' | 'abstract'): boolean {
    const t = this.peekTok()
    if (this.is('*', t) || this.is('(', t)) return true
    return mode !== 'abstract' && this.isIdentifier(t) && !this.isTypedefName(t)
  }

  private pointers(base: Type): Type {
    let t = base
    while (this.accept('*')) {
      t = pointerTo(t)
      for (;;) {
        const w = this.tok.kind === 'ident' ? this.tok.text : ''
        if (w === 'const' || w === '__const') t = withQuals(t, { const: true })
        else if (w === 'volatile' || w === '__volatile__') t = withQuals(t, { volatile: true })
        else if (QUALIFIERS.has(w) || HINTS.has(w)) {
          /* restrict, near, far: hints only */
        } else if (ATTRIBUTE.has(w)) {
          this.skipAttribute()
          continue
        } else break
        this.next()
      }
    }
    return t
  }

  private typeSuffix(t: Type): Type {
    if (this.accept('[')) {
      let length: number | null = null
      let vla: Expr | null = null
      if (this.is('static') || QUALIFIERS.has(this.tok.text)) {
        // C99 `a[static 3]` / `a[const]` in a parameter: cl6x's C89 mode reports #29 and skips it.
        if (this.opts.dialect === 'c89') {
          this.diags.error(this.at(), M.expectedExpression())
          while (!this.is(']') && this.tok.kind !== 'eof') this.next()
        } else while (this.is('static') || QUALIFIERS.has(this.tok.text)) this.next()
      }
      if (!this.is(']')) {
        const e = this.sema.rvalue(this.assignment())
        if (e.type.kind !== 'error') {
          const v = evalIntConst(e)
          if (!isInteger(e.type)) this.diags.error(e.loc, M.integralRequired())
          else if (v === null) {
            if (this.fn) vla = e
            else this.diags.error(e.loc, M.notConstant())
          } else if (v < 0n) {
            this.diags.error(e.loc, M.arraySizeNotPositive())
            length = 1
          } else length = Number(v)
        }
      }
      this.expect(']')
      const a = arrayOf(this.typeSuffix(t), length)
      if (vla) a.vla = { expr: vla, len: null }
      return a
    }
    if (this.accept('(')) return this.parameterList(t)
    return t
  }

  private parameterList(ret: Type): FunctionType {
    const params: Param[] = []
    let variadic = false
    if (this.accept(')')) return { kind: 'function', ret, params, variadic, prototyped: false }
    if (this.is('void') && this.is(')', this.peekTok())) {
      this.next()
      this.next()
      return { kind: 'function', ret, params, variadic, prototyped: true }
    }
    for (;;) {
      if (this.accept('...')) {
        variadic = true
        this.expect(')')
        break
      }
      const start = this.tok
      const spec = this.declSpecifiers()
      const d = this.declarator(spec.type, 'param')
      let type = d.type
      if (type.kind === 'array') type = pointerTo(type.of)
      else if (type.kind === 'function') type = pointerTo(type)
      params.push({ name: d.name, type, loc: this.at(d.tok ?? start) })
      if (this.accept(',')) continue
      this.expect(')')
      break
    }
    return { kind: 'function', ret, params, variadic, prototyped: true }
  }

  private typeName(): Type {
    return this.declarator(this.declSpecifiers().type, 'abstract').type
  }

  private newVar(name: string, type: Type, at: Loc, storage: VarSym['storage']): VarSym {
    return {
      kind: 'var', name, linkName: name, type, loc: at, storage, external: false, file: this.opts.file, init: null, defined: true,
      cregister: false, register: false, hidden: type.kind === 'error', refs: 0, sets: 0, id: this.varCount++
    }
  }

  /** Declares one declarator; returns the automatic variable it created, if any. */
  private declare(spec: Spec, d: Declarator): VarSym | null {
    const name = d.name as string
    const at = this.at(d.tok as Token)
    if (spec.storage === 'typedef') {
      const prev = this.scope.syms.get(name)
      if (prev && !(prev.kind === 'typedef' && compatible(prev.type, d.type))) this.diags.error(at, M.redeclared(name))
      this.scope.syms.set(name, { kind: 'typedef', name, type: d.type, loc: at })
      return null
    }
    if (d.type.kind === 'function') {
      this.declareFunction(name, d.type, spec.storage === 'static', at, false)
      return null
    }
    return this.fn ? this.declareLocal(spec, d, name, at) : (this.declareGlobal(spec, d, name, at), null)
  }

  private declareFunction(name: string, type: FunctionType, isStatic: boolean, at: Loc, implicit: boolean): FuncSym {
    const prev = this.file.syms.get(name)
    if (prev?.kind === 'func') {
      if (!compatible(prev.type, type)) {
        this.diags.error(at, prev.implicit ? M.incompatibleImplicit(name, prev.loc.line) : M.incompatibleDecl(typeToString(prev.type, name), prev.loc.line))
      } else if (!prev.type.prototyped && type.prototyped) prev.type = type
      this.scope.syms.set(name, prev)
      return prev
    }
    if (prev) this.diags.error(at, prev.kind === 'var' ? M.incompatibleDecl(typeToString(prev.type, name), prev.loc.line) : M.redeclared(name))
    const sym: FuncSym = {
      kind: 'func', name, type, loc: at, file: this.opts.file, external: !isStatic, def: null, implicit,
      library: isBuiltinFile(at.file), used: false
    }
    this.file.syms.set(name, sym)
    this.scope.syms.set(name, sym)
    this.funcs.push(sym)
    return sym
  }

  private declareGlobal(spec: Spec, d: Declarator, name: string, at: Loc): VarSym {
    const prev = this.file.syms.get(name)
    let sym: VarSym
    if (prev?.kind === 'var' && !prev.hidden) {
      sym = prev
      if (!compatible(prev.type, d.type)) this.diags.error(at, M.incompatibleDecl(typeToString(prev.type, name), prev.loc.line))
      else if (prev.type.kind === 'array' && prev.type.length === null) prev.type = d.type
      if (spec.storage !== 'extern') {
        sym.defined = true
        if (sym.storage === 'extern') sym.storage = spec.storage === 'static' ? 'static' : 'global'
      }
    } else {
      if (prev) this.diags.error(at, prev.kind === 'func' ? M.incompatibleDecl(typeToString(prev.type, name), prev.loc.line) : M.redeclared(name))
      sym = this.newVar(name, d.type, at, spec.storage === 'extern' ? 'extern' : spec.storage === 'static' ? 'static' : 'global')
      sym.external = spec.storage !== 'static'
      sym.defined = spec.storage !== 'extern'
      sym.cregister = spec.cregister
      this.file.syms.set(name, sym)
      this.objects.push(sym)
    }
    if (this.scope !== this.file) this.scope.syms.set(name, sym)
    if (this.accept('=')) {
      if (sym.init) this.diags.error(at, M.alreadyInitialized(name))
      const r = lowerInit(this.sema, sym.type, this.initializer())
      sym.type = r.type
      sym.init = r.init
      sym.defined = true
      this.checkConstantInit(r.init)
    }
    if (sym.defined && sym.type.kind !== 'array' && !isComplete(sym.type) && sym.type.kind !== 'error') this.diags.error(at, M.incompleteType())
    return sym
  }

  private declareLocal(spec: Spec, d: Declarator, name: string, at: Loc): VarSym | null {
    const fn = this.fn as FnCtx
    if (spec.storage === 'extern') {
      const g = this.file.syms.get(name)
      this.scope.syms.set(name, g?.kind === 'var' ? g : this.declareGlobal(spec, d, name, at))
      return null
    }
    if (this.scope.syms.has(name)) this.diags.error(at, M.redeclared(name))
    if (spec.storage === 'static') {
      const sym = this.newVar(name, d.type, at, 'static')
      sym.linkName = `${name}$${++this.staticCount}`
      this.scope.syms.set(name, sym)
      this.objects.push(sym)
      fn.statics.push(sym)
      fn.declared.push(sym)
      if (this.accept('=')) {
        const r = lowerInit(this.sema, sym.type, this.initializer())
        sym.type = r.type
        sym.init = r.init
        this.checkConstantInit(r.init)
      }
      if (!isComplete(sym.type) && sym.type.kind !== 'error') this.diags.error(at, M.incompleteType())
      return null
    }
    const sym = this.newVar(name, d.type, at, 'auto')
    sym.register = spec.storage === 'register'
    if (d.type.kind === 'array' && d.type.vla) {
      const len = this.newVar(`${name}$len`, T.uint, at, 'auto')
      len.hidden = true
      len.init = { k: 'expr', expr: this.sema.convert(d.type.vla.expr, T.uint) }
      d.type.vla.len = len
      fn.locals.push(len)
    }
    this.scope.syms.set(name, sym)
    fn.locals.push(sym)
    fn.declared.push(sym)
    if (this.accept('=')) {
      if (sym.type.kind === 'array' && sym.type.vla) this.abort(M.unsupported('initializer for a variable-length array'))
      const r = lowerInit(this.sema, sym.type, this.initializer())
      sym.type = r.type
      sym.init = r.init
    }
    if (!isComplete(sym.type) && sym.type.kind !== 'error') this.diags.error(at, M.incompleteType())
    return sym
  }

  private functionDefinition(spec: Spec, d: Declarator): void {
    const type = d.type as FunctionType
    const name = d.name as string
    const at = this.at(d.tok as Token)
    const sym = this.declareFunction(name, type, spec.storage === 'static', at, false)
    if (sym.def) this.diags.error(at, M.functionRedefined(name))
    sym.type = type
    if (!this.is('{')) this.abort(M.expected('{'))
    const scope = new Scope(this.file)
    const fn: FnCtx = { sym, ret: type.ret, scope, locals: [], declared: [], statics: [], labels: new Map(), gotos: [], loops: 0, switches: [] }
    const params: VarSym[] = []
    for (const p of type.params) {
      if (p.name === null) continue
      const v = this.newVar(p.name, p.type, p.loc ?? at, 'param')
      if (scope.syms.has(p.name)) this.diags.error(v.loc, M.redeclared(p.name))
      scope.syms.set(p.name, v)
      params.push(v)
    }
    const saved = { scope: this.scope, fn: this.fn }
    this.scope = scope
    this.fn = fn
    try {
      const body = this.compound(false)
      for (const g of fn.gotos) {
        const target = fn.labels.get(g.label)
        if (target) g.target = target
        else this.diags.error(g.loc, M.labelUndefined(g.label))
      }
      this.usageWarnings(fn.declared)
      const def: FunctionDef = { sym, params, body, locals: fn.locals, statics: fn.statics, loc: at, end: body.end }
      sym.def = def
      this.functions.push(def)
    } finally {
      this.scope = saved.scope
      this.fn = saved.fn
    }
  }

  private usageWarnings(vars: VarSym[]): void {
    for (const v of vars) {
      if (v.hidden || v.refs > 0 || isBuiltinFile(v.loc.file)) continue
      this.diags.warning(v.loc, v.sets > 0 ? M.setNotUsed(v.name) : M.unreferenced(v.name))
    }
  }

  private initializer(): InitSyntax {
    const open = this.tok
    if (!this.accept('{')) return { k: 'expr', expr: this.assignment(), loc: this.at(open) }
    const items: InitSyntaxItem[] = []
    while (!this.is('}')) {
      const designators: Designator[] = []
      for (;;) {
        const d = this.tok
        if (this.accept('[')) {
          const e = this.conditional()
          const v = evalIntConst(e)
          if (v === null && e.type.kind !== 'error') this.diags.error(e.loc, M.notConstant())
          this.expect(']')
          designators.push({ k: 'index', index: Number(v ?? 0n), loc: this.at(d) })
        } else if (this.accept('.')) {
          const id = this.next()
          if (!this.isIdentifier(id)) this.abort(M.expectedIdentifier(), id)
          designators.push({ k: 'field', name: id.text, loc: this.at(id) })
        } else break
      }
      if (designators.length > 0 && !this.accept('=')) this.abort(M.expectedExpression())
      items.push({ designators, init: this.initializer() })
      if (this.accept(',')) continue
      if (!this.is('}')) this.abort(M.expected(','))
    }
    this.next()
    return { k: 'list', items, loc: this.at(open) }
  }

  /** Objects with static storage need constant initialisers (cl6x #28). */
  private checkConstantInit(init: Init): void {
    const check = (e: Expr): void => {
      if (e.type.kind === 'error' || e.k === 'string') return
      if (evalConst(e) === null) this.diags.error(e.loc, M.notConstant())
    }
    if (init.k === 'expr') check(init.expr)
    else init.items.forEach((i) => check(i.expr))
  }

  // ------------------------------------------------------------ statements

  private compound(newScope = true): Block {
    const open = this.tok
    this.expect('{')
    const saved = this.scope
    if (newScope) this.scope = new Scope(this.scope)
    try {
      const body: Stmt[] = []
      while (!this.is('}')) {
        if (this.tok.kind === 'eof') this.abort(M.expected('}'))
        const start = this.pos
        try {
          body.push(this.blockItem())
        } catch (e) {
          if (e !== ABORT) throw e
          this.recover(false)
          if (this.pos === start && !this.is('}')) this.next()
        }
      }
      const close = this.next()
      return { k: 'block', loc: this.at(open), body, end: this.at(close) }
    } finally {
      this.scope = saved
    }
  }

  private blockItem(): Stmt {
    if (this.unknownTypeAhead()) return this.unknownTypeDeclaration()
    if (this.isDeclarationStart() && !this.is(':', this.peekTok())) return this.blockDeclaration()
    return this.statement()
  }

  private blockDeclaration(): Stmt {
    const at = this.at()
    const spec = this.declSpecifiers()
    const vars: VarSym[] = []
    if (this.accept(';')) return { k: 'decl', loc: at, vars }
    for (;;) {
      const v = this.declare(spec, this.declarator(spec.type, 'named'))
      if (v) {
        if (v.type.kind === 'array' && v.type.vla?.len) vars.push(v.type.vla.len)
        vars.push(v)
      }
      if (!this.accept(',')) break
    }
    this.expect(';')
    return { k: 'decl', loc: at, vars }
  }

  private loopBody(): Stmt {
    const fn = this.fn as FnCtx
    fn.loops++
    try {
      return this.statement()
    } finally {
      fn.loops--
    }
  }

  private statement(): Stmt {
    const t = this.tok
    const at = this.at(t)
    const fn = this.fn as FnCtx
    if (this.is('{')) return this.compound()
    if (this.accept(';')) return { k: 'empty', loc: at }
    if (t.kind === 'ident') {
      switch (t.text) {
        case 'if': {
          this.next()
          this.expect('(')
          const test = this.sema.condition(this.expression())
          this.expect(')')
          const then = this.statement()
          const els = this.accept('else') ? this.statement() : null
          return { k: 'if', loc: at, test, then, else: els }
        }
        case 'while': {
          this.next()
          this.expect('(')
          const test = this.sema.condition(this.expression())
          this.expect(')')
          return { k: 'while', loc: at, test, body: this.loopBody() }
        }
        case 'do': {
          this.next()
          const body = this.loopBody()
          if (!this.accept('while')) this.abort(M.expectedWhile())
          this.expect('(')
          const test = this.sema.condition(this.expression())
          this.expect(')')
          this.expect(';')
          return { k: 'do', loc: at, body, test }
        }
        case 'for':
          return this.forStatement(at)
        case 'switch':
          return this.switchStatement(at)
        case 'case':
          return this.caseLabel(at)
        case 'default':
          return this.defaultLabel(at)
        case 'break':
          this.next()
          if (fn.loops === 0 && fn.switches.length === 0) this.diags.error(at, M.breakOutside())
          this.expect(';')
          return { k: 'break', loc: at }
        case 'continue':
          this.next()
          if (fn.loops === 0) this.diags.error(at, M.continueOutside())
          this.expect(';')
          return { k: 'continue', loc: at }
        case 'return': {
          this.next()
          const value = this.is(';') ? null : this.expression()
          const v = this.sema.returnValue(fn.ret, fn.sym.name, value, at)
          this.expect(';')
          return { k: 'return', loc: at, value: v }
        }
        case 'goto': {
          this.next()
          const id = this.next()
          if (!this.isIdentifier(id)) this.abort(M.expectedIdentifier(), id)
          this.expect(';')
          const g: GotoStmt = { k: 'goto', loc: at, label: id.text, target: null }
          fn.gotos.push(g)
          return g
        }
        case 'asm':
        case '__asm':
        case '__asm__':
          this.abort(M.unsupported('asm statement'))
      }
      if (this.isIdentifier(t) && this.is(':', this.peekTok())) {
        this.next()
        this.next()
        const s: LabelStmt = { k: 'label', loc: at, name: t.text, body: { k: 'empty', loc: at } }
        if (fn.labels.has(t.text)) this.diags.error(at, M.labelRedefined(t.text))
        else fn.labels.set(t.text, s)
        if (!this.is('}')) s.body = this.statement()
        return s
      }
      if (t.text === 'else' || this.isDeclarationStart(t)) this.abort(M.expectedStatement())
    }
    const expr = this.expression()
    this.expect(';')
    return { k: 'expr', loc: at, expr }
  }

  private forStatement(at: Loc): Stmt {
    this.next()
    this.expect('(')
    const saved = this.scope
    this.scope = new Scope(this.scope)
    try {
      let init: Stmt | null = null
      if (this.accept(';')) init = null
      else if (this.isDeclarationStart()) {
        if (this.opts.dialect === 'c99') init = this.blockDeclaration()
        else {
          this.diags.error(this.at(), M.expectedExpression())
          while (this.tok.kind !== 'eof' && !this.is(';')) this.next()
          this.accept(';')
        }
      } else {
        const e = this.expression()
        init = { k: 'expr', loc: e.loc, expr: e }
        this.expect(';')
      }
      const test = this.is(';') ? null : this.sema.condition(this.expression())
      this.expect(';')
      const step = this.is(')') ? null : this.expression()
      this.expect(')')
      return { k: 'for', loc: at, init, test, step, body: this.loopBody() }
    } finally {
      this.scope = saved
    }
  }

  private switchStatement(at: Loc): Stmt {
    this.next()
    this.expect('(')
    const test = this.sema.switchValue(this.expression())
    this.expect(')')
    const ctx: SwitchCtx = { type: test.type, cases: [], lines: new Map(), default: null }
    const fn = this.fn as FnCtx
    fn.switches.push(ctx)
    try {
      const body = this.statement()
      return { k: 'switch', loc: at, test, body, cases: ctx.cases, default: ctx.default }
    } finally {
      fn.switches.pop()
    }
  }

  private caseLabel(at: Loc): Stmt {
    this.next()
    const sw = (this.fn as FnCtx).switches.at(-1)
    const e = this.conditional()
    let value = 0n
    if (e.type.kind !== 'error') {
      const v = evalIntConst(sw && sw.type.kind !== 'error' ? this.sema.convert(this.sema.rvalue(e), sw.type) : e)
      if (v === null) this.diags.error(e.loc, M.notConstant())
      else value = v
    }
    this.expect(':')
    if (!sw) this.diags.error(at, M.caseOutside())
    else if (sw.lines.has(value)) this.diags.error(at, M.duplicateCase(sw.lines.get(value) as number))
    else sw.lines.set(value, at.line)
    const s: CaseStmt = { k: 'case', loc: at, value, body: { k: 'empty', loc: at } }
    sw?.cases.push(s)
    if (!this.is('}')) s.body = this.statement()
    return s
  }

  private defaultLabel(at: Loc): Stmt {
    this.next()
    this.expect(':')
    const sw = (this.fn as FnCtx).switches.at(-1)
    const s: DefaultStmt = { k: 'default', loc: at, body: { k: 'empty', loc: at } }
    if (!sw) this.diags.error(at, M.defaultOutside())
    else if (sw.default) this.diags.error(at, M.duplicateDefault())
    else sw.default = s
    if (!this.is('}')) s.body = this.statement()
    return s
  }

  // ------------------------------------------------------------ expressions

  private expression(): Expr {
    let e = this.assignment()
    while (this.is(',')) {
      const t = this.next()
      e = this.sema.comma(e, this.assignment(), this.at(t))
    }
    return e
  }

  private assignment(): Expr {
    const lhs = this.conditional()
    const t = this.tok
    if (t.kind !== 'punct' || !ASSIGN_OPS.has(t.text)) return lhs
    this.next()
    const rhs = this.assignment()
    return t.text === '=' ? this.sema.assign(lhs, rhs, this.at(t)) : this.sema.compound(t.text as CompoundOp, lhs, rhs, this.at(t))
  }

  private conditional(): Expr {
    const c = this.binary(1)
    if (!this.is('?')) return c
    const q = this.next()
    if (this.is(':')) this.abort(M.unsupported('GNU "?:" operator'))
    const a = this.expression()
    this.expect(':')
    return this.sema.cond(c, a, this.conditional(), this.at(q))
  }

  private binary(min: number): Expr {
    let left = this.cast()
    for (;;) {
      const t = this.tok
      const prec = t.kind === 'punct' ? PREC[t.text] : undefined
      if (prec === undefined || prec < min) return left
      this.next()
      left = this.sema.binary(t.text as BinOp | '&&' | '||', left, this.binary(prec + 1), this.at(t))
    }
  }

  private cast(): Expr {
    if (this.is('(') && this.isDeclarationStart(this.peekTok())) {
      const open = this.next()
      const type = this.typeName()
      this.expect(')')
      if (this.is('{')) return this.postfix(this.compoundLiteral(type, this.at(open)))
      return this.sema.cast(type, this.cast(), this.at(open))
    }
    return this.unary()
  }

  private unary(): Expr {
    const t = this.tok
    const at = this.at(t)
    if (t.kind === 'punct') {
      switch (t.text) {
        case '++':
        case '--':
          this.next()
          return this.sema.incdec(t.text, this.unary(), true, at)
        case '&':
          this.next()
          return this.sema.addr(this.cast(), at)
        case '*':
          this.next()
          return this.sema.deref(this.cast(), at)
        case '+':
        case '-':
        case '~':
        case '!':
          this.next()
          return this.sema.unary(t.text, this.cast(), at)
      }
    }
    if (this.is('sizeof')) {
      this.next()
      if (this.is('(') && this.isDeclarationStart(this.peekTok())) {
        this.next()
        const type = this.typeName()
        this.expect(')')
        if (this.is('{')) return this.sema.sizeofExpr(this.postfix(this.compoundLiteral(type, at)), at)
        return this.sema.sizeofType(type, at)
      }
      return this.sema.sizeofExpr(this.unary(), at)
    }
    if (this.is('_Alignof') || this.is('__alignof__')) {
      this.next()
      this.expect('(')
      const type = this.typeName()
      this.expect(')')
      return { k: 'int', loc: at, type: T.uint, value: BigInt(alignOf(type)) }
    }
    return this.postfix(this.primary())
  }

  private postfix(start: Expr): Expr {
    let e = start
    for (;;) {
      const t = this.tok
      const at = this.at(t)
      if (this.accept('[')) {
        const i = this.expression()
        this.expect(']')
        e = this.sema.index(e, i, at)
      } else if (this.accept('(')) {
        const args: Expr[] = []
        if (!this.accept(')')) {
          do args.push(this.assignment())
          while (this.accept(','))
          this.expect(')')
        }
        e = this.sema.call(e, args, at)
      } else if (this.accept('.') || this.accept('->')) {
        const id = this.next()
        if (!this.isIdentifier(id)) this.abort(M.expectedIdentifier(), id)
        e = t.text === '.' ? this.sema.member(e, id.text, at) : this.sema.arrow(e, id.text, at)
      } else if (this.is('++') || this.is('--')) {
        this.next()
        e = this.sema.incdec(t.text as '++' | '--', e, false, at)
      } else return e
    }
  }

  private primary(): Expr {
    const t = this.tok
    const at = this.at(t)
    switch (t.kind) {
      case 'number':
        this.next()
        return this.sema.number(this.literals.get(t) as NumberLiteral, at)
      case 'char':
        this.next()
        return this.sema.char(t.text, at)
      case 'string': {
        const texts: string[] = []
        while (this.tok.kind === 'string') texts.push(this.next().text)
        return this.sema.string(texts, at)
      }
      case 'punct':
        if (t.text === '(') {
          this.next()
          if (this.is('{')) this.abort(M.unsupported('statement expression'))
          const e = this.expression()
          this.expect(')')
          return e
        }
        break
      case 'ident':
        if (!KEYWORDS.has(t.text)) return this.identifier(t)
        break
    }
    this.diags.error(at, M.expectedExpression())
    if (t.kind !== 'eof' && !(t.kind === 'punct' && CLOSERS.has(t.text))) this.next()
    return { k: 'error', loc: at, type: T.error }
  }

  private identifier(t: Token): Expr {
    const name = t.text
    const at = this.at(t)
    this.next()
    switch (name) {
      case '__INFINITY__':
        return { k: 'float', loc: at, type: T.float, value: Infinity }
      case '__NAN__':
        return { k: 'float', loc: at, type: T.float, value: NaN }
      case '__builtin_va_start': {
        this.expect('(')
        const ap = this.assignment()
        this.expect(',')
        const last = this.assignment()
        this.expect(')')
        return this.sema.vaStart(ap, last, at)
      }
      case '__builtin_va_arg': {
        this.expect('(')
        const ap = this.assignment()
        this.expect(',')
        const type = this.typeName()
        this.expect(')')
        return this.sema.vaArg(ap, type, at)
      }
    }
    const sym = this.scope.lookup(name)
    if (!sym && MEM_INTRINSICS.has(name) && this.is('(')) {
      this.next()
      const arg = this.assignment()
      this.expect(')')
      return this.sema.memAccess(name, arg, at)
    }
    if (!sym) {
      if (this.is('(')) {
        const f = this.declareFunction(name, { kind: 'function', ret: T.int, params: [], variadic: false, prototyped: false }, false, at, true)
        this.diags.warning(at, M.implicitFunction(name))
        return this.sema.funcRef(f, at)
      }
      this.diags.error(at, M.undefinedIdent(name))
      const poison = this.newVar(name, T.error, at, 'auto')
      ;(this.fn ? this.fn.scope : this.file).syms.set(name, poison)
      return { k: 'error', loc: at, type: T.error }
    }
    switch (sym.kind) {
      case 'var':
        return this.sema.varRef(sym, at)
      case 'func':
        return this.sema.funcRef(sym, at)
      case 'enum':
        return { k: 'int', loc: at, type: T.int, value: sym.value }
      default:
        this.diags.error(at, M.expectedExpression())
        return { k: 'error', loc: at, type: T.error }
    }
  }

  private compoundLiteral(type: Type, at: Loc): Expr {
    const syntax = this.initializer()
    const obj = this.newVar('', type, at, this.fn ? 'auto' : 'static')
    obj.hidden = true
    const r = lowerInit(this.sema, type, syntax)
    obj.type = r.type
    obj.init = r.init
    if (this.fn) this.fn.locals.push(obj)
    else {
      obj.linkName = `$C$CL${++this.staticCount}`
      this.objects.push(obj)
      this.checkConstantInit(r.init)
    }
    return { k: 'compoundLit', loc: at, type: r.type, obj, init: r.init }
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/parser.test.ts`
Expected: PASS. If one of the table rows differs, compare against the real compiler before changing the expectation. The rows were captured from `cl6x` 8.3.12.

- [ ] **Step 5: Run the whole interpreter suite and typecheck**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: all interp tests pass and there are no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/interp/frontend/parser.ts tests/unit/interp/parser.test.ts
git commit -m "feat(interp): C parser with cl6x error recovery, scopes and usage warnings"
```

---
### Task 7: Compiling and linking programs, and the cl6x diagnostic reference

**Files:**
- Create: `src/interp/frontend/program.ts`
- Create: `scripts/capture-cl6x-diagnostics.mjs`
- Create: `tests/fixtures/diag/cl6x-cases.json`. You write the sources; the `cl6x` fields come from the script.
- Test: `tests/unit/interp/program.test.ts`, `tests/unit/interp/cl6x-diagnostics.test.ts`

**Interfaces:**
- Consumes: `preprocess`, `PreprocessOptions`, `isBuiltinFile`, `parseUnit`, `Diags`, `FatalError`, `FrontDiagnostic`, `BUILTIN_HEADERS`, `PRELUDE`, and the AST types.
- Produces:
  - `CompileOptions` extends `PreprocessOptions` with `diagWarnings`.
  - `compileUnit(file, opts): UnitResult {file, unit, diagnostics, files}`. `unit` is null if there were errors.
  - `linkProgram(units): LinkResult {program, problems}`.
  - `Program {units, globals, functions, main}`.
  - `LinkProblem`, one of `{kind:'unresolved', name, file}` or `{kind:'redefined', name, first, second}`.
  - `library(): {functions: Set, objects: Set}`: what the LabSim runtime provides.

- [ ] **Step 1: Write the reference cases**

Create `tests/fixtures/diag/cl6x-cases.json`. Each case is a small program with a known mistake, taken from the probes run while planning. `cl6x` starts empty.

```json path=tests/fixtures/diag/cl6x-cases.json
[
 {"name": "e1", "source": "int main(void){ int a = b; return 0; }", "cl6x": []},
 {"name": "e2", "source": "int main(void){ int a = 1\n return a; }", "cl6x": []},
 {"name": "e3", "source": "#include <math.io>\nint main(void){return 0;}", "cl6x": []},
 {"name": "e4", "source": "int f(int a,int b){return a+b;}\nint main(void){ return f(1); }", "cl6x": []},
 {"name": "e5", "source": "int f(int a){return a;}\nint main(void){ return f(1,2); }", "cl6x": []},
 {"name": "e6", "source": "int main(void){ int a; int a; return 0; }", "cl6x": []},
 {"name": "e7", "source": "int main(void){ 3 = 4; return 0; }", "cl6x": []},
 {"name": "e8", "source": "int main(void){ int x = ; return 0; }", "cl6x": []},
 {"name": "e9", "source": "int main(void){ foo(); return 0; }", "cl6x": []},
 {"name": "e10", "source": "int main(void){ int *p; float f = 1; p = f; return 0; }", "cl6x": []},
 {"name": "e11", "source": "int main(void){ int a[3]; a = 0; return 0; }", "cl6x": []},
 {"name": "e12", "source": "int main(void){ return (1 + 2; }", "cl6x": []},
 {"name": "e13", "source": "int main(void){ int x; x.y = 1; return 0; }", "cl6x": []},
 {"name": "e14", "source": "struct S {int a;};\nint main(void){ struct S s; s.b = 1; return 0; }", "cl6x": []},
 {"name": "e15", "source": "int main(void){ int a[2] = {1,2,3}; return 0; }", "cl6x": []},
 {"name": "e16", "source": "int main(void){ undefined_t x; return 0; }", "cl6x": []},
 {"name": "e17", "source": "int main(void){ for(int i=0;i<3;i++) {} return i; }", "cl6x": []},
 {"name": "e18", "source": "int main(void){ int x; x(); return 0; }", "cl6x": []},
 {"name": "e19", "source": "int main(void){ int *p; int x = *x; return 0; }", "cl6x": []},
 {"name": "e20", "source": "int main(void){ break; return 0; }", "cl6x": []},
 {"name": "e21", "source": "int main(void){ switch(1){ case 1: case 1: break;} return 0; }", "cl6x": []},
 {"name": "e22", "source": "int main(void){ const int c = 1; c = 2; return 0; }", "cl6x": []},
 {"name": "e23", "source": "void f(void){}\nint main(void){ int x = f(); return 0; }", "cl6x": []},
 {"name": "e24", "source": "int main(void){ goto L; return 0; }", "cl6x": []},
 {"name": "e25", "source": "int main(void){ int x = 1 return 0; }", "cl6x": []},
 {"name": "e26", "source": "int main(void){ return 0; ", "cl6x": []},
 {"name": "e27", "source": "int main(void){ int a; char *s = \"x\"; a = s; return 0; }", "cl6x": []},
 {"name": "e28", "source": "int main(void){ int x = 10 / 0; return 0; }", "cl6x": []},
 {"name": "e29", "source": "#if 1\nint main(void){return 0;}", "cl6x": []},
 {"name": "e30", "source": "#error stop here\nint main(void){return 0;}", "cl6x": []},
 {"name": "e31", "source": "int main(void){ int a[-1]; return 0; }", "cl6x": []},
 {"name": "e32", "source": "int main(void){ printf(\"hi\n\"); return 0; }", "cl6x": []},
 {"name": "e33", "source": "int main(void){ float f; f = sin(1.0); return 0; }", "cl6x": []},
 {"name": "e34", "source": "int main(void){ int x; return 0 }", "cl6x": []},
 {"name": "e35", "source": "int main(void){ struct T t; return 0; }", "cl6x": []},
 {"name": "e36", "source": "int main(void){ int x = 1; x++ ++; return 0; }", "cl6x": []},
 {"name": "e37", "source": "double f(double);\nint f(int x){return x;}\nint main(void){return 0;}", "cl6x": []},
 {"name": "e38", "source": "int main(void){ int x; if (x) else x = 1; return 0; }", "cl6x": []},
 {"name": "e39", "source": "int main(void){ char c = 'ab'; return 0; }", "cl6x": []},
 {"name": "e40", "source": "int main(void){ int i; for (i = 0; i < 3; i++ { } return 0; }", "cl6x": []},
 {"name": "p1", "source": "#foo\nint main(void){return 0;}", "cl6x": []},
 {"name": "p2", "source": "#endif\nint main(void){return 0;}", "cl6x": []},
 {"name": "p3", "source": "#else\nint main(void){return 0;}", "cl6x": []},
 {"name": "p4", "source": "#define F(a,b) a+b\nint main(void){return F(1);}", "cl6x": []},
 {"name": "p5", "source": "#define F(a) a\nint main(void){return F(1,2);}", "cl6x": []},
 {"name": "p6", "source": "#define X 1\n#define X 2\nint main(void){return X;}", "cl6x": []},
 {"name": "p7", "source": "#include \"nothere.h\"\nint main(void){return 0;}", "cl6x": []},
 {"name": "p8", "source": "#if 1 +\n#endif\nint main(void){return 0;}", "cl6x": []},
 {"name": "p9", "source": "#define F(a) a\nint main(void){return F(1;}", "cl6x": []},
 {"name": "p10", "source": "int main(void){ int x = \"s\"; return x; }", "cl6x": []},
 {"name": "p11", "source": "int f(int *p);\nint main(void){ float y; return f(&y); }", "cl6x": []},
 {"name": "p12", "source": "int f(int *p);\nint main(void){ return f(3.0); }", "cl6x": []},
 {"name": "p13", "source": "int main(void){ return; }", "cl6x": []},
 {"name": "p14", "source": "void f(void){ return 1; }\nint main(void){ f(); return 0; }", "cl6x": []},
 {"name": "p15", "source": "int main(void){ int a = 1, b; b = a % 2.0; return b; }", "cl6x": []},
 {"name": "p16", "source": "int main(void){ int *p, *q; int x = p + q; return x; }", "cl6x": []},
 {"name": "p17", "source": "int main(void){ struct S {int a;} s; int x = s + 1; return x; }", "cl6x": []},
 {"name": "p18", "source": "int main(void){ int a[2] = {1,2}; int b[2] = a; return 0; }", "cl6x": []},
 {"name": "p19", "source": "int main(void){ int x = sizeof(void); return x; }", "cl6x": []},
 {"name": "p20", "source": "int f(void);\nint main(void){ return f; }", "cl6x": []},
 {"name": "p21", "source": "int main(void){ int x; x = 3 ? ; return 0; }", "cl6x": []},
 {"name": "p22", "source": "int main(void){ continue; return 0; }", "cl6x": []},
 {"name": "p23", "source": "int main(void){ case 1: return 0; }", "cl6x": []},
 {"name": "p24", "source": "int main(void){ switch(1){ default: default: break; } return 0; }", "cl6x": []},
 {"name": "p25", "source": "int main(void){ L: L: return 0; }", "cl6x": []},
 {"name": "p26", "source": "typedef int T;\nint main(void){ T = 3; return 0; }", "cl6x": []},
 {"name": "p27", "source": "int main(void){ int x = 1; x->y = 2; return 0; }", "cl6x": []},
 {"name": "p28", "source": "struct S {int a;};\nint main(void){ struct S *p; p.a = 1; return 0; }", "cl6x": []},
 {"name": "p29", "source": "struct S {int a;};\nint main(void){ struct S s; s->a = 1; return 0; }", "cl6x": []},
 {"name": "p30", "source": "int main(void){ float f = 1.5; int y = f << 2; return y; }", "cl6x": []},
 {"name": "p31", "source": "int main(void){ int a[3]; int *p = &a; return *p; }", "cl6x": []},
 {"name": "p32", "source": "int main(void){ double d = 1.0; int *p = &d; return *p; }", "cl6x": []},
 {"name": "p33", "source": "int x = 1;\nint x = 2;\nint main(void){return x;}", "cl6x": []},
 {"name": "p34", "source": "int main(void){ int a[2][3] = {{1,2,3},{4,5,6},{7}}; return a[0][0]; }", "cl6x": []},
 {"name": "p36", "source": "int main(void){ unsigned char c = 300; return c; }", "cl6x": []},
 {"name": "p37", "source": "int main(void){ int a[3]; return a[5]; }", "cl6x": []},
 {"name": "p38", "source": "int f(int);\nint f(int x, int y){return x;}\nint main(void){return 0;}", "cl6x": []},
 {"name": "p39", "source": "int main(void){ int x; float y; y = x % y; return 0;}", "cl6x": []},
 {"name": "p40", "source": "int main(void){ int static_x = 0; while (1) ; return static_x; }", "cl6x": []},
 {"name": "p41", "source": "int main(void){ int i = 0; i = i++ + 1; return i; }", "cl6x": []},
 {"name": "p42", "source": "int main(void){ int x = 08; return x; }", "cl6x": []},
 {"name": "p43", "source": "int main(void){ int x = 1.0e; return x; }", "cl6x": []},
 {"name": "p44", "source": "int main(void){ char s[3] = \"abcd\"; return s[0]; }", "cl6x": []},
 {"name": "p45", "source": "int main(void){ const char *s = \"a\"; s[0] = 'b'; return 0; }", "cl6x": []},
 {"name": "p46", "source": "int main(void){ int x; &x = 0; return 0; }", "cl6x": []},
 {"name": "p47", "source": "int main(void){ return @; }", "cl6x": []},
 {"name": "r1", "source": "void f(void){ return 1; }", "cl6x": []},
 {"name": "r2", "source": "int f(void){ return f; }", "cl6x": []},
 {"name": "r3", "source": "struct S{int a;};\nint f(struct S s){ return s; }", "cl6x": []},
 {"name": "r4", "source": "int *f(double d){ return d; }", "cl6x": []},
 {"name": "r5", "source": "int *f(int d){ return d; }", "cl6x": []},
 {"name": "r6", "source": "struct S{int a;};\nint main(void){ struct S s; int x = 1; s = x; return 0; }", "cl6x": []},
 {"name": "r7", "source": "struct S{int a;};\nint main(void){ struct S s; int x; x = s; return x; }", "cl6x": []},
 {"name": "r8", "source": "struct S{int a;}; struct T{int a;};\nint main(void){ struct S s; struct T t; s = t; return 0; }", "cl6x": []},
 {"name": "r9", "source": "int main(void){ int *p; char *q = 0; p = q; return 0; }", "cl6x": []},
 {"name": "r10", "source": "int main(void){ int *p; void *q = 0; p = q; return 0; }", "cl6x": []},
 {"name": "r11", "source": "int main(void){ int *p = 0; float f = 1; f = p; return 0; }", "cl6x": []},
 {"name": "r12", "source": "void g(float *); int main(void){ int x; g(x); return 0; }", "cl6x": []},
 {"name": "r13", "source": "struct S{int a;}; void g(int); int main(void){ struct S s; g(s); return 0; }", "cl6x": []},
 {"name": "r14", "source": "int main(void){ const int x = 1; int *p = &x; return *p; }", "cl6x": []},
 {"name": "r15", "source": "int main(void){ float x = 1; x %= 2; return 0; }", "cl6x": []},
 {"name": "r16", "source": "int main(void){ int a[3]; a++; return 0; }", "cl6x": []},
 {"name": "r17", "source": "int main(void){ void *p = 0; int x = *p; return x; }", "cl6x": []},
 {"name": "r18", "source": "int main(void){ int (*fp)(int) = 0; int x = fp(1,2); return x; }", "cl6x": []},
 {"name": "x1", "source": "int n = 3;\nint a = n;\nint main(void){return a;}", "cl6x": []},
 {"name": "x2", "source": "int main(void){ int a[0]; return 0; }", "cl6x": []},
 {"name": "x3", "source": "int main(void){ return _dotp2(1,2); }", "cl6x": []},
 {"name": "x4", "source": "#warning careful\nint main(void){return 0;}", "cl6x": []},
 {"name": "x5", "source": "#if 1/0\n#endif\nint main(void){return 0;}", "cl6x": []},
 {"name": "x6", "source": "int main(void){ int x = {1,2}; return x; }", "cl6x": []},
 {"name": "x7", "source": "struct S;\nint main(void){ return sizeof(struct S); }", "cl6x": []},
 {"name": "x8", "source": "int main(void){ unsigned u = -1; return (int)u; }", "cl6x": []},
 {"name": "x9", "source": "int f(void){ }\nint main(void){ return f(); }", "cl6x": []},
 {"name": "x10", "source": "int main(void){ int x; x = 1; }", "cl6x": []},
 {"name": "x11", "source": "static int unused_global;\nint main(void){return 0;}", "cl6x": []},
 {"name": "x12", "source": "int main(void){ static int s; return 0; }", "cl6x": []},
 {"name": "x13", "source": "int main(void){ int i; for (i=0;i<2;i++); return 0; }", "cl6x": []},
 {"name": "x14", "source": "int main(void){ int x = 1; x += 2; return 0; }", "cl6x": []},
 {"name": "x15", "source": "int main(void){ int x = 1; x++; return 0; }", "cl6x": []},
 {"name": "x16", "source": "int main(void){ int x; int *p = &x; return 0; }", "cl6x": []},
 {"name": "x17", "source": "int main(void){ int a[3]; a[0] = 1; return 0; }", "cl6x": []},
 {"name": "x18", "source": "int main(void){ int a[3]; return a[3]; }", "cl6x": []},
 {"name": "y1", "source": "int main(void){ int a[3; return 0; }", "cl6x": []},
 {"name": "y2", "source": "int main(void){ int x = 1; if x) x = 2; return 0; }", "cl6x": []},
 {"name": "y3", "source": "int main(void){ do x = 1; (0); return 0; }", "cl6x": []},
 {"name": "y4", "source": "int main(void){ int x; do { x = 1; } (0); return 0; }", "cl6x": []},
 {"name": "y5", "source": "int main void){ return 0; }", "cl6x": []},
 {"name": "y6", "source": "int main(void){ int = 3; return 0; }", "cl6x": []},
 {"name": "y7", "source": "int main(void){ struct { int a } s; return 0; }", "cl6x": []},
 {"name": "y8", "source": "int f(int a int b){ return a; }", "cl6x": []},
 {"name": "y9", "source": "int main(void){ int x; x = (int 3; return 0; }", "cl6x": []},
 {"name": "y10", "source": "int main(void){ int x[2] = {1 2}; return 0; }", "cl6x": []},
 {"name": "y11", "source": "int main(void) return 0;", "cl6x": []},
 {"name": "y12", "source": "int 3x;", "cl6x": []},
 {"name": "y13", "source": "int main(void){ unsigned float x; return 0; }", "cl6x": []},
 {"name": "y14", "source": "int main(void){ long long long x; return 0; }", "cl6x": []},
 {"name": "y15", "source": "int main(void){ int x; x = sizeof int; return 0; }", "cl6x": []},
 {"name": "y16", "source": "enum E { A, B, A };", "cl6x": []},
 {"name": "y17", "source": "int main(void){ int x; x = 1 +; return 0; }", "cl6x": []},
 {"name": "y18", "source": "int main(void){ switch (1) { case: break; } return 0; }", "cl6x": []},
 {"name": "y19", "source": "int main(void){ int a[2]; a[1.0] = 1; return 0; }", "cl6x": []},
 {"name": "y20", "source": "int main(void){ int *p; p = malloc(4); return 0; }", "cl6x": []},
 {"name": "y21", "source": "int main(void){ float f; f = 1.0 / 3; printf(\"%f\", f) return 0; }", "cl6x": []},
 {"name": "y22", "source": "int main(void){ int x = 1;; return x }", "cl6x": []},
 {"name": "z1", "source": "int main(void){ int *p = 0; int x = -p; return x; }", "cl6x": []},
 {"name": "z2", "source": "struct S{int a;};\nint main(void){ struct S s; return !s; }", "cl6x": []},
 {"name": "z3", "source": "int main(void){ int *p = 0; return p == 1.0; }", "cl6x": []},
 {"name": "z4", "source": "struct S{int a;};\nint main(void){ struct S s; return (int)s; }", "cl6x": []},
 {"name": "z5", "source": "int main(void){ int *p = &3; return 0; }", "cl6x": []},
 {"name": "z6", "source": "int main(void){ return 3[4]; }", "cl6x": []},
 {"name": "z7", "source": "int main(void){ void *p = 0; p++; return 0; }", "cl6x": []},
 {"name": "z8", "source": "int main(void){ int *p = 0; float *q = 0; return p == q; }", "cl6x": []},
 {"name": "z9", "source": "int main(void){ int *p = 0; return p < 1; }", "cl6x": []},
 {"name": "z10", "source": "int main(void){ int x = 1; float *q = 0; x = 1 ? x : q; return 0; }", "cl6x": []},
 {"name": "z11", "source": "struct S{int a;};\nint main(void){ struct S s; if (s) return 1; return 0; }", "cl6x": []},
 {"name": "z12", "source": "struct S{int a;};\nint main(void){ struct S s; while (s) ; return 0; }", "cl6x": []},
 {"name": "z13", "source": "struct S{int a;};\nint main(void){ struct S s; switch (s) { } return 0; }", "cl6x": []},
 {"name": "z14", "source": "int main(void){ float f = 1; switch (f) { } return 0; }", "cl6x": []},
 {"name": "z15", "source": "int main(void){ int x; int y = sizeof(main); return y; }", "cl6x": []},
 {"name": "z16", "source": "int main(void){ double d = (double)(int *)0; return 0; }", "cl6x": []},
 {"name": "z17", "source": "int main(void){ int *p = (int *)1.5; return 0; }", "cl6x": []},
 {"name": "z18", "source": "int f(int x){ return x; }\nint main(void){ return f(); }", "cl6x": []},
 {"name": "z19", "source": "int main(void){ int a[3]; int *p = a; p = p * 2; return 0; }", "cl6x": []},
 {"name": "z20", "source": "int main(void){ int x; x = ~1.5; return 0; }", "cl6x": []},
 {"name": "z21", "source": "int main(void){ int *p = 0; p += 1.5; return 0; }", "cl6x": []},
 {"name": "z22", "source": "int main(void){ struct { int a; } s; s.a.b = 1; return 0; }", "cl6x": []},
 {"name": "z23", "source": "union U { int a; };\nint main(void){ union U u; u.c = 1; return 0; }", "cl6x": []},
 {"name": "z24", "source": "int main(void){ struct { int a; } s; s.c = 1; return 0; }", "cl6x": []},
 {"name": "z25", "source": "void f(void);\nint main(void){ int x = f() + 1; return x; }", "cl6x": []},
 {"name": "z26", "source": "int main(void){ char s[] = {1,2,3}; char t[2] = \"ab\"; return s[0] + t[0]; }", "cl6x": []},
 {"name": "z27", "source": "int main(void){ int x = 1; int *p = x; return 0; }", "cl6x": []},
 {"name": "z28", "source": "int main(void){ register int r = 1; int *p = &r; return *p; }", "cl6x": []},
 {"name": "z29", "source": "int x;\nfloat x;\nint main(void){ return 0; }", "cl6x": []},
 {"name": "z30", "source": "void g(int a[static 3]){}\nint main(void){ return 0; }", "cl6x": []},
 {"name": "z31", "source": "int main(void){ goto L; L2: ; return 0; }", "cl6x": []},
 {"name": "z32", "source": "int main(void){ int i; for (i = 0; ; ) break; return 0; }", "cl6x": []},
 {"name": "i1", "source": "int main(void){ f(); return 0; }\nvoid f(void){}", "cl6x": []},
 {"name": "i2", "source": "#include <stdio.h>\n#include <math.h>\nint main(void){ int i; for (i = 0; i < 4; i++) printf(\"%d %f\\n\", i, sin(i * M_PI / 2)); return 0; }", "cl6x": []},
 {"name": "i3", "source": "#include <c6x.h>\nint main(void){ unsigned t0, t1; TSCL = 0; t0 = TSCL; t1 = TSCL; return (int)(t1 - t0) + _dotp2(_pack2(1, 2), _pack2(3, 4)); }", "cl6x": []}
]
```

- [ ] **Step 2: Write the capture script and record cl6x's output**

```js path=scripts/capture-cl6x-diagnostics.mjs
// Records what TI's cl6x reports for each case in tests/fixtures/diag/cl6x-cases.json.
// Usage: node scripts/capture-cl6x-diagnostics.mjs [path-to-ti-cgt-c6000]
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FIXTURE = new URL('../tests/fixtures/diag/cl6x-cases.json', import.meta.url)

function findCgt() {
  if (process.argv[2]) return process.argv[2]
  const base = 'C:\\ti'
  for (const ccs of readdirSync(base).filter((d) => d.startsWith('ccs')).sort().reverse()) {
    const dir = join(base, ccs, 'ccs', 'tools', 'compiler')
    if (!existsSync(dir)) continue
    const cgt = readdirSync(dir).filter((d) => d.startsWith('ti-cgt-c6000')).sort().reverse()[0]
    if (cgt) return join(dir, cgt)
  }
  throw new Error('TI C6000 compiler not found; pass its directory as the first argument')
}

const LOCATED = /^"[^"]*", line (\d+): (fatal error|error|warning|remark) #(\S+): (.*)$/
const AT_END = /^At end of source: (fatal error|error|warning|remark) #(\S+): (.*)$/
const severity = (s) => (s === 'warning' || s === 'remark' ? 'warning' : 'error')

const cgt = findCgt()
const cases = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'labsim-diag-'))
for (const c of cases) {
  writeFileSync(join(tmp, 'case.c'), c.source)
  const args = [
    '-mv6740', `--include_path=${join(cgt, 'include')}`, '--define=c6748', '--diag_warning=225', '--diag_wrap=off',
    '--display_error_number', '--compile_only', `--output_file=${join(tmp, 'case.obj')}`, 'case.c'
  ]
  const r = spawnSync(join(cgt, 'bin', 'cl6x.exe'), args, { cwd: tmp, encoding: 'utf8' })
  c.cl6x = []
  for (const line of `${r.stderr}\n${r.stdout}`.split(/\r?\n/)) {
    let m = LOCATED.exec(line)
    if (m) c.cl6x.push({ line: Number(m[1]), severity: severity(m[2]), code: m[3], message: m[4] })
    else if ((m = AT_END.exec(line))) c.cl6x.push({ line: null, severity: severity(m[1]), code: m[2], message: m[3] })
  }
}
rmSync(tmp, { recursive: true, force: true })
writeFileSync(FIXTURE, JSON.stringify(cases, null, 1) + '\n')
console.log(`captured ${cases.length} cases with ${cgt}`)
```

Run: `node scripts/capture-cl6x-diagnostics.mjs`
Expected: `captured 179 cases with C:\ti\ccs1281\ccs\tools\compiler\ti-cgt-c6000_8.3.12`. The fixture now holds cl6x's diagnostics for every case. Spot-check that `e1` has `{"line": 1, "severity": "error", "code": "20", "message": "identifier \"b\" is undefined"}`.

- [ ] **Step 3: Write the failing tests**

```ts path=tests/unit/interp/cl6x-diagnostics.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { compileUnit } from '../../../src/interp/frontend/program'

interface Reported {
  line: number | null
  severity: 'error' | 'warning'
  code: string
  message: string
}
interface Case {
  name: string
  source: string
  cl6x: Reported[]
}

const CASES: Case[] = JSON.parse(readFileSync(path.join(__dirname, '../../fixtures/diag/cl6x-cases.json'), 'utf8'))

/** Warnings LabSim reproduces; cl6x's flow-analysis warnings (#112-D, #551-D, #994-D, #154-D) are not. */
const IMPLEMENTED_WARNINGS = new Set([
  '225-D', '179-D', '552-D', '1238-D', '48-D', '1696-D', '2097-D', '40-D', '118-D', '121-D', '145-D', '169-D', '515-D',
  '522-D', '177-D', '69-D', '70-D', '43-D', '1219-D', '139-D', '1181-D', '66-D'
])

/** Cases where only the first error is compared, and why. */
const FIRST_ERROR_ONLY: Record<string, string> = {
  p9: 'cl6x reports the errors caused by an unterminated macro call before the call itself'
}

const FILE = path.resolve('/labsim/case.c')
const key = (d: { line: number | null; code: string; message: string }): string => `${d.line ?? 'end'}:${d.code}: ${d.message}`

describe('front-end diagnostics match cl6x 8.3.12', () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.source.split('\n').join(' | ').slice(0, 70)}`, () => {
      const ours = compileUnit(FILE, { readFile: (f) => (f === FILE ? c.source : null), includePaths: [], defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'] }).diagnostics
      const expected = c.cl6x.filter((d) => d.severity === 'error').map(key)
      const got = ours.filter((d) => d.severity === 'error').map(key)
      if (expected.length > 1 || c.name in FIRST_ERROR_ONLY) {
        expect(got[0]).toBe(expected[0])
        return
      }
      expect(got).toEqual(expected)
      const warnings = (list: { severity: string; line: number | null; code: string; message: string }[]): string[] =>
        list.filter((d) => d.severity === 'warning' && IMPLEMENTED_WARNINGS.has(d.code)).map(key).sort()
      expect(warnings(ours)).toEqual(warnings(c.cl6x))
    })
  }
})
```

```ts path=tests/unit/interp/program.test.ts
import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { compileUnit, library, linkProgram, type CompileOptions } from '../../../src/interp/frontend/program'

const P = (f: string): string => path.resolve('/proj', f)

function opts(files: Record<string, string>): CompileOptions {
  const full = Object.fromEntries(Object.entries(files).map(([k, v]) => [P(k), v]))
  return { readFile: (f) => full[f] ?? null, includePaths: [P('.')], defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'] }
}

function build(files: Record<string, string>, sources: string[]) {
  const o = opts(files)
  const results = sources.map((s) => compileUnit(P(s), o))
  for (const r of results) expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return linkProgram(results.map((r) => r.unit!))
}

describe('compileUnit', () => {
  it('returns the unit, its diagnostics and the files it read', () => {
    const r = compileUnit(P('main.c'), opts({ 'main.c': '#include "coef.h"\nint main(void){ return N; }', 'coef.h': '#define N 3' }))
    expect(r.unit?.functions.map((f) => f.sym.name)).toEqual(['main'])
    expect(r.files).toEqual([P('main.c'), P('coef.h')])
    expect(r.diagnostics).toEqual([])
  })
  it('returns no unit after an error or a fatal error', () => {
    expect(compileUnit(P('main.c'), opts({ 'main.c': 'int main(void){ return x; }' })).unit).toBeNull()
    const fatal = compileUnit(P('main.c'), opts({ 'main.c': '#include <math.io>\nint main(void){ return 0; }' }))
    expect(fatal.unit).toBeNull()
    expect(fatal.diagnostics[0]).toMatchObject({ code: '1965', fatal: true })
  })
})

describe('linkProgram', () => {
  it('resolves globals and functions across translation units', () => {
    const files = {
      'main.c': '#include "fir.h"\nextern float coeffs[3];\nint main(void){ float y = fir(1.0f); return (int)(y + coeffs[0]); }',
      'fir.h': 'float fir(float x);',
      'fir.c': 'float coeffs[3] = { 1, 2, 3 };\nstatic float state;\nfloat fir(float x){ state = x * coeffs[1]; return state; }'
    }
    const link = build(files, ['main.c', 'fir.c'])
    expect(link.problems).toEqual([])
    expect(link.program?.globals.get('coeffs')?.file).toBe(P('fir.c'))
    expect([...(link.program?.functions.keys() ?? [])].sort()).toEqual(['fir', 'main'])
    expect(link.program?.main.sym.name).toBe('main')
  })
  it('accepts library functions, intrinsics and tentative definitions in several files', () => {
    const files = {
      'main.c': '#include <stdio.h>\n#include <math.h>\nint n;\nint main(void){ printf("%f\\n", sin(1.0)); return _dotp2(n, 1); }',
      'b.c': 'int n;'
    }
    expect(build(files, ['main.c', 'b.c']).problems).toEqual([])
  })
  it('reports unresolved symbols, a missing main and duplicate definitions', () => {
    expect(build({ 'main.c': 'int helper(int);\nint main(void){ return helper(1); }' }, ['main.c']).problems).toEqual([
      { kind: 'unresolved', name: 'helper', file: P('main.c') }
    ])
    expect(build({ 'lib.c': 'int twice(int x){ return 2 * x; }' }, ['lib.c']).problems).toEqual([
      { kind: 'unresolved', name: 'main', file: 'rts6740_elf.lib<args_main.c.obj>' }
    ])
    expect(build({ 'a.c': 'int x = 1;\nint main(void){ return x; }', 'b.c': 'int x = 2;' }, ['a.c', 'b.c']).problems).toEqual([
      { kind: 'redefined', name: 'x', first: P('a.c'), second: P('b.c') }
    ])
  })
})

describe('library', () => {
  it('lists what the LabSim runtime provides, from its built-in headers', () => {
    const lib = library()
    for (const f of ['printf', 'puts', 'sin', 'sinf', 'sqrt', 'atan2', 'malloc', 'free', 'rand', 'memcpy', 'strlen', 'clock', '_dotp2', '_extu', '_nassert']) {
      expect(lib.functions.has(f), f).toBe(true)
    }
    for (const o of ['_ftable', 'errno', 'CSR', 'TSCL', 'TSCH']) expect(lib.objects.has(o), o).toBe(true)
  })
})
```

- [ ] **Step 4: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/program.test.ts tests/unit/interp/cl6x-diagnostics.test.ts`
Expected: FAIL, because the module `program` does not exist.

- [ ] **Step 5: Implement compile and link**

```ts path=src/interp/frontend/program.ts
import type { FunctionDef, TranslationUnit, VarSym } from './ast'
import { Diags, FatalError, type FrontDiagnostic } from './diag'
import { BUILTIN_HEADERS, PRELUDE } from './headers'
import { parseUnit } from './parser'
import { isBuiltinFile, preprocess, type PreprocessOptions } from './preprocessor'

export interface CompileOptions extends PreprocessOptions {
  /** --diag_warning numbers (CCS passes 225). */
  diagWarnings: string[]
}

export interface UnitResult {
  file: string
  /** null when the file has errors. */
  unit: TranslationUnit | null
  diagnostics: FrontDiagnostic[]
  /** Project files read, main file first. */
  files: string[]
}

export function compileUnit(file: string, opts: CompileOptions): UnitResult {
  const diags = new Diags(opts.diagWarnings)
  let files = [file]
  try {
    const pp = preprocess(file, opts, diags)
    files = pp.files
    const unit = parseUnit(pp.tokens, { file, dialect: opts.dialect, pragmas: pp.pragmas }, diags)
    return { file, unit: diags.errors > 0 ? null : unit, diagnostics: diags.list, files }
  } catch (e) {
    if (e instanceof FatalError) return { file, unit: null, diagnostics: diags.list, files }
    throw e
  }
}

export interface Program {
  units: TranslationUnit[]
  /** Definitions of objects with external linkage, by name. */
  globals: Map<string, VarSym>
  /** Definitions of functions with external linkage, by name. */
  functions: Map<string, FunctionDef>
  main: FunctionDef
}

export type LinkProblem =
  | { kind: 'unresolved'; name: string; file: string }
  | { kind: 'redefined'; name: string; first: string; second: string }

export interface LinkResult {
  program: Program | null
  problems: LinkProblem[]
}

/** Where cl6x's linker says `main` is first referenced when it is missing. */
const MAIN_REFERENCE = 'rts6740_elf.lib<args_main.c.obj>'

export function linkProgram(units: TranslationUnit[]): LinkResult {
  const lib = library()
  const globals = new Map<string, VarSym>()
  const functions = new Map<string, FunctionDef>()
  const problems: LinkProblem[] = []
  for (const u of units) {
    for (const v of u.objects) {
      if (!v.external || !v.defined || isBuiltinFile(v.loc.file)) continue
      const prev = globals.get(v.name)
      if (!prev) globals.set(v.name, v)
      else if (prev.init && v.init) problems.push({ kind: 'redefined', name: v.name, first: prev.file, second: v.file })
      else if (v.init) globals.set(v.name, v)
    }
    for (const f of u.functions) {
      if (!f.sym.external) continue
      const prev = functions.get(f.sym.name)
      if (prev) problems.push({ kind: 'redefined', name: f.sym.name, first: prev.sym.file, second: f.sym.file })
      else functions.set(f.sym.name, f)
    }
  }
  const unresolved = new Map<string, string>()
  for (const u of units) {
    for (const v of u.objects) {
      if (v.defined || v.refs + v.sets === 0 || isBuiltinFile(v.loc.file) || globals.has(v.name) || lib.objects.has(v.name)) continue
      if (!unresolved.has(v.name)) unresolved.set(v.name, u.file)
    }
    for (const f of u.funcs) {
      if (!f.used || f.def || f.library || (f.external && functions.has(f.name)) || lib.functions.has(f.name)) continue
      if (!unresolved.has(f.name)) unresolved.set(f.name, u.file)
    }
  }
  const main = functions.get('main')
  if (!main && !unresolved.has('main')) unresolved.set('main', MAIN_REFERENCE)
  for (const [name, file] of unresolved) problems.push({ kind: 'unresolved', name, file })
  return { program: problems.length === 0 && main ? { units, globals, functions, main } : null, problems }
}

let libraryCache: { functions: Set<string>; objects: Set<string> } | null = null

/** What the LabSim runtime provides: every function and object its built-in headers declare. */
export function library(): { functions: Set<string>; objects: Set<string> } {
  if (libraryCache) return libraryCache
  const headers = Object.keys(BUILTIN_HEADERS).filter((h) => h !== PRELUDE && !BUILTIN_HEADERS[h].includes('#error'))
  const file = '<builtin>/__labsim_library.c'
  const source = headers.map((h) => `#include <${h}>`).join('\n')
  const r = compileUnit(file, { readFile: (f) => (f === file ? source : null), includePaths: [], defines: [], dialect: 'c99', diagWarnings: [] })
  if (!r.unit) throw new Error(`LabSim's built-in headers do not compile: ${r.diagnostics[0]?.message}`)
  libraryCache = { functions: new Set(r.unit.funcs.map((f) => f.name)), objects: new Set(r.unit.objects.map((o) => o.name)) }
  return libraryCache
}
```

- [ ] **Step 6: Run the tests and make the front-end agree with cl6x**

Run: `npx vitest run tests/unit/interp/program.test.ts tests/unit/interp/cl6x-diagnostics.test.ts`
Expected: `program.test.ts` passes. For each failing `cl6x-diagnostics` case, compare `got` with cl6x's output and fix the front-end rather than the fixture:
- the message text in `M`;
- the location (which token);
- the recovery (which tokens are skipped);
- a discretionary `-D` rule in `Sema.compat`.

Add a case to `FIRST_ERROR_ONLY` only when cl6x's own ordering cannot sensibly be reproduced, and write the reason next to it. Re-run until all 179 cases pass.

- [ ] **Step 7: Commit**

```bash
git add src/interp/frontend/program.ts scripts/capture-cl6x-diagnostics.mjs tests/fixtures/diag tests/unit/interp
git commit -m "feat(interp): compileUnit/linkProgram and a 179-case cl6x diagnostic reference"
```

---
### Task 8: Corpus parse test

**Files:**
- Test: `tests/unit/interp/corpus.test.ts`

**Interfaces:**
- Consumes: `compileUnit`, `linkProgram`, `CompileOptions` (Task 7), and `findSources` from `src/main/build/builder.ts`.

- [ ] **Step 1: Write the corpus test**

It reads every project in `~/workspace_v12` and every `.c` file in `~/dsp_ccs_lab`, and skips when those folders are absent. The three multi-variant lab files are compiled once per variant: each `#define EXPERIMENT`/`FILTER` value is substituted in memory, never on disk. In the expectations, `fft_m` and `idft_8_m` fail the same way in real CCS, as checked with cl6x on 2026-09-23.

```ts path=tests/unit/interp/corpus.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { findSources } from '../../../src/main/build/builder'
import { compileUnit, linkProgram, type CompileOptions } from '../../../src/interp/frontend/program'

const WS = join(homedir(), 'workspace_v12')
const LAB = join(homedir(), 'dsp_ccs_lab')

const projects = existsSync(WS)
  ? readdirSync(WS)
      .map((n) => join(WS, n))
      .filter((d) => statSync(d).isDirectory() && !basename(d).startsWith('.') && basename(d) !== 'RemoteSystemsTempFiles')
  : []
const labFiles = existsSync(LAB) ? readdirSync(LAB).filter((f) => f.endsWith('.c')).map((f) => join(LAB, f)) : []

/** Errors cl6x itself reports for these projects: `line:code`. */
const KNOWN: Record<string, string[]> = {
  fft_m: ['2:1965'],
  idft_8_m: ['33:29', '34:29']
}

/** Lab files whose experiment is chosen with a #define, and every value it takes. */
const VARIANTS: [string, string, number[]][] = [
  ['dsp_lab_ccs_exp09_15.c', 'EXPERIMENT', [9, 10, 11, 12, 13, 14, 15]],
  ['dsp_lab_exp5_filters.c', 'FILTER', [1, 2, 3, 4, 5, 6]],
  ['dsp_lab_exp5_fir_iir.c', 'FILTER', [1, 2]]
]

function options(dir: string, rewrite?: (text: string) => string): CompileOptions {
  return {
    readFile: (f) => {
      try {
        const text = readFileSync(f, 'utf8')
        return rewrite ? rewrite(text) : text
      } catch {
        return null
      }
    },
    includePaths: [dir],
    defines: ['c6748'],
    dialect: 'c89',
    diagWarnings: ['225']
  }
}

function check(sources: string[], opts: CompileOptions, known: string[] = []): void {
  const results = sources.map((s) => compileUnit(s, opts))
  const errors = results.flatMap((r) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line ?? 'end'}:${d.code}`))
  expect(errors).toEqual(known)
  if (errors.length === 0) expect(linkProgram(results.map((r) => r.unit!)).problems).toEqual([])
}

describe.skipIf(projects.length === 0)('~/workspace_v12 corpus', () => {
  for (const dir of projects) {
    it(basename(dir), async () => {
      const sources = await findSources(dir)
      if (sources.length > 0) check(sources, options(dir), KNOWN[basename(dir)])
    })
  }
})

describe.skipIf(labFiles.length === 0)('~/dsp_ccs_lab corpus', () => {
  for (const file of labFiles) it(basename(file), () => check([file], options(dirname(file))))
  for (const [name, macro, values] of VARIANTS) {
    for (const value of values) {
      it(`${name} with ${macro} ${value}`, () => {
        const file = join(LAB, name)
        const rewrite = (text: string): string => text.replace(new RegExp(`^#define\\s+${macro}\\s+\\d+`, 'm'), `#define ${macro} ${value}`)
        check([file], options(LAB, rewrite))
      })
    }
  }
})
```

- [ ] **Step 2: Run the corpus test**

Run: `npx vitest run tests/unit/interp/corpus.test.ts`
Expected: every project and variant passes. A failure means the front-end rejects something cl6x accepts, or misses an error cl6x reports. Fix the front-end, and add a focused regression case to `parser.test.ts` for each fix. Never edit the corpus files.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/interp/corpus.test.ts src/interp tests/unit/interp
git commit -m "test(interp): every workspace_v12 and dsp_ccs_lab program parses like cl6x"
```

---
### Task 9: Fallback build, C dialect and the front-end check

**Files:**
- Modify: `src/main/build/projectConfig.ts` (new `dialect` field), `src/main/build/commands.ts` (`--c99`)
- Create: `src/main/build/sources.ts` and `src/main/build/buildResult.ts`, which take `findSources`, `OUT_SUBDIR` and `fail` out of `builder.ts`
- Create: `src/main/build/linkerCmd.ts`, `src/main/build/fallbackImage.ts`, `src/main/build/fallback.ts`
- Replace: `src/main/build/builder.ts`
- Modify: `src/renderer/src/store.ts:100` (the missing-compiler message)
- Modify: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md` (dialect and fallback notes)
- Test:
  - update `tests/unit/build/projectConfig.test.ts`, `tests/unit/build/commands.test.ts`, `tests/unit/build/builder.test.ts` and `tests/e2e/build.spec.ts`
  - create `tests/unit/build/linkerCmd.test.ts` and `tests/unit/build/fallbackImage.test.ts`

**Interfaces:**
- Consumes (Task 7): `compileUnit`, `linkProgram`, `Program`, `LinkProblem`, `CompileOptions`; also `FrontDiagnostic`, `isBuiltinFile`, and `alignOf`, `alignUp`, `isAggregate`, `sizeOf` from types. From Step 2 it uses `parseDiagnostics` and `readBuildConfig`.
- Produces:
  - `BuildConfig.dialect: 'c89' | 'c99'`
  - `parseLinkerCommandFile(text): LinkerCommandFile {memory, sections}`
  - `layoutProgram(program, cmd, {heapSize, stackSize, outFile}): Layout` and `sectionOf(v)`
  - `runFallbackBuild({projectDir, outDir, name, emit}): Promise<BuildResult>`
  - `frontendCheck(sources, cfg, cgtRoot, outDir, emit)`
  - `renderDiagnostic(d, outDir)`, `userIncludePaths(cfg, cgtRoot)`, `FALLBACK_CGT`
  - `failBuild(emit, message)`, `type Emit`
  - `findSources`, `OUT_SUBDIR` and `objectName(projectDir, source)`, all re-exported from `builder.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/build/projectConfig.test.ts`:
- In the first test's expected object, add `dialect: 'c89',` after `linkerCommandFile: 'C6748.cmd'` (keep the comma rules valid).
- Add this test inside `describe('parseCproject')`:

```ts
  it('reads the C dialect option', () => {
    const xml = `<configuration name="Debug"><option superClass="com.ti.ccstudio.buildDefinitions.C6000_8.3.compilerID.C_DIALECT" value="com.ti.ccstudio.buildDefinitions.C6000_8.3.compilerID.C_DIALECT.C99" valueType="enumerated"/></configuration>`
    expect(parseCproject(xml, 'p', DIR, CGT).dialect).toBe('c99')
    expect(defaultConfig('p', DIR, CGT).dialect).toBe('c89')
  })
```

Add to `tests/unit/build/commands.test.ts`, inside `describe('compileArgs')`:

```ts
  it('passes --c99 when the project uses C99', () => {
    const line = renderCommand(CL6X, compileArgs({ ...cfg, dialect: 'c99' }, { rel: '../../main.c', objDir: null, depFile: 'main.d_raw' }))
    expect(line).toContain('--define=c6748 -g --c99 --diag_warning=225')
  })
```

```ts path=tests/unit/build/linkerCmd.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseLinkerCommandFile } from '../../../src/main/build/linkerCmd'

describe('parseLinkerCommandFile', () => {
  it('reads the MEMORY and SECTIONS of the CCS C6748.cmd template', () => {
    const cmd = parseLinkerCommandFile(readFileSync(join(__dirname, '../../fixtures/ccs/C6748.cmd'), 'utf8'))
    expect(cmd.memory).toHaveLength(15)
    expect(cmd.memory[0]).toEqual({ name: 'DSPL2ROM', origin: 0x00700000, length: 0x00100000, attr: 'RWIX' })
    expect(cmd.memory.find((m) => m.name === 'SHRAM')).toEqual({ name: 'SHRAM', origin: 0x80000000, length: 0x00020000, attr: 'RWIX' })
    expect(cmd.sections.slice(0, 4)).toEqual([
      { name: '.text', region: 'SHRAM' }, { name: '.stack', region: 'SHRAM' }, { name: '.bss', region: 'SHRAM' }, { name: '.cio', region: 'SHRAM' }
    ])
    expect(cmd.sections.find((s) => s.name === '.fardata')?.region).toBe('SHRAM')
  })
  it('accepts the other common spellings', () => {
    const text = `/* test */ MEMORY { L2 (RWX) : origin = 0x11800000, length = 256K  // L2
      DDR : org = 0xC0000000 len = 0x10000000 }
      SECTIONS { .text : > L2   .cinit : load > DDR   .far > DDR }`
    const cmd = parseLinkerCommandFile(text)
    expect(cmd.memory).toEqual([
      { name: 'L2', origin: 0x11800000, length: 256 * 1024, attr: 'RWX' },
      { name: 'DDR', origin: 0xc0000000, length: 0x10000000, attr: 'RWIX' }
    ])
    expect(cmd.sections).toEqual([{ name: '.text', region: 'L2' }, { name: '.cinit', region: 'DDR' }, { name: '.far', region: 'DDR' }])
  })
})
```

```ts path=tests/unit/build/fallbackImage.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import * as path from 'path'
import { compileUnit, linkProgram, type Program } from '../../../src/interp/frontend/program'
import { layoutProgram, TEXT_ESTIMATE } from '../../../src/main/build/fallbackImage'
import { parseLinkerCommandFile } from '../../../src/main/build/linkerCmd'

const CMD = parseLinkerCommandFile(readFileSync(path.join(__dirname, '../../fixtures/ccs/C6748.cmd'), 'utf8'))
const FILE = path.resolve('/proj/main.c')

function program(src: string): Program {
  const r = compileUnit(FILE, { readFile: (f) => (f === FILE ? src : null), includePaths: [], defines: ['c6748'], dialect: 'c89', diagWarnings: [] })
  const link = linkProgram([r.unit!])
  expect(link.problems).toEqual([])
  return link.program!
}

const SRC = [
  'float x[64];',
  'float h[3] = { 1, 2, 1 };',
  'static int counter;',
  'static const short table[4] = { 1, 2, 3, 4 };',
  'int n = 5;',
  'int main(void) { static float ls[8]; ls[0] = x[0] + h[1] + table[2] + counter + n; return (int)ls[0]; }'
].join('\n')

describe('layoutProgram', () => {
  it('places objects in the sections cl6x uses, in SECTIONS order inside SHRAM', () => {
    const { image, error } = layoutProgram(program(SRC), CMD, { heapSize: 0x800, stackSize: 0x800, outFile: 'p.out' })
    expect(error).toBeNull()
    expect(image!.sections.map((s) => s.name)).toEqual(['.text', '.stack', '.bss', '.cio', '.const', '.sysmem', '.far', '.neardata', '.fardata'])
    expect(image!.sections[0]).toEqual({ name: '.text', addr: 0x80000000, size: TEXT_ESTIMATE, nobits: false })
    expect(image!.stack).toEqual({ start: 0x80000000 + TEXT_ESTIMATE, size: 0x800 })
    expect(image!.heap.size).toBe(0x800)
    expect(image!.globals.x).toMatchObject({ section: '.far', size: 256 })
    expect(image!.globals.h).toMatchObject({ section: '.fardata', size: 12 })
    expect(image!.globals.n).toMatchObject({ section: '.neardata', size: 4 })
    expect(image!.statics[FILE].counter).toMatchObject({ section: '.bss', size: 4 })
    expect(image!.statics[FILE].table).toMatchObject({ section: '.const', size: 8 })
    expect(image!.statics[FILE]['ls$1']).toMatchObject({ section: '.far', size: 32 })
    expect(image!.entry).toBe(0x80000000)
    expect(image!.globals._c_int00.addr).toBe(0x80000000)
    const sorted = [...image!.sections].sort((a, b) => a.addr - b.addr)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].addr).toBeGreaterThanOrEqual(sorted[i - 1].addr + sorted[i - 1].size)
    const last = sorted[sorted.length - 1]
    expect(last.addr + last.size).toBeLessThanOrEqual(0x80020000)
  })
  it('fails like the TI linker when the data does not fit', () => {
    const { image, error } = layoutProgram(program('float big[40000];\nint main(void) { big[1] = 2; return 0; }'), CMD, { heapSize: 0x800, stackSize: 0x800, outFile: 'p.out' })
    expect(image).toBeNull()
    expect(error).toMatch(/^error #10099-D: program will not fit into available memory\. .*placement fails for section "\.far" size 0x27100/)
  })
})
```

In `tests/unit/build/builder.test.ts`, replace the whole `describe('runBuild without a compiler', …)` block with:

```ts
describe('runBuild without a compiler (LabSim fallback)', () => {
  it('builds with the LabSim front-end and lays the program out in SHRAM', async () => {
    const dir = project('p', GOOD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
    const out = text()
    expect(out).toContain('this build uses the LabSim C front-end')
    expect(out).toContain('Invoking: LabSim C Front-End')
    expect(out).toContain('Finished building target: "p.out"')
    expect(out).toContain('**** Build Finished ****')
    expect(r.image?.globals.y).toMatchObject({ section: '.far', size: 32 })
    expect(r.image?.globals.y.addr).toBeGreaterThanOrEqual(0x80000000)
    expect(r.image?.statics[join(dir, 'main.c')].n).toMatchObject({ section: '.bss', size: 4 })
  })
  it('reports compile errors in cl6x form', async () => {
    const dir = project('bad', BAD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toEqual([
      { file: join(dir, 'main.c'), line: 5, severity: 'error', code: '20', message: 'identifier "z" is undefined' },
      { file: join(dir, 'main.c'), line: 4, severity: 'warning', code: '179-D', message: 'variable "unused" was declared but never referenced' }
    ])
    const out = text()
    expect(out).toContain('"../../main.c", line 5: error #20: identifier "z" is undefined')
    expect(out).toContain('1 error detected in the compilation of "../../main.c".')
    expect(out).toContain('Build stopped: 1 file failed to compile; "bad.out" not built.')
  })
  it('reports unresolved functions like the TI linker', async () => {
    const r = await runBuild({ projectDir: project('undef', 'int helper(int);\nint main(void)\n{\n    return helper(2);\n}\n'), kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics.map((d) => d.code)).toEqual(['10234-D', '10234-D', '10010'])
    expect(r.diagnostics[0].message).toBe('unresolved symbol helper, first referenced in ./main.obj')
    expect(text()).toContain('error #10010: errors encountered during linking; "undef.out" not built')
  })
})
```

In the same file, inside `describe.skipIf(!tc)('runBuild with cl6x', …)`:
- In the first test, after `const out = text()`, add `expect(out).not.toContain("LabSim's own front-end cannot run it")`.
- Add this test:

```ts
  it("warns when LabSim's front-end cannot read a program that cl6x builds", async () => {
    const src = 'struct flags { unsigned a : 3; } f;\nint main(void)\n{\n    f.a = 1;\n    return f.a;\n}\n'
    const r = await runBuild({ projectDir: project('bits', src), kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(true)
    expect(text()).toContain("LabSim: cl6x built this program, but LabSim's own front-end cannot run it yet")
    expect(text()).toContain('unsupported construct bit-field')
  })
```

In `tests/e2e/build.spec.ts`, replace `test('explains a missing compiler', …)` with:

```ts
test('builds with the LabSim front-end when cl6x is missing', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'labsim-nocgt-'))
  await launch({ LABSIM_COMPILER_ROOT: empty })
  await expect(page.locator('.console .cl-error')).toContainText('C6000 compiler (cl6x) not found')
  await row('alpha_good').click()
  await page.getByTitle('Build Project (Ctrl+B)').click()
  const consoleBox = page.locator('.console')
  await expect(consoleBox).toContainText('**** Build Finished ****')
  await expect(consoleBox).toContainText('Invoking: LabSim C Front-End')
  await expect(consoleBox).toContainText('Finished building target: "alpha_good.out"')
  await page.getByRole('button', { name: 'Problems' }).click()
  await expect(page.locator('.table-caption')).toHaveText('0 errors, 0 warnings, 0 others')
  await row('beta_bad').click()
  await page.getByTitle('Build Project (Ctrl+B)').click()
  await expect(page.getByLabel('Console')).toHaveValue('CDT Build Console [beta_bad]')
  await expect(consoleBox).toContainText('**** Build Finished ****')
  await page.getByRole('button', { name: 'Problems' }).click()
  await expect(page.locator('.table-caption')).toHaveText('1 error, 1 warning, 0 others')
  await expect(page.locator('.problems-row[data-severity="error"]')).toContainText('#20 identifier "z" is undefined')
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/build`
Expected: FAIL. The new modules are missing, `dialect` is undefined, and runBuild without a compiler still fails.

- [ ] **Step 3: Add the dialect to the build configuration**

In `src/main/build/projectConfig.ts`:
- Add to `BuildConfig` after `linkerCommandFile`:

```ts
  /** C89 (cl6x's default, relaxed) or C99 (--c99), from the project's C_DIALECT option. */
  dialect: 'c89' | 'c99'
```

- Add `dialect: 'c89'` to the object `defaultConfig` returns, after `linkerCommandFile: null` (add the comma).
- In `parseCproject`, before `return cfg`, add:

```ts
  const dialect = value('C_DIALECT')?.split('.').pop()?.toUpperCase()
  cfg.dialect = dialect === 'C99' || dialect === 'C11' ? 'c99' : 'c89'
```

In `src/main/build/commands.ts`, replace `diagFlags` with:

```ts
function diagFlags(cfg: BuildConfig): string[] {
  return [
    '-g',
    ...(cfg.dialect === 'c99' ? ['--c99'] : []),
    ...cfg.diagWarnings.map((w) => `--diag_warning=${w}`),
    '--diag_wrap=off',
    '--display_error_number'
  ]
}
```

- [ ] **Step 4: Move shared helpers out of the builder**

```ts path=src/main/build/sources.ts
import { promises as fs } from 'fs'
import * as path from 'path'

export const OUT_SUBDIR = path.join('.labsim', 'Debug')
const SKIP_DIRS = new Set(['debug', 'release'])

export async function findSources(projectDir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory() && !(dir === projectDir && SKIP_DIRS.has(e.name.toLowerCase()))) await walk(p)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.c')) out.push(p)
    }
  }
  await walk(projectDir)
  // Files in the project root first, then subfolders, each alphabetical.
  return out.sort((a, b) => {
    const da = path.dirname(a) === projectDir ? 0 : 1
    const db = path.dirname(b) === projectDir ? 0 : 1
    return da - db || a.localeCompare(b)
  })
}

/** The object file name the linker reports for a source: "./main.obj", "./src/fir.obj". */
export function objectName(projectDir: string, source: string): string {
  return './' + path.relative(projectDir, source).replace(/\\/g, '/').replace(/\.c$/i, '.obj')
}
```

```ts path=src/main/build/buildResult.ts
import type { BuildResult } from '@shared/build'

export type Emit = (text: string, kind: 'out' | 'info' | 'error') => void

/** Ends a build with a LabSim message (also listed as a Problem), CCS-style. */
export function failBuild(emit: Emit, message: string): BuildResult {
  emit(message, 'error')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: false, diagnostics: [{ file: null, line: null, severity: 'error', code: 'LABSIM', message }], image: null }
}
```

- [ ] **Step 5: Implement the linker command file reader**

```ts path=src/main/build/linkerCmd.ts
import type { MemoryRegion } from '@shared/program'

export interface LinkerCommandFile {
  memory: MemoryRegion[]
  /** Output sections and the MEMORY region each is placed in, in file order. */
  sections: { name: string; region: string }[]
}

function block(src: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*\\{`).exec(src)
  if (!m) return ''
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(m.index + m[0].length, i)
  }
  return src.slice(m.index + m[0].length)
}

function num(s: string): number {
  if (/^0x/i.test(s)) return parseInt(s, 16)
  if (/k$/i.test(s)) return parseInt(s, 10) * 1024
  if (/h$/i.test(s)) return parseInt(s.slice(0, -1), 16)
  return Number(s)
}

/** Reads MEMORY and SECTIONS from a TI linker command file (the forms CCS templates use). */
export function parseLinkerCommandFile(text: string): LinkerCommandFile {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
  const memory: MemoryRegion[] = []
  const region = /(\w+)\s*(?:\(\s*(\w+)\s*\))?\s*:?\s*(?:org|origin|o)\s*=\s*(\w+)\s*,?\s*(?:len|length|l)\s*=\s*(\w+)/gi
  for (const m of block(src, 'MEMORY').matchAll(region)) {
    memory.push({ name: m[1], origin: num(m[3]), length: num(m[4]), attr: (m[2] ?? 'RWIX').toUpperCase() })
  }
  const sections: { name: string; region: string }[] = []
  const placement = /([.\w$]+)\s*(?::\s*)?(?:(?:load|run)\s*=?\s*)?>\s*(\w+)/g
  for (const m of block(src, 'SECTIONS').matchAll(placement)) sections.push({ name: m[1], region: m[2] })
  return { memory, sections }
}
```

- [ ] **Step 6: Implement the synthetic layout**

```ts path=src/main/build/fallbackImage.ts
import type { ProgramImage, SectionInfo, SymbolInfo } from '@shared/program'
import type { VarSym } from '../../interp/frontend/ast'
import { isBuiltinFile } from '../../interp/frontend/preprocessor'
import type { Program } from '../../interp/frontend/program'
import { alignOf, alignUp, isAggregate, sizeOf, type Type } from '../../interp/frontend/types'
import type { LinkerCommandFile } from './linkerCmd'

/** Code size assumed for .text: LabSim generates no code; this is about the size of a program that uses printf. */
export const TEXT_ESTIMATE = 0x7000
const CIO_SIZE = 0x120
const NOBITS = new Set(['.stack', '.sysmem', '.bss', '.far', '.cio'])

export type Layout = { image: ProgramImage; error: null } | { image: null; error: string }

const isConstObject = (t: Type): boolean => (t.kind === 'array' ? isConstObject(t.of) : !!t.const && !t.volatile)

/** The section cl6x (EABI, far aggregates) puts an object in. */
export function sectionOf(v: VarSym): string {
  if (isConstObject(v.type)) return '.const'
  if (isAggregate(v.type)) return v.init ? '.fardata' : '.far'
  return v.init ? '.neardata' : '.bss'
}

/** Lays the program's data out the way the TI linker would, in the regions the .cmd file names. */
export function layoutProgram(program: Program, cmd: LinkerCommandFile, opts: { heapSize: number; stackSize: number; outFile: string }): Layout {
  const sizes = new Map<string, number>([['.text', TEXT_ESTIMATE], ['.stack', opts.stackSize], ['.sysmem', opts.heapSize], ['.cio', CIO_SIZE]])
  const placed: { sym: VarSym; section: string; offset: number }[] = []
  for (const u of program.units) {
    for (const v of u.objects) {
      if (!v.defined || v.storage === 'extern' || isBuiltinFile(v.loc.file)) continue
      if (v.external && program.globals.get(v.name) !== v) continue
      const section = sectionOf(v)
      const align = Math.max(alignOf(v.type), isAggregate(v.type) && sizeOf(v.type) >= 8 ? 8 : 1)
      const offset = alignUp(sizes.get(section) ?? 0, align)
      sizes.set(section, offset + sizeOf(v.type))
      placed.push({ sym: v, section, offset })
    }
  }

  const defaultRegion = cmd.sections[0]?.region ?? cmd.memory[0]?.name
  const order = [...cmd.sections.map((s) => s.name), ...[...sizes.keys()].filter((n) => !cmd.sections.some((s) => s.name === n))]
  const cursor = new Map(cmd.memory.map((m) => [m.name, m.origin]))
  const sections: SectionInfo[] = []
  for (const name of order) {
    const size = sizes.get(name)
    if (!size || sections.some((s) => s.name === name)) continue
    const regionName = cmd.sections.find((s) => s.name === name)?.region ?? defaultRegion
    const region = cmd.memory.find((m) => m.name === regionName)
    if (!region) return { image: null, error: `error #10099-D: program will not fit into available memory.  no memory region for section "${name}"` }
    const addr = alignUp(cursor.get(region.name) as number, 8)
    const end = region.origin + region.length
    if (addr + size > end) {
      const free = Math.max(0, end - addr).toString(16)
      return {
        image: null,
        error: `error #10099-D: program will not fit into available memory.  placement fails for section "${name}" size 0x${size.toString(16)} page 0.  Available memory ranges:  ${region.name} size: 0x${region.length.toString(16)} unused: 0x${free} max hole: 0x${free}`
      }
    }
    cursor.set(region.name, addr + size)
    sections.push({ name, addr, size, nobits: NOBITS.has(name) })
  }

  const base = (name: string): number => sections.find((s) => s.name === name)?.addr ?? 0
  const globals: Record<string, SymbolInfo> = {}
  const statics: Record<string, Record<string, SymbolInfo>> = {}
  for (const u of program.units) statics[u.file] = {}
  for (const p of placed) {
    const info: SymbolInfo = { name: p.sym.linkName, addr: base(p.section) + p.offset, size: sizeOf(p.sym.type), section: p.section, kind: 'object' }
    if (p.sym.external) globals[p.sym.name] = info
    else statics[p.sym.file][p.sym.linkName] = info
  }
  const text = base('.text')
  globals._c_int00 = { name: '_c_int00', addr: text, size: 0, section: '.text', kind: 'func' }
  let fnAddr = text + 0x100
  for (const name of [...program.functions.keys()].sort()) {
    globals[name] = { name, addr: fnAddr, size: 0, section: '.text', kind: 'func' }
    fnAddr += 0x100
  }
  globals['C$$EXIT'] = { name: 'C$$EXIT', addr: text + TEXT_ESTIMATE - 0x20, size: 0, section: '.text', kind: 'func' }
  const range = (name: string): { start: number; size: number } => {
    const s = sections.find((x) => x.name === name)
    return s ? { start: s.addr, size: s.size } : { start: 0, size: 0 }
  }
  return {
    image: { outFile: opts.outFile, entry: text, memory: cmd.memory, sections, globals, statics, stack: range('.stack'), heap: range('.sysmem') },
    error: null
  }
}
```

- [ ] **Step 7: Implement the fallback build and the front-end check**

```ts path=src/main/build/fallback.ts
import { promises as fs, readFileSync } from 'fs'
import * as path from 'path'
import type { BuildResult, Diagnostic } from '@shared/build'
import type { TranslationUnit } from '../../interp/frontend/ast'
import type { FrontDiagnostic } from '../../interp/frontend/diag'
import { isBuiltinFile } from '../../interp/frontend/preprocessor'
import { compileUnit, linkProgram, type CompileOptions, type LinkProblem } from '../../interp/frontend/program'
import { failBuild, type Emit } from './buildResult'
import { parseDiagnostics } from './diagnostics'
import { layoutProgram } from './fallbackImage'
import { parseLinkerCommandFile } from './linkerCmd'
import { readBuildConfig, type BuildConfig } from './projectConfig'
import { findSources, objectName } from './sources'

/** Stands in for the compiler root when there is no compiler, so `${CG_TOOL_ROOT}` paths stay recognisable. */
export const FALLBACK_CGT = '${CG_TOOL_ROOT}'

const fwd = (p: string): string => p.replace(/\\/g, '/')

/** The project's include paths without the compiler's own include directory: LabSim has built-in headers. */
export function userIncludePaths(cfg: BuildConfig, cgtRoot: string): string[] {
  const cgt = fwd(cgtRoot).toLowerCase()
  return cfg.includePaths.filter((p) => {
    const q = fwd(p).toLowerCase()
    return !q.startsWith(cgt) && !/\/ti-cgt-c6000[^/]*\/include\/?$/.test(q)
  })
}

function readSource(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function frontendOptions(cfg: BuildConfig, cgtRoot: string): CompileOptions {
  return { readFile: readSource, includePaths: userIncludePaths(cfg, cgtRoot), defines: cfg.defines, dialect: cfg.dialect, diagWarnings: cfg.diagWarnings }
}

/** A front-end diagnostic as cl6x prints it, with the path relative to the build directory. */
export function renderDiagnostic(d: FrontDiagnostic, outDir: string): string {
  const what = d.code === 'LABSIM' ? `error: ${d.message}` : `${d.fatal ? 'fatal error' : d.severity} #${d.code}: ${d.message}`
  if (d.line === null || d.file === null) return `At end of source: ${what}`
  const shown = isBuiltinFile(d.file) ? d.file : fwd(path.relative(outDir, d.file))
  return `"${shown}", line ${d.line}: ${what}`
}

function summary(list: FrontDiagnostic[], rel: string): string[] {
  const n = list.filter((d) => d.severity === 'error').length
  if (n === 0) return []
  const s = n === 1 ? '' : 's'
  return list.some((d) => d.fatal)
    ? [`${n} catastrophic error${s} detected in the compilation of "${rel}".`, 'Compilation terminated.']
    : [`${n} error${s} detected in the compilation of "${rel}".`]
}

/** Link problems in the TI linker's words, so parseDiagnostics reads them like real linker output. */
function renderLinkProblems(problems: LinkProblem[], layoutError: string | null, outName: string, obj: (source: string) => string): string {
  const lines: string[] = []
  for (const p of problems) {
    if (p.kind === 'redefined') lines.push(`error #10056: symbol "${p.name}" redefined: first defined in "${obj(p.first)}"; redefined in "${obj(p.second)}"`)
  }
  const unresolved = problems.filter((p): p is Extract<LinkProblem, { kind: 'unresolved' }> => p.kind === 'unresolved')
  if (unresolved.length > 0) {
    lines.push('', ' undefined first referenced', '  symbol       in file', ' --------- ----------------')
    for (const u of unresolved) lines.push(` ${u.name.padEnd(9)} ${u.file.startsWith('rts') ? u.file : obj(u.file)}`)
    lines.push('', 'error #10234-D: unresolved symbols remain')
  }
  if (layoutError) lines.push(layoutError)
  if (lines.length === 0) return ''
  lines.push(`error #10010: errors encountered during linking; "${outName}" not built`)
  return lines.join('\n')
}

export interface FallbackRequest {
  projectDir: string
  outDir: string
  name: string
  emit: Emit
}

/** Builds with LabSim's own front-end and a synthetic linker when cl6x is not installed. */
export async function runFallbackBuild({ projectDir, outDir, name, emit }: FallbackRequest): Promise<BuildResult> {
  emit('LabSim: the C6000 compiler (cl6x) was not found, so this build uses the LabSim C front-end.', 'info')
  emit("Its diagnostics follow cl6x 8.3. Set Window > Preferences > C6000 Compiler Location to build with TI's compiler.", 'info')
  emit('', 'out')
  const cfg = await readBuildConfig(projectDir, FALLBACK_CGT)
  const sources = await findSources(projectDir)
  if (sources.length === 0) return failBuild(emit, `No C source files in project ${name}.`)
  await fs.mkdir(outDir, { recursive: true })

  const opts = frontendOptions(cfg, FALLBACK_CGT)
  const diagnostics: Diagnostic[] = []
  const units: TranslationUnit[] = []
  let failed = 0
  for (const src of sources) {
    const rel = fwd(path.relative(outDir, src))
    emit(`Building file: "${rel}"`, 'out')
    emit('Invoking: LabSim C Front-End', 'out')
    const r = compileUnit(src, opts)
    for (const d of r.diagnostics) emit(renderDiagnostic(d, outDir), 'error')
    for (const line of summary(r.diagnostics, rel)) emit(line, 'error')
    diagnostics.push(...r.diagnostics.map(({ fatal: _fatal, ...d }) => d))
    if (!r.unit) {
      failed++
      emit('>> Compilation failure', 'out')
      continue
    }
    units.push(r.unit)
    emit(`Finished building: "${rel}"`, 'out')
    emit(' ', 'out')
  }

  const outName = `${name}.out`
  if (failed > 0) {
    emit(`Build stopped: ${failed} file${failed === 1 ? '' : 's'} failed to compile; "${outName}" not built.`, 'error')
    emit('', 'out')
    emit('**** Build Finished ****', 'out')
    return { ok: false, diagnostics, image: null }
  }
  if (!cfg.linkerCommandFile) {
    const r = failBuild(emit, `No linker command file (.cmd) in project ${name}. Copy C6748.cmd from another project.`)
    return { ...r, diagnostics: [...diagnostics, ...r.diagnostics] }
  }

  emit(`Building target: "${outName}"`, 'out')
  emit('Invoking: LabSim Linker (fallback)', 'out')
  const link = linkProgram(units)
  const cmd = parseLinkerCommandFile(await fs.readFile(path.join(projectDir, cfg.linkerCommandFile), 'utf8'))
  const layout = link.program
    ? layoutProgram(link.program, cmd, { heapSize: Number(cfg.heapSize), stackSize: Number(cfg.stackSize), outFile: path.join(outDir, outName) })
    : null
  const text = renderLinkProblems(link.problems, layout && !layout.image ? layout.error : null, outName, (f) => objectName(projectDir, f))
  if (text) {
    for (const line of text.split('\n')) emit(line, 'error')
    diagnostics.push(...parseDiagnostics(text, outDir))
  }
  if (!layout?.image) {
    emit('', 'out')
    emit('**** Build Finished ****', 'out')
    return { ok: false, diagnostics, image: null }
  }
  emit(`Finished building target: "${outName}"`, 'out')
  emit(' ', 'out')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: true, diagnostics, image: layout.image }
}

/** After a successful cl6x build: warns when LabSim's own front-end cannot read the program, because Debug needs it. */
export function frontendCheck(sources: string[], cfg: BuildConfig, cgtRoot: string, outDir: string, emit: Emit): void {
  const opts = frontendOptions(cfg, cgtRoot)
  const problems: string[] = []
  const units: TranslationUnit[] = []
  for (const src of sources) {
    const r = compileUnit(src, opts)
    for (const d of r.diagnostics) if (d.severity === 'error') problems.push(renderDiagnostic(d, outDir))
    if (r.unit) units.push(r.unit)
  }
  if (problems.length === 0) {
    for (const p of linkProgram(units).problems) if (p.kind === 'unresolved') problems.push(`"${p.name}" is not in LabSim's runtime library yet`)
  }
  if (problems.length === 0) return
  emit("LabSim: cl6x built this program, but LabSim's own front-end cannot run it yet (Debug will not start):", 'error')
  for (const p of problems.slice(0, 5)) emit(`    ${p}`, 'error')
}
```

- [ ] **Step 8: Replace the builder**

```ts path=src/main/build/builder.ts
import { promises as fs } from 'fs'
import * as path from 'path'
import type { BuildKind, BuildResult, Diagnostic, Toolchain } from '@shared/build'
import { failBuild, type Emit } from './buildResult'
import { compileArgs, linkArgs, renderCommand, toSpawnArgs } from './commands'
import { isStale, parseDepFile } from './depfile'
import { parseDiagnostics } from './diagnostics'
import { frontendCheck, runFallbackBuild } from './fallback'
import { loadProgramImage } from './image'
import { readBuildConfig } from './projectConfig'
import { runProcess } from './runProcess'
import { findSources, OUT_SUBDIR } from './sources'

export { findSources, objectName, OUT_SUBDIR } from './sources'

const FLAGS_FILE = 'labsim-flags.json'
const DIAGS_FILE = 'labsim-diagnostics.json'

export interface BuildRequest {
  projectDir: string
  kind: BuildKind
  toolchain: Toolchain | null
  onOutput: Emit
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

const fwd = (p: string): string => p.replace(/\\/g, '/')

async function clean(projectDir: string, name: string, emit: Emit): Promise<BuildResult> {
  emit(`**** Clean-only build of configuration Debug for project ${name} ****`, 'out')
  emit('', 'out')
  await fs.rm(path.join(projectDir, OUT_SUBDIR), { recursive: true, force: true })
  emit(`Removed ${fwd(OUT_SUBDIR)}`, 'out')
  emit('Finished clean', 'out')
  emit(' ', 'out')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: true, diagnostics: [], image: null }
}

export async function runBuild(req: BuildRequest): Promise<BuildResult> {
  const { projectDir, kind, toolchain } = req
  const emit = req.onOutput
  const name = path.basename(projectDir)
  const outDir = path.join(projectDir, OUT_SUBDIR)

  if (kind === 'clean') return clean(projectDir, name, emit)
  if (kind === 'rebuild') {
    await clean(projectDir, name, emit)
    emit('', 'out')
  }

  emit(`**** Build of configuration Debug for project ${name} ****`, 'out')
  emit('', 'out')
  if (!toolchain) return runFallbackBuild({ projectDir, outDir, name, emit })

  const cfg = await readBuildConfig(projectDir, toolchain.root)
  const sources = await findSources(projectDir)
  if (sources.length === 0) return failBuild(emit, `No C source files in project ${name}.`)
  await fs.mkdir(outDir, { recursive: true })

  // Any change of options or compiler invalidates every object.
  const flags = JSON.stringify({ cfg, cgt: toolchain.root })
  const forced = (await readJson<string>(path.join(outDir, FLAGS_FILE), '')) !== flags
  const stored = await readJson<Record<string, Diagnostic[]>>(path.join(outDir, DIAGS_FILE), {})
  const perSource: Record<string, Diagnostic[]> = {}

  const objs: { source: string; objPath: string; objRel: string }[] = []
  let failed = 0
  let compiled = 0
  for (const src of sources) {
    const relToProject = fwd(path.relative(projectDir, src))
    const subdir = path.posix.dirname(relToProject) === '.' ? null : path.posix.dirname(relToProject)
    const base = path.basename(src, path.extname(src))
    const objRel = (subdir ? `${subdir}/` : '') + `${base}.obj`
    const depRel = (subdir ? `${subdir}/` : '') + `${base}.d_raw`
    const objPath = path.join(outDir, objRel)
    objs.push({ source: src, objPath, objRel: `./${objRel}` })

    let deps: string[] = [src]
    try {
      deps = [src, ...parseDepFile(await fs.readFile(path.join(outDir, depRel), 'utf8'), outDir)]
    } catch {
      /* no dependency file yet: stale anyway because the object is missing */
    }
    if (!forced && !(await isStale(objPath, deps))) {
      perSource[src] = stored[src] ?? []
      continue
    }

    compiled++
    const rel = fwd(path.relative(outDir, src))
    if (subdir) await fs.mkdir(path.join(outDir, subdir), { recursive: true })
    const args = compileArgs(cfg, { rel, objDir: subdir, depFile: depRel })
    emit(`Building file: "${rel}"`, 'out')
    emit('Invoking: C6000 Compiler', 'out')
    emit(renderCommand(toolchain.cl6x, args), 'out')
    const captured: string[] = []
    const code = await runProcess(toolchain.cl6x, toSpawnArgs(args), outDir, (line, stream) => {
      captured.push(line)
      emit(line, stream === 'stderr' ? 'error' : 'out')
    })
    perSource[src] = parseDiagnostics(captured.join('\n'), outDir)
    if (code !== 0) {
      failed++
      await fs.rm(objPath, { force: true })
    } else {
      emit(`Finished building: "${rel}"`, 'out')
      emit(' ', 'out')
    }
  }

  await fs.writeFile(path.join(outDir, DIAGS_FILE), JSON.stringify(perSource), 'utf8')
  await fs.writeFile(path.join(outDir, FLAGS_FILE), JSON.stringify(flags), 'utf8')
  const diagnostics = Object.values(perSource).flat()
  const outName = `${name}.out`

  if (failed > 0) {
    emit(`Build stopped: ${failed} file${failed === 1 ? '' : 's'} failed to compile; "${outName}" not built.`, 'error')
    emit('', 'out')
    emit('**** Build Finished ****', 'out')
    return { ok: false, diagnostics, image: null }
  }

  if (!cfg.linkerCommandFile) {
    const r = failBuild(emit, `No linker command file (.cmd) in project ${name}. Copy C6748.cmd from another project.`)
    return { ...r, diagnostics: [...diagnostics, ...r.diagnostics] }
  }
  const cmdPath = path.join(projectDir, cfg.linkerCommandFile)
  const outPath = path.join(outDir, outName)
  const mapPath = path.join(outDir, `${name}.map`)
  const needLink = compiled > 0 || forced || (await isStale(outPath, [...objs.map((o) => o.objPath), cmdPath]))

  if (needLink) {
    const args = linkArgs(cfg, objs.map((o) => o.objRel), fwd(path.relative(outDir, cmdPath)))
    emit(`Building target: "${outName}"`, 'out')
    emit('Invoking: C6000 Linker', 'out')
    emit(renderCommand(toolchain.cl6x, args), 'out')
    const captured: string[] = []
    const code = await runProcess(toolchain.cl6x, toSpawnArgs(args), outDir, (line, stream) => {
      captured.push(line)
      emit(line, stream === 'stderr' ? 'error' : 'out')
    })
    diagnostics.push(...parseDiagnostics(captured.join('\n'), outDir))
    if (code !== 0) {
      await fs.rm(outPath, { force: true })
      emit('', 'out')
      emit('**** Build Finished ****', 'out')
      return { ok: false, diagnostics, image: null }
    }
    emit(`Finished building target: "${outName}"`, 'out')
    emit(' ', 'out')
  } else {
    emit(`'${outName}' is up to date.`, 'out')
  }

  frontendCheck(sources, cfg, toolchain.root, outDir, emit)
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  const image = await loadProgramImage(outPath, mapPath, objs.map((o) => ({ source: o.source, objPath: o.objPath })))
  return { ok: true, diagnostics, image }
}
```

- [ ] **Step 9: Update the startup message**

In `src/renderer/src/store.ts`, replace the `else get().print(...)` line in `init()` with:

```ts
      else get().print(MAIN_CONSOLE, "C6000 compiler (cl6x) not found. Builds will use the LabSim front-end; set Window > Preferences > C6000 Compiler Location to use TI's compiler.", 'error')
```

- [ ] **Step 10: Record the decisions in the spec**

In `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, under **C front-end and executor**, append to the **Language.** paragraph:

```markdown
The dialect follows the project's C_DIALECT option, like cl6x: by default relaxed C89 (`__STDC_VERSION__`
199409L), where `for (int i …)` is error #29. C99 (`--c99`) allows it. The other C99 features above are accepted
in both modes.
```

In **Build phase**, replace the **Fallback when `cl6x` is missing** bullet with:

```markdown
- **Fallback when `cl6x` is missing:** the build uses LabSim's front-end, which gives cl6x-numbered diagnostics
  (verified against 179 reference cases). A synthetic linker then reads MEMORY/SECTIONS from the project's
  `.cmd`, puts objects in cl6x's sections (`.bss`/`.neardata` for scalars, `.far`/`.fardata` for aggregates,
  `.const` for const data), assumes 0x7000 bytes of `.text`, and places sections in SECTIONS order. The console
  says the fallback is in use. After every successful `cl6x` build the front-end also checks the program, and
  the console warns when LabSim cannot run something `cl6x` accepted.
```

- [ ] **Step 11: Run all unit tests and the typecheck**

Run: `npm test && npm run typecheck`
Expected: every unit test passes, including the cl6x-backed builder tests, and there are no type errors.

- [ ] **Step 12: Run the end-to-end tests**

Run: `npm run test:e2e`
Expected: all 11 Playwright tests pass. That includes the new fallback test and the updated build tests.

- [ ] **Step 13: Commit**

```bash
git add -A src tests docs
git commit -m "feat(build): LabSim front-end fallback build, C99 dialect and front-end check after cl6x builds"
```

---

### Task 10: Verify against the real workspace

**Files:** none. This task checks the finished step by hand, the way Step 2 was checked.

- [ ] **Step 1: Snapshot `~/workspace_v12` modification times**

```bash
find ~/workspace_v12 -type f -not -path '*/.labsim/*' -printf '%p %T@\n' | sort > /tmp/ws-before.txt
```

- [ ] **Step 2: Build `exp11` in the app with and without cl6x**

Use Playwright (a scratch script, not a committed test) to launch the built app on `~/workspace_v12`:
- With the compiler: build `exp11`. Expected: `Finished building target: "exp11.out"`, `0 errors`, and no `LabSim: cl6x built this program` line.
- With `LABSIM_COMPILER_ROOT` set to an empty folder: build `exp11` and `fft_m`. Expected:
  - `exp11` builds with the LabSim C Front-End;
  - `fft_m` shows `fatal error #1965: cannot open source file "math.io"`, the same as CCS.

Take a screenshot of each and look at them.

- [ ] **Step 3: Clean up and confirm nothing else changed**

```bash
rm -rf ~/workspace_v12/exp11/.labsim ~/workspace_v12/fft_m/.labsim
find ~/workspace_v12 -type f -not -path '*/.labsim/*' -printf '%p %T@\n' | sort > /tmp/ws-after.txt
diff /tmp/ws-before.txt /tmp/ws-after.txt && echo unchanged
```

Expected: `unchanged`.
