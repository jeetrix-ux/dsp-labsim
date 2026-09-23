import { dialog, ipcMain, type BrowserWindow } from 'electron'
import * as path from 'path'
import type { BuildKind, BuildOutputLine, Toolchain } from '@shared/build'
import type { ProgramImage } from '@shared/program'
import { runBuild } from './build/builder'
import { toolchainAt } from './build/toolchain'
import { assertInside, listProjects, readTextFile, readTree, writeTextFile } from './workspace'

export interface IpcContext {
  getWorkspace(): string
  setWorkspace(dir: string): Promise<void>
  getWindow(): BrowserWindow | null
  getToolchain(): Toolchain | null
  setCompilerRoot(root: string): Promise<Toolchain | null>
  /** Latest successful link per project dir; the debugger (Step 5) loads from here. */
  images: Map<string, ProgramImage>
}

export function registerIpc(ctx: IpcContext): void {
  const pickFolder = async (title: string): Promise<string | null> => {
    const win = ctx.getWindow()
    const options = { title, properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  }

  ipcMain.handle('ws:get', () => ctx.getWorkspace())
  ipcMain.handle('ws:switch', async () => {
    const dir = await pickFolder('Select Workspace')
    if (dir) await ctx.setWorkspace(dir)
    return dir
  })
  ipcMain.handle('ws:projects', () => listProjects(ctx.getWorkspace()))
  ipcMain.handle('ws:tree', (_e, dir: string) => readTree(assertInside(ctx.getWorkspace(), dir)))
  ipcMain.handle('fs:read', (_e, p: string) => readTextFile(ctx.getWorkspace(), p))
  ipcMain.handle('fs:write', (_e, p: string, content: string) => writeTextFile(ctx.getWorkspace(), p, content))

  ipcMain.handle('build:toolchain', () => ctx.getToolchain())
  ipcMain.handle('build:chooseCompiler', async () => {
    const dir = await pickFolder('Select the C6000 compiler folder (ti-cgt-c6000_x.y.z)')
    if (!dir) return ctx.getToolchain()
    if (!(await toolchainAt(dir))) throw new Error(`${dir} does not contain bin\\cl6x.exe`)
    return ctx.setCompilerRoot(dir)
  })

  let building = false
  ipcMain.handle('build:run', async (_e, projectDir: string, kind: BuildKind) => {
    const dir = assertInside(ctx.getWorkspace(), projectDir)
    if (building) throw new Error('A build is already running.')
    building = true
    const consoleName = `CDT Build Console [${path.basename(dir)}]`
    try {
      const result = await runBuild({
        projectDir: dir,
        kind,
        toolchain: ctx.getToolchain(),
        onOutput: (text, lineKind) => {
          const line: BuildOutputLine = { console: consoleName, text, kind: lineKind }
          ctx.getWindow()?.webContents.send('build:output', line)
        }
      })
      if (result.image) ctx.images.set(dir, result.image)
      else ctx.images.delete(dir)
      return result
    } finally {
      building = false
    }
  })
}
