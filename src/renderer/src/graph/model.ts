/** The Single Time graph's properties and the pure maths behind it (no DOM). */

export const DSP_DATA_TYPES = [
  '8 bit signed integer',
  '8 bit unsigned integer',
  '16 bit signed integer',
  '16 bit unsigned integer',
  '32 bit signed integer',
  '32 bit unsigned integer',
  '64 bit signed integer',
  '64 bit unsigned integer',
  '32 bit floating point',
  '64 bit floating point'
] as const
export type DspDataType = (typeof DSP_DATA_TYPES)[number]
export const PLOT_STYLES = ['Line', 'Bar'] as const
export const GRID_STYLES = ['No Grid', 'Minor Grid', 'Major Grid'] as const
export const SCALES = ['Linear', 'Log'] as const
export const TIME_UNITS = ['sample', 's', 'ms', 'us'] as const

export interface GraphProps {
  acquisitionBufferSize: number
  dspDataType: DspDataType
  indexIncrement: number
  interleavedDataSources: boolean
  qValue: number
  samplingRateHz: number
  startAddress: string
  axisDisplay: boolean
  dataPlotStyle: (typeof PLOT_STYLES)[number]
  displayDataSize: number
  gridStyle: (typeof GRID_STYLES)[number]
  magnitudeDisplayScale: (typeof SCALES)[number]
  timeDisplayUnit: (typeof TIME_UNITS)[number]
  useDcValueForGraph: boolean
  dcValue: number
}

export const DEFAULT_PROPS: GraphProps = {
  acquisitionBufferSize: 1,
  dspDataType: '32 bit signed integer',
  indexIncrement: 1,
  interleavedDataSources: false,
  qValue: 0,
  samplingRateHz: 1,
  startAddress: '',
  axisDisplay: true,
  dataPlotStyle: 'Line',
  displayDataSize: 100,
  gridStyle: 'Major Grid',
  magnitudeDisplayScale: 'Linear',
  timeDisplayUnit: 'sample',
  useDcValueForGraph: false,
  dcValue: 0
}

type Key = keyof GraphProps

export interface PropSpec {
  key: Key
  label: string
  group: 'Data' | 'Display'
  kind: 'int' | 'number' | 'positive' | 'bool' | 'enum' | 'text'
  options?: readonly string[]
  min?: number
  max?: number
  /** Shown in the dialog only while this property is true. */
  when?: Key
}

export const MAX_ELEMENTS = 65536
/** Bytes one refresh may read. */
export const MAX_READ = 1 << 20

/** The dialog's rows, in CCS's order. */
export const PROPS: PropSpec[] = [
  { key: 'acquisitionBufferSize', label: 'Acquisition Buffer Size', group: 'Data', kind: 'int', min: 1, max: MAX_ELEMENTS },
  { key: 'dspDataType', label: 'Dsp Data Type', group: 'Data', kind: 'enum', options: DSP_DATA_TYPES },
  { key: 'indexIncrement', label: 'Index Increment', group: 'Data', kind: 'int', min: 1, max: MAX_ELEMENTS },
  { key: 'interleavedDataSources', label: 'Interleaved Data Sources', group: 'Data', kind: 'bool' },
  { key: 'qValue', label: 'Q_Value', group: 'Data', kind: 'int', min: 0, max: 31 },
  { key: 'samplingRateHz', label: 'Sampling Rate Hz', group: 'Data', kind: 'positive' },
  { key: 'startAddress', label: 'Start Address', group: 'Data', kind: 'text' },
  { key: 'axisDisplay', label: 'Axis Display', group: 'Display', kind: 'bool' },
  { key: 'dataPlotStyle', label: 'Data Plot Style', group: 'Display', kind: 'enum', options: PLOT_STYLES },
  { key: 'displayDataSize', label: 'Display Data Size', group: 'Display', kind: 'int', min: 1, max: MAX_ELEMENTS },
  { key: 'gridStyle', label: 'Grid Style', group: 'Display', kind: 'enum', options: GRID_STYLES },
  { key: 'magnitudeDisplayScale', label: 'Magnitude Display Scale', group: 'Display', kind: 'enum', options: SCALES },
  { key: 'timeDisplayUnit', label: 'Time Display Unit', group: 'Display', kind: 'enum', options: TIME_UNITS },
  { key: 'useDcValueForGraph', label: 'Use Dc Value For Graph', group: 'Display', kind: 'bool' },
  { key: 'dcValue', label: 'Dc Value', group: 'Display', kind: 'number', when: 'useDcValueForGraph' }
]

/** The dialog's text for each property (booleans as 'true' / 'false'). */
export type Draft = Record<Key, string>

