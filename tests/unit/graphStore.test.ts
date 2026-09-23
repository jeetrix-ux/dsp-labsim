import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { FileDialogOptions, LabsimApi } from '@shared/api'
import type { DebugCommand } from '@shared/debug'
import type { SessionStatus } from '../../src/renderer/src/debugStore'
import { DEFAULT_PROPS, type GraphProps } from '../../src/renderer/src/graph/model'
import { createGraphStore, NO_SESSION, type GraphStore } from '../../src/renderer/src/graphStore'
import { createAppStore, type AppStore } from '../../src/renderer/src/store'

const P = 'C:\\ws\\exp11'
const Y = 0x80001000

function f32(values: number[]): number[] {
  const v = new DataView(new ArrayBuffer(values.length * 4))
  values.forEach((x, i) => v.setFloat32(i * 4, x, true))
  return [...new Uint8Array(v.buffer)]
}

function fakeApi() {
  const api = {
    requests: [] as DebugCommand[],
    /** Target memory: address → float32 values. */
    memory: new Map<number, number[]>([[Y, [0, 0.5, 2, 4.5]]]),
    written: [] as { path: string; data: string; encoding: string }[],
    savePath: null as string | null,
    saveOptions: [] as FileDialogOptions[],
    openResult: null as { path: string; content: string } | null,
    debugRequest: async (cmd: DebugCommand): Promise<unknown> => {
      api.requests.push(cmd)
      if (cmd.cmd === 'address') return cmd.expr === 'y' ? { address: Y } : cmd.expr === 'bad' ? { address: 0 } : { error: `identifier "${cmd.expr}" is undefined` }
      if (cmd.cmd === 'readMemory') {
        const vals = api.memory.get(cmd.addr)
        return vals ? f32(vals).slice(0, cmd.length) : null
      }
      return null
    },
    chooseSaveFile: async (o: FileDialogOptions) => {
      api.saveOptions.push(o)
      return api.savePath
    },
    writeChosenFile: async (path: string, data: string, encoding: string) => {
      api.written.push({ path, data, encoding })
    },
    openTextFile: async () => api.openResult
  }
  return api
}

type Mini = { status: SessionStatus; project: string | null; selectedFrame: number }

let api: ReturnType<typeof fakeApi>
let app: AppStore
let debug: StoreApi<Mini>
let storage: Map<string, string>
let graphs: GraphStore
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}
const props = (over: Partial<GraphProps>): GraphProps => ({ ...DEFAULT_PROPS, startAddress: 'y', acquisitionBufferSize: 4, displayDataSize: 4, dspDataType: '32 bit floating point', ...over })
const g0 = () => graphs.getState().graphs[0]

async function open(over: Partial<GraphProps> = {}): Promise<string> {
  graphs.getState().openNew()
  expect(await graphs.getState().applyDialog(props(over))).toBeNull()
  return g0().id
}

