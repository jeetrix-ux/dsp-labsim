import { useEffect, type JSX } from 'react'
import { appStore, useApp } from '../appStore'

function Body(): JSX.Element {
  const st = appStore.getState()
  const compiler = useApp((s) => s.compiler)
  const workspace = useApp((s) => s.workspace)

  useEffect(() => {
    void appStore.getState().loadCompiler()
  }, [])

  const tc = compiler?.toolchain
  const status = compiler === null ? 'Looking for the compiler…' : tc ? `TI C6000 compiler v${tc.version} (${compiler.chosen ? 'chosen' : 'auto-detected'})` : 'Not found: builds use the LabSim front-end.'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && st.closeDialog()}>
      <div className="modal prefs-dialog" role="dialog" aria-label="Preferences" onKeyDown={(e) => e.key === 'Escape' && st.closeDialog()}>
        <div className="modal-title">Preferences</div>
        <section className="pref-section">
          <h3>C6000 Compiler</h3>
          <div className="pref-compiler">{status}</div>
          {tc && <div className="pref-path" title={tc.root}>{tc.root}</div>}
          <div className="pref-hint">LabSim looks for C:\ti\ccs*\ccs\tools\compiler\ti-cgt-c6000_* and uses the newest one.</div>
          <div className="pref-actions">
            <button onClick={() => void st.chooseCompiler()}>Browse...</button>
            <button disabled={compiler !== null && !compiler.chosen} onClick={() => void st.autoDetectCompiler()}>Use Auto-detect</button>
          </div>
        </section>
        <section className="pref-section">
          <h3>Workspace</h3>
          <div className="pref-workspace pref-path" title={workspace}>{workspace}</div>
          <div className="pref-actions">
            <button
              onClick={() => {
                st.closeDialog()
                void st.switchWorkspace()
              }}
            >
              Switch Workspace...
            </button>
          </div>
        </section>
        <div className="modal-buttons">
          <span className="tb-spacer" />
          <button autoFocus onClick={() => st.closeDialog()}>Close</button>
        </div>
      </div>
    </div>
  )
}

export function PreferencesDialog(): JSX.Element | null {
  const open = useApp((s) => s.dialog === 'preferences')
  return open ? <Body /> : null
}
