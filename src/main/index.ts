import { app, BrowserWindow, dialog } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { loadSettings, resolveWorkspace, saveSettings } from './settings'

if (process.env.LABSIM_USERDATA) app.setPath('userData', process.env.LABSIM_USERDATA)

let mainWindow: BrowserWindow | null = null
let workspace = ''
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
  workspace = await resolveWorkspace(await loadSettings(settingsFile()), homedir(), process.env.LABSIM_WORKSPACE)
  registerIpc({
    getWorkspace: () => workspace,
    setWorkspace: async (dir) => {
      workspace = dir
      await saveSettings(settingsFile(), { ...(await loadSettings(settingsFile())), workspace: dir })
    },
    getWindow: () => mainWindow
  })
  buildMenu(() => mainWindow)
  mainWindow = createWindow()
})

app.on('window-all-closed', () => app.quit())
