import { promises as fs } from 'fs'
import * as path from 'path'
import type { FileNode, ProjectInfo } from '@shared/api'

const SKIP_DIRS = new Set(['RemoteSystemsTempFiles'])
const MAX_DEPTH = 6

const byKindThenName = (a: FileNode, b: FileNode): number =>
  a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export async function listProjects(workspace: string): Promise<ProjectInfo[]> {
  const entries = await fs.readdir(workspace, { withFileTypes: true })
  const projects: ProjectInfo[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const dir = path.join(workspace, e.name)
    const files = await fs.readdir(dir)
    const isCcsProject = files.includes('.project')
    if (isCcsProject || files.some((f) => /\.(c|h)$/i.test(f))) projects.push({ name: e.name, dir, isCcsProject })
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function readTree(dir: string, depth = 0): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) nodes.push({ name: e.name, path: p, kind: 'dir', children: await readTree(p, depth + 1) })
    else if (e.isFile()) nodes.push({ name: e.name, path: p, kind: 'file' })
  }
  return nodes.sort(byKindThenName)
}

export function assertInside(root: string, p: string): string {
  const abs = path.resolve(root, p)
  const rel = path.relative(path.resolve(root), abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path outside workspace: ${p}`)
  return abs
}

export async function readTextFile(workspace: string, p: string): Promise<string> {
  return fs.readFile(assertInside(workspace, p), 'utf8')
}

export async function writeTextFile(workspace: string, p: string, content: string): Promise<void> {
  await fs.writeFile(assertInside(workspace, p), content, 'utf8')
}
