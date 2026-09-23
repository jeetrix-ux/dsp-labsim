import { createStore } from 'zustand/vanilla'
import type { FileDialogOptions, LabsimApi } from '@shared/api'
import type { AddressResult } from '@shared/debug'
import type { SessionStatus } from './debugStore'
import {
  DEFAULT_PROPS, decode, fitView, fromSettingsFile, pushSamples, readSpan, toCsv, toDat, toSettingsFile, validateProps, zoomView,
  type GraphProps, type View
} from './graph/model'
import type { AppStore } from './store'

export interface Graph {
  id: string
  title: string
  /** The project whose remembered properties this graph updates. */
  project: string | null
  props: GraphProps
  /** The display buffer: the newest `displayDataSize` samples. */
  buffer: number[]
  /** Where the last refresh read; Continuous Refresh reuses it while the target runs. */
  address: number | null
  /** Shown in place of the plot. */
  error: string | null
  continuous: boolean
  /** null: fit the data. */
  view: View | null
}

/** What the graphs need from the debug session store. */
export interface DebugSource {
  getState(): { status: SessionStatus; project: string | null; selectedFrame: number }
  subscribe(listener: (state: { status: SessionStatus }, prev: { status: SessionStatus }) => void): () => void
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface GraphState {
  graphs: Graph[]
  active: string | null
  /** The Graph Properties dialog: for a new graph (graphId null) or an open one. */
  dialog: { graphId: string | null; props: GraphProps } | null

  openNew(): void
  showProperties(id: string): void
  cancelDialog(): void
  /** Creates or updates the graph; resolves to a validation error (dialog stays open) or null. */
  applyDialog(props: GraphProps): Promise<string | null>
  importProps(): Promise<{ props: GraphProps } | { error: string } | null>
  exportProps(props: GraphProps): Promise<void>
  select(id: string): void
  close(id: string): void
  refresh(id: string): Promise<void>
  reset(id: string): void
  setContinuous(id: string, on: boolean): void
  zoom(id: string, how: 'in' | 'out' | 'fit'): void
  saveData(id: string): Promise<void>
  exportImage(id: string, pngDataUrl: string): Promise<void>
}

export const NO_SESSION = 'No debug session: start one with Run > Debug (F11).'
export const CONTINUOUS_MS = 100

const HALTED: SessionStatus[] = ['suspended', 'exited', 'halted']
const LIVE: SessionStatus[] = ['running', ...HALTED]
const PROP_FILTERS = [{ name: 'Graph properties', extensions: ['graphProp'] }]
const hex8 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`
const rememberKey = (project: string | null): string => `labsim.graph:${(project ?? '').toLowerCase()}`
/** Drops Electron's "Error invoking remote method 'x': Error: " prefix. */
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createGraphStore(api: LabsimApi, app: AppStore, debug: DebugSource, storage: KeyValueStorage | null) {
  return createStore<GraphState>()((set, get) => {
    let next = 1
    const timers = new Map<string, ReturnType<typeof setInterval>>()
    const busy = new Set<string>()
    const queued = new Map<string, { resolve: boolean; frame: number }>()

    const find = (id: string): Graph | undefined => get().graphs.find((g) => g.id === id)
    const update = (id: string, patch: Partial<Graph>): void =>
      set((s) => ({ graphs: s.graphs.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
    const currentProject = (): string | null => debug.getState().project ?? app.getState().selectedProject

    const remembered = (project: string | null): GraphProps => {
      try {
        const text = storage?.getItem(rememberKey(project))
        if (text) {
          const p = { ...DEFAULT_PROPS, ...(JSON.parse(text) as Partial<GraphProps>) }
          if (!validateProps(p)) return p
        }
      } catch {
        // unreadable: use the defaults
      }
      return { ...DEFAULT_PROPS }
    }

    const remember = (project: string | null, props: GraphProps): void => {
      try {
        storage?.setItem(rememberKey(project), JSON.stringify(props))
      } catch {
        // storage unavailable: nothing to remember
      }
    }

    const stopTimer = (id: string): void => {
      const t = timers.get(id)
      if (t !== undefined) clearInterval(t)
      timers.delete(id)
    }

    /** One refresh: (re)resolve the Start Address if asked, read, decode and scroll it into the display buffer. */
    const loadOnce = async (id: string, resolve: boolean, frame: number): Promise<void> => {
      const g = find(id)
      if (!g) return
      if (!LIVE.includes(debug.getState().status)) {
        if (g.buffer.length === 0) update(id, { error: NO_SESSION })
        return
      }
      const stale = (): boolean => find(id)?.props !== g.props
      try {
        let address = g.address
        if (resolve || address === null) {
          const r = (await api.debugRequest({ cmd: 'address', frame, expr: g.props.startAddress })) as AddressResult
          if (stale()) return
          if ('error' in r) {
            update(id, { error: `Invalid start address: ${r.error}`, address: null })
            return
          }
          address = r.address
        }
        const length = readSpan(g.props)
        const bytes = (await api.debugRequest({ cmd: 'readMemory', addr: address, length })) as number[] | null
        const now = find(id)
        if (!now || stale()) return
        if (!bytes) {
          update(id, { error: `Invalid start address: cannot read ${length} bytes at ${hex8(address)}`, address })
          return
        }
        update(id, { buffer: pushSamples(now.buffer, decode(bytes, g.props), g.props.displayDataSize), address, error: null })
      } catch (e) {
        if (!stale()) update(id, { error: message(e) })
      }
    }

    /** Refreshes one graph; a refresh asked for while one is in flight runs after it. */
    const load = async (id: string, resolve: boolean, frame: number): Promise<void> => {
      if (busy.has(id)) {
        const q = queued.get(id)
        queued.set(id, { resolve: resolve || (q?.resolve ?? false), frame })
        return
      }
      busy.add(id)
      try {
        await loadOnce(id, resolve, frame)
      } finally {
        busy.delete(id)
      }
      const again = queued.get(id)
      if (again) {
        queued.delete(id)
        await load(id, again.resolve, again.frame)
      }
    }

    debug.subscribe((s, prev) => {
      if (s.status === prev.status) return
      if (s.status === 'starting') set((st) => ({ graphs: st.graphs.map((g) => ({ ...g, address: null })) }))
      if (HALTED.includes(s.status)) for (const g of get().graphs) void load(g.id, true, 0)
    })

    const save = async (title: string, defaultName: string, filters: FileDialogOptions['filters'], data: (path: string) => string, encoding: 'utf8' | 'base64'): Promise<void> => {
      const path = await api.chooseSaveFile({ title, defaultName, filters })
      if (path) await api.writeChosenFile(path, data(path), encoding)
    }

    return {
      graphs: [],
      active: null,
      dialog: null,

      openNew() {
        set({ dialog: { graphId: null, props: remembered(currentProject()) } })
      },

      showProperties(id) {
        const g = find(id)
        if (g) set({ dialog: { graphId: id, props: g.props } })
      },

      cancelDialog() {
        set({ dialog: null })
      },

      async applyDialog(props) {
        const error = validateProps(props)
        if (error) return error
        const dialog = get().dialog
        if (!dialog) return null
        let id = dialog.graphId
        if (id) {
          const g = find(id)
          if (!g) return null
          remember(g.project, props)
          update(id, { props, buffer: [], address: null, error: null, view: null })
        } else {
          const project = currentProject()
          remember(project, props)
          id = `g${next}`
          const g: Graph = { id, title: `Single Time - ${next}`, project, props, buffer: [], address: null, error: null, continuous: false, view: null }
          next++
          set((s) => ({ graphs: [...s.graphs, g] }))
          app.getState().setPerspective('debug')
        }
        set({ dialog: null, active: id })
        await load(id, true, debug.getState().selectedFrame)
        return null
      },

      async importProps() {
        const file = await api.openTextFile({ title: 'Import Graph Properties', filters: PROP_FILTERS })
        return file ? fromSettingsFile(file.content) : null
      },

      async exportProps(props) {
        await save('Export Graph Properties', 'graph.graphProp', PROP_FILTERS, () => toSettingsFile(props), 'utf8')
      },

      select(id) {
        set({ active: id })
      },

      close(id) {
        stopTimer(id)
        queued.delete(id)
        set((s) => {
          const i = s.graphs.findIndex((g) => g.id === id)
          const graphs = s.graphs.filter((g) => g.id !== id)
          const active = s.active !== id ? s.active : ((graphs[i] ?? graphs[i - 1])?.id ?? null)
          return { graphs, active }
        })
      },

      refresh(id) {
        return load(id, true, debug.getState().selectedFrame)
      },

      reset(id) {
        update(id, { buffer: [] })
      },

      setContinuous(id, on) {
        stopTimer(id)
        update(id, { continuous: on })
        if (on) {
          timers.set(id, setInterval(() => {
            if (debug.getState().status === 'running') void load(id, false, 0)
          }, CONTINUOUS_MS))
        }
      },

      zoom(id, how) {
        const g = find(id)
        if (!g) return
        const base = g.view ?? fitView(g.buffer, g.props)
        update(id, { view: how === 'fit' ? null : zoomView(base, how === 'in' ? 0.5 : 2) })
      },

      async saveData(id) {
        const g = find(id)
        if (!g) return
        const filters = [
          { name: 'CSV (comma separated)', extensions: ['csv'] },
          { name: 'CCS data file', extensions: ['dat'] }
        ]
        await save('Save Graph Data', `${g.title}.csv`, filters, (path) => (path.toLowerCase().endsWith('.dat') ? toDat(g.buffer, g.props, g.address) : toCsv(g.buffer, g.props)), 'utf8')
      },

      async exportImage(id, pngDataUrl) {
        const g = find(id)
        if (!g) return
        await save('Export Image', `${g.title}.png`, [{ name: 'PNG image', extensions: ['png'] }], () => pngDataUrl.slice(pngDataUrl.indexOf(',') + 1), 'base64')
      }
    }
  })
}

export type GraphStore = ReturnType<typeof createGraphStore>
