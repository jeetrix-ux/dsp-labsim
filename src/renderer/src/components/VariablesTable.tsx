import { useState, type JSX, type MouseEvent } from 'react'
import type { NumberFormat, VarNode } from '@shared/debug'
import { debugStore, useDebug } from '../appStore'

const FORMATS: [NumberFormat, string][] = [
  ['natural', 'Natural'],
  ['hex', 'Hex'],
  ['decimal', 'Decimal'],
  ['binary', 'Binary'],
  ['char', 'Char']
]

type View = 'var' | 'expr'

interface Menu {
  x: number
  y: number
  expr: string
  removable: boolean
}

function Row(props: { node: VarNode; depth: number; view: View; onMenu: (e: MouseEvent, node: VarNode, depth: number) => void }): JSX.Element {
  const { node, depth, view } = props
  const children = useDebug((s) => s.children[`${view}:${node.expr}`])
  const [editing, setEditing] = useState(false)
  const d = debugStore.getState()
  const editable = !node.error && !node.expandable && node.value !== ''
  return (
    <>
      <tr className="var-row" data-name={node.name} onContextMenu={(e) => props.onMenu(e, node, depth)}>
        <td style={{ paddingLeft: 6 + depth * 14 }}>
          <span className="twisty" onClick={() => node.expandable && void d.toggleExpand(view, node.expr)}>
            {node.expandable ? (children ? '▾' : '▸') : ''}
          </span>
          {node.name}
        </td>
        <td>{node.type}</td>
        <td className={node.error ? 'var-error' : 'var-value'} onDoubleClick={() => editable && setEditing(true)}>
          {editing ? (
            <input
              className="var-edit"
              autoFocus
              defaultValue={node.value.replace(/ '.*'$/, '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditing(false)
                  void d.editValue(node.expr, e.currentTarget.value)
                } else if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={() => setEditing(false)}
            />
          ) : (
            (node.error ?? node.value)
          )}
        </td>
        <td>{node.address}</td>
      </tr>
      {children?.map((c) => <Row key={c.expr} node={c} depth={depth + 1} view={view} onMenu={props.onMenu} />)}
    </>
  )
}

/** The Variables and Expressions table: expandable rows, editable values and a Number Format menu. */
export function VariablesTable(props: { nodes: VarNode[]; view: View; footer?: JSX.Element }): JSX.Element {
  const [menu, setMenu] = useState<Menu | null>(null)
  const expressions = useDebug((s) => s.expressions)
  const d = debugStore.getState()
  const open = (e: MouseEvent, node: VarNode, depth: number): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, expr: node.expr, removable: props.view === 'expr' && depth === 0 && expressions.includes(node.expr) })
  }
  return (
    <div className="var-wrap" onClick={() => setMenu(null)}>
      <table className="grid">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Value</th><th>Location</th></tr>
        </thead>
        <tbody>
          {props.nodes.map((n) => <Row key={n.expr} node={n} depth={0} view={props.view} onMenu={open} />)}
          {props.footer}
        </tbody>
      </table>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-title">Number Format</div>
          {FORMATS.map(([f, label]) => (
            <div
              key={f}
              className="ctx-item"
              onClick={() => {
                setMenu(null)
                void d.setFormat(menu.expr, f)
              }}
            >
              {label}
            </div>
          ))}
          {menu.removable && (
            <div
              className="ctx-item"
              onClick={() => {
                setMenu(null)
                d.removeExpression(menu.expr)
              }}
            >
              Remove
            </div>
          )}
        </div>
      )}
    </div>
  )
}
