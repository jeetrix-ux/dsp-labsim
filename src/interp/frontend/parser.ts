import type { BinOp, Block, CaseStmt, CompoundOp, DefaultStmt, Expr, FuncSym, FunctionDef, GotoStmt, Init, LabelStmt, Stmt, Sym, TranslationUnit, VarSym } from './ast'
import { evalConst, evalIntConst } from './consteval'
import { M, type Diags, type Loc, type Msg, type Punct } from './diag'
import { lowerInit, type Designator, type InitSyntax, type InitSyntaxItem } from './initializer'
import { loc as tokLoc, tokenize, type Token } from './lexer'
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

/**
 * Parses one C expression typed in the debugger (Expressions view, graph start address) in the file scope of `unit`,
 * with a function's `locals` visible. Macros are not expanded, as in CCS. Returns null after a syntax error.
 */
export function parseExpression(text: string, unit: TranslationUnit, locals: VarSym[], diags: Diags): Expr | null {
  return new Parser(tokenize(text, '<expression>'), { file: unit.file, dialect: 'c99' }, diags).standalone(unit.scope as Scope, locals)
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
    return {
      file: this.opts.file,
      functions: this.functions,
      objects: this.objects,
      funcs: this.funcs,
      pragmas: this.opts.pragmas ?? [],
      scope: this.file
    }
  }

  /** One expression in `file` with `locals` in an inner scope; the whole input must be the expression. */
  standalone(file: Scope, locals: VarSym[]): Expr | null {
    const scope = new Scope(file)
    for (const v of locals) scope.syms.set(v.name, v)
    this.scope = scope
    try {
      const e = this.expression()
      if (this.tok.kind !== 'eof') {
        this.diags.error(this.at(), M.expectedExpression())
        return null
      }
      return e
    } catch (err) {
      if (err === ABORT) return null
      throw err
    }
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
      // cl6x reports a missing ']' and reads on as if it were there.
      if (!this.accept(']')) this.diags.repaired(this.at(), M.expected(']'))
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
        if (prev.implicit) this.diags.warning(at, M.incompatibleImplicit(name, prev.loc.line))
        else this.diags.error(at, M.incompatibleDecl(typeToString(prev.type, name), prev.loc.line))
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
    // cl6x gives no usage warning for a variable whose own declaration or initializer is in error.
    const errorsBefore = this.diags.unrepaired
    const quietIfErrors = (sym: VarSym): void => {
      if (this.diags.unrepaired > errorsBefore) sym.hidden = true
    }
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
      quietIfErrors(sym)
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
    quietIfErrors(sym)
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
      for (const [label, s] of fn.labels) if (!fn.gotos.some((g) => g.label === label)) this.diags.warning(s.loc, M.labelUnreferenced(label))
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
      if (!this.is('}')) {
        // cl6x reports the missing comma and carries on with the next item.
        this.diags.repaired(this.at(), M.expected(','))
        if (this.is(';') || this.tok.kind === 'eof') throw ABORT
      }
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
      const errorsBefore = this.diags.unrepaired
      const d = this.declarator(spec.type, 'named')
      const badDeclarator = this.diags.unrepaired > errorsBefore
      const v = this.declare(spec, d)
      // No usage warning for a variable whose declarator is in error (cl6x).
      if (v && badDeclarator) v.hidden = true
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
    // A '{' where an expression belongs (`a[8] = {0, 0};`) ends the statement: cl6x skips the braces unreported.
    if (t.kind === 'punct' && t.text === '{') this.abort(M.expectedExpression(), t)
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
