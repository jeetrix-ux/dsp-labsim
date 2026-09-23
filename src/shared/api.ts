import type { BuildKind, BuildOutputLine, BuildResult, Toolchain } from './build'
import type { DebugCommand, DebugEvent } from './debug'

export type { BuildKind, BuildOutputLine, BuildResult, Diagnostic, Toolchain } from './build'

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
  | 'project.build'
  | 'project.rebuild'
  | 'project.clean'
  | 'window.editPerspective'
  | 'window.debugPerspective'
  | 'window.compilerLocation'
  | 'run.debug'
  | 'run.resume'
  | 'run.suspend'
  | 'run.terminate'
  | 'run.restart'
  | 'run.reload'
  | 'run.stepInto'
  | 'run.stepOver'
  | 'run.stepReturn'
  | 'run.toLine'

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
  getToolchain(): Promise<Toolchain | null>
  /** Folder picker for the C6000 CGT root; resolves to the toolchain now in use (null if none). */
  chooseCompiler(): Promise<Toolchain | null>
  build(projectDir: string, kind: BuildKind): Promise<BuildResult>
  onBuildOutput(cb: (line: BuildOutputLine) => void): () => void
  /** Starts debugging the project's last successful build (stopping any running session first). */
  debugStart(projectDir: string): Promise<void>
  debugRequest(cmd: DebugCommand): Promise<unknown>
  debugTerminate(): Promise<void>
  onDebugEvent(cb: (event: DebugEvent) => void): () => void
}

declare global {
  interface Window {
    labsim: LabsimApi
  }
}
