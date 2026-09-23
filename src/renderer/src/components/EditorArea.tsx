import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, type JSX } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { languageFor } from '@shared/files'
import { appStore, debugStore, useApp, useDebug } from '../appStore'
import { samePath as sameFile } from '../debugStore'
import { isDirty } from '../store'

/** Monaco model URI for a Windows path. `Uri.parse('C:\\x')` would treat `c:` as a scheme. */
export const toModelPath = (p: string): string => 'file:///' + p.replace(/\\/g, '/')

const samePath = (a: string, b: string): boolean => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

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

let activeEditor: MonacoEditor.IStandaloneCodeEditor | null = null

/** The cursor line in the editor (Run to Line). */
export function getCursorLine(): number | null {
  return activeEditor?.getPosition()?.lineNumber ?? null
}

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

  const diagnostics = useApp((s) => s.diagnostics)
  const reveal = useApp((s) => s.reveal)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const revealedSeq = useRef(0)
  const breakpoints = useDebug((s) => s.breakpoints)
  const pc = useDebug((s) => s.pc)
  const debugDecorations = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)

  const applyDebug = useCallback(() => {
    const ed = editorRef.current
    const path = appStore.getState().activeTab
    const model = ed?.getModel()
    if (!ed || !path || !model || !debugDecorations.current) return
    const d = debugStore.getState()
    const decorations: MonacoEditor.IModelDeltaDecoration[] = []
    for (const b of d.breakpoints) {
      if (!sameFile(b.file, path) || b.line > model.getLineCount()) continue
      decorations.push({
        range: new monaco.Range(b.line, 1, b.line, 1),
        options: { glyphMarginClassName: b.enabled ? 'bp-glyph' : 'bp-glyph off', glyphMarginHoverMessage: { value: `Breakpoint: line ${b.line}` } }
      })
    }
    if (d.pc && sameFile(d.pc.file, path) && d.pc.line <= model.getLineCount()) {
      decorations.push({ range: new monaco.Range(d.pc.line, 1, d.pc.line, 1), options: { isWholeLine: true, className: 'pc-line', linesDecorationsClassName: 'pc-bar' } })
    }
    debugDecorations.current.set(decorations)
  }, [])

  const applyMarkers = useCallback(() => {
    for (const t of appStore.getState().tabs) {
      const model = monaco.editor.getModel(monaco.Uri.parse(toModelPath(t.path)))
      if (!model) continue
      const markers = diagnostics
        .filter((d) => d.file && d.line && samePath(d.file, t.path) && d.line <= model.getLineCount())
        .map((d) => ({
          severity:
            d.severity === 'error' ? monaco.MarkerSeverity.Error : d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
          message: `#${d.code} ${d.message}`,
          startLineNumber: d.line as number,
          endLineNumber: d.line as number,
          startColumn: model.getLineFirstNonWhitespaceColumn(d.line as number) || 1,
          endColumn: model.getLineMaxColumn(d.line as number)
        }))
      monaco.editor.setModelMarkers(model, 'cl6x', markers)
    }
  }, [diagnostics])

  const applyReveal = useCallback(() => {
    const ed = editorRef.current
    const r = appStore.getState().reveal
    if (!ed || !r || r.seq === revealedSeq.current || !samePath(r.path, appStore.getState().activeTab ?? '')) return
    revealedSeq.current = r.seq
    ed.revealLineInCenter(r.line)
    ed.setPosition({ lineNumber: r.line, column: 1 })
    ed.focus()
  }, [])

  useEffect(applyMarkers, [applyMarkers, tabs, active])
  useEffect(applyReveal, [applyReveal, reveal, active])
  useEffect(applyDebug, [applyDebug, breakpoints, pc, active, tabs])

  const onMount: OnMount = (editor, m) => {
    editorRef.current = editor
    activeEditor = editor
    debugDecorations.current = editor.createDecorationsCollection()
    // CCS toggles a breakpoint with a double-click in the left margin.
    editor.onMouseDown((e) => {
      if (e.event.detail !== 2) return
      const t = e.target.type
      if (t !== m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && t !== m.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return
      const line = e.target.position?.lineNumber
      const path = appStore.getState().activeTab
      if (line && path) void debugStore.getState().toggleBreakpoint(path, line)
    })
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void appStore.getState().saveTab())
    applyMarkers()
    applyReveal()
    applyDebug()
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
