import { app, BrowserWindow, dialog } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import type { Toolchain } from '@shared/build'
import type { ProgramImage } from '@shared/program'
import { findToolchain } from './build/toolchain'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { loadSettings, resolveWorkspace, saveSettings } from './settings'

if (process.env.LABSIM_USERDATA) app.setPath('userData', process.env.LABSIM_USERDATA)

let mainWindow: BrowserWindow | null = null
let workspace = ''
let toolchain: Toolchain | null = null
const images = new Map<string, ProgramImage>()
const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'DSP LabSim',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => win.show())
  // Pop-out editor/graph windows (window.open from the renderer, which then renders into them).
  win.webContents.setWindowOpenHandler(({ frameName, url }) =>
    frameName.startsWith('labsim-') && url === 'about:blank'
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#e8ebef', minWidth: 400, minHeight: 300 } }
      : { action: 'deny' }
  )
  // Pop-outs belong to this window: close them with it so the app can quit.
  win.on('closed', () => {
    for (const w of BrowserWindow.getAllWindows()) if (w !== win && !w.isDestroyed()) w.destroy()
  })
  // The renderer blocks unload while files are modified; ask before discarding them.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Discard changes and exit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Some files have unsaved changes.'
    })
    if (choice === 0) event.preventDefault()
  })
  win.on('closed', () => {
    mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

void app.whenReady().then(async () => {
  const settings = await loadSettings(settingsFile())
  workspace = await resolveWorkspace(settings, homedir(), process.env.LABSIM_WORKSPACE)
  // LABSIM_COMPILER_ROOT lets tests simulate a missing or custom compiler.
  toolchain = await findToolchain(process.env.LABSIM_COMPILER_ROOT ?? settings.compilerRoot)
  registerIpc({
    getWorkspace: () => workspace,
    setWorkspace: async (dir) => {
      workspace = dir
      await saveSettings(settingsFile(), { ...(await loadSettings(settingsFile())), workspace: dir })
    },
    getWindow: () => mainWindow,
    getToolchain: () => toolchain,
    setCompilerRoot: async (root) => {
      toolchain = await findToolchain(root)
      await saveSettings(settingsFile(), { ...(await loadSettings(settingsFile())), compilerRoot: root })
      return toolchain
    },
    compilerChosen: async () => process.env.LABSIM_COMPILER_ROOT !== undefined || !!(await loadSettings(settingsFile())).compilerRoot,
    resetCompilerRoot: async () => {
      const s = await loadSettings(settingsFile())
      delete s.compilerRoot
      await saveSettings(settingsFile(), s)
      toolchain = await findToolchain(process.env.LABSIM_COMPILER_ROOT)
      return toolchain
    },
    images
  })
  buildMenu(() => mainWindow)
  mainWindow = createWindow()
})

app.on('window-all-closed', () => app.quit())
