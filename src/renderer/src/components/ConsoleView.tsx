import { useEffect, useRef, type JSX } from 'react'
import { appStore, debugStore, useApp, useDebug } from '../appStore'
import { cioConsoleName } from '../debugStore'

export function ConsoleView(): JSX.Element {
  const consoles = useApp((s) => s.consoles)
  const active = useApp((s) => s.activeConsole)
  const lines = consoles[active] ?? []
  const bodyRef = useRef<HTMLPreElement>(null)
  const st = appStore.getState()
  const inputPending = useDebug((s) => s.inputPending)
  const project = useDebug((s) => s.project)
  const showInput = inputPending && project !== null && active === cioConsoleName(project)

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
          <div key={i} className={`cl-${l.kind}`}>{l.text || ' '}</div>
        ))}
      </pre>
      {showInput && (
        <input
          className="console-input"
          aria-label="Console input"
          autoFocus
          placeholder="The program is waiting for input: type a line and press Enter"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const text = e.currentTarget.value
            e.currentTarget.value = ''
            void debugStore.getState().sendInput(text)
          }}
        />
      )}
    </div>
  )
}
