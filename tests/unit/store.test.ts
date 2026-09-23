import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildKind, BuildResult, Diagnostic, FileNode, LabsimApi, MenuCommand, NewProjectOptions, ProjectInfo, Toolchain } from '@shared/api'
import { NEW_PROJECT_DEFAULTS } from '@shared/newProject'
import { buildConsoleName, createAppStore, isDirty, MAIN_CONSOLE, type AppStore } from '../../src/renderer/src/store'

const WS = 'C:\\ws'
const P = `${WS}\\exp11`
const MAIN = `${P}\\main.c`
const CMD = `${P}\\C6748.cmd`
const OUT = `${P}\\Debug\\exp11.out`

type FakeApi = LabsimApi & {
  files: Record<string, string>
  treeCalls: number
  nextWorkspace: string | null
  buildCalls: [string, BuildKind][]
  nextBuild: BuildResult
  toolchain: Toolchain | null
  created: NewProjectOptions[]
  autoCalls: number
}

function fakeApi(): FakeApi {
  const projects: ProjectInfo[] = [{ name: 'exp11', dir: P, isCcsProject: true }]
  const tree: FileNode[] = [
    { name: 'Debug', path: `${P}\\Debug`, kind: 'dir', children: [{ name: 'exp11.out', path: OUT, kind: 'file' }] },
    { name: 'C6748.cmd', path: CMD, kind: 'file' },
    { name: 'main.c', path: MAIN, kind: 'file' }
  ]
  const api: FakeApi = {
    chooseSaveFile: async () => null,
    writeChosenFile: async () => {},
    openTextFile: async () => null,
    created: [],
    createProject: async (o: NewProjectOptions) => {
      if (o.name === 'dup') throw new Error("Error invoking remote method 'project:create': Error: 'dup' already exists in the workspace.")
      api.created.push(o)
      const dir = `${WS}\\${o.name}`
      projects.push({ name: o.name, dir, isCcsProject: false })
      api.files[`${dir}\\main.c`] = 'int main(void)\r\n{\r\n\treturn 0;\r\n}\r\n'
      return dir
    },
    buildCalls: [],
    nextBuild: { ok: true, diagnostics: [], image: null },
    toolchain: { root: 'C:\\ti\\cgt', version: '8.3.12', cl6x: 'C:\\ti\\cgt\\bin\\cl6x.exe' },
    getToolchain: async () => api.toolchain,
    chooseCompiler: async () => api.toolchain,
    autoCalls: 0,
    compilerInfo: async () => ({ toolchain: api.toolchain, chosen: api.toolchain !== null }),
    autoDetectCompiler: async () => {
      api.autoCalls++
      api.toolchain = null
      return null
    },
    build: async (dir: string, kind: BuildKind) => {
      api.buildCalls.push([dir, kind])
      return api.nextBuild
    },
    onBuildOutput: () => () => {},
    debugStart: async () => {},
    debugRequest: async () => null,
    debugTerminate: async () => {},
    onDebugEvent: () => () => {},
    files: { [MAIN]: 'int main(void)\r\n{\r\n}\r\n', [CMD]: 'MEMORY {}' } as Record<string, string>,
    treeCalls: 0,
    nextWorkspace: null as string | null,
    getWorkspace: async () => WS,
    switchWorkspace: async () => api.nextWorkspace,
    listProjects: async () => projects,
    readTree: async () => {
      api.treeCalls++
      return tree
    },
    readFile: async (p: string) => {
      if (!(p in api.files)) throw new Error(`ENOENT ${p}`)
      return api.files[p]
    },
    writeFile: async (p: string, c: string) => {
      api.files[p] = c
    },
    onMenu: (_cb: (c: MenuCommand) => void) => () => {}
  }
  return api
}

let api: ReturnType<typeof fakeApi>
let store: AppStore
beforeEach(async () => {
  api = fakeApi()
  store = createAppStore(api)
  await store.getState().init()
})

