import { promises as fs } from 'fs'
import * as path from 'path'

export const OUT_SUBDIR = path.join('.labsim', 'Debug')
const SKIP_DIRS = new Set(['debug', 'release'])

export async function findSources(projectDir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory() && !(dir === projectDir && SKIP_DIRS.has(e.name.toLowerCase()))) await walk(p)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.c')) out.push(p)
    }
  }
  await walk(projectDir)
  // Files in the project root first, then subfolders, each alphabetical.
  return out.sort((a, b) => {
    const da = path.dirname(a) === projectDir ? 0 : 1
    const db = path.dirname(b) === projectDir ? 0 : 1
    return da - db || a.localeCompare(b)
  })
}

/** The object file name the linker reports for a source: "./main.obj", "./src/fir.obj". */
export function objectName(projectDir: string, source: string): string {
  return './' + path.relative(projectDir, source).replace(/\\/g, '/').replace(/\.c$/i, '.obj')
}
