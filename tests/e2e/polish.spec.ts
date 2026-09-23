import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CMD = join(__dirname, '../fixtures/ccs/C6748.cmd')
let app: ElectronApplication
let page: Page
let ws: string

const FILL = ['float y[4];', 'int main(void)', '{', '    int i;', '    for (i = 0; i < 4; i++)', '        y[i] = i * i * 0.5f;', '    return 0;', '}', ''].join('\r\n')

test.beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-polish-'))
  mkdirSync(join(ws, 'fill'))
  writeFileSync(join(ws, 'fill', '.project'), '<projectDescription><name>fill</name></projectDescription>')
  writeFileSync(join(ws, 'fill', 'main.c'), FILL)
  copyFileSync(CMD, join(ws, 'fill', 'C6748.cmd'))
  const env = {
    ...process.env,
    LABSIM_WORKSPACE: ws,
    LABSIM_USERDATA: mkdtempSync(join(tmpdir(), 'labsim-ud-')),
    LABSIM_COMPILER_ROOT: mkdtempSync(join(tmpdir(), 'labsim-nocgt-')),
    LABSIM_TI_ROOT: mkdtempSync(join(tmpdir(), 'labsim-noti-'))
  }
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  await expect(page.locator('.tree-row').first()).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
})

const menu = (cmd: string) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd)
const row = (name: string) => page.locator('.tree-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })

test('File > New > CCS Project creates a project that builds and debugs', async () => {
  await menu('file.newProject')
  const dlg = page.getByRole('dialog', { name: 'New CCS Project' })
  await dlg.getByLabel('Project name').fill('lab1')
  await dlg.getByLabel('Heap size').fill('0x1000')
  await dlg.getByRole('button', { name: 'Finish' }).click()
  await expect(dlg).toBeHidden()
  await expect(row('lab1')).toBeVisible()
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('return 0;')
  expect(existsSync(join(ws, 'lab1', 'main.c'))).toBe(true)
  expect(readFileSync(join(ws, 'lab1', 'C6748.cmd'), 'utf8')).toBe(readFileSync(join(__dirname, '../../resources/C6748.cmd'), 'utf8'))
  expect(JSON.parse(readFileSync(join(ws, 'lab1', 'labsim.json'), 'utf8'))).toEqual({ heapSize: '0x1000', stackSize: '0x800', optLevel: 'off', defines: ['c6748'] })

  await page.getByTitle('Debug (F11)').click()
  await expect(page.locator('.debug-tree')).toContainText('main() at main.c')
  await page.getByTitle('Terminate (Ctrl+F2)').click()

  await menu('file.newProject')
  await dlg.getByLabel('Project name').fill('LAB1')
  await dlg.getByRole('button', { name: 'Finish' }).click()
  await expect(dlg.getByRole('alert')).toHaveText("'LAB1' already exists in the workspace.")
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).toBeHidden()
})

test('Window > Preferences shows the compiler and the workspace', async () => {
  await menu('window.preferences')
  const dlg = page.getByRole('dialog', { name: 'Preferences' })
  await expect(dlg.locator('.pref-compiler')).toHaveText('Not found: builds use the LabSim front-end.')
  await expect(dlg.locator('.pref-workspace')).toHaveText(ws)
  await dlg.getByRole('button', { name: 'Close' }).click()
  await expect(dlg).toBeHidden()
})

test('the Memory Browser shows y as floats and hex after the run', async () => {
  await row('fill').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(page.locator('.debug-tree')).toContainText('main() at main.c')
  await page.getByTitle('Resume (F8)').click()
  await expect(page.locator('.debug-tree')).toContainText('C$$EXIT()')
  await menu('view.memoryBrowser')
  await page.getByLabel('Memory format').selectOption('32-Bit Floating Point')
  await page.getByLabel('Memory address').fill('y')
  await page.getByLabel('Memory address').press('Enter')
  const first = page.locator('tr.mem-row').first()
  await expect(first.locator('td.mem-cell')).toHaveText(['0', '0.5', '2', '4.5'])
  await page.getByLabel('Memory format').selectOption('32-Bit Hex - TI Style')
  await expect(first.locator('td.mem-cell')).toHaveText(['00000000', '3F000000', '40000000', '40900000'])
  await page.getByLabel('Memory address').fill('nosuch')
  await page.getByLabel('Memory address').press('Enter')
  await expect(page.locator('.memory-error')).toContainText('Invalid address:')
})
