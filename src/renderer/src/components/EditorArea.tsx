import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, type JSX } from 'react'
import { languageFor } from '@shared/files'
import { appStore, useApp } from '../appStore'
import { isDirty } from '../store'

/** Monaco model URI for a Windows path. `Uri.parse('C:\\x')` would treat `c:` as a scheme. */
export const toModelPath = (p: string): string => 'file:///' + p.replace(/\\/g, '/')

export async function requestClose(path: string): Promise<void> {
  const s = appStore.getState()
  const tab = s.tabs.find((t) => t.path === path)
  if (!tab) return
  if (isDirty(tab)) {
    if (!window.confirm(`'${tab.title}' has been modified. Save changes and close?`)) return
    await s.saveTab(path)
  }
  s.closeTab(path)
}

const EDITOR_OPTIONS = {
  fontFamily: "Consolas, 'Courier New', monospace",
  fontSize: 13,
  tabSize: 4,
  minimap: { enabled: false },
  glyphMargin: true,
  automaticLayout: true,
  scrollBeyondLastLine: false
} as const

export function EditorArea(): JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const active = useApp((s) => s.activeTab)
  const tab = tabs.find((t) => t.path === active)
  const st = appStore.getState()

  // Models outlive the <Editor> (keepCurrentModel); dispose them when their tab closes.
  const openPaths = useRef<string[]>([])
  useEffect(() => {
    const now = tabs.map((t) => t.path)
    for (const p of openPaths.current) {
      if (!now.includes(p)) monaco.editor.getModel(monaco.Uri.parse(toModelPath(p)))?.dispose()
    }
    openPaths.current = now
  }, [tabs])

  const onMount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void appStore.getState().saveTab())
  }

  return (
    <div className="editor-area">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.path}
            className={t.path === active ? 'tab active' : 'tab'}
            title={t.path}
            onMouseDown={() => st.setActiveTab(t.path)}
          >
            <span>{(isDirty(t) ? '*' : '') + t.title}</span>
            <button
              className="tab-close"
              aria-label={`Close ${t.title}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void requestClose(t.path)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="editor-host">
        {tab ? (
          <Editor
            path={toModelPath(tab.path)}
            defaultValue={tab.content}
            defaultLanguage={languageFor(tab.path)}
            theme="vs"
            keepCurrentModel
            options={EDITOR_OPTIONS}
            onMount={onMount}
            onChange={(v) => st.editTab(tab.path, v ?? '')}
          />
        ) : (
          <div className="empty">Double-click a file in the Project Explorer to open it.</div>
        )}
      </div>
    </div>
  )
}
