import { createStore } from 'zustand/vanilla'
import type { BuildKind, BuildOutputLine, BuildResult, Diagnostic, CompilerInfo, FileNode, LabsimApi, NewProjectOptions, ProjectInfo } from '@shared/api'
import { basename, isTextFile, joinPath } from '@shared/files'

export type Perspective = 'edit' | 'debug'
export type BottomTab = 'console' | 'problems' | 'memory'
export type ConsoleKind = 'out' | 'info' | 'error'

export interface ConsoleLine {
  text: string
  kind: ConsoleKind
}

export interface EditorTab {
  path: string
  title: string
  content: string
  savedContent: string
}

export const MAIN_CONSOLE = 'DSP LabSim'

export const isDirty = (t: EditorTab): boolean => t.content !== t.savedContent

export type DialogKind = 'newProject' | 'preferences'

/** Views that can be popped out into their own window. */
export type PopoutView = 'editor' | 'graphs'

/** An IPC rejection's message without Electron's "Error invoking remote method 'x': Error: " prefix. */
export const ipcError = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const buildConsoleName = (projectDir: string): string => `CDT Build Console [${basename(projectDir)}]`

const inside = (dir: string, file: string): boolean => {
  const d = dir.toLowerCase()
  const f = file.toLowerCase()
  return f.startsWith(d + '\\') || f.startsWith(d + '/')
}

export interface AppState {
  workspace: string
  projects: ProjectInfo[]
  /** Project dir → its file tree, loaded on first expand. */
  trees: Record<string, FileNode[]>
  /** Project or folder path → expanded in the explorer. */
  expanded: Record<string, boolean>
  selectedProject: string | null
  tabs: EditorTab[]
  activeTab: string | null
  perspective: Perspective
  consoles: Record<string, ConsoleLine[]>
  activeConsole: string
  bottomTab: BottomTab
  building: boolean
  diagnostics: Diagnostic[]
  /** Editor request to show a line; seq changes on every request. */
  reveal: { path: string; line: number; seq: number } | null

  init(): Promise<void>
  refresh(): Promise<void>
  switchWorkspace(): Promise<void>
  toggleExpand(path: string): Promise<void>
  selectProject(dir: string): void
  openFile(path: string): Promise<void>
  closeTab(path: string): void
  setActiveTab(path: string): void
  editTab(path: string, content: string): void
  /** Saves the given tab, or the active one; a no-op when it is not dirty. */
  saveTab(path?: string): Promise<void>
  saveAll(): Promise<void>
  setPerspective(p: Perspective): void
  print(consoleName: string, text: string, kind?: ConsoleKind): void
  clearConsole(consoleName: string): void
  setActiveConsole(consoleName: string): void
  setBottomTab(tab: BottomTab): void
  build(kind: BuildKind): Promise<BuildResult | null>
  chooseCompiler(): Promise<void>
  compiler: CompilerInfo | null
  loadCompiler(): Promise<void>
  autoDetectCompiler(): Promise<void>
  dialog: DialogKind | null
  /** Which views are in their own window. */
  popout: Record<PopoutView, boolean>
  setPopout(view: PopoutView, open: boolean): void
  openDialog(d: DialogKind): void
  closeDialog(): void
  /** File > New > CCS Project; resolves to an error to show in the dialog, or null when done. */
  createProject(o: NewProjectOptions): Promise<string | null>
  openAt(path: string, line: number): Promise<void>
  appendBuildOutput(line: BuildOutputLine): void
}

