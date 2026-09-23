import { useState, type JSX } from 'react'
import { memoryStore, useMemory } from '../appStore'
import { hexAddr, MEMORY_FORMATS, type MemoryFormat } from '../memory/format'

export function MemoryView(): JSX.Element {
  const expr = useMemory((s) => s.expr)
  const format = useMemory((s) => s.format)
  const base = useMemory((s) => s.base)
  const rows = useMemory((s) => s.rows)
  const error = useMemory((s) => s.error)
  const [text, setText] = useState(expr)
  const m = memoryStore.getState()

  return (
    <div className="memory-wrap">
      <div className="console-bar memory-bar">
        <input
          className="memory-input"
          aria-label="Memory address"
          placeholder="Enter an address or expression, e.g. y or 0x80000000"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void m.go(text)}
        />
        <button className="link-btn" onClick={() => void m.go(text)}>Go</button>
        <select aria-label="Memory format" value={format} onChange={(e) => void m.setFormat(e.target.value as MemoryFormat)}>
          {MEMORY_FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <button className="icon-btn" title="Previous Page" aria-label="Previous Page" disabled={base === null} onClick={() => void m.page(-1)}>▲</button>
        <button className="icon-btn" title="Next Page" aria-label="Next Page" disabled={base === null} onClick={() => void m.page(1)}>▼</button>
        <button className="link-btn" disabled={base === null} onClick={() => void m.refresh()}>Refresh</button>
      </div>
      {error ? (
        <div className="memory-error" role="alert">{error}</div>
      ) : base === null ? (
        <div className="empty">Enter an address or a symbol (y, &amp;x[4], 0x80000000) while debugging, then press Enter.</div>
      ) : (
        <div className="memory-body">
          <table className="memory-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.address} className="mem-row">
                  <td className="mem-addr">{hexAddr(r.address)}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="mem-cell">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
