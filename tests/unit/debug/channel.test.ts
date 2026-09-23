import { describe, expect, it } from 'vitest'
import type { DebugEvent } from '@shared/debug'
import { CommandSender, createDebugBuffer, workerChannel } from '../../../src/main/debug/channel'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('debug command slot', () => {
  it('hands requests to the worker side one at a time, in order', async () => {
    const buffer = createDebugBuffer()
    const sender = new CommandSender(buffer)
    const events: DebugEvent[] = []
    const ch = workerChannel(buffer, (e) => events.push(e))
    expect(ch.poll()).toBeNull()
    sender.send({ id: 1, cmd: 'resume' })
    sender.send({ id: 2, cmd: 'evaluate', frame: 0, expr: 'y[3]', format: 'hex' })
    expect(ch.poll()).toEqual({ id: 1, cmd: 'resume' })
    await tick()
    expect(ch.wait()).toEqual({ id: 2, cmd: 'evaluate', frame: 0, expr: 'y[3]', format: 'hex' })
    expect(ch.poll()).toBeNull()
    ch.send({ event: 'running' })
    expect(events).toEqual([{ event: 'running' }])
  })
})
