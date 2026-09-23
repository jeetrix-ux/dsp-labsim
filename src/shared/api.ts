export interface ProjectInfo {
  name: string
  dir: string
  isCcsProject: boolean
}

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: FileNode[]
}

export type MenuCommand =
  | 'file.save'
  | 'file.saveAll'
  | 'file.refresh'
  | 'file.switchWorkspace'
  | 'window.editPerspective'
  | 'window.debugPerspective'

export interface LabsimApi {
  getWorkspace(): Promise<string>
  /** Shows a folder picker; resolves to the new workspace or null if cancelled. */
  switchWorkspace(): Promise<string | null>
  listProjects(): Promise<ProjectInfo[]>
  readTree(projectDir: string): Promise<FileNode[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  /** Subscribes to application-menu commands; returns an unsubscribe function. */
  onMenu(cb: (cmd: MenuCommand) => void): () => void
}

declare global {
  interface Window {
    labsim: LabsimApi
  }
}
