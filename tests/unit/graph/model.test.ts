import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROPS, decode, fitView, fmtNum, fmtTick, fromDraft, fromSettingsFile, nearestSample, niceTicks, plotValue, pushSamples, readSpan,
  toCsv, toDat, toDraft, toSettingsFile, validateProps, xLabel, xValue, zoomView, type GraphProps
} from '../../../src/renderer/src/graph/model'

const props = (over: Partial<GraphProps>): GraphProps => ({ ...DEFAULT_PROPS, ...over })

function bytes(size: number, write: (v: DataView) => void): number[] {
  const v = new DataView(new ArrayBuffer(size))
  write(v)
  return [...new Uint8Array(v.buffer)]
}

describe('properties', () => {
  it('has CCS defaults', () => {
    expect(DEFAULT_PROPS).toEqual({
      acquisitionBufferSize: 1, dspDataType: '32 bit signed integer', indexIncrement: 1, interleavedDataSources: false, qValue: 0,
      samplingRateHz: 1, startAddress: '', axisDisplay: true, dataPlotStyle: 'Line', displayDataSize: 100, gridStyle: 'Major Grid',
      magnitudeDisplayScale: 'Linear', timeDisplayUnit: 'sample', useDcValueForGraph: false, dcValue: 0
    })
    expect(validateProps(DEFAULT_PROPS)).toBeNull()
  })

  it('parses and validates drafts', () => {
    const d = toDraft(DEFAULT_PROPS)
    expect(d.acquisitionBufferSize).toBe('1')
    expect(d.axisDisplay).toBe('true')
    expect(fromDraft({ ...d, acquisitionBufferSize: ' 128 ', dspDataType: '32 BIT FLOATING POINT', startAddress: ' &x[4] ' })).toEqual({
      props: props({ acquisitionBufferSize: 128, dspDataType: '32 bit floating point', startAddress: '&x[4]' })
    })
    expect(fromDraft({ ...d, acquisitionBufferSize: '0' })).toEqual({ error: 'Acquisition Buffer Size must be a whole number from 1 to 65536' })
    expect(fromDraft({ ...d, qValue: '1.5' })).toEqual({ error: 'Q_Value must be a whole number from 0 to 31' })
    expect(fromDraft({ ...d, samplingRateHz: '0' })).toEqual({ error: 'Sampling Rate Hz must be a number greater than 0' })
    expect(fromDraft({ ...d, dcValue: 'abc' })).toEqual({ error: 'Dc Value must be a number' })
    expect(fromDraft({ ...d, axisDisplay: 'yes' })).toEqual({ error: 'Axis Display must be true or false' })
    expect(fromDraft({ ...d, gridStyle: 'Dotted' })).toEqual({ error: 'Grid Style must be one of: No Grid, Minor Grid, Major Grid' })
    expect(validateProps(props({ acquisitionBufferSize: 65536, indexIncrement: 4, dspDataType: '64 bit floating point' }))).toMatch(/limit is 1048576 bytes/)
  })

  it('writes and reads settings files', () => {
    const p = props({ startAddress: 'buf+2', acquisitionBufferSize: 64, dspDataType: '16 bit signed integer', qValue: 15, gridStyle: 'Minor Grid' })
    const text = toSettingsFile(p)
    expect(text).toContain('Start Address=buf+2\n')
    expect(text).toContain('Dsp Data Type=16 bit signed integer\n')
    expect(fromSettingsFile(text)).toEqual({ props: p })
    expect(fromSettingsFile('# comment\r\nq_value = 3\r\nUnknown=1\r\n')).toEqual({ props: props({ qValue: 3 }) })
    expect(fromSettingsFile('hello')).toEqual({ error: 'This file has no graph properties.' })
    expect(fromSettingsFile('Q_Value=99')).toEqual({ error: 'Q_Value must be a whole number from 0 to 31' })
  })
})

