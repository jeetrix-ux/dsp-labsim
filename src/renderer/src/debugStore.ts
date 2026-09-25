import { createStore } from 'zustand/vanilla'
import type { LabsimApi } from '@shared/api'
import type { DebugCommand, DebugEvent, FrameInfo, NumberFormat, StopReason, VarNode } from '@shared/debug'
import { basename, samePath } from '@shared/files'
import { buildConsoleName, type AppStore } from './store'

export type SessionStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'exited' | 'halted'

export interface Breakpoint {
  file: string
  line: number
  enabled: boolean
  /** The debugger confirmed a statement at this line (after a session loaded). */
  verified: boolean
}

export const CIO_PREFIX = '[C674X_0] '
export const cioConsoleName = (projectDir: string): string => `${basename(projectDir)}:CIO`
export { samePath }

export interface DebugState {
  status: SessionStatus
  project: string | null
  reason: StopReason | null
  message: string | null
  frames: FrameInfo[]
  selectedFrame: number
  /** The line the target is stopped at. */
  pc: { file: string; line: number } | null
  variables: VarNode[]
  expressions: string[]
  results: Record<string, VarNode>
  /** Expanded rows, `var:<expr>` or `expr:<expr>` → their children. */
  children: Record<string, VarNode[]>
  formats: Record<string, NumberFormat>
  breakpoints: Breakpoint[]
  inputPending: boolean

  start(): Promise<void>
  reload(): Promise<void>
  restart(): Promise<void>
  terminate(): Promise<void>
  resume(): Promise<void>
  suspend(): Promise<void>
  stepInto(): Promise<void>
  stepOver(): Promise<void>
  stepReturn(): Promise<void>
  runToLine(file: string, line: number): Promise<void>
  toggleBreakpoint(file: string, line: number): Promise<void>
  setBreakpointEnabled(index: number, enabled: boolean): Promise<void>
  removeBreakpoint(index: number): Promise<void>
  removeAllBreakpoints(): Promise<void>
  selectFrame(index: number): Promise<void>
  toggleExpand(view: 'var' | 'expr', expr: string): Promise<void>
  addExpression(text: string): Promise<void>
  removeExpression(text: string): void
  editValue(expr: string, value: string): Promise<void>
  setFormat(expr: string, format: NumberFormat): Promise<void>
  sendInput(text: string): Promise<void>
  handleEvent(event: DebugEvent): void
}

const ACTIVE: SessionStatus[] = ['running', 'suspended', 'exited', 'halted']

