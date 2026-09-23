import type { JSX } from 'react'

const box = { width: 16, height: 16, viewBox: '0 0 16 16' }

export const SaveIcon = (): JSX.Element => (
  <svg {...box}><rect x="2" y="2" width="12" height="12" rx="1" fill="#3a6ea5" /><rect x="4" y="2" width="8" height="4" fill="#dfe8f2" /><rect x="4" y="9" width="8" height="5" fill="#fff" /></svg>
)
export const HammerIcon = (): JSX.Element => (
  <svg {...box}><rect x="2" y="2" width="8" height="4" rx="1" fill="#7a5230" transform="rotate(-35 6 4)" /><rect x="7" y="5" width="2.2" height="10" rx="1" fill="#b08040" transform="rotate(-35 8 10)" /></svg>
)
export const BugIcon = (): JSX.Element => (
  <svg {...box}><ellipse cx="8" cy="9.5" rx="4" ry="5" fill="#4d8f2f" /><circle cx="8" cy="4" r="2.3" fill="#2f5f1a" /><path d="M1 7h3M12 7h3M1 11h3M12 11h3M8 5v9" stroke="#1e3d10" strokeWidth="1" /></svg>
)
export const ResumeIcon = (): JSX.Element => (
  <svg {...box}><rect x="2" y="3" width="2" height="10" fill="#2e8b3a" /><path d="M6 3l8 5-8 5z" fill="#2e8b3a" /></svg>
)
export const SuspendIcon = (): JSX.Element => (
  <svg {...box}><rect x="3" y="3" width="3.5" height="10" fill="#d9a400" /><rect x="9.5" y="3" width="3.5" height="10" fill="#d9a400" /></svg>
)
export const TerminateIcon = (): JSX.Element => (
  <svg {...box}><rect x="3" y="3" width="10" height="10" rx="1" fill="#c9302c" /></svg>
)
export const StepIntoIcon = (): JSX.Element => (
  <svg {...box}><path d="M8 1v9M4.5 6.5L8 10l3.5-3.5" stroke="#d9a400" strokeWidth="2" fill="none" /><circle cx="8" cy="13.5" r="1.8" fill="#3a6ea5" /></svg>
)
export const StepOverIcon = (): JSX.Element => (
  <svg {...box}><path d="M2 9a6 6 0 0 1 11-3" stroke="#d9a400" strokeWidth="2" fill="none" /><path d="M14 2v5h-5z" fill="#d9a400" /><circle cx="8" cy="13.5" r="1.8" fill="#3a6ea5" /></svg>
)
export const StepReturnIcon = (): JSX.Element => (
  <svg {...box}><path d="M8 13V4M4.5 7.5L8 4l3.5 3.5" stroke="#d9a400" strokeWidth="2" fill="none" /><rect x="3" y="1" width="10" height="1.8" fill="#3a6ea5" /></svg>
)
export const RefreshIcon = (): JSX.Element => (
  <svg {...box}><path d="M13 8a5 5 0 1 1-1.5-3.5" stroke="#3a6ea5" strokeWidth="1.8" fill="none" /><path d="M14 1.5v4.5H9.5z" fill="#3a6ea5" /></svg>
)
export const ProjectIcon = (): JSX.Element => (
  <svg {...box}><path d="M1 4h5l1.5 1.5H15V14H1z" fill="#e8c16a" /><rect x="9" y="8" width="5" height="5" fill="#c9302c" /></svg>
)
export const FolderIcon = (): JSX.Element => (
  <svg {...box}><path d="M1 4h5l1.5 1.5H15V14H1z" fill="#e8c16a" /></svg>
)
export const FileIcon = ({ name }: { name: string }): JSX.Element => {
  const isC = /\.[ch]$/i.test(name)
  return (
    <svg {...box}>
      <path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#8a8a8a" />
      {isC && <text x="8" y="12" fontSize="7" textAnchor="middle" fill="#3a6ea5" fontWeight="bold">{/\.h$/i.test(name) ? 'h' : 'c'}</text>}
    </svg>
  )
}
export const RestartIcon = (): JSX.Element => (
  <svg {...box}><path d="M3 8a5 5 0 1 0 1.6-3.7" stroke="#2e8b3a" strokeWidth="1.8" fill="none" /><path d="M2 1.5v4.5h4.5z" fill="#2e8b3a" /></svg>
)
