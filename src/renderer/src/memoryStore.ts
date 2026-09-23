import { createStore } from 'zustand/vanilla'
import type { LabsimApi } from '@shared/api'
import type { AddressResult } from '@shared/debug'
import type { SessionStatus } from './debugStore'
import { NO_SESSION, type DebugSource } from './graphStore'
import { alignDown, formatRows, PAGE_BYTES, PAGE_ROWS, ROW_BYTES, type MemoryFormat, type MemoryRow } from './memory/format'
import { ipcError } from './store'

export interface MemoryState {
  expr: string
  format: MemoryFormat
  /** The first address shown; null until Go. */
  base: number | null
  rows: MemoryRow[]
  /** Shown in place of the rows. */
  error: string | null
  go(expr: string): Promise<void>
  setFormat(f: MemoryFormat): Promise<void>
  page(delta: number): Promise<void>
  refresh(): Promise<void>
}

const HALTED: SessionStatus[] = ['suspended', 'exited', 'halted']
const LIVE: SessionStatus[] = ['running', ...HALTED]
const LAST_PAGE = 0x1_0000_0000 - PAGE_BYTES

export function createMemoryStore(api: LabsimApi, debug: DebugSource) {
  return createStore<MemoryState>()((set, get) => {
    let seq = 0

    /** Reads the page at `base`: in one request, or row by row when part of it is unmapped. */
    const load = async (base: number): Promise<void> => {
      const mine = ++seq
      try {
        let bytes = (await api.debugRequest({ cmd: 'readMemory', addr: base, length: PAGE_BYTES })) as (number | null)[] | null
        if (!bytes) {
          bytes = []
          for (let r = 0; r < PAGE_ROWS; r++) {
            const row = (await api.debugRequest({ cmd: 'readMemory', addr: base + r * ROW_BYTES, length: ROW_BYTES })) as number[] | null
            bytes.push(...(row ?? Array<null>(ROW_BYTES).fill(null)))
          }
        }
        if (mine === seq) set({ base, rows: formatRows(base, bytes, get().format), error: null })
      } catch (e) {
        if (mine === seq) set({ error: ipcError(e) })
      }
    }

    debug.subscribe((s, prev) => {
      if (s.status !== prev.status && HALTED.includes(s.status)) void get().refresh()
    })

    return {
      expr: '',
      format: '32-Bit Hex - TI Style',
      base: null,
      rows: [],
      error: null,

      async go(text) {
        const expr = text.trim()
        set({ expr })
        if (!expr) return set({ error: 'Enter an address or an expression such as y or &x[4].' })
        if (!LIVE.includes(debug.getState().status)) return set({ error: NO_SESSION })
        let r: AddressResult
        try {
          r = (await api.debugRequest({ cmd: 'address', frame: debug.getState().selectedFrame, expr })) as AddressResult
        } catch (e) {
          return set({ error: ipcError(e) })
        }
        if ('error' in r) return set({ error: `Invalid address: ${r.error}` })
        await load(Math.min(alignDown(r.address, get().format), LAST_PAGE))
      },

      async setFormat(format) {
        set({ format })
        const base = get().base
        if (base !== null && LIVE.includes(debug.getState().status)) await load(alignDown(base, format))
      },

      async page(delta) {
        const base = get().base
        if (base === null || !LIVE.includes(debug.getState().status)) return
        await load(Math.max(0, Math.min(LAST_PAGE, base + delta * PAGE_BYTES)))
      },

      async refresh() {
        const base = get().base
        if (base !== null && LIVE.includes(debug.getState().status)) await load(base)
      }
    }
  })
}

export type MemoryStore = ReturnType<typeof createMemoryStore>
