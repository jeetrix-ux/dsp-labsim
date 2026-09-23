import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const EXE = join(__dirname, '../../dist/win-unpacked/DSP LabSim.exe')

test.skip(!existsSync(EXE), 'Run `npm run dist:dir` first to test the packaged app.')

test('the packaged app creates a project from its bundled C6748.cmd and debugs it', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'labsim-pkg-'))
  const env = {
    ...process.env,
    LABSIM_WORKSPACE: ws,
    LABSIM_USERDATA: mkdtempSync(join(tmpdir(), 'labsim-ud-')),
    LABSIM_COMPILER_ROOT: mkdtempSync(join(tmpdir(), 'labsim-nocgt-')),
    LABSIM_TI_ROOT: mkdtempSync(join(tmpdir(), 'labsim-noti-'))
  }
  const app = await electron.launch({ executablePath: EXE, args: [], env })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.console')).toContainText('Workspace:')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'file.newProject'))
    const dlg = page.getByRole('dialog', { name: 'New CCS Project' })
    await dlg.getByLabel('Project name').fill('packed')
    await dlg.getByRole('button', { name: 'Finish' }).click()
    await expect(dlg).toBeHidden()
    expect(readFileSync(join(ws, 'packed', 'C6748.cmd'), 'utf8')).toBe(readFileSync(join(__dirname, '../../resources/C6748.cmd'), 'utf8'))
    await page.getByTitle('Debug (F11)').click()
    await expect(page.locator('.debug-tree')).toContainText('main() at main.c')
  } finally {
    await app.close()
  }
})
