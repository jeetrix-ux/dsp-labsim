import { useEffect, type JSX } from 'react'
import type { MenuCommand } from '@shared/api'
import { basename } from '@shared/files'
import { appStore, debugStore, graphStore, useApp, useGraphs } from './appStore'
import { isDirty } from './store'
import { BottomPanel } from './components/BottomPanel'
import { DebugView, VariablesPanel } from './components/DebugViews'
import { EditorArea, getCursorLine } from './components/EditorArea'
import { GraphPanel } from './components/GraphPanel'
import { GraphPropertiesDialog } from './components/GraphPropertiesDialog'
import { NewProjectDialog } from './components/NewProjectDialog'
import { PreferencesDialog } from './components/PreferencesDialog'
import { ProjectExplorer } from './components/ProjectExplorer'
import { Splitter } from './components/Splitter'
import { Toolbar } from './components/Toolbar'

function runToCursor(): void {
  const file = appStore.getState().activeTab
  const line = getCursorLine()
  if (file && line) void debugStore.getState().runToLine(file, line)
}

/** CCS's debug keys; caught before Monaco (which uses F8 itself) and the window see them. */
const KEYS: Record<string, MenuCommand> = {
  F11: 'run.debug',
  F8: 'run.resume',
  'Alt+F8': 'run.suspend',
  'Ctrl+F2': 'run.terminate',
  F5: 'run.stepInto',
  F6: 'run.stepOver',
  F7: 'run.stepReturn',
  'Ctrl+R': 'run.toLine'
}

function onKey(e: KeyboardEvent): void {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const combo = `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${key}`
  const cmd = KEYS[combo]
  if (!cmd) return
  e.preventDefault()
  e.stopPropagation()
  handleMenu(cmd)
}

function handleMenu(cmd: MenuCommand): void {
  const s = appStore.getState()
  const d = debugStore.getState()
  switch (cmd) {
    case 'run.debug': void d.start(); break
    case 'run.resume': void d.resume(); break
    case 'run.suspend': void d.suspend(); break
    case 'run.terminate': void d.terminate(); break
    case 'run.restart': void d.restart(); break
    case 'run.reload': void d.reload(); break
    case 'run.stepInto': void d.stepInto(); break
    case 'run.stepOver': void d.stepOver(); break
    case 'run.stepReturn': void d.stepReturn(); break
    case 'run.toLine': runToCursor(); break
    case 'tools.graphSingleTime': graphStore.getState().openNew(); break
    case 'file.newProject': s.openDialog('newProject'); break
    case 'file.save': void s.saveTab(); break
    case 'file.saveAll': void s.saveAll(); break
    case 'file.refresh': void s.refresh(); break
    case 'file.switchWorkspace': void s.switchWorkspace(); break
    case 'project.build': void s.build('build'); break
    case 'project.rebuild': void s.build('rebuild'); break
    case 'project.clean': void s.build('clean'); break
    case 'window.preferences': s.openDialog('preferences'); break
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
  const graphCount = useGraphs((s) => s.graphs.length)

  useEffect(() => {
    void appStore.getState().init()
    const offMenu = window.labsim.onMenu(handleMenu)
    const offBuild = window.labsim.onBuildOutput((line) => appStore.getState().appendBuildOutput(line))
    const offDebug = window.labsim.onDebugEvent((event) => debugStore.getState().handleEvent(event))
    window.addEventListener('keydown', onKey, true)
    return () => {
      offMenu()
      offBuild()
      offDebug()
      window.removeEventListener('keydown', onKey, true)
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

  const editor =
    perspective === 'debug' && graphCount > 0 ? (
      <Splitter key="with-graphs" direction="row" size={560} fixed="second">
        {[<EditorArea key="editor" />, <GraphPanel key="graphs" />]}
      </Splitter>
    ) : (
      <EditorArea key="editor" />
    )

  const editorAndConsole = (
    <Splitter direction="column" size={220} fixed="second">
      {[editor, <BottomPanel key="bottom" />]}
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
      <GraphPropertiesDialog />
      <NewProjectDialog />
      <PreferencesDialog />
    </div>
  )
}
