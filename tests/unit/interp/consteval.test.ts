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
