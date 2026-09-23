import type { JSX, ReactNode } from 'react'
import { appStore, useApp } from '../appStore'
import { isDirty } from '../store'
import {
  BugIcon, HammerIcon, ResumeIcon, SaveIcon, StepIntoIcon, StepOverIcon, StepReturnIcon, SuspendIcon, TerminateIcon
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
  const st = appStore.getState()
  return (
    <div className="toolbar">
      <TbButton title="Save (Ctrl+S)" disabled={!canSave} onClick={() => void st.saveTab()}><SaveIcon /></TbButton>
      <Sep />
      <TbButton title="Build Project (Ctrl+B)" disabled={!canBuild} onClick={() => void st.build('build')}><HammerIcon /></TbButton>
      <TbButton title="Debug (F11)" disabled><BugIcon /></TbButton>
      {perspective === 'debug' && (
        <>
          <Sep />
          <TbButton title="Resume (F8)" disabled><ResumeIcon /></TbButton>
          <TbButton title="Suspend (Alt+F8)" disabled><SuspendIcon /></TbButton>
          <TbButton title="Terminate (Ctrl+F2)" disabled><TerminateIcon /></TbButton>
          <Sep />
          <TbButton title="Step Into (F5)" disabled><StepIntoIcon /></TbButton>
          <TbButton title="Step Over (F6)" disabled><StepOverIcon /></TbButton>
          <TbButton title="Step Return (F7)" disabled><StepReturnIcon /></TbButton>
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
