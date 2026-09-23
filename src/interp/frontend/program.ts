import type { FunctionDef, TranslationUnit, VarSym } from './ast'
import { Diags, FatalError, type FrontDiagnostic } from './diag'
import { BUILTIN_HEADERS, PRELUDE } from './headers'
import { parseUnit } from './parser'
import { isBuiltinFile, preprocess, type PreprocessOptions } from './preprocessor'
import type { FunctionType } from './types'

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

export interface Library {
  functions: Set<string>
  objects: Set<string>
  /** The declared type of every library function, from LabSim's built-in headers. */
  prototypes: Map<string, FunctionType>
}

let libraryCache: Library | null = null

/** What the LabSim runtime provides: every function and object its built-in headers declare. */
export function library(): Library {
  if (libraryCache) return libraryCache
  const headers = Object.keys(BUILTIN_HEADERS).filter((h) => h !== PRELUDE && !BUILTIN_HEADERS[h].includes('#error'))
  const file = '<builtin>/__labsim_library.c'
  const source = headers.map((h) => `#include <${h}>`).join('\n') + '\n'
  const r = compileUnit(file, { readFile: (f) => (f === file ? source : null), includePaths: [], defines: [], dialect: 'c99', diagWarnings: [] })
  if (!r.unit) throw new Error(`LabSim's built-in headers do not compile: ${r.diagnostics[0]?.message}`)
  libraryCache = {
    functions: new Set(r.unit.funcs.map((f) => f.name)),
    objects: new Set(r.unit.objects.map((o) => o.name)),
    prototypes: new Map(r.unit.funcs.map((f) => [f.name, f.type]))
  }
  return libraryCache
}
