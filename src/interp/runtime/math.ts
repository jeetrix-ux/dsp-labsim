import type { Machine } from '../exec/machine'
import { f2big, f2i } from '../exec/scalar'
import { EDOM, ERANGE, setErrno } from './errno'
import { fn, type LibFunction } from './types'

interface Precision {
  round: (v: number) => number
  max: number
  min: number
  expMax: number
  expMin: number
  float: boolean
}

const D: Precision = { round: (v) => v, max: 1.7976931348623157e308, min: 2.2250738585072014e-308, expMax: 709.782712893384, expMin: -708.3964185322641, float: false }
const F: Precision = { round: Math.fround, max: 3.4028234663852886e38, min: 1.1754943508222875e-38, expMax: 88.72283935546875, expMin: -87.33654475055311, float: true }

/** C round(): halves away from zero. */
const cRound = (x: number): number => {
  const t = Math.trunc(x)
  return Math.abs(x - t) >= 0.5 ? t + Math.sign(x) : t
}

/** rint()/nearbyint(): halves to even. */
const rint = (x: number): number => {
  if (!Number.isFinite(x)) return x
  const f = Math.floor(x)
  const d = x - f
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1
  return r === 0 ? (x < 0 ? -0 : 0) : r
}

function ldexp(input: number, exp: number): number {
  let x = input
  let n = Math.max(-2200, Math.min(2200, exp))
  if (!Number.isFinite(x) || x === 0) return x
  while (n > 1023) {
    x *= 2 ** 1023
    n -= 1023
  }
  while (n < -1022) {
    x *= 2 ** -1022
    n += 1022
  }
  return x * 2 ** n
}

function frexp(x: number): [number, number] {
  if (x === 0 || !Number.isFinite(x)) return [x, 0]
  let e = Math.floor(Math.log2(Math.abs(x))) + 1
  let f = ldexp(x, -e)
  while (Math.abs(f) < 0.5) {
    f *= 2
    e--
  }
  while (Math.abs(f) >= 1) {
    f /= 2
    e++
  }
  return [f, e]
}

function nextafter(x: number, y: number, p: Precision): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (x === y) return y
  const dv = new DataView(new ArrayBuffer(8))
  if (x === 0) return y > 0 ? (p.float ? 1.401298464324817e-45 : 5e-324) : p.float ? -1.401298464324817e-45 : -5e-324
  const up = (y > x) === (x > 0)
  if (p.float) {
    dv.setFloat32(0, x)
    dv.setInt32(0, dv.getInt32(0) + (up ? 1 : -1))
    return dv.getFloat32(0)
  }
  dv.setFloat64(0, x)
  dv.setBigInt64(0, dv.getBigInt64(0) + (up ? 1n : -1n))
  return dv.getFloat64(0)
}

function erfcLarge(x: number): number {
  let f = x
  for (let k = 60; k >= 1; k--) f = x + k / 2 / f
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f
}

function erf(x: number): number {
  if (Number.isNaN(x)) return x
  const ax = Math.abs(x)
  if (ax >= 2.5) return Math.sign(x) * (1 - erfcLarge(ax))
  let sum = x
  let term = x
  for (let n = 1; n < 200; n++) {
    term *= (-x * x) / n
    const t = term / (2 * n + 1)
    sum += t
    if (Math.abs(t) < 1e-17 * Math.abs(sum)) break
  }
  return (2 / Math.sqrt(Math.PI)) * sum
}

function erfc(x: number): number {
  if (Number.isNaN(x)) return x
  if (x < 0) return 2 - erfc(-x)
  return x < 2.5 ? 1 - erf(x) : erfcLarge(x)
}

/** log Γ(x) for x ≥ 15 by Stirling's series (Bernoulli terms B2k / (2k(2k−1) x^(2k−1))). */
function stirlingLog(x: number): number {
  const z = 1 / (x * x)
  const series =
    (1 / 12 + z * (-1 / 360 + z * (1 / 1260 + z * (-1 / 1680 + z * (1 / 1188 + z * (-691 / 360360 + z * (1 / 156 + z * (-3617 / 122400)))))))) / x
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + series
}

