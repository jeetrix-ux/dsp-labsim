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