describe('init', () => {
  it('loads workspace and projects, selects the first project, prints a banner', () => {
    const s = store.getState()
    expect(s.workspace).toBe(WS)
    expect(s.projects.map((p) => p.name)).toEqual(['exp11'])
    expect(s.selectedProject).toBe(P)
    expect(s.consoles[MAIN_CONSOLE].map((l) => l.text)).toEqual([
      `Workspace: ${WS} (1 project)`,
      'C6000 compiler: C:\\ti\\cgt (v8.3.12)'
    ])
  })
})

describe('project tree', () => {
  it('loads a project tree once, on first expand', async () => {
    await store.getState().toggleExpand(P)
    expect(store.getState().expanded[P]).toBe(true)
    expect(store.getState().trees[P]).toHaveLength(3)
    await store.getState().toggleExpand(P)
    await store.getState().toggleExpand(P)
    expect(api.treeCalls).toBe(1)
  })
})

describe('editor tabs', () => {
  it('opens a file once and activates it', async () => {
    await store.getState().openFile(MAIN)
    await store.getState().openFile(CMD)
    await store.getState().openFile(MAIN)
    const s = store.getState()
    expect(s.tabs.map((t) => t.title)).toEqual(['main.c', 'C6748.cmd'])
    expect(s.activeTab).toBe(MAIN)
  })
  it('does not open binary files and says why', async () => {
    await store.getState().openFile(OUT)
    expect(store.getState().tabs).toHaveLength(0)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toContain('exp11.out')
  })
  it('reports read errors in the console', async () => {
    await store.getState().openFile(`${P}\\gone.c`)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)).toMatchObject({ kind: 'error' })
  })
  it('tracks dirty state and saves exactly what the editor holds', async () => {
    await store.getState().openFile(MAIN)
    store.getState().editTab(MAIN, 'int main(void)\r\n{\r\n  return 1;\r\n}\r\n')
    expect(isDirty(store.getState().tabs[0])).toBe(true)
    await store.getState().saveTab()
    expect(api.files[MAIN]).toBe('int main(void)\r\n{\r\n  return 1;\r\n}\r\n')
    expect(isDirty(store.getState().tabs[0])).toBe(false)
  })
  it('saveAll writes every dirty tab', async () => {
    await store.getState().openFile(MAIN)
    await store.getState().openFile(CMD)
    store.getState().editTab(MAIN, 'a')
    store.getState().editTab(CMD, 'b')
    await store.getState().saveAll()
    expect([api.files[MAIN], api.files[CMD]]).toEqual(['a', 'b'])
  })
  it('closing the active tab activates its right neighbour, else the left', async () => {
    await store.getState().openFile(MAIN)
    await store.getState().openFile(CMD)
    store.getState().setActiveTab(MAIN)
    store.getState().closeTab(MAIN)
    expect(store.getState().activeTab).toBe(CMD)
    store.getState().closeTab(CMD)
    expect(store.getState().activeTab).toBeNull()
  })
})

describe('workspace switching', () => {
  it('refuses while files are modified', async () => {
    await store.getState().openFile(MAIN)
    store.getState().editTab(MAIN, 'x')
    api.nextWorkspace = 'C:\\other'
    await store.getState().switchWorkspace()
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.kind).toBe('error')
  })
  it('closes tabs and reloads when a folder is picked', async () => {
    await store.getState().openFile(MAIN)
    api.nextWorkspace = 'C:\\other'
    await store.getState().switchWorkspace()
    expect(store.getState().tabs).toHaveLength(0)
  })
})

describe('console', () => {
  it('splits multi-line text into lines and clears', () => {
    store.getState().print('Build', 'a\r\nb', 'out')
    expect(store.getState().consoles.Build).toEqual([{ text: 'a', kind: 'out' }, { text: 'b', kind: 'out' }])
    store.getState().clearConsole('Build')
    expect(store.getState().consoles.Build).toEqual([])
  })
})

describe('perspective', () => {
  it('switches', () => {
    store.getState().setPerspective('debug')
    expect(store.getState().perspective).toBe('debug')
  })
})

describe('compiler status', () => {
  it('warns at startup when cl6x is missing', async () => {
    api = fakeApi()
    api.toolchain = null
    store = createAppStore(api)
    await store.getState().init()
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)).toMatchObject({ kind: 'error' })
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toContain('not found')
  })
})

