import type { BuildKind, BuildOutputLine, BuildResult, Toolchain } from './build'
import type { DebugCommand, DebugEvent } from './debug'
import type { NewProjectOptions } from './newProject'

export type { BuildKind, BuildOutputLine, BuildResult, Diagnostic, Toolchain } from './build'
export type { NewProjectOptions } from './newProject'

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

export interface FileDialogOptions {
  title: string
  /** File name (or path) the dialog starts with. */
  defaultName?: string
  filters: { name: string; extensions: string[] }[]
}

export interface CompilerInfo {
  toolchain: Toolchain | null
  /** The folder was chosen in Preferences (or by LABSIM_COMPILER_ROOT), not auto-detected. */
  chosen: boolean
}

export type MenuCommand =
  | 'file.newProject'
  | 'file.save'
  | 'file.saveAll'
  | 'file.refresh'
  | 'file.switchWorkspace'
  | 'project.build'
  | 'project.rebuild'
  | 'project.clean'
  | 'window.editPerspective'
  | 'window.debugPerspective'
  | 'window.preferences'
  | 'view.memoryBrowser'
  | 'tools.graphSingleTime'
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
  compilerInfo(): Promise<CompilerInfo>
  /** Forgets the chosen compiler folder and auto-detects again; resolves to the toolchain now in use. */
  autoDetectCompiler(): Promise<Toolchain | null>
  build(projectDir: string, kind: BuildKind): Promise<BuildResult>
  onBuildOutput(cb: (line: BuildOutputLine) => void): () => void
  /** Starts debugging the project's last successful build (stopping any running session first). */
  debugStart(projectDir: string): Promise<void>
  debugRequest(cmd: DebugCommand): Promise<unknown>
  debugTerminate(): Promise<void>
  onDebugEvent(cb: (event: DebugEvent) => void): () => void
  /** A save dialog; resolves to the chosen path (writable with writeChosenFile) or null if cancelled. */
  chooseSaveFile(opts: FileDialogOptions): Promise<string | null>
  /** Writes a file the user picked with chooseSaveFile. */
  writeChosenFile(path: string, data: string, encoding: 'utf8' | 'base64'): Promise<void>
  /** An open dialog for a text file; resolves to its path and content, or null if cancelled. */
  openTextFile(opts: FileDialogOptions): Promise<{ path: string; content: string } | null>
  /** Creates a project in the workspace (File > New > CCS Project); resolves to its folder. */
  createProject(opts: NewProjectOptions): Promise<string>
}

declare global {
  interface Window {
    labsim: LabsimApi
  }
}