/** Γ(x) = Γ(x + n) / (x (x+1) … (x+n−1)), shifting x up to 15 where Stirling's series is exact to double precision. */
function tgamma(x: number): number {
  if (Number.isNaN(x)) return x
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * tgamma(1 - x))
  let y = x
  let prod = 1
  while (y < 15) {
    prod *= y
    y += 1
  }
  return Math.exp(stirlingLog(y)) / prod
}

function lgamma(x: number): number {
  if (Number.isNaN(x)) return x
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x)
  let y = x
  let prod = 1
  while (y < 15) {
    prod *= y
    y += 1
  }
  return stirlingLog(y) - Math.log(prod)
}

function logTI(m: Machine, x: number): number {
  if (x <= 0) {
    setErrno(m, x === 0 ? ERANGE : EDOM)
    return -Infinity
  }
  return Math.log(x)
}

function expTI(m: Machine, x: number, p: Precision): number {
  if (x < p.expMin) return 0
  if (x === Infinity) return Infinity
  if (x > p.expMax) {
    setErrno(m, ERANGE)
    return Infinity
  }
  return Math.exp(x)
}

const isOdd = (y: number): boolean => (Math.abs(y) < 2147483648 ? (y & 1) !== 0 : (y / 2) % 1 !== 0)

function powTI(m: Machine, x: number, y: number, p: Precision): number {
  if (x <= 0) {
    if (x < 0) {
      if (Math.trunc(y) !== y) {
        setErrno(m, EDOM)
        return powTI(m, x, cRound(y), p)
      }
      const z = powTI(m, -x, y, p)
      return isOdd(y) ? -z : z
    }
    if (y < 0) {
      setErrno(m, EDOM)
      return -p.max
    }
    return y === 0 ? 1 : x
  }
  if (x === 1 || y === 1) return x
  const r = Math.pow(x, y)
  if (r > p.max) {
    setErrno(m, ERANGE)
    return p.max
  }
  return r < p.min ? 0 : r
}

function atan2TI(m: Machine, y: number, x: number): number {
  let r: number
  if (x === 0) {
    if (y === 0) {
      setErrno(m, EDOM)
      return 0
    }
    r = Math.PI / 2
  } else {
    r = Math.atan(Math.abs(y / x))
    if (x < 0) r = Math.PI - r
  }
  return y < 0 ? -r : r
}

function classify(x: number, p: Precision): number {
  if (Number.isNaN(x)) return 2
  if (!Number.isFinite(x)) return 1
  if (x === 0) return 4
  return Math.abs(x) < p.min ? 5 : 3
}

const table: Record<string, LibFunction> = {}

/** Registers `name` (double) and `name` + 'f' (float, result rounded to single precision). */
function both(name: string, fixed: number, f: (m: Machine, a: any[], p: Precision) => any): void {
  table[name] = fn(fixed, (m, a) => f(m, a, D))
  table[`${name}f`] = fn(fixed, (m, a) => {
    const r = f(m, a, F)
    return typeof r === 'number' ? Math.fround(r) : r
  })
}

const unary = (name: string, f: (m: Machine, x: number, p: Precision) => number): void => both(name, 1, (m, [x], p) => f(m, x, p))
const binary = (name: string, f: (m: Machine, x: number, y: number, p: Precision) => number): void => both(name, 2, (m, [x, y], p) => f(m, x, y, p))

