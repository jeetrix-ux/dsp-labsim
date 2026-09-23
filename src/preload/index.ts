import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BuildOutputLine, LabsimApi, MenuCommand } from '@shared/api'
import type { DebugEvent } from '@shared/debug'

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
  },
  getToolchain: () => ipcRenderer.invoke('build:toolchain'),
  chooseCompiler: () => ipcRenderer.invoke('build:chooseCompiler'),
  build: (projectDir, kind) => ipcRenderer.invoke('build:run', projectDir, kind),
  onBuildOutput(cb) {
    const handler = (_e: IpcRendererEvent, line: BuildOutputLine): void => cb(line)
    ipcRenderer.on('build:output', handler)
    return () => ipcRenderer.removeListener('build:output', handler)
  },
  debugStart: (projectDir) => ipcRenderer.invoke('debug:start', projectDir),
  debugRequest: (cmd) => ipcRenderer.invoke('debug:request', cmd),
  debugTerminate: () => ipcRenderer.invoke('debug:terminate'),
  onDebugEvent(cb) {
    const handler = (_e: IpcRendererEvent, event: DebugEvent): void => cb(event)
    ipcRenderer.on('debug:event', handler)
    return () => ipcRenderer.removeListener('debug:event', handler)
  }
}

contextBridge.exposeInMainWorld('labsim', api)
