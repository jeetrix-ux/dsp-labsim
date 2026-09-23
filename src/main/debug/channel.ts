import type { DebugEvent, DebugRequest } from '@shared/debug'
import type { DebugChannel } from '../../interp/debug/debugger'

const FULL = 0
const LENGTH = 1
const HEADER = 16
/** Largest request in bytes of JSON; requests are small (an expression at most). */
const CAPACITY = 1 << 20

interface AtomicsWaitAsync {
  waitAsync(a: Int32Array, index: number, value: number): { async: boolean; value: Promise<string> | string }
}

export function createDebugBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER + CAPACITY)
}

/** Main-process side: writes requests into the slot one at a time, waiting (without blocking) for the worker to take each. */
export class CommandSender {
  private readonly ctl: Int32Array
  private readonly data: Uint8Array
  private readonly queue: DebugRequest[] = []
  private pumping = false

  constructor(buffer: SharedArrayBuffer) {
    this.ctl = new Int32Array(buffer, 0, 2)
    this.data = new Uint8Array(buffer, HEADER, CAPACITY)
  }

  send(req: DebugRequest): void {
    this.queue.push(req)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length > 0) {
        while (Atomics.load(this.ctl, FULL) !== 0) {
          const w = (Atomics as unknown as AtomicsWaitAsync).waitAsync(this.ctl, FULL, 1)
          if (w.async) await w.value
        }
        const bytes = new TextEncoder().encode(JSON.stringify(this.queue.shift()))
        if (bytes.length > CAPACITY) continue
        this.data.set(bytes)
        Atomics.store(this.ctl, LENGTH, bytes.length)
        Atomics.store(this.ctl, FULL, 1)
        Atomics.notify(this.ctl, FULL)
      }
    } finally {
      this.pumping = false
    }
  }
}

/** Worker side of the slot: `wait` blocks the worker thread (the program is stopped), `poll` does not. */
export function workerChannel(buffer: SharedArrayBuffer, post: (event: DebugEvent) => void): DebugChannel {
  const ctl = new Int32Array(buffer, 0, 2)
  const data = new Uint8Array(buffer, HEADER, CAPACITY)
  const decoder = new TextDecoder()
  const take = (): DebugRequest => {
    const n = Atomics.load(ctl, LENGTH)
    const req = JSON.parse(decoder.decode(data.slice(0, n))) as DebugRequest
    Atomics.store(ctl, FULL, 0)
    Atomics.notify(ctl, FULL)
    return req
  }
  return {
    wait: () => {
      Atomics.wait(ctl, FULL, 0)
      return take()
    },
    poll: () => (Atomics.load(ctl, FULL) === 1 ? take() : null),
    send: post
  }
}
