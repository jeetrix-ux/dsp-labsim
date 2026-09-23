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
      if (!isBuiltinFile(file) && text.length > 0 && !text.endsWith('\n')) {
        this.diags.warning({ file, line: text.replace(/\r\n?/g, '\n').split('\n').length, col: 1 }, M.noNewlineAtEnd())
      }
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
