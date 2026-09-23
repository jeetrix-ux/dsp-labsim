import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LabsimApi, MenuCommand } from '@shared/api'

const api: LabsimApi = {
  getWorkspace: () => ipcRenderer.invoke('ws:get'),
  switchWorkspace: () => ipcRenderer.invoke('ws:switch'),
  listProjects: () => ipcRenderer.invoke('ws:projects'),
  readTree: (projectDir) => ipcRenderer.invoke('ws:tree', projectDir),
  readFile: (path) => ipcRenderer.invoke('fs:read', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:write', path, content),
  onMenu(cb) {
    const handler = (_e: IpcRendererEvent, cmd: MenuCommand): void => cb(cmd)
    ipcRenderer.on('menu', handler)
    return () => ipcRenderer.removeListener('menu', handler)
  }
}

contextBridge.exposeInMainWorld('labsim', api)
