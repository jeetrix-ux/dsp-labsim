import { promises as fs } from 'fs'
import * as path from 'path'

/** Parses a cl6x --preproc_dependency file ("main.obj: <dep>" per line) into absolute paths. */
export function parseDepFile(text: string, cwd: string): string[] {
  const deps: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const sep = line.indexOf(': ')
    if (sep < 0) continue
    const dep = line.slice(sep + 2).trim().replace(/\\ /g, ' ')
    if (dep) deps.push(path.resolve(cwd, dep))
  }
  return deps
}

async function mtime(p: string): Promise<number | null> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return null
  }
}

/** True when target is missing, or any dependency is missing or newer than it. */
export async function isStale(target: string, deps: string[]): Promise<boolean> {
  const t = await mtime(target)
  if (t === null) return true
  for (const d of deps) {
    const m = await mtime(d)
    if (m === null || m > t) return true
  }
  return false
}
