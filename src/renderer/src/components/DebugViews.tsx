import { useState, type JSX } from 'react'
import { ViewHeader } from './ViewHeader'

export function DebugView(): JSX.Element {
  return (
    <div className="view">
      <ViewHeader title="Debug" />
      <div className="view-body"><div className="empty">No debug session is running.</div></div>
    </div>
  )
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
        {tab === 'Breakpoints' ? (
          <div className="empty">No breakpoints.</div>
        ) : (
          <table className="grid">
            <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Location</th></tr></thead>
            <tbody />
          </table>
        )}
      </div>
    </div>
  )
}
