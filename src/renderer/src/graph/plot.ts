import { fmtTick, niceTicks, plotValue, ticksEvery, xLabel, xValue, type GraphProps, type View } from './model'

/** The plot area inside the canvas, in CSS pixels. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export function layoutFor(width: number, height: number, axisDisplay: boolean): Rect {
  return axisDisplay
    ? { left: 64, top: 10, right: Math.max(65, width - 14), bottom: Math.max(11, height - 36) }
    : { left: 4, top: 4, right: Math.max(5, width - 4), bottom: Math.max(5, height - 4) }
}

export function toPx(r: Rect, v: View, x: number, y: number): [number, number] {
  return [r.left + ((x - v.x0) / (v.x1 - v.x0)) * (r.right - r.left), r.bottom - ((y - v.y0) / (v.y1 - v.y0)) * (r.bottom - r.top)]
}

export function fromPx(r: Rect, v: View, px: number, py: number): [number, number] {
  return [v.x0 + ((px - r.left) / (r.right - r.left)) * (v.x1 - v.x0), v.y0 + ((r.bottom - py) / (r.bottom - r.top)) * (v.y1 - v.y0)]
}

export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'strokeRect' | 'beginPath'
  | 'moveTo' | 'lineTo' | 'stroke' | 'fillText' | 'save' | 'restore' | 'rect' | 'clip' | 'setLineDash'
>

/** CCS's graph colours. */
export const COLORS = {
  background: '#ffffff',
  major: '#c0c0c0',
  minor: '#e6e6e6',
  frame: '#808080',
  text: '#000000',
  trace: '#0000ff',
  reference: '#808080'
}

export interface PlotInput {
  buffer: number[]
  props: GraphProps
  view: View
  width: number
  height: number
}

function grid(ctx: Ctx2D, r: Rect, v: View, xs: number[], ys: number[], color: string): void {
  ctx.strokeStyle = color
  ctx.beginPath()
  for (const x of xs) {
    const sx = Math.round(toPx(r, v, x, 0)[0]) + 0.5
    ctx.moveTo(sx, r.top)
    ctx.lineTo(sx, r.bottom)
  }
  for (const y of ys) {
    const sy = Math.round(toPx(r, v, 0, y)[1]) + 0.5
    ctx.moveTo(r.left, sy)
    ctx.lineTo(r.right, sy)
  }
  ctx.stroke()
}

/** Draws a Single Time graph; returns how many samples were plotted. */
export function drawGraph(ctx: Ctx2D, { buffer, props, view, width, height }: PlotInput): number {
  const r = layoutFor(width, height, props.axisDisplay)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, width, height)
  ctx.lineWidth = 1
  const xt = niceTicks(view.x0, view.x1, Math.max(2, Math.floor((r.right - r.left) / 80)))
  const yt = niceTicks(view.y0, view.y1, Math.max(2, Math.floor((r.bottom - r.top) / 40)))
  if (props.gridStyle === 'Minor Grid') {
    grid(ctx, r, view, ticksEvery(view.x0, view.x1, xt.step / 5), ticksEvery(view.y0, view.y1, yt.step / 5), COLORS.minor)
  }
  if (props.gridStyle !== 'No Grid') grid(ctx, r, view, xt.ticks, yt.ticks, COLORS.major)

  const dc = props.useDcValueForGraph && props.magnitudeDisplayScale === 'Linear'
  if (dc) {
    const sy = Math.round(toPx(r, view, 0, props.dcValue)[1]) + 0.5
    ctx.strokeStyle = COLORS.reference
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(r.left, sy)
    ctx.lineTo(r.right, sy)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top)
  ctx.clip()
  ctx.strokeStyle = COLORS.trace
  ctx.fillStyle = COLORS.trace
  let drawn = 0
  let last = null as [number, number] | null
  if (props.dataPlotStyle === 'Bar') {
    const w = Math.max(1, Math.abs(toPx(r, view, xValue(1, props), 0)[0] - toPx(r, view, xValue(0, props), 0)[0]) * 0.6)
    const base = toPx(r, view, 0, dc ? props.dcValue : Math.min(Math.max(0, view.y0), view.y1))[1]
    buffer.forEach((v, i) => {
      const y = plotValue(v, props)
      if (!Number.isFinite(y)) return
      const [px, py] = toPx(r, view, xValue(i, props), y)
      ctx.fillRect(px - w / 2, Math.min(py, base), w, Math.max(1, Math.abs(base - py)))
      drawn++
    })
  } else {
    ctx.beginPath()
    let pen = false
    buffer.forEach((v, i) => {
      const y = plotValue(v, props)
      if (!Number.isFinite(y)) {
        pen = false
        return
      }
      const [px, py] = toPx(r, view, xValue(i, props), y)
      if (pen) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
      pen = true
      last = [px, py]
      drawn++
    })
    ctx.stroke()
    if (drawn === 1 && last) ctx.fillRect(last[0] - 1.5, last[1] - 1.5, 3, 3)
  }
  ctx.restore()

  if (props.axisDisplay) {
    ctx.strokeStyle = COLORS.frame
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, r.right - r.left, r.bottom - r.top)
    ctx.fillStyle = COLORS.text
    ctx.font = '11px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const x of xt.ticks) ctx.fillText(fmtTick(x, xt.step), toPx(r, view, x, 0)[0], r.bottom + 4)
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(xLabel(props), (r.left + r.right) / 2, height - 3)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const y of yt.ticks) ctx.fillText(fmtTick(y, yt.step), r.left - 6, toPx(r, view, 0, y)[1])
    if (props.magnitudeDisplayScale === 'Log') {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('dB', 4, r.top)
    }
  }
  return drawn
}
