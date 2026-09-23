import type { JSX } from 'react'
import { appStore, useApp } from '../appStore'
import { ConsoleView } from './ConsoleView'
import { ProblemsView } from './ProblemsView'

export function BottomPanel(): JSX.Element {
  const tab = useApp((s) => s.bottomTab)
  const st = appStore.getState()
  return (
    <div className="view">
      <div className="view-tabs">
        <button className={tab === 'console' ? 'vtab active' : 'vtab'} onClick={() => st.setBottomTab('console')}>Console</button>
        <button className={tab === 'problems' ? 'vtab active' : 'vtab'} onClick={() => st.setBottomTab('problems')}>Problems</button>
      </div>
      <div className="view-body">{tab === 'console' ? <ConsoleView /> : <ProblemsView />}</div>
    </div>
  )
}
