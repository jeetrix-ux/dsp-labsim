import type { JSX } from 'react'
import { basename } from '@shared/files'
import { appStore, debugStore, useDebug } from '../appStore'

export function BreakpointsView(): JSX.Element {
  const bps = useDebug((s) => s.breakpoints)
  const status = useDebug((s) => s.status)
  const d = debugStore.getState()
  if (bps.length === 0) return <div className="empty">No breakpoints.</div>
  const session = status !== 'idle' && status !== 'starting'
  return (
    <div>
      <div className="bp-bar">
        <button className="link-btn" onClick={() => void d.removeAllBreakpoints()}>Remove All</button>
      </div>
      {bps.map((b, i) => (
        <div key={`${b.file}:${b.line}`} className="bp-row" onDoubleClick={() => void appStore.getState().openAt(b.file, b.line)}>
          <input
            type="checkbox"
            aria-label={`Enable ${basename(b.file)}, line ${b.line}`}
            checked={b.enabled}
            onChange={(e) => void d.setBreakpointEnabled(i, e.target.checked)}
          />
          <span className={b.enabled ? 'bp-dot' : 'bp-dot off'} />
          <span>
            {basename(b.file)}, line {b.line}
            {session && !b.verified ? ' (unverified: no code at or after this line)' : ''}
          </span>
          <button className="tab-close" aria-label="Remove breakpoint" onClick={() => void d.removeBreakpoint(i)}>×</button>
        </div>
      ))}
    </div>
  )
}