describe('decoding', () => {
  it('reads the span the acquisition needs', () => {
    expect(readSpan(props({ acquisitionBufferSize: 4, indexIncrement: 2, dspDataType: '32 bit floating point' }))).toBe(28)
    expect(readSpan(props({ acquisitionBufferSize: 3, dspDataType: '8 bit unsigned integer' }))).toBe(3)
  })

  it('decodes little-endian data with Q scaling for integer types', () => {
    const s16 = bytes(4, (v) => { v.setInt16(0, -2, true); v.setInt16(2, 3, true) })
    expect(decode(s16, props({ acquisitionBufferSize: 2, dspDataType: '16 bit signed integer', qValue: 1 }))).toEqual([-1, 1.5])
    expect(decode([255], props({ dspDataType: '8 bit unsigned integer' }))).toEqual([255])
    expect(decode([255], props({ dspDataType: '8 bit signed integer' }))).toEqual([-1])
    expect(decode(bytes(4, (v) => v.setUint32(0, 0xffffffff, true)), props({ dspDataType: '32 bit unsigned integer' }))).toEqual([4294967295])
    expect(decode(bytes(8, (v) => v.setBigInt64(0, -5n, true)), props({ dspDataType: '64 bit signed integer' }))).toEqual([-5])
    expect(decode(bytes(8, (v) => v.setFloat64(0, 0.1, true)), props({ dspDataType: '64 bit floating point', qValue: 3 }))).toEqual([0.1])
    const f32 = bytes(16, (v) => [0.5, 1, 2, 4.5].forEach((x, i) => v.setFloat32(i * 4, x, true)))
    expect(decode(f32, props({ acquisitionBufferSize: 2, indexIncrement: 2, dspDataType: '32 bit floating point' }))).toEqual([0.5, 2])
  })

  it('scrolls the display buffer', () => {
    let b: number[] = []
    for (const v of [1, 2, 3, 4]) b = pushSamples(b, [v], 3)
    expect(b).toEqual([2, 3, 4])
    expect(pushSamples([1], [2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })
})

describe('axes', () => {
  it('maps samples to time units', () => {
    const p = props({ samplingRateHz: 8000, timeDisplayUnit: 'ms' })
    expect(xValue(8, p)).toBeCloseTo(1)
    expect(xLabel(p)).toBe('Time (ms)')
    expect(xLabel(DEFAULT_PROPS)).toBe('Sample')
    expect(nearestSample(1.06, p, 100)).toBe(8)
    expect(nearestSample(-3, DEFAULT_PROPS, 10)).toBe(0)
    expect(nearestSample(3, DEFAULT_PROPS, 0)).toBeNull()
  })

  it('fits, pads and zooms the view', () => {
    const p = props({ displayDataSize: 4 })
    const v = fitView([0, 0.5, 2, 4.5], p)
    expect(v.x0).toBe(0)
    expect(v.x1).toBe(3)
    expect(v.y0).toBeCloseTo(-0.225)
    expect(v.y1).toBeCloseTo(4.725)
    expect(fitView([], p)).toMatchObject({ y0: -1.1, y1: 1.1 })
    const dc = fitView([1, 3], props({ useDcValueForGraph: true, dcValue: 1, displayDataSize: 2 }))
    expect((dc.y0 + dc.y1) / 2).toBeCloseTo(1)
    expect(zoomView({ x0: 0, x1: 10, y0: -2, y1: 2 }, 0.5)).toEqual({ x0: 2.5, x1: 7.5, y0: -1, y1: 1 })
  })

  it('plots log magnitude in dB', () => {
    const p = props({ magnitudeDisplayScale: 'Log' })
    expect(plotValue(-100, p)).toBeCloseTo(40)
    expect(plotValue(0, p)).toBeNaN()
    expect(plotValue(-100, DEFAULT_PROPS)).toBe(-100)
  })

  it('chooses nice ticks and labels', () => {
    expect(niceTicks(0, 99, 5)).toEqual({ ticks: [0, 20, 40, 60, 80], step: 20 })
    expect(niceTicks(-1.1, 1.1, 4)).toEqual({ ticks: [-1, -0.5, 0, 0.5, 1], step: 0.5 })
    expect(fmtTick(0.5, 0.5)).toBe('0.5')
    expect(fmtTick(40, 20)).toBe('40')
    expect(fmtTick(2e7, 1e7)).toBe('2.00e+7')
    expect(fmtNum(0.10000000149011612)).toBe('0.1')
    expect(fmtNum(2147483647)).toBe('2147483647')
  })
})

describe('saved data', () => {
  it('writes CSV with the x unit', () => {
    expect(toCsv([0, 0.5], DEFAULT_PROPS)).toBe('Sample,Value\r\n0,0\r\n1,0.5\r\n')
    expect(toCsv([0.10000000149011612], props({ dspDataType: '32 bit floating point', samplingRateHz: 1000, timeDisplayUnit: 'ms' }))).toBe('Time (ms),Value\r\n0,0.100000001\r\n')
  })

  it('writes CCS .dat files', () => {
    expect(toDat([1, -2], DEFAULT_PROPS, 0x80001000)).toBe('1651 4 80001000 0 2\r\n1\r\n-2\r\n')
  })
})
