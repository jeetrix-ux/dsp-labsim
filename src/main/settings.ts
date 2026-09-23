import { promises as fs } from 'fs'
import * as path from 'path'

export interface Settings {
  workspace?: string
  /** C6000 CGT root chosen by the user; auto-detected when absent. */
  compilerRoot?: string
}

export async function loadSettings(file: string): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Settings
  } catch {
    return {}
  }
}

export async function saveSettings(file: string, s: Settings): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(s, null, 2), 'utf8')
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

export async function resolveWorkspace(s: Settings, home: string, override?: string): Promise<string> {
  for (const candidate of [override, s.workspace, path.join(home, 'workspace_v12')]) {
    if (candidate && (await isDir(candidate))) return path.resolve(candidate)
  }
  const fallback = path.join(home, 'labsim_workspace')
  await fs.mkdir(fallback, { recursive: true })
  return fallback
}
