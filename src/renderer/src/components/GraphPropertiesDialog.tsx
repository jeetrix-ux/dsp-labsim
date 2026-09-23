import { useState, type JSX } from 'react'
import { graphStore, useGraphs } from '../appStore'
import { PROPS, fromDraft, toDraft, type Draft, type GraphProps, type PropSpec } from '../graph/model'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function Field({ spec, value, onChange }: { spec: PropSpec; value: string; onChange: (v: string) => void }): JSX.Element {
  if (spec.kind === 'bool' || spec.kind === 'enum') {
    const options = spec.kind === 'bool' ? ['true', 'false'] : (spec.options ?? [])
    return (
      <select aria-label={spec.label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  return <input aria-label={spec.label} value={value} spellCheck={false} autoFocus={spec.key === 'startAddress'} onChange={(e) => onChange(e.target.value)} />
}

function DialogBody({ initial }: { initial: GraphProps }): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [note, setNote] = useState<string | null>(null)
  const g = graphStore.getState()
  const parsed = fromDraft(draft)
  const error = 'error' in parsed ? parsed.error : null

  const ok = async (): Promise<void> => {
    if ('props' in parsed) setNote(await g.applyDialog(parsed.props))
  }
  const importFile = async (): Promise<void> => {
    try {
      const r = await g.importProps()
      if (!r) return
      if ('error' in r) setNote(r.error)
      else {
        setDraft(toDraft(r.props))
        setNote(null)
      }
    } catch (e) {
      setNote(errorText(e))
    }
  }
  const exportFile = async (): Promise<void> => {
    if (!('props' in parsed)) return
    try {
      await g.exportProps(parsed.props)
    } catch (e) {
      setNote(errorText(e))
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && g.cancelDialog()}>
      <div
        className="modal graph-dialog"
        role="dialog"
        aria-label="Graph Properties"
        onKeyDown={(e) => {
          if (e.key === 'Escape') g.cancelDialog()
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !error) void ok()
        }}
      >
        <div className="modal-title">Graph Properties</div>
        <div className="prop-scroll">
          <table className="grid prop-table">
            <thead>
              <tr><th>Property</th><th>Value</th></tr>
            </thead>
            {(['Data', 'Display'] as const).map((group) => (
              <tbody key={group}>
                <tr className="prop-group"><td colSpan={2}>{group} Properties</td></tr>
                {PROPS.filter((s) => s.group === group && (!s.when || draft[s.when] === 'true')).map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td><Field spec={s} value={draft[s.key]} onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div className="modal-error" role="alert">{note ?? error ?? ''}</div>
        <div className="modal-buttons">
          <button onClick={() => void importFile()}>Import</button>
          <button disabled={!!error} onClick={() => void exportFile()}>Export</button>
          <span className="tb-spacer" />
          <button disabled={!!error} onClick={() => void ok()}>OK</button>
          <button onClick={() => g.cancelDialog()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function GraphPropertiesDialog(): JSX.Element | null {
  const dialog = useGraphs((s) => s.dialog)
  return dialog ? <DialogBody initial={dialog.props} /> : null
}
