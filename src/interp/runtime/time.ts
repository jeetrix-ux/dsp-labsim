import type { Machine } from '../exec/machine'
import { CYCLES_PER_STATEMENT } from '../exec/machine'
import { fn, state, type LibFunction } from './types'

/** Seconds between 1900-01-01 (TI's time_t epoch) and 1970-01-01. */
const EPOCH_1900 = 2208988800
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The static buffers gmtime/localtime and asctime/ctime return. */
const buffers = state((m) => ({ tm: m.placement.alloc(36, 4), text: m.placement.alloc(32, 1) }))

interface Tm {
  sec: number
  min: number
  hour: number
  mday: number
  mon: number
  year: number
  wday: number
  yday: number
  isdst: number
}

function readTm(m: Machine, p: number): Tm {
  const f = (i: number): number => m.mem.i32(p + 4 * i)
  return { sec: f(0), min: f(1), hour: f(2), mday: f(3), mon: f(4), year: f(5), wday: f(6), yday: f(7), isdst: f(8) }
}

function writeTm(m: Machine, p: number, t: Tm): void {
  ;[t.sec, t.min, t.hour, t.mday, t.mon, t.year, t.wday, t.yday, t.isdst].forEach((v, i) => m.mem.set32(p + 4 * i, v))
}

function toTm(t: number): Tm {
  const d = new Date(((t >>> 0) - EPOCH_1900) * 1000)
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  return {
    sec: d.getUTCSeconds(),
    min: d.getUTCMinutes(),
    hour: d.getUTCHours(),
    mday: d.getUTCDate(),
    mon: d.getUTCMonth(),
    year: d.getUTCFullYear() - 1900,
    wday: d.getUTCDay(),
    yday: Math.floor((d.getTime() - start) / 86400000),
    isdst: 0
  }
}

const two = (n: number): string => String(n).padStart(2, '0')

function asctime(t: Tm): string {
  return `${DAYS[t.wday] ?? '???'} ${MONTHS[t.mon] ?? '???'} ${String(t.mday).padStart(2, ' ')} ${two(t.hour)}:${two(t.min)}:${two(t.sec)} ${t.year + 1900}\n`
}

function strftime(fmt: string, t: Tm): string {
  return fmt.replace(/%(.)/g, (all, c: string) => {
    switch (c) {
      case 'a': return DAYS[t.wday] ?? ''
      case 'A': return FULL_DAYS[t.wday] ?? ''
      case 'b': return MONTHS[t.mon] ?? ''
      case 'B': return FULL_MONTHS[t.mon] ?? ''
      case 'c': return asctime(t).slice(0, -1)
      case 'd': return two(t.mday)
      case 'H': return two(t.hour)
      case 'I': return two(t.hour % 12 === 0 ? 12 : t.hour % 12)
      case 'j': return String(t.yday + 1).padStart(3, '0')
      case 'm': return two(t.mon + 1)
      case 'M': return two(t.min)
      case 'p': return t.hour < 12 ? 'AM' : 'PM'
      case 'S': return two(t.sec)
      case 'w': return String(t.wday)
      case 'x': return `${two(t.mon + 1)}/${two(t.mday)}/${two(t.year % 100)}`
      case 'X': return `${two(t.hour)}:${two(t.min)}:${two(t.sec)}`
      case 'y': return two(t.year % 100)
      case 'Y': return String(t.year + 1900)
      case 'Z': return 'GMT'
      case '%': return '%'
      default: return all
    }
  })
}

function writeString(m: Machine, p: number, s: string): void {
  m.mem.write(p, [...s].map((c) => c.charCodeAt(0) & 0xff))
  m.mem.set8(p + s.length, 0)
}

function convert(m: Machine, tp: number): number {
  if (tp === 0) return 0
  const b = buffers(m)
  writeTm(m, b.tm, toTm(m.mem.u32(tp)))
  return b.tm
}

export const TIME: Record<string, LibFunction> = {
  clock: fn(0, (m) => {
    m.note('clock', `clock() gives an estimated cycle count (${CYCLES_PER_STATEMENT} cycles per C statement), not the C674x's real timing.`)
    return m.cycles >>> 0
  }),
  time: fn(1, (m, [tp]) => {
    const t = (Math.floor(Date.now() / 1000) + EPOCH_1900) >>> 0
    if (tp !== 0) m.mem.set32(tp, t)
    return t
  }),
  difftime: fn(2, (_m, [a, b]) => (a >>> 0) - (b >>> 0)),
  gmtime: fn(1, (m, [tp]) => convert(m, tp)),
  localtime: fn(1, (m, [tp]) => convert(m, tp)),
  mktime: fn(1, (m, [p]) => {
    const t = readTm(m, p)
    const ms = Date.UTC(t.year + 1900, t.mon, t.mday, t.hour, t.min, t.sec)
    const secs = (Math.floor(ms / 1000) + EPOCH_1900) >>> 0
    writeTm(m, p, toTm(secs))
    return secs
  }),
  asctime: fn(1, (m, [p]) => {
    const b = buffers(m)
    writeString(m, b.text, asctime(readTm(m, p)))
    return b.text
  }),
  ctime: fn(1, (m, [tp]) => {
    const b = buffers(m)
    writeString(m, b.text, asctime(toTm(m.mem.u32(tp))))
    return b.text
  }),
  strftime: fn(4, (m, [buf, max, fmt, p]) => {
    const s = strftime(m.mem.cstring(fmt), readTm(m, p))
    if (s.length + 1 > max >>> 0) return 0
    writeString(m, buf, s)
    return s.length
  })
}
