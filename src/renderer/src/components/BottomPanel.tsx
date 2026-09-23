import type { JSX } from 'react'
import { appStore, useApp } from '../appStore'
import type { BottomTab } from '../store'
import { ConsoleView } from './ConsoleView'
import { MemoryView } from './MemoryView'
import { ProblemsView } from './ProblemsView'

const TABS: [BottomTab, string][] = [
  ['console', 'Console'],
  ['problems', 'Problems'],
  ['memory', 'Memory Browser']
]

export function BottomPanel(): JSX.Element {
  const tab = useApp((s) => s.bottomTab)
  const st = appStore.getState()
  return (
    <div className="view">
      <div className="view-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'vtab active' : 'vtab'} onClick={() => st.setBottomTab(id)}>{label}</button>
        ))}
      </div>
      <div className="view-body">{tab === 'console' ? <ConsoleView /> : tab === 'problems' ? <ProblemsView /> : <MemoryView />}</div>
    </div>
  )
}
