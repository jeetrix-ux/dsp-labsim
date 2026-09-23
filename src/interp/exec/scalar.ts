import type { Type } from '../frontend/types'
import type { Memory } from './memory'

/** How a C value is held in JavaScript. Aggregates (and functions) are represented by their address. */
export type Kind =
  | 'bool' | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i40' | 'u40' | 'i64' | 'u64' | 'f32' | 'f64' | 'ptr' | 'agg' | 'void'

export function kindOf(t: Type): Kind {
  switch (t.kind) {
    case 'int':
      if (t.name === '_Bool') return 'bool'
      if (t.bits === 8) return t.signed ? 'i8' : 'u8'
      if (t.bits === 16) return t.signed ? 'i16' : 'u16'
      if (t.bits === 32) return t.signed ? 'i32' : 'u32'
      if (t.bits === 40) return t.signed ? 'i40' : 'u40'
      return t.signed ? 'i64' : 'u64'
    case 'float':
      return t.name === 'float' ? 'f32' : 'f64'
    case 'pointer':
      return 'ptr'
    case 'struct':
    case 'union':
    case 'array':
    case 'function':
      return 'agg'
    default:
      return 'void'
  }
}

export const isBig = (k: Kind): boolean => k === 'i40' || k === 'u40' || k === 'i64' || k === 'u64'
export const isFloatKind = (k: Kind): boolean => k === 'f32' || k === 'f64'
export const zeroOf = (k: Kind): number | bigint => (isBig(k) ? 0n : 0)

/** Bytes a scalar of this kind occupies. */
export function kindSize(k: Kind): number {
  switch (k) {
    case 'bool':
    case 'i8':
    case 'u8':
      return 1
    case 'i16':
    case 'u16':
      return 2
    case 'i40':
    case 'u40':
    case 'i64':
    case 'u64':
    case 'f64':
      return 8
    default:
      return 4
  }
}

export type Load = (addr: number) => any
export type Store = (addr: number, v: any) => void

export function loader(mem: Memory, k: Kind): Load {
  switch (k) {
    case 'bool':
    case 'u8':
      return (a) => mem.u8(a)
    case 'i8':
      return (a) => mem.i8(a)
    case 'i16':
      return (a) => mem.i16(a)
    case 'u16':
      return (a) => mem.u16(a)
    case 'i32':
      return (a) => mem.i32(a)
    case 'u32':
    case 'ptr':
      return (a) => mem.u32(a)
    case 'i40':
      return (a) => BigInt.asIntN(40, mem.i64(a))
    case 'u40':
      return (a) => BigInt.asUintN(40, mem.u64(a))
    case 'i64':
      return (a) => mem.i64(a)
    case 'u64':
      return (a) => mem.u64(a)
    case 'f32':
      return (a) => mem.f32(a)
    case 'f64':
      return (a) => mem.f64(a)
    default:
      return (a) => a
  }
}

export function storer(mem: Memory, k: Kind): Store {
  switch (k) {
    case 'bool':
    case 'i8':
    case 'u8':
      return (a, v) => mem.set8(a, v)
    case 'i16':
    case 'u16':
      return (a, v) => mem.set16(a, v)
    case 'i32':
    case 'u32':
    case 'ptr':
      return (a, v) => mem.set32(a, v)
    case 'i40':
    case 'u40':
    case 'i64':
    case 'u64':
      return (a, v) => mem.set64(a, v)
    case 'f32':
      return (a, v) => mem.setF32(a, v)
    case 'f64':
      return (a, v) => mem.setF64(a, v)
    default:
      throw new Error(`no scalar store for kind ${k}`)
  }
}

const I32_MIN = -2147483648
const I32_MAX = 2147483647
const U32_MAX = 4294967295

/** Float to int as the C674x SPTRUNC/DPTRUNC do: truncate toward zero, saturate, NaN gives 0x80000000. */
export function f2i(v: number): number {
  if (v !== v) return I32_MIN
  if (v >= I32_MAX) return I32_MAX
  if (v <= I32_MIN) return I32_MIN
  return Math.trunc(v) | 0
}

/** Float to unsigned as TI's _fixfu/_fixdu: truncate, saturate at UINT_MAX, wrap negative values around. */
export function f2u(v: number): number {
  if (v >= U32_MAX) return U32_MAX
  if (v >= 0) return Math.trunc(v)
  return f2i(v) >>> 0
}

/** Float to a 40- or 64-bit integer: truncate and saturate (negative values wrap for unsigned targets). */
export function f2big(v: number, bits: number, signed: boolean): bigint {
  const b = BigInt(bits)
  if (!signed) {
    if (v !== v) return 0n
    if (v < 0) return BigInt.asUintN(bits, f2big(v, bits, true))
    const max = (1n << b) - 1n
    return v >= Number(max) ? max : BigInt(Math.trunc(v))
  }
  const max = (1n << (b - 1n)) - 1n
  const min = -(1n << (b - 1n))
  if (v !== v) return min
  if (v >= Number(max)) return max
  if (v <= Number(min)) return min
  return BigInt(Math.trunc(v))
}

/** Reduces a bigint to the width of a 40- or 64-bit kind. */
export function wrapper(k: Kind): (v: bigint) => bigint {
  const bits = k === 'i40' || k === 'u40' ? 40 : 64
  return k[0] === 'i' ? (v) => BigInt.asIntN(bits, v) : (v) => BigInt.asUintN(bits, v)
}

const RANGE: Partial<Record<Kind, [number, number]>> = {
  bool: [0, 1],
  i8: [-128, 127],
  u8: [0, 255],
  i16: [-32768, 32767],
  u16: [0, 65535],
  i32: [I32_MIN, I32_MAX],
  u32: [0, U32_MAX],
  ptr: [0, U32_MAX]
}

/** The C conversion from one kind to another, or null when the value needs no change. */
export function converter(from: Kind, to: Kind): ((v: any) => any) | null {
  if (from === to || to === 'void' || to === 'agg' || from === 'agg' || from === 'void') return null
  const fromBig = isBig(from)
  const fromFloat = isFloatKind(from)
  switch (to) {
    case 'f64':
      return fromBig ? (v) => Number(v) : null
    case 'f32':
      return fromBig ? (v) => Math.fround(Number(v)) : (v) => Math.fround(v)
    case 'bool':
      return fromBig ? (v) => (v !== 0n ? 1 : 0) : (v) => (v !== 0 ? 1 : 0)
    case 'i40':
    case 'u40':
    case 'i64':
    case 'u64': {
      const bits = to === 'i40' || to === 'u40' ? 40 : 64
      const signed = to[0] === 'i'
      const wrap = wrapper(to)
      if (fromFloat) return (v) => f2big(v, bits, signed)
      if (fromBig) return wrap
      return (v) => wrap(BigInt(v))
    }
  }
  const src = RANGE[from]
  const dst = RANGE[to] as [number, number]
  if (src && src[0] >= dst[0] && src[1] <= dst[1]) return null
  const toInt: (v: any) => number = fromBig
    ? (v) => Number(BigInt.asIntN(32, v))
    : fromFloat
      ? to === 'u32' || to === 'ptr' ? f2u : f2i
      : (v) => v
  switch (to) {
    case 'i8':
      return (v) => (toInt(v) << 24) >> 24
    case 'u8':
      return (v) => toInt(v) & 0xff
    case 'i16':
      return (v) => (toInt(v) << 16) >> 16
    case 'u16':
      return (v) => toInt(v) & 0xffff
    case 'i32':
      return (v) => toInt(v) | 0
    default:
      return (v) => toInt(v) >>> 0
  }
}
