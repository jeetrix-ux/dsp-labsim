import { spawn } from 'child_process'

/** Runs a program without a shell, reporting complete output lines. Resolves to the exit code (-1 if it could not start). */
export function runProcess(
  exe: string,
  args: string[],
  cwd: string,
  onLine: (text: string, stream: 'stdout' | 'stderr') => void
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true })
    const pending = { stdout: '', stderr: '' }
    const feed = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const parts = (pending[stream] + chunk.toString('utf8')).split(/\r?\n/)
      pending[stream] = parts.pop() ?? ''
      for (const p of parts) onLine(p, stream)
    }
    child.stdout.on('data', (c: Buffer) => feed('stdout', c))
    child.stderr.on('data', (c: Buffer) => feed('stderr', c))
    child.on('error', (err) => {
      onLine(`Could not run ${exe}: ${err.message}`, 'stderr')
      resolve(-1)
    })
    child.on('close', (code) => {
      for (const s of ['stdout', 'stderr'] as const) if (pending[s]) onLine(pending[s], s)
      resolve(code ?? -1)
    })
  })
}
