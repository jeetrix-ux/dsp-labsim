import { useEffect, type JSX } from 'react'
import type { MenuCommand } from '@shared/api'
import { basename } from '@shared/files'
import { appStore, useApp } from './appStore'
import { isDirty } from './store'
import { BottomPanel } from './components/BottomPanel'
import { DebugView, VariablesPanel } from './components/DebugViews'
import { EditorArea } from './components/EditorArea'
import { ProjectExplorer } from './components/ProjectExplorer'
import { Splitter } from './components/Splitter'
import { Toolbar } from './components/Toolbar'

function handleMenu(cmd: MenuCommand): void {
  const s = appStore.getState()
  switch (cmd) {
    case 'file.save': void s.saveTab(); break
    case 'file.saveAll': void s.saveAll(); break
    case 'file.refresh': void s.refresh(); break
    case 'file.switchWorkspace': void s.switchWorkspace(); break
    case 'project.build': void s.build('build'); break
    case 'project.rebuild': void s.build('rebuild'); break
    case 'project.clean': void s.build('clean'); break
    case 'window.compilerLocation': void s.chooseCompiler(); break
    case 'window.editPerspective': s.setPerspective('edit'); break
    case 'window.debugPerspective': s.setPerspective('debug'); break
  }
}

function relativeTo(root: string, p: string): string {
  return p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, '/') : p
}

export function App(): JSX.Element {
  const perspective = useApp((s) => s.perspective)
  const workspace = useApp((s) => s.workspace)
  const active = useApp((s) => s.activeTab)
  const dirtyCount = useApp((s) => s.tabs.filter(isDirty).length)

  useEffect(() => {
    void appStore.getState().init()
    const offMenu = window.labsim.onMenu(handleMenu)
    const offBuild = window.labsim.onBuildOutput((line) => appStore.getState().appendBuildOutput(line))
    return () => {
      offMenu()
      offBuild()
    }
  }, [])

  useEffect(() => {
    document.title = [workspace && basename(workspace), active && relativeTo(workspace, active), 'DSP LabSim']
      .filter(Boolean)
      .join(' - ')
  }, [workspace, active])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (dirtyCount > 0) {
        e.preventDefault()
        e.returnValue = false
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  const editorAndConsole = (
    <Splitter direction="column" size={220} fixed="second">
      {[<EditorArea key="editor" />, <BottomPanel key="bottom" />]}
    </Splitter>
  )

  return (
    <div className="app">
      <Toolbar />
      <div className="workbench">
        {perspective === 'edit' ? (
          <Splitter direction="row" size={260} fixed="first">
            {[<ProjectExplorer key="explorer" />, editorAndConsole]}
          </Splitter>
        ) : (
          <Splitter direction="column" size={210} fixed="first">
            {[
              <Splitter key="top" direction="row" size={520} fixed="first">
                {[<DebugView key="debug" />, <VariablesPanel key="vars" />]}
              </Splitter>,
              editorAndConsole
            ]}
          </Splitter>
        )}
      </div>
    </div>
  )
}
