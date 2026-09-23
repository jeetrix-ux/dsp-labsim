import type { Worker } from 'worker_threads'
import type { DebugCommand, DebugEvent, DebugLaunch, DebugRequest } from '@shared/debug'
import { CommandSender, createDebugBuffer } from './channel'
import createDebugWorker from './worker?nodeWorker'

/** One debug session: a worker thread running the program under the Debugger. */
export class DebugSession {
  private readonly worker: Worker
  private readonly sender: CommandSender
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private ended = false

  constructor(
    launch: DebugLaunch,
    private readonly onEvent: (event: DebugEvent) => void
  ) {
    const buffer = createDebugBuffer()
    this.sender = new CommandSender(buffer)
    this.worker = createDebugWorker({ workerData: { launch, buffer } })
    this.worker.on('message', (event: DebugEvent) => {
      if (event.event !== 'reply') {
        this.onEvent(event)
        return
      }
      const p = this.pending.get(event.id)
      this.pending.delete(event.id)
      if (event.error !== undefined) p?.reject(new Error(event.error))
      else p?.resolve(event.result)
    })
    this.worker.on('error', (e) => this.onEvent({ event: 'failed', messages: [`LabSim's debugger stopped: ${e.message}`] }))
    this.worker.on('exit', () => this.finish())
  }

  get alive(): boolean {
    return !this.ended
  }

  request(cmd: DebugCommand): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error('The debug session has ended.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.sender.send({ ...cmd, id } as DebugRequest)
    })
  }

  /** Asks the worker to stop; kills it if it has not stopped within half a second. */
  async terminate(): Promise<void> {
    if (this.ended) return
    const exited = new Promise<void>((resolve) => this.worker.once('exit', () => resolve()))
    this.sender.send({ id: 0, cmd: 'terminate' })
    const timer = setTimeout(() => void this.worker.terminate(), 500)
    await exited
    clearTimeout(timer)
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    for (const p of this.pending.values()) p.reject(new Error('The debug session has ended.'))
    this.pending.clear()
    this.onEvent({ event: 'ended' })
  }
}
