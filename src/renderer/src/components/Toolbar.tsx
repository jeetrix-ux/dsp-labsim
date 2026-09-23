import type { JSX, ReactNode } from 'react'
import { appStore, debugStore, useApp, useDebug } from '../appStore'
import { isDirty } from '../store'
import {
  BugIcon, HammerIcon, RestartIcon, ResumeIcon, SaveIcon, StepIntoIcon, StepOverIcon, StepReturnIcon, SuspendIcon, TerminateIcon
} from './icons'

function TbButton(props: { title: string; disabled?: boolean; onClick?: () => void; children: ReactNode }): JSX.Element {
  return (
    <button className="tb-btn" title={props.title} aria-label={props.title} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

const Sep = (): JSX.Element => <span className="tb-sep" />

export function Toolbar(): JSX.Element {
  const perspective = useApp((s) => s.perspective)
  const canSave = useApp((s) => {
    const t = s.tabs.find((x) => x.path === s.activeTab)
    return !!t && isDirty(t)
  })
  const canBuild = useApp((s) => s.selectedProject !== null && !s.building)
  const status = useDebug((s) => s.status)
  const st = appStore.getState()
  const d = debugStore.getState()
  const suspended = status === 'suspended'
  const live = status !== 'idle' && status !== 'starting'
  return (
    <div className="toolbar">
      <TbButton title="Save (Ctrl+S)" disabled={!canSave} onClick={() => void st.saveTab()}><SaveIcon /></TbButton>
      <Sep />
      <TbButton title="Build Project (Ctrl+B)" disabled={!canBuild} onClick={() => void st.build('build')}><HammerIcon /></TbButton>
      <TbButton title="Debug (F11)" disabled={!canBuild || status === 'starting'} onClick={() => void d.start()}><BugIcon /></TbButton>
      {perspective === 'debug' && (
        <>
          <Sep />
          <TbButton title="Resume (F8)" disabled={!suspended} onClick={() => void d.resume()}><ResumeIcon /></TbButton>
          <TbButton title="Suspend (Alt+F8)" disabled={status !== 'running'} onClick={() => void d.suspend()}><SuspendIcon /></TbButton>
          <TbButton title="Terminate (Ctrl+F2)" disabled={status === 'idle'} onClick={() => void d.terminate()}><TerminateIcon /></TbButton>
          <TbButton title="Restart" disabled={!live} onClick={() => void d.restart()}><RestartIcon /></TbButton>
          <Sep />
          <TbButton title="Step Into (F5)" disabled={!suspended} onClick={() => void d.stepInto()}><StepIntoIcon /></TbButton>
          <TbButton title="Step Over (F6)" disabled={!suspended} onClick={() => void d.stepOver()}><StepOverIcon /></TbButton>
          <TbButton title="Step Return (F7)" disabled={!suspended} onClick={() => void d.stepReturn()}><StepReturnIcon /></TbButton>
        </>
      )}
      <span className="tb-spacer" />
      <div className="perspectives">
        <button className={perspective === 'edit' ? 'persp active' : 'persp'} onClick={() => st.setPerspective('edit')}>CCS Edit</button>
        <button className={perspective === 'debug' ? 'persp active' : 'persp'} onClick={() => st.setPerspective('debug')}>CCS Debug</button>
      </div>
    </div>
  )
}
