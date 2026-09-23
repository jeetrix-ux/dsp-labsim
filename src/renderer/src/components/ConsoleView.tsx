import { useEffect, useRef, type JSX } from 'react'
import { appStore, useApp } from '../appStore'

export function ConsoleView(): JSX.Element {
  const consoles = useApp((s) => s.consoles)
  const active = useApp((s) => s.activeConsole)
  const lines = consoles[active] ?? []
  const bodyRef = useRef<HTMLPreElement>(null)
  const st = appStore.getState()

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="console-wrap">
      <div className="console-bar">
        <select value={active} onChange={(e) => st.setActiveConsole(e.target.value)} aria-label="Console">
          {Object.keys(consoles).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button className="link-btn" onClick={() => st.clearConsole(active)}>Clear</button>
      </div>
      <pre ref={bodyRef} className="console">
        {lines.map((l, i) => (
          <div key={i} className={`cl-${l.kind}`}>{l.text || ' '}</div>
        ))}
      </pre>
    </div>
  )
}
