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
