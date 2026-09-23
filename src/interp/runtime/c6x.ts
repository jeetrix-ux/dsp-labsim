import { fn, type LibFunction } from './types'

const s16 = (x: number): number => (x << 16) >> 16
const u16 = (x: number): number => x & 0xffff
const h16 = (x: number): number => x >> 16
const uh16 = (x: number): number => x >>> 16
const ubyte = (x: number, i: number): number => (x >>> (8 * i)) & 0xff
const sbyte = (x: number, i: number): number => (x << (24 - 8 * i)) >> 24
const sat32 = (v: number): number => (v > 2147483647 ? 2147483647 : v < -2147483648 ? -2147483648 : v)
const sat16 = (v: number): number => (v > 32767 ? 32767 : v < -32768 ? -32768 : v)
const clampU = (v: number, max: number): number => (v > max ? max : v < 0 ? 0 : v)
const pack = (hi: number, lo: number): number => (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0
const bytes = (b3: number, b2: number, b1: number, b0: number): number => (((b3 & 0xff) << 24) | ((b2 & 0xff) << 16) | ((b1 & 0xff) << 8) | (b0 & 0xff)) >>> 0
const perByte = (a: number, b: number, f: (x: number, y: number) => number): number =>
  bytes(f(ubyte(a, 3), ubyte(b, 3)), f(ubyte(a, 2), ubyte(b, 2)), f(ubyte(a, 1), ubyte(b, 1)), f(ubyte(a, 0), ubyte(b, 0)))
const ll = (hi: number, lo: number): bigint => BigInt.asIntN(64, (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0))
const bits = (lo: number, hi: number): number[] => {
  const out: number[] = []
  for (let b = lo & 31; b <= (hi & 31); b++) out.push(b)
  return out
}
const mask = (a: number, b: number): number => bits(a, b).reduce((m, k) => m | (1 << k), 0)
const smpy = (x: number, y: number): number => {
  const p = x * y * 2
  return p === 0x80000000 ? 0x7fffffff : p | 0
}
const sat40 = (v: bigint): bigint => (v > (1n << 39n) - 1n ? (1n << 39n) - 1n : v < -(1n << 39n) ? -(1n << 39n) : v)
const dv = new DataView(new ArrayBuffer(8))
const doubleBits = (d: number): [number, number] => {
  dv.setFloat64(0, d, true)
  return [dv.getUint32(4, true), dv.getUint32(0, true)]
}
const fromBits = (hi: number, lo: number): number => {
  dv.setUint32(4, hi >>> 0, true)
  dv.setUint32(0, lo >>> 0, true)
  return dv.getFloat64(0, true)
}
const floatBits = (f: number): number => {
  dv.setFloat32(0, f, true)
  return dv.getUint32(0, true)
}
const bitsFloat = (u: number): number => {
  dv.setUint32(0, u >>> 0, true)
  return dv.getFloat32(0, true)
}
/** SPINT/DPINT: round to nearest (even), saturate, NaN gives 0x80000000. */
const toIntRounded = (v: number): number => {
  if (v !== v) return -2147483648
  const f = Math.floor(v)
  const d = v - f
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1
  return sat32(r) | 0
}
const shiftSat = (x: number, n: number): number => (n <= 0 ? x >> Math.min(-n, 31) : sat32(x * 2 ** Math.min(n, 31)) | 0)
const add2 = (a: number, b: number): number => pack(h16(a) + h16(b), a + b) | 0
const sub2 = (a: number, b: number): number => pack(h16(a) - h16(b), a - b) | 0
const sadd2 = (a: number, b: number): number => pack(sat16(h16(a) + h16(b)), sat16(s16(a) + s16(b))) | 0
const ssub2 = (a: number, b: number): number => pack(sat16(h16(a) - h16(b)), sat16(s16(a) - s16(b))) | 0
const packh2 = (a: number, b: number): number => ((a & 0xffff0000) | (b >>> 16)) >>> 0
const pack2 = (a: number, b: number): number => pack(a, b)

type Impl = (...a: any[]) => any
const i = (arity: number, f: Impl): LibFunction => fn(arity, (_m, a) => f(...a))

export const INTRINSICS: Record<string, LibFunction> = {
  _extu: i(3, (s, a, b) => ((s << (a & 31)) >>> (b & 31)) >>> 0),
  _ext: i(3, (s, a, b) => (s << (a & 31)) >> (b & 31)),
  _set: i(3, (s, a, b) => (s | mask(a, b)) >>> 0),
  _clr: i(3, (s, a, b) => (s & ~mask(a, b)) >>> 0),
  _extur: i(2, (s, r) => ((s << ((r >> 5) & 31)) >>> (r & 31)) >>> 0),
  _extr: i(2, (s, r) => (s << ((r >> 5) & 31)) >> (r & 31)),
  _setr: i(2, (s, r) => (s | mask((r >> 5) & 31, r & 31)) >>> 0),
  _clrr: i(2, (s, r) => (s & ~mask((r >> 5) & 31, r & 31)) >>> 0),
  _sadd: i(2, (a, b) => sat32(a + b) | 0),
  _ssub: i(2, (a, b) => sat32(a - b) | 0),
  _sshl: i(2, (a, n) => shiftSat(a, Math.min(n >>> 0, 31))),
  _add2: i(2, add2),
  _sub2: i(2, sub2),
  _subc: i(2, (a, b) => {
    const d = a - b
    return (d >= 0 ? d * 2 + 1 : a * 2) >>> 0
  }),
  _lmbd: i(2, (a, b) => Math.clz32(a & 1 ? b : ~b)),
  _abs: i(1, (x) => (x === -2147483648 ? 2147483647 : Math.abs(x))),
  _labs: i(1, (x: bigint) => sat40(x < 0n ? -x : x)),
  _norm: i(1, (x) => (x === 0 || x === -1 ? 31 : Math.clz32(x ^ (x >> 31)) - 1)),
  _lnorm: i(1, (x: bigint) => {
    if (x === 0n || x === -1n) return 39
    const v = x < 0n ? ~x : x
    return 39 - v.toString(2).length
  }),
  _smpy: i(2, (a, b) => smpy(s16(a), s16(b))),
  _smpyhl: i(2, (a, b) => smpy(h16(a), s16(b))),
  _smpylh: i(2, (a, b) => smpy(s16(a), h16(b))),
  _smpyh: i(2, (a, b) => smpy(h16(a), h16(b))),
  _mpy: i(2, (a, b) => s16(a) * s16(b)),
  _mpyus: i(2, (a, b) => u16(a) * s16(b)),
  _mpysu: i(2, (a, b) => s16(a) * u16(b)),
  _mpyu: i(2, (a, b) => (u16(a) * u16(b)) >>> 0),
  _mpyhl: i(2, (a, b) => h16(a) * s16(b)),
  _mpyhuls: i(2, (a, b) => uh16(a) * s16(b)),
  _mpyhslu: i(2, (a, b) => h16(a) * u16(b)),
  _mpyhlu: i(2, (a, b) => (uh16(a) * u16(b)) >>> 0),
  _mpylh: i(2, (a, b) => s16(a) * h16(b)),
  _mpyluhs: i(2, (a, b) => u16(a) * h16(b)),
  _mpylshu: i(2, (a, b) => s16(a) * uh16(b)),
  _mpylhu: i(2, (a, b) => (u16(a) * uh16(b)) >>> 0),
  _mpyh: i(2, (a, b) => h16(a) * h16(b)),
  _mpyhus: i(2, (a, b) => uh16(a) * h16(b)),
  _mpyhsu: i(2, (a, b) => h16(a) * uh16(b)),
  _mpyhu: i(2, (a, b) => (uh16(a) * uh16(b)) >>> 0),
  _lsadd: i(2, (a, b: bigint) => sat40(BigInt(a) + b)),
  _lssub: i(2, (a, b: bigint) => sat40(BigInt(a) - b)),
  _sat: i(1, (x: bigint) => (x > 2147483647n ? 2147483647 : x < -2147483648n ? -2147483648 : Number(x))),
  _fabs: i(1, Math.abs),
  _fabsf: i(1, Math.abs),
  _mpyidll: i(2, (a, b) => BigInt(a) * BigInt(b)),
  _spint: i(1, toIntRounded),
  _dpint: i(1, toIntRounded),
  _hi: i(1, (d) => doubleBits(d)[0]),
  _lo: i(1, (d) => doubleBits(d)[1]),
  _hif: i(1, (d) => bitsFloat(doubleBits(d)[0])),
  _lof: i(1, (d) => bitsFloat(doubleBits(d)[1])),
  _hill: i(1, (x: bigint) => Number(BigInt.asUintN(64, x) >> 32n)),
  _loll: i(1, (x: bigint) => Number(BigInt.asUintN(32, x))),
  _itod: i(2, (hi, lo) => fromBits(hi, lo)),
  _ftod: i(2, (hi, lo) => fromBits(floatBits(hi), floatBits(lo))),
  _itoll: i(2, (hi, lo) => ll(hi, lo)),
  _itof: i(1, (u) => bitsFloat(u)),
  _ftoi: i(1, (f) => floatBits(f)),
  _dtoll: i(1, (d) => {
    const [hi, lo] = doubleBits(d)
    return ll(hi, lo)
  }),
  _lltod: i(1, (x: bigint) => fromBits(Number(BigInt.asUintN(64, x) >> 32n), Number(BigInt.asUintN(32, x)))),
  _add4: i(2, (a, b) => perByte(a, b, (x, y) => x + y) | 0),
  _sub4: i(2, (a, b) => perByte(a, b, (x, y) => x - y) | 0),
  _avg2: i(2, (a, b) => pack((h16(a) + h16(b) + 1) >> 1, (s16(a) + s16(b) + 1) >> 1) | 0),
  _avgu4: i(2, (a, b) => perByte(a, b, (x, y) => (x + y + 1) >> 1)),
  _cmpeq2: i(2, (a, b) => (h16(a) === h16(b) ? 2 : 0) | (s16(a) === s16(b) ? 1 : 0)),
  _cmpeq4: i(2, (a, b) => [0, 1, 2, 3].reduce((m, k) => m | (ubyte(a, k) === ubyte(b, k) ? 1 << k : 0), 0)),
  _cmpgt2: i(2, (a, b) => (h16(a) > h16(b) ? 2 : 0) | (s16(a) > s16(b) ? 1 : 0)),
  _cmpgtu4: i(2, (a, b) => [0, 1, 2, 3].reduce((m, k) => m | (ubyte(a, k) > ubyte(b, k) ? 1 << k : 0), 0)),
  _dotp2: i(2, (a, b) => (s16(a) * s16(b) + h16(a) * h16(b)) | 0),
  _dotpn2: i(2, (a, b) => (h16(a) * h16(b) - s16(a) * s16(b)) | 0),
  _dotpnrsu2: i(2, (a, b) => Math.floor((h16(a) * uh16(b) - s16(a) * u16(b) + 0x8000) / 65536) | 0),
  _dotprsu2: i(2, (a, b) => Math.floor((h16(a) * uh16(b) + s16(a) * u16(b) + 0x8000) / 65536) | 0),
  _dotpsu4: i(2, (a, b) => [0, 1, 2, 3].reduce((s, k) => s + sbyte(a, k) * ubyte(b, k), 0) | 0),
  _dotpu4: i(2, (a, b) => [0, 1, 2, 3].reduce((s, k) => s + ubyte(a, k) * ubyte(b, k), 0) >>> 0),
  _ldotp2: i(2, (a, b) => BigInt(s16(a) * s16(b) + h16(a) * h16(b))),
  _max2: i(2, (a, b) => pack(Math.max(h16(a), h16(b)), Math.max(s16(a), s16(b))) | 0),
  _min2: i(2, (a, b) => pack(Math.min(h16(a), h16(b)), Math.min(s16(a), s16(b))) | 0),
  _maxu4: i(2, (a, b) => perByte(a, b, Math.max)),
  _minu4: i(2, (a, b) => perByte(a, b, Math.min)),
  _mpy2ll: i(2, (a, b) => ll(h16(a) * h16(b), s16(a) * s16(b))),
  _mpyhill: i(2, (a, b) => BigInt(h16(a)) * BigInt(b)),
  _mpylill: i(2, (a, b) => BigInt(s16(a)) * BigInt(b)),
  _mpyhir: i(2, (a, b) => Number((BigInt(h16(a)) * BigInt(b) + 0x4000n) >> 15n) | 0),
  _mpylir: i(2, (a, b) => Number((BigInt(s16(a)) * BigInt(b) + 0x4000n) >> 15n) | 0),
  _mpysu4ll: i(2, (a, b) => {
    const p = [0, 1, 2, 3].map((k) => sbyte(a, k) * ubyte(b, k))
    return ll(pack(p[3], p[2]), pack(p[1], p[0]))
  }),
  _mpyu4ll: i(2, (a, b) => {
    const p = [0, 1, 2, 3].map((k) => ubyte(a, k) * ubyte(b, k))
    return ll(pack(p[3], p[2]), pack(p[1], p[0]))
  }),
  _pack2: i(2, pack2),
  _packh2: i(2, packh2),
  _packhl2: i(2, (a, b) => ((a & 0xffff0000) | (b & 0xffff)) >>> 0),
  _packlh2: i(2, (a, b) => (((a & 0xffff) << 16) | (b >>> 16)) >>> 0),
  _packh4: i(2, (a, b) => bytes(ubyte(a, 3), ubyte(a, 1), ubyte(b, 3), ubyte(b, 1))),
  _packl4: i(2, (a, b) => bytes(ubyte(a, 2), ubyte(a, 0), ubyte(b, 2), ubyte(b, 0))),
  _rotl: i(2, (a, n) => {
    const k = n & 31
    return k === 0 ? a >>> 0 : ((a << k) | (a >>> (32 - k))) >>> 0
  }),
  _sadd2: i(2, sadd2),
  _saddu4: i(2, (a, b) => perByte(a, b, (x, y) => clampU(x + y, 255))),
  _saddus2: i(2, (a, b) => pack(clampU(uh16(a) + h16(b), 65535), clampU(u16(a) + s16(b), 65535)) | 0),
  _shlmb: i(2, (a, b) => ((b << 8) | (a >>> 24)) >>> 0),
  _shrmb: i(2, (a, b) => ((b >>> 8) | ((a & 0xff) << 24)) >>> 0),
  _shr2: i(2, (a, n) => pack(h16(a) >> Math.min(n & 31, 15), s16(a) >> Math.min(n & 31, 15)) | 0),
  _shru2: i(2, (a, n) => ((n & 31) >= 16 ? 0 : pack(uh16(a) >>> (n & 31), u16(a) >>> (n & 31)))),
  _smpy2ll: i(2, (a, b) => ll(smpy(h16(a), h16(b)), smpy(s16(a), s16(b)))),
  _spack2: i(2, (a, b) => pack(sat16(a), sat16(b)) | 0),
  _spacku4: i(2, (a, b) => bytes(clampU(h16(a), 255), clampU(s16(a), 255), clampU(h16(b), 255), clampU(s16(b), 255))),
  _sshvl: i(2, (a, n) => shiftSat(a, Math.max(-31, Math.min(31, n)))),
  _sshvr: i(2, (a, n) => shiftSat(a, -Math.max(-31, Math.min(31, n)))),
  _subabs4: i(2, (a, b) => perByte(a, b, (x, y) => Math.abs(x - y))),
  _abs2: i(1, (a) => pack(sat16(Math.abs(h16(a))), sat16(Math.abs(s16(a)))) | 0),
  _bitc4: i(1, (a) => perByte(a, 0, (x) => x.toString(2).split('1').length - 1)),
  _bitr: i(1, (a) => {
    let r = 0
    for (let k = 0; k < 32; k++) if (a & (1 << k)) r |= 1 << (31 - k)
    return r >>> 0
  }),
  _deal: i(1, (a) => {
    let r = 0
    for (let k = 0; k < 16; k++) {
      if (a & (1 << (2 * k))) r |= 1 << k
      if (a & (1 << (2 * k + 1))) r |= 1 << (16 + k)
    }
    return r >>> 0
  }),
  _shfl: i(1, (a) => {
    let r = 0
    for (let k = 0; k < 16; k++) {
      if (a & (1 << k)) r |= 1 << (2 * k)
      if (a & (1 << (16 + k))) r |= 1 << (2 * k + 1)
    }
    return r >>> 0
  }),
  _mvd: i(1, (a) => a),
  _swap4: i(1, (a) => (((a & 0x00ff00ff) << 8) | ((a >>> 8) & 0x00ff00ff)) >>> 0),
  _unpkhu4: i(1, (a) => (((a >>> 24) << 16) | ((a >>> 16) & 0xff)) >>> 0),
  _unpklu4: i(1, (a) => ((((a >>> 8) & 0xff) << 16) | (a & 0xff)) >>> 0),
  _xpnd2: i(1, (a) => ((a & 2 ? 0xffff0000 : 0) | (a & 1 ? 0xffff : 0)) >>> 0),
  _xpnd4: i(1, (a) => bytes(a & 8 ? 0xff : 0, a & 4 ? 0xff : 0, a & 2 ? 0xff : 0, a & 1 ? 0xff : 0)),
  _addsub: i(2, (a, b) => ll((a + b) | 0, (a - b) | 0)),
  _addsub2: i(2, (a, b) => ll(add2(a, b), sub2(a, b))),
  _saddsub: i(2, (a, b) => ll(sat32(a + b), sat32(a - b))),
  _saddsub2: i(2, (a, b) => ll(sadd2(a, b), ssub2(a, b))),
  _dpack2: i(2, (a, b) => ll(packh2(a, b), pack2(a, b))),
  _dmv: i(2, (a, b) => ll(a, b)),
  _fdmv: i(2, (a, b) => fromBits(floatBits(a), floatBits(b))),
  _mpy32ll: i(2, (a, b) => BigInt(a) * BigInt(b)),
  _mpy32: i(2, (a, b) => Math.imul(a, b)),
  _mpy32su: i(2, (a, b) => BigInt(a) * BigInt(b >>> 0)),
  _mpy32us: i(2, (a, b) => BigInt(a >>> 0) * BigInt(b)),
  _mpy32u: i(2, (a, b) => BigInt.asIntN(64, BigInt(a >>> 0) * BigInt(b >>> 0))),
  _smpy32: i(2, (a, b) => {
    const p = BigInt(a) * BigInt(b) * 2n
    return p > (1n << 63n) - 1n ? 0x7fffffff : Number(p >> 32n) | 0
  }),
  _ssub2: i(2, ssub2),
  _nassert: i(1, () => undefined)
}

/** Intrinsics whose exact C674x results LabSim cannot guarantee (Galois-field, complex and reciprocal-estimate
 * instructions): a program that uses one does not load, rather than getting a plausible but wrong value. */
export const UNSUPPORTED_INTRINSICS: ReadonlySet<string> = new Set([
  '_gmpy4', '_gmpy', '_xormpy', '_ddotph2', '_ddotph2r', '_ddotpl2', '_ddotpl2r', '_ddotp4', '_dpackx2', '_shfl3',
  '_mpy2ir', '_cmpy', '_cmpyr', '_cmpyr1', '_rpack2', '_rcpsp', '_rcpdp', '_rsqrsp', '_rsqrdp', '_dtol', '_ltod'
])
