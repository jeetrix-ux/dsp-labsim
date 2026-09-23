import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { DebugEvent, DebugLaunch } from '@shared/debug'
import { prepare } from '../../../src/cli/prepare'
import { CommandSender, createDebugBuffer } from '../../../src/main/debug/channel'

/** The bundled worker from `npm run build` (electron-vite names the chunk). Skipped when the app is not built. */
const OUT = join(__dirname, '../../../out/main')
const workerFile = existsSync(OUT)
  ? readdirSync(OUT)
      .map((f) => join(OUT, f))
      .find((f) => f.endsWith('.js') && readFileSync(f, 'utf8').includes("LabSim's C front-end cannot load this program"))
  : undefined

describe.skipIf(!workerFile)('the built debug worker', () => {
  it('stops at main, resumes to the end and terminates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'labsim-worker-'))
    try {
      writeFileSync(join(dir, 'main.c'), '#include <stdio.h>\nint main(void)\n{\n    int k = 6;\n    printf("k=%d\\n", k * 7);\n    return 0;\n}\n')
      const p = await prepare(join(dir, 'main.c'))
      if (!p.ok) throw new Error(p.messages.join('\n'))
      const launch: DebugLaunch = { projectDir: dir, sources: [join(dir, 'main.c')], includePaths: [dir], defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'], image: p.image }
      const buffer = createDebugBuffer()
      const sender = new CommandSender(buffer)
      const worker = new Worker(workerFile as string, { workerData: { launch, buffer } })
      const events: DebugEvent[] = []
      const next = (pred: (e: DebugEvent) => boolean): Promise<DebugEvent> =>
        new Promise((resolve) => {
          const found = events.find(pred)
          if (found) return resolve(found)
          const on = (e: DebugEvent): void => {
            if (pred(e)) {
              worker.off('message', on)
              resolve(e)
            }
          }
          worker.on('message', on)
        })
      worker.on('message', (e: DebugEvent) => events.push(e))
      expect(await next((e) => e.event === 'stopped')).toMatchObject({ reason: 'entry', line: 4 })
      sender.send({ id: 1, cmd: 'resume' })
      expect(await next((e) => e.event === 'stopped' && e.reason === 'exit')).toMatchObject({ code: 0 })
      expect(events.filter((e) => e.event === 'output').map((e) => (e.event === 'output' ? e.text : ''))).toEqual(['k=42\n'])
      const exited = new Promise((r) => worker.once('exit', r))
      sender.send({ id: 2, cmd: 'terminate' })
      await exited
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
