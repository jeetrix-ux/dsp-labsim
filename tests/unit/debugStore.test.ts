import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult, FileNode, LabsimApi, ProjectInfo } from '@shared/api'
import type { DebugCommand, DebugEvent, VarNode } from '@shared/debug'
import { cioConsoleName, createDebugStore, type DebugStore } from '../../src/renderer/src/debugStore'
import { buildConsoleName, createAppStore, type AppStore } from '../../src/renderer/src/store'

const WS = 'C:\\ws'
const P = `${WS}\\exp11`
const MAIN = `${P}\\main.c`
const CIO = cioConsoleName(P)

const node = (name: string, value: string, expandable = false): VarNode => ({ name, expr: name, type: 'int', value, address: '0x80001000', expandable })

function fakeApi() {
  const requests: DebugCommand[] = []
  const api = {
    requests,
    starts: [] as string[],
    terminated: 0,
    nextBuild: { ok: true, diagnostics: [], image: null } as BuildResult,
    getWorkspace: async () => WS,
    switchWorkspace: async () => null,
    listProjects: async (): Promise<ProjectInfo[]> => [{ name: 'exp11', dir: P, isCcsProject: true }],
    readTree: async (): Promise<FileNode[]> => [{ name: 'main.c', path: MAIN, kind: 'file' }],
    readFile: async () => 'int main(void)\n{\n    int i;\n}\n',
    writeFile: async () => {},
    onMenu: () => () => {},
    getToolchain: async () => null,
    chooseCompiler: async () => null,
    build: async () => api.nextBuild,
    onBuildOutput: () => () => {},
    debugStart: async (dir: string) => {
      api.starts.push(dir)
    },
    debugTerminate: async () => {
      api.terminated++
    },
    onDebugEvent: () => () => {},
    debugRequest: async (cmd: DebugCommand): Promise<unknown> => {
      requests.push(cmd)
      switch (cmd.cmd) {
        case 'stackFrames':
          return [{ index: 0, name: 'main', file: MAIN, line: 3 }]
        case 'variables':
          return [node('i', cmd.formats.i === 'hex' ? '0x00000002' : '2')]
        case 'evaluate':
          return node(cmd.expr, '42')
        case 'children':
          return [node('[0]', '7')]
        case 'setBreakpoints':
          return cmd.lines.map((l) => (l === 1 ? 3 : l > 4 ? null : l))
        default:
          return null
      }
    }
  }
  return api
}

let api: ReturnType<typeof fakeApi>
let app: AppStore
let dbg: DebugStore
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const lines = (name: string): string[] => (app.getState().consoles[name] ?? []).map((l) => l.text)
const stopped = (line: number, reason: 'breakpoint' | 'step' | 'entry' = 'step'): DebugEvent => ({ event: 'stopped', reason, file: MAIN, line })

beforeEach(async () => {
  api = fakeApi()
  app = createAppStore(api as unknown as LabsimApi)
  await app.getState().init()
  dbg = createDebugStore(api as unknown as LabsimApi, app)
})

describe('starting', () => {
  it('builds, clears the CIO console, switches to CCS Debug and launches', async () => {
    app.getState().print(CIO, 'old')
    await dbg.getState().start()
    expect(api.starts).toEqual([P])
    expect(dbg.getState()).toMatchObject({ status: 'starting', project: P })
    expect(app.getState()).toMatchObject({ perspective: 'debug', activeConsole: CIO })
    expect(lines(CIO)).toEqual([])
  })

  it('does not launch when the build fails', async () => {
    api.nextBuild = { ok: false, diagnostics: [], image: null }
    await dbg.getState().start()
    expect(api.starts).toEqual([])
    expect(lines(buildConsoleName(P)).at(-1)).toBe("Errors exist in project 'exp11'. Fix them before debugging.")
  })

  it('sends breakpoints once loaded and moves them to verified lines', async () => {
    await dbg.getState().toggleBreakpoint(MAIN, 1)
    await dbg.getState().toggleBreakpoint(MAIN, 9)
    expect(api.requests).toEqual([])
    await dbg.getState().start()
    dbg.getState().handleEvent({ event: 'loaded' })
    await settle()
    expect(api.requests).toEqual([{ cmd: 'setBreakpoints', file: MAIN, lines: [1, 9] }])
    expect(dbg.getState().breakpoints).toEqual([
      { file: MAIN, line: 3, enabled: true, verified: true },
      { file: MAIN, line: 9, enabled: true, verified: false }
    ])
    expect(dbg.getState().status).toBe('running')
  })
})