export function toDraft(p: GraphProps): Draft {
  const d = {} as Draft
  for (const s of PROPS) d[s.key] = String(p[s.key])
  return d
}

function parseField(s: PropSpec, raw: string): { value: unknown } | { error: string } {
  const text = raw.trim()
  const n = text === '' ? NaN : Number(text)
  switch (s.kind) {
    case 'int':
      return Number.isInteger(n) && n >= (s.min ?? -Infinity) && n <= (s.max ?? Infinity)
        ? { value: n }
        : { error: `${s.label} must be a whole number from ${s.min} to ${s.max}` }
    case 'positive':
      return Number.isFinite(n) && n > 0 ? { value: n } : { error: `${s.label} must be a number greater than 0` }
    case 'number':
      return Number.isFinite(n) ? { value: n } : { error: `${s.label} must be a number` }
    case 'bool':
      return /^(true|false)$/i.test(text) ? { value: text.toLowerCase() === 'true' } : { error: `${s.label} must be true or false` }
    case 'enum': {
      const option = s.options?.find((o) => o.toLowerCase() === text.toLowerCase())
      return option ? { value: option } : { error: `${s.label} must be one of: ${s.options?.join(', ')}` }
    }
    default:
      return { value: text }
  }
}

export function fromDraft(d: Draft): { props: GraphProps } | { error: string } {
  const p = { ...DEFAULT_PROPS } as Record<Key, unknown>
  for (const s of PROPS) {
    const r = parseField(s, d[s.key] ?? '')
    if ('error' in r) return r
    p[s.key] = r.value
  }
  const props = p as unknown as GraphProps
  const span = readSpan(props)
  if (span > MAX_READ) {
    return { error: `The graph would read ${span} bytes per refresh; the limit is ${MAX_READ} bytes (lower Acquisition Buffer Size or Index Increment)` }
  }
  return { props }
}

export function validateProps(p: GraphProps): string | null {
  const r = fromDraft(toDraft(p))
  return 'error' in r ? r.error : null
}

export function typeInfo(t: DspDataType): { size: number; float: boolean; signed: boolean } {
  return { size: Number(t.split(' ')[0]) / 8, float: t.endsWith('floating point'), signed: !t.includes('unsigned') }
}

/** Bytes from the Start Address to the end of the last element one refresh reads. */
export function readSpan(p: GraphProps): number {
  return ((p.acquisitionBufferSize - 1) * p.indexIncrement + 1) * typeInfo(p.dspDataType).size
}

/** The C6748 is little-endian; integer types are scaled by 2^-Q. */
export function decode(bytes: ArrayLike<number>, p: GraphProps): number[] {
  const { size, float, signed } = typeInfo(p.dspDataType)
  const view = new DataView(Uint8Array.from(bytes).buffer)
  const scale = float ? 1 : 2 ** p.qValue
  const out: number[] = []
  for (let i = 0; i < p.acquisitionBufferSize; i++) {
    const at = i * p.indexIncrement * size
    let v: number
    if (size === 1) v = signed ? view.getInt8(at) : view.getUint8(at)
    else if (size === 2) v = signed ? view.getInt16(at, true) : view.getUint16(at, true)
    else if (size === 4) v = float ? view.getFloat32(at, true) : signed ? view.getInt32(at, true) : view.getUint32(at, true)
    else v = float ? view.getFloat64(at, true) : Number(signed ? view.getBigInt64(at, true) : view.getBigUint64(at, true))
    out.push(v / scale)
  }
  return out
}

/** Appends a refresh's samples and keeps the newest `size` (CCS's scrolling display buffer). */
export function pushSamples(buffer: number[], samples: number[], size: number): number[] {
  const all = buffer.concat(samples)
  return all.length > size ? all.slice(all.length - size) : all
}

/** The y value drawn for a sample: the sample, or its magnitude in dB on the Log scale (NaN for 0). */
export function plotValue(v: number, p: GraphProps): number {
  if (p.magnitudeDisplayScale === 'Linear') return v
  return Math.abs(v) < 1e-30 ? NaN : 20 * Math.log10(Math.abs(v))
}

const UNIT_SCALE = { sample: 1, s: 1, ms: 1e3, us: 1e6 } as const

export function xValue(i: number, p: GraphProps): number {
  return p.timeDisplayUnit === 'sample' ? i : (i / p.samplingRateHz) * UNIT_SCALE[p.timeDisplayUnit]
}

export function xLabel(p: GraphProps): string {
  return p.timeDisplayUnit === 'sample' ? 'Sample' : `Time (${p.timeDisplayUnit})`
}

