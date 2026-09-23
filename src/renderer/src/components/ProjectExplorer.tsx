import type { JSX, ReactNode } from 'react'
import type { FileNode } from '@shared/api'
import { appStore, useApp } from '../appStore'
import { FileIcon, FolderIcon, ProjectIcon, RefreshIcon } from './icons'
import { ViewHeader } from './ViewHeader'

interface RowProps {
  depth: number
  label: string
  icon: ReactNode
  suffix?: string
  expandable?: boolean
  expanded?: boolean
  selected?: boolean
  onClick?: () => void
  onToggle?: () => void
  onDoubleClick?: () => void
}

function TreeRow(p: RowProps): JSX.Element {
  return (
    <div
      className={p.selected ? 'tree-row selected' : 'tree-row'}
      style={{ paddingLeft: 4 + p.depth * 16 }}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      title={p.label}
    >
      <span
        className="twisty"
        onClick={(e) => {
          e.stopPropagation()
          p.onToggle?.()
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {p.expandable ? (p.expanded ? '▾' : '▸') : ''}
      </span>
      {p.icon}
      <span className="tree-label">{p.label}</span>
      {p.suffix && <span className="tree-suffix">{p.suffix}</span>}
    </div>
  )
}

function Nodes({ nodes, depth }: { nodes: FileNode[]; depth: number }): JSX.Element {
  const expanded = useApp((s) => s.expanded)
  const st = appStore.getState()
  return (
    <>
      {nodes.map((n) =>
        n.kind === 'dir' ? (
          <div key={n.path}>
            <TreeRow
              depth={depth}
              label={n.name}
              icon={<FolderIcon />}
              expandable
              expanded={!!expanded[n.path]}
              onToggle={() => void st.toggleExpand(n.path)}
              onDoubleClick={() => void st.toggleExpand(n.path)}
            />
            {expanded[n.path] && n.children && <Nodes nodes={n.children} depth={depth + 1} />}
          </div>
        ) : (
          <TreeRow key={n.path} depth={depth} label={n.name} icon={<FileIcon name={n.name} />} onDoubleClick={() => void st.openFile(n.path)} />
        )
      )}
    </>
  )
}

export function ProjectExplorer(): JSX.Element {
  const projects = useApp((s) => s.projects)
  const trees = useApp((s) => s.trees)
  const expanded = useApp((s) => s.expanded)
  const selected = useApp((s) => s.selectedProject)
  const st = appStore.getState()
  return (
    <div className="view">
      <ViewHeader
        title="Project Explorer"
        actions={<button className="icon-btn" title="Refresh" onClick={() => void st.refresh()}><RefreshIcon /></button>}
      />
      <div className="view-body tree">
        {projects.length === 0 && <div className="empty">No projects in this workspace.</div>}
        {projects.map((p) => (
          <div key={p.dir}>
            <TreeRow
              depth={0}
              label={p.name}
              suffix={p.dir === selected ? '  [Active - Debug]' : undefined}
              icon={<ProjectIcon />}
              expandable
              expanded={!!expanded[p.dir]}
              selected={p.dir === selected}
              onClick={() => st.selectProject(p.dir)}
              onToggle={() => void st.toggleExpand(p.dir)}
              onDoubleClick={() => void st.toggleExpand(p.dir)}
            />
            {expanded[p.dir] && trees[p.dir] && <Nodes nodes={trees[p.dir]} depth={1} />}
          </div>
        ))}
      </div>
    </div>
  )
}
