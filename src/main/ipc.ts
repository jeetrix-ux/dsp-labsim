import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import type { FileDialogOptions } from '@shared/api'
import type { BuildKind, BuildOutputLine, Toolchain } from '@shared/build'
import type { DebugCommand } from '@shared/debug'
import type { ProgramImage } from '@shared/program'
import { runBuild } from './build/builder'
import { debugLaunch } from './debug/launch'
import { ChosenFiles } from './chosenFiles'
import { DebugSession } from './debug/session'
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

  let session: DebugSession | null = null
  ipcMain.handle('debug:start', async (_e, projectDir: string) => {
    const dir = assertInside(ctx.getWorkspace(), projectDir)
    const image = ctx.images.get(dir)
    if (!image) throw new Error(`Build ${path.basename(dir)} successfully before debugging it.`)
    const old = session
    session = null
    await old?.terminate()
    const launch = await debugLaunch(dir, image, ctx.getToolchain())
    const s = new DebugSession(launch, (event) => {
      ctx.getWindow()?.webContents.send('debug:event', event)
      if (event.event === 'ended' && session === s) session = null
    })
    session = s
  })
  ipcMain.handle('debug:request', (_e, cmd: DebugCommand) => {
    if (!session) throw new Error('No debug session is running.')
    return session.request(cmd)
  })
  ipcMain.handle('debug:terminate', async () => {
    const s = session
    session = null
    await s?.terminate()
  })

  const chosen = new ChosenFiles()
  ipcMain.handle('file:chooseSave', async (_e, o: FileDialogOptions) => {
    const win = ctx.getWindow()
    const options = { title: o.title, defaultPath: o.defaultName, filters: o.filters }
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return null
    chosen.add(r.filePath)
    return r.filePath
  })
  ipcMain.handle('file:writeChosen', async (_e, p: string, data: string, encoding: 'utf8' | 'base64') => {
    await fs.writeFile(chosen.assert(p), Buffer.from(data, encoding))
  })
  ipcMain.handle('file:openText', async (_e, o: FileDialogOptions) => {
    const win = ctx.getWindow()
    const options = { title: o.title, defaultPath: o.defaultName, filters: o.filters, properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || r.filePaths.length === 0) return null
    return { path: r.filePaths[0], content: await fs.readFile(r.filePaths[0], 'utf8') }
  })
}