beforeEach(() => {
  api = fakeApi()
  app = createAppStore(api as unknown as LabsimApi)
  debug = createStore<Mini>()(() => ({ status: 'suspended', project: P, selectedFrame: 1 }))
  storage = new Map()
  graphs = createGraphStore(api as unknown as LabsimApi, app, debug, { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dialog', () => {
  it('starts from the defaults, then from the project’s last-used properties', async () => {
    graphs.getState().openNew()
    expect(graphs.getState().dialog).toEqual({ graphId: null, props: DEFAULT_PROPS })
    await graphs.getState().applyDialog(props({ qValue: 3 }))
    graphs.getState().openNew()
    expect(graphs.getState().dialog?.props).toEqual(props({ qValue: 3 }))
    debug.setState({ project: 'C:\\ws\\other' })
    graphs.getState().openNew()
    expect(graphs.getState().dialog?.props).toEqual(DEFAULT_PROPS)
  })

  it('rejects invalid properties and keeps the dialog open', async () => {
    graphs.getState().openNew()
    expect(await graphs.getState().applyDialog({ ...DEFAULT_PROPS, qValue: 40 })).toBe('Q_Value must be a whole number from 0 to 31')
    expect(graphs.getState().dialog).not.toBeNull()
    expect(graphs.getState().graphs).toHaveLength(0)
  })

  it('imports and exports settings files', async () => {
    api.savePath = 'C:\\tmp\\g.graphProp'
    await graphs.getState().exportProps(props({ qValue: 2 }))
    expect(api.written[0]).toMatchObject({ path: 'C:\\tmp\\g.graphProp', encoding: 'utf8' })
    api.openResult = { path: 'C:\\tmp\\g.graphProp', content: api.written[0].data }
    expect(await graphs.getState().importProps()).toEqual({ props: props({ qValue: 2 }) })
    api.openResult = null
    expect(await graphs.getState().importProps()).toBeNull()
  })
})

describe('refresh', () => {
  it('opens a graph in CCS Debug, resolves the address in the selected frame and plots the data', async () => {
    const id = await open()
    expect(g0()).toMatchObject({ id, title: 'Single Time - 1', project: P, buffer: [0, 0.5, 2, 4.5], address: Y, error: null })
    expect(graphs.getState()).toMatchObject({ active: id, dialog: null })
    expect(app.getState().perspective).toBe('debug')
    expect(api.requests).toEqual([
      { cmd: 'address', frame: 1, expr: 'y' },
      { cmd: 'readMemory', addr: Y, length: 16 }
    ])
  })

  it('shows why the start address does not evaluate or cannot be read', async () => {
    await open({ startAddress: 'nosuch' })
    expect(g0().error).toBe('Invalid start address: identifier "nosuch" is undefined')
    graphs.getState().showProperties(g0().id)
    await graphs.getState().applyDialog(props({ startAddress: 'bad' }))
    expect(g0().error).toBe('Invalid start address: cannot read 16 bytes at 0x00000000')
  })

  it('scrolls when the acquisition is smaller than the display', async () => {
    const id = await open({ acquisitionBufferSize: 1, displayDataSize: 3 })
    for (const v of [7, 8, 9]) {
      api.memory.set(Y, [v])
      await graphs.getState().refresh(id)
    }
    expect(g0().buffer).toEqual([7, 8, 9])
    graphs.getState().reset(id)
    expect(g0().buffer).toEqual([])
  })

  it('refreshes on every halt in the top frame and forgets addresses when a session starts', async () => {
    await open()
    api.requests.length = 0
    debug.setState({ status: 'running' })
    api.memory.set(Y, [1, 2, 3, 4])
    debug.setState({ status: 'suspended' })
    await settle()
    expect(api.requests[0]).toEqual({ cmd: 'address', frame: 0, expr: 'y' })
    expect(g0().buffer).toEqual([1, 2, 3, 4])
    debug.setState({ status: 'starting' })
    expect(g0().address).toBeNull()
  })

  it('says there is no session instead of reading', async () => {
    debug.setState({ status: 'idle' })
    await open()
    expect(g0().error).toBe(NO_SESSION)
    expect(api.requests).toEqual([])
  })

  it('reads every 100 ms while running with Continuous Refresh, reusing the address', async () => {
    const id = await open({ acquisitionBufferSize: 1, displayDataSize: 10 })
    vi.useFakeTimers()
    api.requests.length = 0
    debug.setState({ status: 'running' })
    graphs.getState().setContinuous(id, true)
    await vi.advanceTimersByTimeAsync(350)
    expect(api.requests.filter((r) => r.cmd === 'readMemory')).toHaveLength(3)
    expect(api.requests.some((r) => r.cmd === 'address')).toBe(false)
    expect(g0().continuous).toBe(true)
    graphs.getState().setContinuous(id, false)
    await vi.advanceTimersByTimeAsync(300)
    expect(api.requests.filter((r) => r.cmd === 'readMemory')).toHaveLength(3)
  })

  it('ignores a read that finishes after the properties changed', async () => {
    const id = await open()
    let release: () => void = () => {}
    const slow = api.debugRequest
    api.debugRequest = async (cmd) => {
      if (cmd.cmd === 'readMemory') await new Promise<void>((r) => (release = r))
      return slow(cmd)
    }
    const pending = graphs.getState().refresh(id)
    await settle()
    graphs.getState().showProperties(id)
    api.debugRequest = slow
    await graphs.getState().applyDialog(props({ acquisitionBufferSize: 2, displayDataSize: 2 }))
    release()
    await pending
    expect(g0().buffer).toEqual([0, 0.5])
  })
})

describe('view and files', () => {
  it('zooms about the centre and fits again', async () => {
    const id = await open()
    graphs.getState().zoom(id, 'in')
    expect(g0().view).toMatchObject({ x0: 0.75, x1: 2.25 })
    graphs.getState().zoom(id, 'out')
    expect(g0().view?.x1).toBeCloseTo(3)
    graphs.getState().zoom(id, 'fit')
    expect(g0().view).toBeNull()
  })

  it('saves CSV or .dat by the chosen extension, and PNG images', async () => {
    const id = await open()
    api.savePath = 'C:\\tmp\\y.csv'
    await graphs.getState().saveData(id)
    expect(api.saveOptions[0]).toMatchObject({ title: 'Save Graph Data', defaultName: 'Single Time - 1.csv' })
    expect(api.written[0]).toEqual({ path: 'C:\\tmp\\y.csv', data: 'Sample,Value\r\n0,0\r\n1,0.5\r\n2,2\r\n3,4.5\r\n', encoding: 'utf8' })
    api.savePath = 'C:\\tmp\\y.DAT'
    await graphs.getState().saveData(id)
    expect(api.written[1].data.startsWith('1651 4 80001000 0 4\r\n')).toBe(true)
    api.savePath = 'C:\\tmp\\y.png'
    await graphs.getState().exportImage(id, 'data:image/png;base64,iVBORw0K')
    expect(api.written[2]).toEqual({ path: 'C:\\tmp\\y.png', data: 'iVBORw0K', encoding: 'base64' })
    api.savePath = null
    await graphs.getState().saveData(id)
    expect(api.written).toHaveLength(3)
  })

  it('closes graphs and stops their timers', async () => {
    const a = await open()
    graphs.getState().openNew()
    await graphs.getState().applyDialog(props({}))
    const b = graphs.getState().graphs[1].id
    expect(graphs.getState().graphs[1].title).toBe('Single Time - 2')
    expect(graphs.getState().active).toBe(b)
    graphs.getState().setContinuous(b, true)
    graphs.getState().close(b)
    expect(graphs.getState().graphs.map((g) => g.id)).toEqual([a])
    expect(graphs.getState().active).toBe(a)
  })
})
