import type { JSX, ReactNode } from 'react'

export function ViewHeader({ title, actions }: { title: string; actions?: ReactNode }): JSX.Element {
  return (
    <div className="view-header">
      <span className="view-title">{title}</span>
      <span className="view-actions">{actions}</span>
    </div>
  )
}
