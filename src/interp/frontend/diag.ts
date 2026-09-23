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

  /** Syntax errors the parser repaired in place (a missing `]` or `,`), which cl6x does not let hide usage warnings. */
  private repairs = 0

  get errors(): number {
    return this.list.filter((d) => d.severity === 'error').length
  }

  /** Errors other than repaired ones: what suppresses usage warnings for the declaration they occur in. */
  get unrepaired(): number {
    return this.errors - this.repairs
  }

  error(at: Loc, [code, text]: Msg): void {
    this.push(at, 'error', code, text)
  }

  /** Reports a syntax error the parser repairs and carries on from. */
  repaired(at: Loc, msg: Msg): void {
    this.repairs++
    this.error(at, msg)
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
  noNewlineAtEnd: (): Msg => ['1-D', 'last line of file ends without a newline'],
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
  incompatibleImplicit: (name: string, line: number): Msg => ['161-D', `declaration is incompatible with previous "${name}" (declared at line ${line})`],
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
  labelUnreferenced: (name: string): Msg => ['179-D', `label "${name}" was declared but never referenced`],
  setNotUsed: (name: string): Msg => ['552-D', `variable "${name}" was set but never used`],
  // LabSim's own limits
  unsupported: (what: string): Msg => ['LABSIM', `LabSim: unsupported construct ${what}`]
}
