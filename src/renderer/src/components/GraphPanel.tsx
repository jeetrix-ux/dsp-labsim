import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import { graphStore, useGraphs } from '../appStore'
import { fitView, fmtNum, nearestSample, xValue } from '../graph/model'
import { drawGraph, fromPx, layoutFor } from '../graph/plot'
import type { Graph } from '../graphStore'
import { PopoutButton } from './PopoutButton'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const act = (p: Promise<unknown>): void => {
  p.catch((e) => window.alert(`LabSim: ${errorText(e)}`))
}

function GBtn(props: { title: string; label: string; pressed?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button className={props.pressed ? 'g-btn pressed' : 'g-btn'} title={props.title} aria-label={props.title} aria-pressed={props.pressed} onClick={props.onClick}>
      {props.label}
    </button>
  )
}

function GraphView({ graph }: { graph: Graph }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cursor, setCursor] = useState<string | null>(null)
  const st = graphStore.getState()
  const view = useMemo(() => graph.view ?? fitView(graph.buffer, graph.props), [graph.view, graph.buffer, graph.props])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // In a pop-out, observe with that window's ResizeObserver: an observer only sees its own document.
    const Observer = host.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver
    const ro = new Observer(() => setSize({ w: host.clientWidth, h: host.clientHeight }))
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || size.w === 0 || size.h === 0) return
    const dpr = c.ownerDocument.defaultView?.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.dataset.points = String(drawGraph(ctx, { buffer: graph.buffer, props: graph.props, view, width: size.w, height: size.h }))
  }, [graph.buffer, graph.props, graph.error, view, size])

  const onMove = (e: MouseEvent<HTMLCanvasElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const [x] = fromPx(layoutFor(size.w, size.h, graph.props.axisDisplay), view, e.clientX - box.left, e.clientY - box.top)
    const i = nearestSample(x, graph.props, graph.buffer.length)
    setCursor(i === null ? null : `x: ${fmtNum(xValue(i, graph.props))}   y: ${fmtNum(graph.buffer[i])}`)
  }

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <GBtn title="Refresh" label="Refresh" onClick={() => act(st.refresh(graph.id))} />
        <GBtn title="Continuous Refresh" label="Continuous" pressed={graph.continuous} onClick={() => st.setContinuous(graph.id, !graph.continuous)} />
        <GBtn title="Reset Graph" label="Reset" onClick={() => st.reset(graph.id)} />
        <GBtn title="Show Graph Properties" label="Properties" onClick={() => st.showProperties(graph.id)} />
        <span className="tb-sep" />
        <GBtn title="Zoom In" label="+" onClick={() => st.zoom(graph.id, 'in')} />
        <GBtn title="Zoom Out" label="−" onClick={() => st.zoom(graph.id, 'out')} />
        <GBtn title="Zoom Fit" label="Fit" onClick={() => st.zoom(graph.id, 'fit')} />
        <span className="tb-sep" />
        <GBtn title="Save Data" label="Save Data" onClick={() => act(st.saveData(graph.id))} />
        <GBtn title="Export Image" label="Export Image" onClick={() => canvasRef.current && act(st.exportImage(graph.id, canvasRef.current.toDataURL('image/png')))} />
      </div>
      <div ref={hostRef} className="graph-host">
        {graph.error ? (
          <div className="graph-error" role="alert">{graph.error}</div>
        ) : (
          <canvas ref={canvasRef} className="graph-canvas" style={{ width: size.w, height: size.h }} onMouseMove={onMove} onMouseLeave={() => setCursor(null)} />
        )}
        {cursor && !graph.error && <div className="graph-readout">{cursor}</div>}
      </div>
    </div>
  )
}

/** The graph tabs; in the main window it offers Pop Out, in the pop-out window Dock. */
export function GraphPanel({ popped = false }: { popped?: boolean }): JSX.Element {
  const graphs = useGraphs((s) => s.graphs)
  const active = useGraphs((s) => s.active)
  const shown = graphs.find((g) => g.id === active) ?? graphs[0]
  const st = graphStore.getState()
  return (
    <div className="view graph-panel">
      <div className="view-tabs">
        {graphs.map((g) => (
          <div key={g.id} className={g.id === shown?.id ? 'vtab graph-tab active' : 'vtab graph-tab'} onMouseDown={() => st.select(g.id)}>
            <span>{g.title}</span>
            <button className="tab-close" aria-label={`Close ${g.title}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => st.close(g.id)}>×</button>
          </div>
        ))}
        <span className="tb-spacer" />
        <PopoutButton view="graphs" popped={popped} />
      </div>
      <div className="view-body graph-body">{shown && <GraphView key={shown.id} graph={shown} />}</div>
    </div>
  )
}
