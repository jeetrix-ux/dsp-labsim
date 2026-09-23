import { promises as fs } from 'fs'
import * as path from 'path'
import type { Toolchain } from '@shared/build'

const CGT_DIR = /^ti-cgt-c6000_(.+)$/

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

export async function toolchainAt(root: string): Promise<Toolchain | null> {
  const cl6x = path.join(root, 'bin', 'cl6x.exe')
  if (!(await exists(cl6x))) return null
  return { root, version: CGT_DIR.exec(path.basename(root))?.[1] ?? 'unknown', cl6x }
}

/** The override when it is a valid CGT root; otherwise the newest C6000 CGT under <tiRoot> or <tiRoot>/ccs*\/ccs/tools/compiler. */
export async function findToolchain(override?: string, tiRoot = 'C:\\ti'): Promise<Toolchain | null> {
  if (override) return toolchainAt(override)
  const candidates: string[] = []
  for (const d of await subdirs(tiRoot)) {
    const name = path.basename(d)
    if (CGT_DIR.test(name)) candidates.push(d)
    if (name.startsWith('ccs')) {
      for (const c of await subdirs(path.join(d, 'ccs', 'tools', 'compiler'))) {
        if (CGT_DIR.test(path.basename(c))) candidates.push(c)
      }
    }
  }
  const found = (await Promise.all(candidates.map(toolchainAt))).filter((t): t is Toolchain => t !== null)
  found.sort((a, b) => compareVersions(b.version, a.version))
  return found[0] ?? null
}
