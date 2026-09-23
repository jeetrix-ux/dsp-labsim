import { beforeEach, describe, expect, it } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { LabsimApi } from '@shared/api'
import type { DebugCommand } from '@shared/debug'
import type { SessionStatus } from '../../src/renderer/src/debugStore'
import { NO_SESSION } from '../../src/renderer/src/graphStore'
import { createMemoryStore, type MemoryStore } from '../../src/renderer/src/memoryStore'

const Y = 0x80001000
type Mini = { status: SessionStatus; project: string | null; selectedFrame: number }

function fakeApi() {
  const api = {
    requests: [] as DebugCommand[],
    /** Readable bytes by address. */
    mem: new Map<number, number>(),
    debugRequest: async (cmd: DebugCommand): Promise<unknown> => {
      api.requests.push(cmd)
      if (cmd.cmd === 'address') return cmd.expr === 'y' ? { address: Y } : cmd.expr === 'odd' ? { address: Y + 3 } : { error: `identifier "${cmd.expr}" is undefined` }
      if (cmd.cmd === 'readMemory') {
        const out: number[] = []
        for (let i = 0; i < cmd.length; i++) {
          const b = api.mem.get(cmd.addr + i)
          if (b === undefined) return null
          out.push(b)
        }
        return out
      }
      return null
    }
  }
  return api
}

let api: ReturnType<typeof fakeApi>
let debug: StoreApi<Mini>
let mem: MemoryStore
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  api = fakeApi()
  // y = { 0.5f, 1.0f } and 256 more readable bytes; everything from Y + 264 on is unmapped.
  ;[0x00, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x80, 0x3f].forEach((b, i) => api.mem.set(Y + i, b))
  for (let i = 8; i < 264; i++) api.mem.set(Y + i, 0)
  debug = createStore<Mini>()(() => ({ status: 'suspended', project: 'C:\\ws\\p', selectedFrame: 2 }))
  mem = createMemoryStore(api as unknown as LabsimApi, debug)
})

describe('Memory Browser store', () => {
  it('goes to a symbol in the selected frame and reads a page, row by row where unmapped', async () => {
    await mem.getState().go(' y ')
    const s = mem.getState()
    expect(s).toMatchObject({ expr: 'y', base: Y, error: null })
    expect(api.requests[0]).toEqual({ cmd: 'address', frame: 2, expr: 'y' })
    expect(api.requests[1]).toEqual({ cmd: 'readMemory', addr: Y, length: 512 })
    expect(s.rows).toHaveLength(32)
    expect(s.rows[0].cells).toEqual(['3F000000', '3F800000', '00000000', '00000000'])
    expect(s.rows[15].cells).toEqual(['00000000', '00000000', '00000000', '00000000'])
    expect(s.rows[16].cells).toEqual(['????????', '????????', '????????', '????????'])
    expect(s.rows[31].cells[0]).toBe('????????')
  })

  it('changes format, aligns the start and pages', async () => {
    await mem.getState().go('odd')
    expect(mem.getState().base).toBe(Y)
    await mem.getState().setFormat('32-Bit Floating Point')
    expect(mem.getState().rows[0].cells.slice(0, 2)).toEqual(['0.5', '1'])
    await mem.getState().page(1)
    expect(mem.getState().base).toBe(Y + 512)
    expect(mem.getState().rows[0].cells[0]).toBe('????????')
    await mem.getState().page(-1)
    expect(mem.getState().base).toBe(Y)
  })

  it('explains bad input and a missing session', async () => {
    await mem.getState().go('')
    expect(mem.getState().error).toBe('Enter an address or an expression such as y or &x[4].')
    await mem.getState().go('nosuch')
    expect(mem.getState().error).toBe('Invalid address: identifier "nosuch" is undefined')
    debug.setState({ status: 'idle' })
    await mem.getState().go('y')
    expect(mem.getState().error).toBe(NO_SESSION)
  })

  it('refreshes on every halt', async () => {
    await mem.getState().go('y')
    api.mem.set(Y, 0x11)
    debug.setState({ status: 'running' })
    debug.setState({ status: 'suspended' })
    await settle()
    expect(mem.getState().rows[0].cells[0]).toBe('3F000011')
  })
})
