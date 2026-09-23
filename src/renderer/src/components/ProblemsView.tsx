import { useState, type JSX } from 'react'
import type { Diagnostic } from '@shared/api'
import { basename } from '@shared/files'
import { appStore, useApp } from '../appStore'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function folderOf(workspace: string, file: string | null): string {
  if (!file) return ''
  const dir = file.slice(0, Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')))
  return (dir.startsWith(workspace) ? dir.slice(workspace.length) : dir).replace(/\\/g, '/') || '/'
}

function Group({ title, items, workspace }: { title: string; items: Diagnostic[]; workspace: string }): JSX.Element | null {
  const [open, setOpen] = useState(true)
  if (items.length === 0) return null
  return (
    <>
      <tr className="problems-group" onClick={() => setOpen(!open)}>
        <td colSpan={5}>{open ? '▾' : '▸'} {title} ({plural(items.length, 'item')})</td>
      </tr>
      {open &&
        items.map((d, i) => (
          <tr
            key={i}
            className="problems-row"
            data-severity={d.severity}
            onDoubleClick={() => {
              if (d.file && d.line) void appStore.getState().openAt(d.file, d.line)
            }}
          >
            <td className={`sev sev-${d.severity}`}>#{d.code} {d.message}</td>
            <td>{d.file ? basename(d.file) : ''}</td>
            <td>{folderOf(workspace, d.file)}</td>
            <td>{d.line ? `line ${d.line}` : ''}</td>
            <td>C/C++ Problem</td>
          </tr>
        ))}
    </>
  )
}

export function ProblemsView(): JSX.Element {
  const diags = useApp((s) => s.diagnostics)
  const workspace = useApp((s) => s.workspace)
  const errors = diags.filter((d) => d.severity === 'error')
  const warnings = diags.filter((d) => d.severity === 'warning')
  const infos = diags.filter((d) => d.severity === 'remark')
  return (
    <div className="table-wrap">
      <div className="table-caption">
        {plural(errors.length, 'error')}, {plural(warnings.length, 'warning')}, {plural(infos.length, 'other')}
      </div>
      <table className="grid">
        <thead>
          <tr><th>Description</th><th>Resource</th><th>Path</th><th>Location</th><th>Type</th></tr>
        </thead>
        <tbody>
          <Group title="Errors" items={errors} workspace={workspace} />
          <Group title="Warnings" items={warnings} workspace={workspace} />
          <Group title="Infos" items={infos} workspace={workspace} />
        </tbody>
      </table>
    </div>
  )
}