/** The buffer index nearest to x, or null for an empty buffer. */
export function nearestSample(x: number, p: GraphProps, length: number): number | null {
  if (length === 0) return null
  const i = p.timeDisplayUnit === 'sample' ? x : (x / UNIT_SCALE[p.timeDisplayUnit]) * p.samplingRateHz
  return Math.min(length - 1, Math.max(0, Math.round(i)))
}

export interface View {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** The whole display buffer on x; the data (or ±1) on y with a 5% margin, centred on Dc Value when it is used. */
export function fitView(buffer: number[], p: GraphProps): View {
  const n = Math.max(p.displayDataSize, 2)
  let lo = Infinity
  let hi = -Infinity
  for (const v of buffer) {
    const y = plotValue(v, p)
    if (!Number.isFinite(y)) continue
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  if (lo > hi) {
    lo = -1
    hi = 1
  }
  if (p.useDcValueForGraph && p.magnitudeDisplayScale === 'Linear') {
    const r = Math.max(Math.abs(hi - p.dcValue), Math.abs(lo - p.dcValue)) || 1
    lo = p.dcValue - r
    hi = p.dcValue + r
  }
  if (lo === hi) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.05
  // Stems sit on the samples, so leave half a sample either side or the first and last hide under the frame.
  const edge = p.dataPlotStyle === 'Bar' ? 0.5 : 0
  return { x0: xValue(0 - edge, p), x1: xValue(n - 1 + edge, p), y0: lo - pad, y1: hi + pad }
}

/** Scales the view about its centre (factor < 1 zooms in). */
export function zoomView(v: View, factor: number): View {
  const cx = (v.x0 + v.x1) / 2
  const cy = (v.y0 + v.y1) / 2
  return { x0: cx - (cx - v.x0) * factor, x1: cx + (v.x1 - cx) * factor, y0: cy - (cy - v.y0) * factor, y1: cy + (v.y1 - cy) * factor }
}

export function ticksEvery(lo: number, hi: number, step: number): number[] {
  const out: number[] = []
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && out.length < 1000; k++) out.push(Number((k * step).toPrecision(12)))
  return out
}

/** About `count` ticks at a 1/2/5 × 10^k step. */
export function niceTicks(lo: number, hi: number, count: number): { ticks: number[]; step: number } {
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(span)) return { ticks: [lo], step: 1 }
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
  return { ticks: ticksEvery(lo, hi, step), step }
}

export function fmtTick(v: number, step: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-4) return v.toExponential(2)
  return v.toFixed(Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))))
}

/** A value with at most `digits` significant digits; integers in full. */
export function fmtNum(v: number, digits = 7): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(digits)))
}

/** Digits that round-trip the data type (9 for float, 17 otherwise). */
const savedDigits = (p: GraphProps): number => (p.dspDataType === '32 bit floating point' ? 9 : 17)

export function toCsv(buffer: number[], p: GraphProps): string {
  const rows = buffer.map((v, i) => `${fmtNum(xValue(i, p), 12)},${fmtNum(v, savedDigits(p))}`)
  return [`${xLabel(p)},Value`, ...rows].join('\r\n') + '\r\n'
}

/** CCS data file: `1651 <format 4 = float> <start address> <page 0> <count>`, both numbers in hex. */
export function toDat(buffer: number[], p: GraphProps, address: number | null): string {
  const head = `1651 4 ${(address ?? 0).toString(16).padStart(8, '0')} 0 ${buffer.length.toString(16)}`
  return [head, ...buffer.map((v) => fmtNum(v, savedDigits(p)))].join('\r\n') + '\r\n'
}

export const SETTINGS_HEADER = '# DSP LabSim Single Time graph properties'

export function toSettingsFile(p: GraphProps): string {
  const d = toDraft(p)
  return [SETTINGS_HEADER, ...PROPS.map((s) => `${s.label}=${d[s.key]}`)].join('\n') + '\n'
}

/** Reads `Label=value` lines (any case, `#` comments); missing properties keep their defaults. */
export function fromSettingsFile(text: string): { props: GraphProps } | { error: string } {
  const d = toDraft(DEFAULT_PROPS)
  let found = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const eq = line.indexOf('=')
    if (!line || line.startsWith('#') || eq < 0) continue
    const label = line.slice(0, eq).trim().toLowerCase()
    const spec = PROPS.find((s) => s.label.toLowerCase() === label)
    if (!spec) continue
    d[spec.key] = line.slice(eq + 1).trim()
    found++
  }
  return found === 0 ? { error: 'This file has no graph properties.' } : fromDraft(d)
}
