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
        { label: 'Build Project', accelerator: 'CmdOrCtrl+B', click: send('project.build') },
        { label: 'Rebuild Project', click: send('project.rebuild') },
        { label: 'Clean...', click: send('project.clean') }
      ]
    },
    {
      label: 'Run',
      // The renderer handles these keys (Monaco would take F8, the window Ctrl+R); the menu only shows them.
      submenu: [
        { label: 'Debug', accelerator: 'F11', registerAccelerator: false, click: send('run.debug') },
        { type: 'separator' },
        { label: 'Resume', accelerator: 'F8', registerAccelerator: false, click: send('run.resume') },
        { label: 'Suspend', accelerator: 'Alt+F8', registerAccelerator: false, click: send('run.suspend') },
        { label: 'Terminate', accelerator: 'Ctrl+F2', registerAccelerator: false, click: send('run.terminate') },
        { label: 'Restart', click: send('run.restart') },
        { label: 'Reload Program', click: send('run.reload') },
        { type: 'separator' },
        { label: 'Step Into', accelerator: 'F5', registerAccelerator: false, click: send('run.stepInto') },
        { label: 'Step Over', accelerator: 'F6', registerAccelerator: false, click: send('run.stepOver') },
        { label: 'Step Return', accelerator: 'F7', registerAccelerator: false, click: send('run.stepReturn') },
        { label: 'Run to Line', accelerator: 'Ctrl+R', registerAccelerator: false, click: send('run.toLine') }
      ]
    },
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
        { label: 'Preferences', submenu: [{ label: 'C6000 Compiler Location...', click: send('window.compilerLocation') }] },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
