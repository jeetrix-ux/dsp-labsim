import type { NumberFormat } from '@shared/debug'
import { hex } from '../exec/memory'
import { kindOf, kindSize } from '../exec/scalar'
import { typeToString, type Type } from '../frontend/types'

/** `float[8]`, `int *`: typeToString without the space before an array's brackets. */
export const typeName = (t: Type): string => typeToString(t).replace(/ \[/g, '[')

const ESCAPES: Record<number, string> = { 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 39: "\\'", 92: '\\\\' }

function charText(c: number): string {
  if (ESCAPES[c] !== undefined) return `'${ESCAPES[c]}'`
  if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`
  return `'\\x${c.toString(16).toUpperCase().padStart(2, '0')}'`
}

/** The fewest significant digits that read back as the same float. */
export function shortestFloat(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p))
    if (Math.fround(n) === v) return String(n)
  }
  return String(v)
}

function floatBits(v: number, single: boolean): bigint {
  const dv = new DataView(new ArrayBuffer(8))
  if (single) {
    dv.setFloat32(0, v)
    return BigInt(dv.getUint32(0))
  }
  dv.setFloat64(0, v)
  return dv.getBigUint64(0)
}

export function formatValue(value: unknown, t: Type, fmt: NumberFormat): string {
  const k = kindOf(t)
  if (k === 'void') return ''
  if (k === 'agg' || k === 'ptr') return `0x${hex(value as number)}`
  if (k === 'f32' || k === 'f64') {
    const x = value as number
    const single = k === 'f32'
    if (fmt === 'hex') return `0x${floatBits(x, single).toString(16).toUpperCase().padStart(single ? 8 : 16, '0')}`
    if (fmt === 'binary') return `0b${floatBits(x, single).toString(2).padStart(single ? 32 : 64, '0')}`
    return single ? shortestFloat(x) : String(x)
  }
  const n = BigInt(value as number | bigint)
  const bits = k === 'i40' || k === 'u40' ? 40 : kindSize(k) * 8
  const u = BigInt.asUintN(bits, n)
  switch (fmt) {
    case 'hex':
      return `0x${u.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}`
    case 'binary':
      return `0b${u.toString(2).padStart(bits, '0')}`
    case 'char':
      return charText(Number(u & 0xffn))
    case 'decimal':
      return n.toString()
    default:
      return k === 'i8' || k === 'u8' ? `${n} ${charText(Number(u & 0xffn))}` : n.toString()
  }
}
