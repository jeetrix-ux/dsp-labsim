import type { JSX } from 'react'

export function ProblemsView(): JSX.Element {
  return (
    <div className="table-wrap">
      <div className="table-caption">0 items</div>
      <table className="grid">
        <thead>
          <tr><th>Description</th><th>Resource</th><th>Path</th><th>Location</th><th>Type</th></tr>
        </thead>
        <tbody />
      </table>
    </div>
  )
}
