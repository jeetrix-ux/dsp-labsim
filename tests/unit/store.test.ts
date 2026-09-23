import { beforeEach, describe, expect, it } from 'vitest'
import type { FileNode, LabsimApi, MenuCommand, ProjectInfo } from '@shared/api'
import { createAppStore, isDirty, MAIN_CONSOLE, type AppStore } from '../../src/renderer/src/store'

const WS = 'C:\\ws'
const P = `${WS}\\exp11`
const MAIN = `${P}\\main.c`
const CMD = `${P}\\C6748.cmd`
const OUT = `${P}\\Debug\\exp11.out`

function fakeApi(): LabsimApi & { files: Record<string, string>; treeCalls: number; nextWorkspace: string | null } {
  const projects: ProjectInfo[] = [{ name: 'exp11', dir: P, isCcsProject: true }]
  const tree: FileNode[] = [
    { name: 'Debug', path: `${P}\\Debug`, kind: 'dir', children: [{ name: 'exp11.out', path: OUT, kind: 'file' }] },
    { name: 'C6748.cmd', path: CMD, kind: 'file' },
    { name: 'main.c', path: MAIN, kind: 'file' }
  ]
  const api = {
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
    expect(s.consoles[MAIN_CONSOLE].at(-1)).toEqual({ text: `Workspace: ${WS} (1 project)`, kind: 'info' })
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