export function createAppStore(api: LabsimApi) {
  return createStore<AppState>()((set, get) => ({
    workspace: '',
    projects: [],
    trees: {},
    expanded: {},
    selectedProject: null,
    tabs: [],
    activeTab: null,
    perspective: 'edit',
    consoles: { [MAIN_CONSOLE]: [] },
    activeConsole: MAIN_CONSOLE,
    bottomTab: 'console',
    dialog: null,
    popout: { editor: false, graphs: false },
    compiler: null,
    building: false,
    diagnostics: [],
    reveal: null,

    async init() {
      const workspace = await api.getWorkspace()
      const projects = await api.listProjects()
      set({ workspace, projects, trees: {}, expanded: {}, selectedProject: projects[0]?.dir ?? null })
      const n = projects.length
      get().print(MAIN_CONSOLE, `Workspace: ${workspace} (${n} project${n === 1 ? '' : 's'})`, 'info')
      const tc = await api.getToolchain()
      if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version})`, 'info')
      else get().print(MAIN_CONSOLE, "C6000 compiler (cl6x) not found. Builds will use the LabSim front-end; choose TI's compiler in Window > Preferences.", 'error')
    },

    async refresh() {
      const projects = await api.listProjects()
      const trees: Record<string, FileNode[]> = {}
      for (const dir of Object.keys(get().trees)) {
        if (projects.some((p) => p.dir === dir)) trees[dir] = await api.readTree(dir)
      }
      set({ projects, trees })
    },

    async switchWorkspace() {
      if (get().tabs.some(isDirty)) {
        get().print(MAIN_CONSOLE, 'Save or close modified files before switching workspace.', 'error')
        return
      }
      const picked = await api.switchWorkspace()
      if (!picked) return
      set({ tabs: [], activeTab: null })
      await get().init()
    },

    async toggleExpand(path) {
      const open = !get().expanded[path]
      const isProject = get().projects.some((p) => p.dir === path)
      if (open && isProject && !get().trees[path]) {
        const tree = await api.readTree(path)
        set((s) => ({ trees: { ...s.trees, [path]: tree } }))
      }
      set((s) => ({ expanded: { ...s.expanded, [path]: open } }))
    },

    selectProject(dir) {
      set({ selectedProject: dir })
    },

    async openFile(path) {
      const owner = get().projects.find((p) => inside(p.dir, path))
      if (get().tabs.some((t) => t.path === path)) {
        set({ activeTab: path, ...(owner ? { selectedProject: owner.dir } : {}) })
        return
      }
      if (!isTextFile(path)) {
        get().print(MAIN_CONSOLE, `${basename(path)} is not a text file and cannot be opened in the editor.`, 'info')
        return
      }
      let content: string
      try {
        content = await api.readFile(path)
      } catch (e) {
        get().print(MAIN_CONSOLE, `Could not open ${path}: ${String(e)}`, 'error')
        return
      }
      set((s) => ({
        tabs: [...s.tabs, { path, title: basename(path), content, savedContent: content }],
        activeTab: path,
        ...(owner ? { selectedProject: owner.dir } : {})
      }))
    },

    closeTab(path) {
      set((s) => {
        const i = s.tabs.findIndex((t) => t.path === path)
        if (i < 0) return {}
        const tabs = s.tabs.filter((t) => t.path !== path)
        const activeTab = s.activeTab !== path ? s.activeTab : ((tabs[i] ?? tabs[i - 1])?.path ?? null)
        return { tabs, activeTab }
      })
    },

    setActiveTab(path) {
      set({ activeTab: path })
    },

    editTab(path, content) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content } : t)) }))
    },

    async saveTab(path) {
      const target = path ?? get().activeTab
      const tab = get().tabs.find((t) => t.path === target)
      if (!tab || !isDirty(tab)) return
      const content = tab.content
      try {
        await api.writeFile(tab.path, content)
      } catch (e) {
        get().print(MAIN_CONSOLE, `Could not save ${tab.path}: ${String(e)}`, 'error')
        return
      }
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === tab.path ? { ...t, savedContent: content } : t)) }))
    },

    async saveAll() {
      for (const t of get().tabs.filter(isDirty)) await get().saveTab(t.path)
    },

    setPerspective(perspective) {
      set({ perspective })
    },

    print(consoleName, text, kind = 'out') {
      const lines = text.split(/\r?\n/).map((t) => ({ text: t, kind }))
      set((s) => ({ consoles: { ...s.consoles, [consoleName]: [...(s.consoles[consoleName] ?? []), ...lines] } }))
    },

    clearConsole(consoleName) {
      set((s) => ({ consoles: { ...s.consoles, [consoleName]: [] } }))
    },

    setActiveConsole(consoleName) {
      set({ activeConsole: consoleName })
    },

    setBottomTab(bottomTab) {
      set({ bottomTab })
    },

    async build(kind) {
      const dir = get().selectedProject
      if (!dir || get().building) return null
      // Mark the build as started before any await, so a second click cannot start another one.
      const consoleName = buildConsoleName(dir)
      set((s) => ({ building: true, consoles: { ...s.consoles, [consoleName]: [] }, activeConsole: consoleName, bottomTab: 'console' }))
      try {
        await get().saveAll()
        const result = await api.build(dir, kind)
        set({ diagnostics: result.diagnostics })
        return result
      } catch (e) {
        get().print(consoleName, `Build failed: ${String(e)}`, 'error')
        return null
      } finally {
        set({ building: false })
      }
    },

    async chooseCompiler() {
      try {
        const tc = await api.chooseCompiler()
        if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version})`, 'info')
      } catch (e) {
        get().print(MAIN_CONSOLE, ipcError(e), 'error')
      }
      await get().loadCompiler()
    },

    async loadCompiler() {
      set({ compiler: await api.compilerInfo() })
    },

    async autoDetectCompiler() {
      const tc = await api.autoDetectCompiler()
      if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version}), auto-detected`, 'info')
      else get().print(MAIN_CONSOLE, 'C6000 compiler: not found by auto-detect; builds will use the LabSim front-end.', 'info')
      await get().loadCompiler()
    },

    setPopout(view, open) {
      set((s) => ({ popout: { ...s.popout, [view]: open } }))
    },

    openDialog(dialog) {
      set({ dialog })
    },

    closeDialog() {
      set({ dialog: null })
    },

    async createProject(o) {
      let dir: string
      try {
        dir = await api.createProject(o)
      } catch (e) {
        return ipcError(e)
      }
      await get().refresh()
      set({ selectedProject: dir, dialog: null })
      if (!get().expanded[dir]) await get().toggleExpand(dir)
      await get().openFile(joinPath(dir, 'main.c'))
      get().print(MAIN_CONSOLE, `Created project ${o.name} in ${dir}`, 'info')
      return null
    },

    async openAt(path, line) {
      await get().openFile(path)
      if (get().activeTab !== path) return
      set((s) => ({ reveal: { path, line, seq: (s.reveal?.seq ?? 0) + 1 } }))
    },

    appendBuildOutput(line) {
      get().print(line.console, line.text, line.kind)
    }
  }))
}

export type AppStore = ReturnType<typeof createAppStore>
