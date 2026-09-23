import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/api'

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (cmd: MenuCommand) => (): void => getWindow()?.webContents.send('menu', cmd)
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('file.save') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: send('file.saveAll') },
        { type: 'separator' },
        { label: 'Refresh', click: send('file.refresh') },
        { label: 'Switch Workspace...', click: send('file.switchWorkspace') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    {
      label: 'Project',
      submenu: [
        { label: 'Build Project', accelerator: 'CmdOrCtrl+B', enabled: false },
        { label: 'Rebuild Project', enabled: false },
        { label: 'Clean...', enabled: false }
      ]
    },
    { label: 'Run', submenu: [{ label: 'Debug', accelerator: 'F11', enabled: false }] },
    { label: 'Tools', submenu: [{ label: 'Graph', submenu: [{ label: 'Single Time', enabled: false }] }] },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Open Perspective',
          submenu: [
            { label: 'CCS Edit', click: send('window.editPerspective') },
            { label: 'CCS Debug', click: send('window.debugPerspective') }
          ]
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
