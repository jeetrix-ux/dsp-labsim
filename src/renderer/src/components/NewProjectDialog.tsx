import { useState, type JSX } from 'react'
import { NEW_PROJECT_DEFAULTS, OPT_LEVELS, validateNewProject, type NewProjectOptions, type OptLevel } from '@shared/newProject'
import { appStore, useApp } from '../appStore'

const splitSymbols = (text: string): string[] => text.split(/[\s,;]+/).filter(Boolean)

function Body(): JSX.Element {
  const st = appStore.getState()
  const [name, setName] = useState('')
  const [heapSize, setHeap] = useState(NEW_PROJECT_DEFAULTS.heapSize)
  const [stackSize, setStack] = useState(NEW_PROJECT_DEFAULTS.stackSize)
  const [optLevel, setOpt] = useState<OptLevel>(NEW_PROJECT_DEFAULTS.optLevel)
  const [symbols, setSymbols] = useState(NEW_PROJECT_DEFAULTS.defines.join(' '))
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const opts: NewProjectOptions = { name: name.trim(), heapSize: heapSize.trim(), stackSize: stackSize.trim(), optLevel, defines: splitSymbols(symbols) }
  const invalid = validateNewProject(opts)

  const finish = async (): Promise<void> => {
    if (invalid || busy) return
    setBusy(true)
    setFailure(await st.createProject(opts))
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && st.closeDialog()}>
      <div
        className="modal wizard-dialog"
        role="dialog"
        aria-label="New CCS Project"
        onKeyDown={(e) => {
          if (e.key === 'Escape') st.closeDialog()
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) void finish()
        }}
      >
        <div className="modal-title">New CCS Project</div>
        <div className="wizard-note">Create a new CCS project for the TMS320C6748 (LCDK).</div>
        <table className="grid prop-table">
          <tbody>
            <tr className="prop-group"><td colSpan={2}>Target</td></tr>
            <tr><td>Target</td><td>C674x Floating-point DSP: TMS320C6748</td></tr>
            <tr><td>Connection</td><td>Texas Instruments XDS100v3 USB Debug Probe</td></tr>
            <tr className="prop-group"><td colSpan={2}>Project</td></tr>
            <tr>
              <td>Project name</td>
              <td><input aria-label="Project name" autoFocus spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} /></td>
            </tr>
            <tr><td>Output type</td><td>Executable</td></tr>
            <tr><td>Project template</td><td>Empty Project (with main.c)</td></tr>
            <tr className="prop-group"><td colSpan={2}>Advanced settings</td></tr>
            <tr>
              <td>Heap size</td>
              <td><input aria-label="Heap size" spellCheck={false} value={heapSize} onChange={(e) => setHeap(e.target.value)} /></td>
            </tr>
            <tr>
              <td>Stack size</td>
              <td><input aria-label="Stack size" spellCheck={false} value={stackSize} onChange={(e) => setStack(e.target.value)} /></td>
            </tr>
            <tr>
              <td>Optimization level</td>
              <td>
                <select aria-label="Optimization level" value={optLevel} onChange={(e) => setOpt(e.target.value as OptLevel)}>
                  {OPT_LEVELS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>Predefined symbols</td>
              <td><input aria-label="Predefined symbols" spellCheck={false} value={symbols} onChange={(e) => setSymbols(e.target.value)} /></td>
            </tr>
          </tbody>
        </table>
        <div className="modal-error" role="alert">{failure ?? (name ? invalid : null) ?? ''}</div>
        <div className="modal-buttons">
          <span className="tb-spacer" />
          <button disabled={!!invalid || busy} onClick={() => void finish()}>Finish</button>
          <button onClick={() => st.closeDialog()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function NewProjectDialog(): JSX.Element | null {
  const open = useApp((s) => s.dialog === 'newProject')
  return open ? <Body /> : null
}