unary('sqrt', (m, x) => {
  if (x === Infinity || x === -Infinity) return x
  if (x <= 0) {
    if (x === 0) return 0
    setErrno(m, EDOM)
    return 0
  }
  return Math.sqrt(x)
})
unary('log', (m, x) => logTI(m, x))
unary('log10', (m, x) => (logTI(m, x) === -Infinity ? -Infinity : Math.log10(x)))
unary('log2', (m, x) => (logTI(m, x) === -Infinity ? -Infinity : Math.log2(x)))
unary('exp', (m, x, p) => expTI(m, x, p))
unary('exp2', (m, x, p) => expTI(m, x * Math.LN2, p))
unary('asin', (m, x) => {
  if (x > 1 || x < -1) {
    setErrno(m, EDOM)
    return Math.asin(x > 0 ? 1 : -1)
  }
  return Math.asin(x)
})
unary('acos', (m, x) => {
  if (x > 1 || x < -1) {
    setErrno(m, EDOM)
    return Math.acos(x > 0 ? 1 : -1)
  }
  return Math.acos(x)
})
unary('cosh', (m, x, p) => {
  const r = Math.cosh(x)
  if (r > p.max) {
    setErrno(m, EDOM)
    return x < 0 ? -Infinity : Infinity
  }
  return r
})
unary('sinh', (m, x, p) => {
  const r = Math.sinh(x)
  if (Math.abs(r) > p.max) setErrno(m, EDOM)
  return r
})
for (const [name, f] of Object.entries({
  sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, tanh: Math.tanh, ceil: Math.ceil, floor: Math.floor,
  fabs: Math.abs, acosh: Math.acosh, asinh: Math.asinh, atanh: Math.atanh, cbrt: Math.cbrt, expm1: Math.expm1,
  log1p: Math.log1p, trunc: Math.trunc, round: cRound, rint, nearbyint: rint, erf, erfc, tgamma, lgamma
})) unary(name, (_m, x) => f(x))
unary('logb', (_m, x) => (x === 0 ? -Infinity : !Number.isFinite(x) ? Math.abs(x) : frexp(x)[1] - 1))
binary('pow', (m, x, y, p) => powTI(m, x, y, p))
binary('atan2', (m, y, x) => atan2TI(m, y, x))
binary('fmod', (m, x, y) => {
  if (y === 0) {
    setErrno(m, EDOM)
    return 0
  }
  return x % y
})
binary('copysign', (_m, x, y) => (Object.is(y, -0) || y < 0 ? -Math.abs(x) : Math.abs(x)))
binary('fdim', (_m, x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : x > y ? x - y : 0))
binary('fmax', (_m, x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.max(x, y)))
binary('fmin', (_m, x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y)))
binary('hypot', (_m, x, y) => Math.hypot(x, y))
binary('nextafter', (_m, x, y, p) => nextafter(x, y, p))
binary('remainder', (_m, x, y) => x - y * rint(x / y))
both('fma', 3, (_m, [x, y, z]) => x * y + z)
both('frexp', 2, (m, [x, e]) => {
  const [f, n] = frexp(x)
  m.mem.set32(e, n)
  return f
})
both('ldexp', 2, (_m, [x, n]) => ldexp(x, n))
both('scalbn', 2, (_m, [x, n]) => ldexp(x, n))
both('scalbln', 2, (_m, [x, n]) => ldexp(x, n))
both('modf', 2, (m, [x, ip], p) => {
  const t = Math.trunc(x)
  if (p.float) m.mem.setF32(ip, t)
  else m.mem.setF64(ip, t)
  return Number.isFinite(x) ? x - t : x === x ? 0 : x
})
both('remquo', 3, (m, [x, y, quo]) => {
  const n = rint(x / y)
  m.mem.set32(quo, Number.isFinite(n) ? (Math.abs(n) % 8) * Math.sign(n) : 0)
  return x - y * n
})
both('nan', 1, () => NaN)
both('ilogb', 1, (_m, [x]) => (x === 0 || Number.isNaN(x) ? -2147483648 : !Number.isFinite(x) ? 2147483647 : frexp(x)[1] - 1))
both('lrint', 1, (_m, [x]) => f2i(rint(x)))
both('lround', 1, (_m, [x]) => f2i(cRound(x)))
both('llrint', 1, (_m, [x]) => f2big(rint(x), 64, true))
both('llround', 1, (_m, [x]) => f2big(cRound(x), 64, true))
both('__signbit', 1, (_m, [x]) => (x < 0 || Object.is(x, -0) ? 1 : 0))
for (const suffix of ['', 'f', 'l']) {
  const p = suffix === 'f' ? F : D
  table[`__fpclassify${suffix}`] = fn(1, (_m, [x]) => classify(x, p))
  table[`__isfinite${suffix}`] = fn(1, (_m, [x]) => (Number.isFinite(x) ? 1 : 0))
  table[`__isinf${suffix}`] = fn(1, (_m, [x]) => (x === Infinity || x === -Infinity ? 1 : 0))
  table[`__isnan${suffix}`] = fn(1, (_m, [x]) => (Number.isNaN(x) ? 1 : 0))
  table[`__isnormal${suffix}`] = fn(1, (_m, [x]) => (classify(x, p) === 3 ? 1 : 0))
}

export const MATH: Readonly<Record<string, LibFunction>> = table