describe('stopping', () => {
  beforeEach(async () => {
    await dbg.getState().start()
    dbg.getState().handleEvent({ event: 'loaded' })
    await dbg.getState().addExpression('y[3]')
  })

  it('refreshes frames, variables and expressions and shows the line', async () => {
    dbg.getState().handleEvent(stopped(3, 'entry'))
    await settle()
    await settle()
    const s = dbg.getState()
    expect(s).toMatchObject({ status: 'suspended', reason: 'entry', pc: { file: MAIN, line: 3 }, selectedFrame: 0 })
    expect(s.frames.map((f) => f.name)).toEqual(['main'])
    expect(s.variables.map((v) => v.value)).toEqual(['2'])
    expect(s.results['y[3]'].value).toBe('42')
    expect(app.getState().activeTab).toBe(MAIN)
    expect(app.getState().reveal).toMatchObject({ path: MAIN, line: 3 })
  })

  it('sends step commands only while suspended, and suspend only while running', async () => {
    api.requests.length = 0
    await dbg.getState().stepOver()
    await dbg.getState().suspend()
    expect(api.requests.map((r) => r.cmd)).toEqual(['suspend'])
    dbg.getState().handleEvent(stopped(3))
    await settle()
    api.requests.length = 0
    await dbg.getState().stepOver()
    await dbg.getState().runToLine(MAIN, 4)
    expect(api.requests.map((r) => r.cmd)).toEqual(['stepOver', 'runToLine'])
    dbg.getState().handleEvent({ event: 'running' })
    expect(dbg.getState()).toMatchObject({ status: 'running', pc: null })
  })

  it('formats and expands values, and changes them', async () => {
    dbg.getState().handleEvent(stopped(3))
    await settle()
    await dbg.getState().setFormat('i', 'hex')
    expect(dbg.getState().variables[0].value).toBe('0x00000002')
    await dbg.getState().toggleExpand('var', 'y')
    expect(dbg.getState().children['var:y'].map((c) => c.value)).toEqual(['7'])
    await dbg.getState().toggleExpand('var', 'y')
    expect(dbg.getState().children['var:y']).toBeUndefined()
    await dbg.getState().editValue('i', '5')
    expect(api.requests).toContainEqual({ cmd: 'assign', frame: 0, expr: 'i', value: '5' })
  })
})

describe('console', () => {
  beforeEach(async () => {
    await dbg.getState().start()
    dbg.getState().handleEvent({ event: 'loaded' })
  })

  it('prefixes program output with [C674X_0] and shows notes and runtime errors', () => {
    const d = dbg.getState()
    d.handleEvent({ event: 'output', text: 'x=1\ny=2\n', stream: 'stdout' })
    d.handleEvent({ event: 'output', text: 'oops\n', stream: 'stderr' })
    d.handleEvent({ event: 'note', text: "write past end of 'y' (y[8], size 8)" })
    d.handleEvent({ event: 'stopped', reason: 'halt', file: MAIN, line: 4, message: 'Division by zero' })
    expect(app.getState().consoles[CIO].map((l) => `${l.kind}:${l.text}`)).toEqual([
      'out:[C674X_0] x=1',
      'out:[C674X_0] y=2',
      'error:[C674X_0] oops',
      "info:LabSim: write past end of 'y' (y[8], size 8)",
      'error:LabSim: Division by zero (main.c:4)'
    ])
    expect(dbg.getState().status).toBe('halted')
  })

  it('asks for input and sends the typed line', async () => {
    dbg.getState().handleEvent({ event: 'inputRequest' })
    expect(dbg.getState().inputPending).toBe(true)
    await dbg.getState().sendInput('21')
    expect(api.requests).toContainEqual({ cmd: 'input', text: '21' })
    expect(lines(CIO).at(-1)).toBe('21')
    expect(dbg.getState().inputPending).toBe(false)
  })

  it('goes idle when terminated', async () => {
    await dbg.getState().terminate()
    expect(api.terminated).toBe(1)
    expect(dbg.getState()).toMatchObject({ status: 'idle', pc: null, frames: [] })
  })
})
