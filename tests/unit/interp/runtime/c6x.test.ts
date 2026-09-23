import { describe, expect, it } from 'vitest'
import { loadProgram } from '../../../../src/interp/run'
import { build, NO_IO, runC } from '../exec/harness'

/** [C expression, expected value as unsigned 32-bit] */
const CASES: [string, number][] = [
  ['_dotp2(0x00030002, 0x00050004)', 23],
  ['_pack2(0x1234abcd, 0x5678ef01)', 0xabcdef01],
  ['_add2(0x0001ffff, 0x00010001)', 0x00020000],
  ['_sub2(0x00010000, 0x00010001)', 0x0000ffff],
  ['_mpy(0x0001fffe, 3)', -6 >>> 0],
  ['_mpyh(0x00020000, 0xfffd0000)', -6 >>> 0],
  ['_sadd(0x7fffffff, 1)', 0x7fffffff],
  ['_ssub(-2147483647 - 1, 1)', 0x80000000],
  ['_norm(1)', 30],
  ['_norm(0)', 31],
  ['_norm(-1)', 31],
  ['_lmbd(1, 0x00100000)', 11],
  ['_lmbd(0, 0xffff0000)', 16],
  ['_abs(-2147483647 - 1)', 0x7fffffff],
  ['_extu(0xabcd1234, 8, 24)', 0xcd],
  ['_ext(0x0000ff00, 16, 24)', 0xffffffff],
  ['_set(0, 4, 7)', 0xf0],
  ['_clr(0xff, 0, 3)', 0xf0],
  ['_hi(1.0)', 0x3ff00000],
  ['_lo(1.0)', 0],
  ['_smpy(0x8000, 0x8000)', 0x7fffffff],
  ['_smpy(0x4000, 0x4000)', 0x20000000],
  ['_swap4(0x11223344)', 0x22114433],
  ['_bitr(1)', 0x80000000],
  ['_rotl(0x80000001, 1)', 3],
  ['_bitc4(0xff0f0301)', 0x08040201],
  ['_deal(0xaaaaaaaa)', 0xffff0000],
  ['_shfl(0xffff0000)', 0xaaaaaaaa],
  ['_avgu4(0x02040608, 0x01010101)', 0x02030405],
  ['_packh4(0x11223344, 0x55667788)', 0x11335577],
  ['_packl4(0x11223344, 0x55667788)', 0x22446688],
  ['_cmpgt2(0x00050003, 0x00040004)', 2],
  ['_max2(0xfffe0005, 0x00010002)', 0x00010005],
  ['_saddu4(0xf0100000, 0x20200000)', 0xff300000],
  ['_spack2(70000, -70000)', 0x7fff8000],
  ['_subabs4(0x0510ff00, 0x0a0500ff)', 0x050bffff],
  ['_shr2(0x80000010, 4)', 0xf8000001],
  ['_mpy32(0x10000, 0x10000)', 0],
  ['_ftoi(1.0f)', 0x3f800000]
]

describe('C6000 intrinsics', () => {
  it('compute bit-exact results', () => {
    const lines = CASES.map(([e], i) => `    r[${i}] = (unsigned)(${e});`)
    const r = runC(`#include <c6x.h>\nunsigned r[${CASES.length}];\nlong long w[3];\ndouble d;\nint main(void)\n{\n${lines.join('\n')}\n    w[0] = _mpy32ll(-2, 3);\n    w[1] = _mpy2ll(0x00020003, 0x00040005);\n    w[2] = _itoll(1, 2);\n    d = _itod(0x40000000, 0);\n    return 0;\n}`)
    expect(r.result).toMatchObject({ status: 'exited' })
    const got = CASES.map((_, i) => r.m.mem.u32(r.g('r') + 4 * i))
    expect(Object.fromEntries(got.map((v, i) => [CASES[i][0], v]))).toEqual(Object.fromEntries(CASES.map(([e, v]) => [e, v >>> 0])))
    expect([0, 1, 2].map((i) => r.m.mem.i64(r.g('w') + 8 * i))).toEqual([-6n, (8n << 32n) + 15n, (1n << 32n) + 2n])
    expect(r.m.mem.f64(r.g('d'))).toBe(2)
  })

  it('refuses to load a program that uses an intrinsic LabSim cannot run exactly', () => {
    const { program, image } = build('#include <c6x.h>\nint main(void) { return _gmpy4(1, 2); }')
    expect(() => loadProgram(program, image, NO_IO)).toThrow('LabSim: unsupported construct _gmpy4()')
  })
})
