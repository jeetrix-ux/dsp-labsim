import { app, BrowserWindow } from 'electron'
import { join } from 'path'

if (process.env.LABSIM_USERDATA) app.setPath('userData', process.env.LABSIM_USERDATA)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'DSP LabSim',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

void app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => app.quit())
