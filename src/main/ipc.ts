import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { assertInside, listProjects, readTextFile, readTree, writeTextFile } from './workspace'

export interface IpcContext {
  getWorkspace(): string
  setWorkspace(dir: string): Promise<void>
  getWindow(): BrowserWindow | null
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('ws:get', () => ctx.getWorkspace())
  ipcMain.handle('ws:switch', async () => {
    const win = ctx.getWindow()
    const options = { title: 'Select Workspace', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || r.filePaths.length === 0) return null
    await ctx.setWorkspace(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('ws:projects', () => listProjects(ctx.getWorkspace()))
  ipcMain.handle('ws:tree', (_e, dir: string) => readTree(assertInside(ctx.getWorkspace(), dir)))
  ipcMain.handle('fs:read', (_e, p: string) => readTextFile(ctx.getWorkspace(), p))
  ipcMain.handle('fs:write', (_e, p: string, content: string) => writeTextFile(ctx.getWorkspace(), p, content))
}
