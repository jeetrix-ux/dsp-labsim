import { useState, type JSX } from 'react'
import type { VarNode } from '@shared/debug'
import { basename } from '@shared/files'
import { appStore, debugStore, useDebug } from '../appStore'
import { BreakpointsView } from './BreakpointsView'
import { VariablesTable } from './VariablesTable'
import { ViewHeader } from './ViewHeader'

export function DebugView(): JSX.Element {
  const status = useDebug((s) => s.status)
  const project = useDebug((s) => s.project)
  const frames = useDebug((s) => s.frames)
  const selected = useDebug((s) => s.selectedFrame)
  const reason = useDebug((s) => s.reason)
  const d = debugStore.getState()
  if (status === 'idle' || !project) {
    return (
      <div className="view">
        <ViewHeader title="Debug" />
        <div className="view-body"><div className="empty">No debug session is running.</div></div>
      </div>
    )
  }
  const state =
    status === 'starting' ? 'Loading' : status === 'running' ? 'Running' : reason === 'breakpoint' ? 'Suspended - SW Breakpoint' : 'Suspended'
  return (
    <div className="view">
      <ViewHeader title="Debug" />
      <div className="view-body debug-tree">
        <div className="dt-row dt-0">▾ {basename(project)} [Code Composer Studio - Device Debugging]</div>
        <div className="dt-row dt-1">▾ Texas Instruments XDS100v3 USB Debug Probe_0/C674X_0 ({state})</div>
        {status === 'exited' ? (
          <div className="dt-row dt-2 selected">C$$EXIT()</div>
        ) : (
          frames.map((f) => (
            <div
              key={f.index}
              className={f.index === selected ? 'dt-row dt-2 selected' : 'dt-row dt-2'}
              onClick={() => {
                void d.selectFrame(f.index)
                if (f.file && f.line) void appStore.getState().openAt(f.file, f.line)
              }}
            >
              {f.name}() at {f.file ? basename(f.file) : '?'}:{f.line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function VariablesView(): JSX.Element {
  const vars = useDebug((s) => s.variables)
  return <VariablesTable nodes={vars} view="var" />
}

function ExpressionsView(): JSX.Element {
  const expressions = useDebug((s) => s.expressions)
  const results = useDebug((s) => s.results)
  const [text, setText] = useState('')
  const nodes: VarNode[] = expressions.map((e) => results[e] ?? { name: e, expr: e, type: '', value: '', address: '', expandable: false })
  const footer = (
    <tr className="add-expr">
      <td colSpan={4}>
        <input
          aria-label="Add new expression"
          placeholder="Add new expression"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              void debugStore.getState().addExpression(text)
              setText('')
            }
          }}
        />
      </td>
    </tr>
  )
  return <VariablesTable nodes={nodes} view="expr" footer={footer} />
}

type VarTab = 'Variables' | 'Expressions' | 'Breakpoints'

export function VariablesPanel(): JSX.Element {
  const [tab, setTab] = useState<VarTab>('Variables')
  return (
    <div className="view">
      <div className="view-tabs">
        {(['Variables', 'Expressions', 'Breakpoints'] as const).map((t) => (
          <button key={t} className={tab === t ? 'vtab active' : 'vtab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="view-body">
        {tab === 'Variables' ? <VariablesView /> : tab === 'Expressions' ? <ExpressionsView /> : <BreakpointsView />}
      </div>
    </div>
  )
}