export function createDebugStore(api: LabsimApi, app: AppStore) {
  return createStore<DebugState>()((set, get) => {
    const consoleName = (): string => cioConsoleName(get().project ?? '')
    const active = (): boolean => ACTIVE.includes(get().status)

    /** A request whose failure is shown in the console instead of thrown. */
    const request = async <T>(cmd: DebugCommand): Promise<T | null> => {
      try {
        return (await api.debugRequest(cmd)) as T
      } catch (e) {
        app.getState().print(consoleName(), `LabSim: ${e instanceof Error ? e.message : String(e)}`, 'error')
        return null
      }
    }

    const syncFile = async (file: string): Promise<void> => {
      if (!active()) return
      const mine = get().breakpoints.filter((b) => b.enabled && samePath(b.file, file))
      const verified = await request<(number | null)[]>({ cmd: 'setBreakpoints', file, lines: mine.map((b) => b.line) })
      if (!verified) return
      set((s) => {
        const moved = s.breakpoints.map((b) => {
          const k = mine.indexOf(b)
          if (k < 0) return b
          const v = verified[k]
          return v === null || v === undefined ? { ...b, verified: false } : { ...b, line: v, verified: true }
        })
        return { breakpoints: moved.filter((b, i) => moved.findIndex((o) => samePath(o.file, b.file) && o.line === b.line) === i) }
      })
    }

    const syncAll = async (): Promise<void> => {
      const files: string[] = []
      for (const b of get().breakpoints) if (!files.some((f) => samePath(f, b.file))) files.push(b.file)
      for (const f of files) await syncFile(f)
    }

    const refreshValues = async (): Promise<void> => {
      const { selectedFrame: frame, formats, expressions } = get()
      const variables = (await request<VarNode[]>({ cmd: 'variables', frame, formats })) ?? []
      const results: Record<string, VarNode> = {}
      for (const expr of expressions) {
        const r = await request<VarNode>({ cmd: 'evaluate', frame, expr, format: formats[expr] ?? 'natural' })
        if (r) results[expr] = r
      }
      const children: Record<string, VarNode[]> = {}
      for (const key of Object.keys(get().children)) {
        children[key] = (await request<VarNode[]>({ cmd: 'children', frame, expr: key.slice(key.indexOf(':') + 1), formats })) ?? []
      }
      set({ variables, results, children })
    }

    const refresh = async (): Promise<void> => {
      const frames = (await request<FrameInfo[]>({ cmd: 'stackFrames' })) ?? []
      set({ frames, selectedFrame: 0 })
      await refreshValues()
    }

    const control = async (cmd: DebugCommand): Promise<void> => {
      if (get().status === 'suspended') await request(cmd)
    }

    const launch = async (dir: string): Promise<void> => {
      set({ status: 'starting', project: dir, reason: null, message: null, frames: [], pc: null, variables: [], results: {}, children: {}, inputPending: false })
      const a = app.getState()
      const name = cioConsoleName(dir)
      a.clearConsole(name)
      a.setActiveConsole(name)
      a.setBottomTab('console')
      a.setPerspective('debug')
      try {
        await api.debugStart(dir)
      } catch (e) {
        a.print(name, `LabSim: ${e instanceof Error ? e.message : String(e)}`, 'error')
        set({ status: 'idle' })
      }
    }

    return {
      status: 'idle',
      project: null,
      reason: null,
      message: null,
      frames: [],
      selectedFrame: 0,
      pc: null,
      variables: [],
      expressions: [],
      results: {},
      children: {},
      formats: {},
      breakpoints: [],
      inputPending: false,

      async start() {
        const dir = app.getState().selectedProject
        if (!dir || get().status === 'starting' || app.getState().building) return
        const result = await app.getState().build('build')
        if (!result) return
        if (!result.ok) {
          app.getState().print(buildConsoleName(dir), `Errors exist in project '${basename(dir)}'. Fix them before debugging.`, 'error')
          return
        }
        await launch(dir)
      },

      async reload() {
        await get().start()
      },

      async restart() {
        const dir = get().project
        if (dir && get().status !== 'idle' && get().status !== 'starting') await launch(dir)
      },

      async terminate() {
        if (get().status === 'idle') return
        await api.debugTerminate()
        set({ status: 'idle', pc: null, frames: [], variables: [], inputPending: false })
      },

      resume: () => control({ cmd: 'resume' }),
      stepInto: () => control({ cmd: 'stepInto' }),
      stepOver: () => control({ cmd: 'stepOver' }),
      stepReturn: () => control({ cmd: 'stepReturn' }),
      runToLine: (file, line) => control({ cmd: 'runToLine', file, line }),

      async suspend() {
        if (get().status === 'running') await request({ cmd: 'suspend' })
      },

      async toggleBreakpoint(file, line) {
        const bps = get().breakpoints
        const i = bps.findIndex((b) => samePath(b.file, file) && b.line === line)
        set({ breakpoints: i >= 0 ? bps.filter((_, k) => k !== i) : [...bps, { file, line, enabled: true, verified: false }] })
        await syncFile(file)
      },

      async setBreakpointEnabled(index, enabled) {
        const b = get().breakpoints[index]
        if (!b) return
        set((s) => ({ breakpoints: s.breakpoints.map((x, k) => (k === index ? { ...x, enabled } : x)) }))
        await syncFile(b.file)
      },

      async removeBreakpoint(index) {
        const b = get().breakpoints[index]
        if (!b) return
        set((s) => ({ breakpoints: s.breakpoints.filter((_, k) => k !== index) }))
        await syncFile(b.file)
      },

      async removeAllBreakpoints() {
        const files = get().breakpoints.map((b) => b.file)
        set({ breakpoints: [] })
        for (const f of files.filter((f, i) => files.findIndex((o) => samePath(o, f)) === i)) await syncFile(f)
      },

      async selectFrame(index) {
        set({ selectedFrame: index })
        if (active()) await refreshValues()
      },

      async toggleExpand(view, expr) {
        const key = `${view}:${expr}`
        if (get().children[key]) {
          set((s) => {
            const children = { ...s.children }
            delete children[key]
            return { children }
          })
          return
        }
        const kids = (await request<VarNode[]>({ cmd: 'children', frame: get().selectedFrame, expr, formats: get().formats })) ?? []
        set((s) => ({ children: { ...s.children, [key]: kids } }))
      },

      async addExpression(text) {
        const expr = text.trim()
        if (!expr || get().expressions.includes(expr)) return
        set((s) => ({ expressions: [...s.expressions, expr] }))
        if (!active()) return
        const r = await request<VarNode>({ cmd: 'evaluate', frame: get().selectedFrame, expr, format: get().formats[expr] ?? 'natural' })
        if (r) set((s) => ({ results: { ...s.results, [expr]: r } }))
      },

      removeExpression(text) {
        set((s) => {
          const results = { ...s.results }
          delete results[text]
          return { expressions: s.expressions.filter((e) => e !== text), results }
        })
      },

      async editValue(expr, value) {
        if (!active()) return
        const r = await request<VarNode>({ cmd: 'assign', frame: get().selectedFrame, expr, value })
        if (r?.error) app.getState().print(consoleName(), `LabSim: cannot set ${expr}: ${r.error}`, 'error')
        await refreshValues()
      },

      async setFormat(expr, format) {
        set((s) => ({ formats: { ...s.formats, [expr]: format } }))
        if (active()) await refreshValues()
      },

      async sendInput(text) {
        if (!get().inputPending) return
        set({ inputPending: false })
        app.getState().print(consoleName(), text, 'info')
        await request({ cmd: 'input', text })
      },

      handleEvent(event) {
        const a = app.getState()
        switch (event.event) {
          case 'loaded':
            set({ status: 'running' })
            void syncAll()
            break
          case 'running':
            set({ status: 'running', pc: null, reason: null })
            break
          case 'stopped': {
            const status: SessionStatus = event.reason === 'exit' ? 'exited' : event.reason === 'halt' ? 'halted' : 'suspended'
            const pc = event.file && event.line ? { file: event.file, line: event.line } : null
            set({ status, reason: event.reason, message: event.message ?? null, pc, inputPending: false })
            if (event.reason === 'halt') a.print(consoleName(), `LabSim: ${event.message} (${basename(event.file ?? '')}:${event.line})`, 'error')
            if (pc) void a.openAt(pc.file, pc.line)
            void refresh()
            break
          }
          case 'output': {
            const parts = event.text.split('\n')
            if (parts[parts.length - 1] === '') parts.pop()
            for (const p of parts) a.print(consoleName(), CIO_PREFIX + p, event.stream === 'stderr' ? 'error' : 'out')
            break
          }
          case 'note':
            a.print(consoleName(), `LabSim: ${event.text}`, 'info')
            break
          case 'inputRequest':
            set({ inputPending: true })
            a.setActiveConsole(consoleName())
            a.setBottomTab('console')
            break
          case 'failed':
            a.print(consoleName(), event.messages.join('\n'), 'error')
            set({ status: 'idle', pc: null, frames: [] })
            break
          case 'ended':
            if (get().status !== 'starting') set({ status: 'idle', pc: null, frames: [], variables: [], inputPending: false })
            break
          case 'reply':
            break
        }
      }
    }
  })
}

export type DebugStore = ReturnType<typeof createDebugStore>