describe('build', () => {
  const ERR: Diagnostic = { file: MAIN, line: 2, severity: 'error', code: '20', message: 'identifier "y" is undefined' }

  it('saves modified files, then builds the selected project into its build console', async () => {
    await store.getState().openFile(MAIN)
    store.getState().editTab(MAIN, 'changed')
    api.nextBuild = { ok: false, diagnostics: [ERR], image: null }
    const r = await store.getState().build('build')
    expect(api.files[MAIN]).toBe('changed')
    expect(api.buildCalls).toEqual([[P, 'build']])
    expect(r?.ok).toBe(false)
    const s = store.getState()
    expect(s.diagnostics).toEqual([ERR])
    expect(s.building).toBe(false)
    expect(s.activeConsole).toBe(buildConsoleName(P))
    expect(s.bottomTab).toBe('console')
  })
  it('clears the previous build console and appends streamed lines', async () => {
    const name = buildConsoleName(P)
    expect(name).toBe('CDT Build Console [exp11]')
    store.getState().print(name, 'old')
    const pending = store.getState().build('build')
    store.getState().appendBuildOutput({ console: name, text: '<Linking>', kind: 'out' })
    await pending
    expect(store.getState().consoles[name].map((l) => l.text)).toEqual(['<Linking>'])
  })
  it('does nothing without a selected project', async () => {
    store.setState({ selectedProject: null })
    expect(await store.getState().build('build')).toBeNull()
    expect(api.buildCalls).toEqual([])
  })
})

describe('navigation', () => {
  it('opening a file selects its project', async () => {
    store.setState({ selectedProject: null })
    await store.getState().openFile(MAIN)
    expect(store.getState().selectedProject).toBe(P)
  })
  it('openAt opens the file and requests a reveal of the line', async () => {
    await store.getState().openAt(MAIN, 7)
    await store.getState().openAt(MAIN, 9)
    expect(store.getState().activeTab).toBe(MAIN)
    expect(store.getState().reveal).toEqual({ path: MAIN, line: 9, seq: 2 })
  })
})

describe('new project', () => {
  it('creates the project, selects and expands it, opens main.c and closes the dialog', async () => {
    store.getState().openDialog('newProject')
    expect(store.getState().dialog).toBe('newProject')
    expect(await store.getState().createProject({ name: 'lab1', ...NEW_PROJECT_DEFAULTS })).toBeNull()
    const dir = `${WS}\\lab1`
    expect(api.created).toEqual([{ name: 'lab1', ...NEW_PROJECT_DEFAULTS }])
    expect(store.getState().projects.map((p) => p.name)).toContain('lab1')
    expect(store.getState()).toMatchObject({ dialog: null, selectedProject: dir, activeTab: `${dir}\\main.c` })
    expect(store.getState().expanded[dir]).toBe(true)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toBe(`Created project lab1 in ${dir}`)
  })

  it('returns the error without the IPC prefix and keeps the dialog open', async () => {
    store.getState().openDialog('newProject')
    expect(await store.getState().createProject({ name: 'dup', ...NEW_PROJECT_DEFAULTS })).toBe("'dup' already exists in the workspace.")
    expect(store.getState().dialog).toBe('newProject')
    store.getState().closeDialog()
    expect(store.getState().dialog).toBeNull()
  })
})

describe('preferences', () => {
  it('loads the compiler in use and switches to auto-detect', async () => {
    await store.getState().loadCompiler()
    expect(store.getState().compiler).toEqual({ toolchain: api.toolchain, chosen: true })
    await store.getState().autoDetectCompiler()
    expect(api.autoCalls).toBe(1)
    expect(store.getState().compiler).toEqual({ toolchain: null, chosen: false })
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toBe('C6000 compiler: not found by auto-detect; builds will use the LabSim front-end.')
  })

  it('refreshes the compiler after Browse', async () => {
    await store.getState().chooseCompiler()
    expect(store.getState().compiler?.toolchain?.version).toBe('8.3.12')
  })
})

describe('bottom panel', () => {
  it('can show the Memory Browser', () => {
    store.getState().setBottomTab('memory')
    expect(store.getState().bottomTab).toBe('memory')
  })
})
