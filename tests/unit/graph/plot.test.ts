import { describe, expect, it } from 'vitest'
import { DEFAULT_PROPS, type GraphProps } from '../../../src/renderer/src/graph/model'
import { COLORS, drawGraph, fromPx, layoutFor, toPx, type Ctx2D } from '../../../src/renderer/src/graph/plot'

/** Records calls and the style in force at each call. */
function recorder() {
  const calls: { op: string; args: unknown[]; strokeStyle: unknown; fillStyle: unknown }[] = []
  const ctx: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic' }
  for (const op of ['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText', 'save', 'restore', 'rect', 'clip', 'setLineDash']) {
    ctx[op] = (...args: unknown[]) => calls.push({ op, args, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle })
  }
  return { ctx: ctx as unknown as Ctx2D, calls }
}

const props = (over: Partial<GraphProps>): GraphProps => ({ ...DEFAULT_PROPS, displayDataSize: 4, ...over })
const view = { x0: 0, x1: 3, y0: -1, y1: 5 }

describe('plot', () => {
  it('maps values to pixels and back', () => {
    const r = layoutFor(400, 300, true)
    expect(r).toEqual({ left: 64, top: 10, right: 386, bottom: 264 })
    const [px, py] = toPx(r, view, 1.5, 2)
    expect(px).toBeCloseTo(225)
    expect(py).toBeCloseTo(137)
    const [x, y] = fromPx(r, view, px, py)
    expect(x).toBeCloseTo(1.5)
    expect(y).toBeCloseTo(2)
    expect(layoutFor(400, 300, false)).toEqual({ left: 4, top: 4, right: 396, bottom: 296 })
  })

  it('draws a blue line through every sample, with axes and a grid', () => {
    const { ctx, calls } = recorder()
    const n = drawGraph(ctx, { buffer: [0, 0.5, 2, 4.5], props: props({}), view, width: 400, height: 300 })
    expect(n).toBe(4)
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 400, 300], fillStyle: COLORS.background })
    expect(calls.filter((c) => c.op === 'lineTo' && c.strokeStyle === COLORS.trace)).toHaveLength(3)
    expect(calls.some((c) => c.op === 'stroke' && c.strokeStyle === COLORS.major)).toBe(true)
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toContain('Sample')
  })

  it('breaks the line at gaps and hides axes and grid on request', () => {
    const { ctx, calls } = recorder()
    const n = drawGraph(ctx, {
      buffer: [1, 0, 100, 10],
      props: props({ magnitudeDisplayScale: 'Log', axisDisplay: false, gridStyle: 'No Grid' }),
      view: { x0: 0, x1: 3, y0: -10, y1: 50 },
      width: 200,
      height: 100
    })
    expect(n).toBe(3)
    expect(calls.filter((c) => c.op === 'moveTo' && c.strokeStyle === COLORS.trace)).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(0)
    expect(calls.some((c) => c.strokeStyle === COLORS.major || c.strokeStyle === COLORS.minor)).toBe(false)
  })

  it('draws bars, the minor grid and the DC reference line', () => {
    const { ctx, calls } = recorder()
    drawGraph(ctx, {
      buffer: [1, 2, 3],
      props: props({ dataPlotStyle: 'Bar', gridStyle: 'Minor Grid', useDcValueForGraph: true, dcValue: 2 }),
      view,
      width: 400,
      height: 300
    })
    const stems = calls.filter((c) => c.op === 'fillRect' && c.fillStyle === COLORS.trace)
    expect(stems).toHaveLength(3)
    // Thin stems (a discrete-value plot), not wide bars, however far apart the samples are.
    expect(stems.map((c) => c.args[2])).toEqual([2, 2, 2])
    expect(calls.some((c) => c.op === 'stroke' && c.strokeStyle === COLORS.minor)).toBe(true)
    expect(calls.some((c) => c.op === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(true)
  })

  it('marks a lone sample', () => {
    const { ctx, calls } = recorder()
    expect(drawGraph(ctx, { buffer: [2], props: props({}), view, width: 400, height: 300 })).toBe(1)
    expect(calls.some((c) => c.op === 'fillRect' && c.fillStyle === COLORS.trace)).toBe(true)
  })
})
