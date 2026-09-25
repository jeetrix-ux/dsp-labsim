import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CMD = join(__dirname, '../fixtures/ccs/C6748.cmd')
let app: ElectronApplication
let page: Page

const FILL = ['float y[4];', 'int main(void)', '{', '    int i;', '    for (i = 0; i < 4; i++)', '        y[i] = i * i * 0.5f;', '    return 0;', '}', ''].join('\r\n')

test.beforeEach(async () => {
  const ws = mkdtempSync(join(tmpdir(), 'labsim-popout-'))
  mkdirSync(join(ws, 'fill'))
  writeFileSync(join(ws, 'fill', '.project'), '<projectDescription><name>fill</name></projectDescription>')
  writeFileSync(join(ws, 'fill', 'main.c'), FILL)
  copyFileSync(CMD, join(ws, 'fill', 'C6748.cmd'))
  const env = {
    ...process.env,
    LABSIM_WORKSPACE: ws,
    LABSIM_USERDATA: mkdtempSync(join(tmpdir(), 'labsim-ud-')),
    LABSIM_COMPILER_ROOT: mkdtempSync(join(tmpdir(), 'labsim-nocgt-'))
  }
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  await expect(page.locator('.tree-row').first()).toBeVisible()
  await page.getByTitle('Debug (F11)').click()
  await expect(page.locator('.debug-tree')).toContainText('main() at main.c:5')
})

test.afterEach(async () => {
  await app?.close()
})

test('the editor pops out into its own window, stays live, and docks back when closed', async () => {
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: /^Pop Out Editor/ }).click()
  const pop = await opened
  await expect(pop.locator('.monaco-editor .view-lines')).toContainText('y[i] = i * i * 0.5f;')
  await expect(page.locator('.popped-placeholder')).toContainText('The editor is in its own window.')

  // Debug keys work from the pop-out, and the pc line follows there.
  await pop.locator('.monaco-editor .view-lines').click()
  await pop.keyboard.press('F6')
  await expect(page.locator('.debug-tree')).toContainText('main() at main.c:6')
  await expect(pop.locator('.pc-line')).toHaveCount(1)

  // Edits made in the pop-out are the main window's edits.
  await pop.keyboard.press('Control+End')
  await pop.keyboard.type('// popped')
  await expect(pop.locator('.tab.active')).toContainText('*main.c')

  await pop.close()
  await expect(page.locator('.popped-placeholder')).toHaveCount(0)
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('// popped')
  // Save, so closing the app does not stop at "unsaved changes".
  await page.getByTitle('Save (Ctrl+S)').click()
  await expect(page.locator('.tab.active')).not.toContainText('*')
})

test('the graphs pop out, keep refreshing, and dock back with the button', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'tools.graphSingleTime'))
  const dlg = page.getByRole('dialog', { name: 'Graph Properties' })
  await dlg.getByLabel('Start Address', { exact: true }).fill('y')
  await dlg.getByLabel('Acquisition Buffer Size', { exact: true }).fill('4')
  await dlg.getByLabel('Display Data Size', { exact: true }).fill('4')
  await dlg.getByLabel('Dsp Data Type', { exact: true }).selectOption('32 bit floating point')
  await dlg.getByRole('button', { name: 'OK' }).click()
  await expect(page.locator('canvas.graph-canvas')).toHaveAttribute('data-points', '4')

  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: /^Pop Out Graphs/ }).click()
  const pop = await opened
  await expect(pop.locator('canvas.graph-canvas')).toHaveAttribute('data-points', '4')
  await expect(page.locator('.graph-panel')).toHaveCount(0)
  // The canvas fills the pop-out, so its own ResizeObserver saw it.
  expect(Number(await pop.locator('canvas.graph-canvas').evaluate((c) => (c as HTMLCanvasElement).width))).toBeGreaterThan(300)

  await page.getByTitle('Resume (F8)').click()
  await expect(page.locator('.debug-tree')).toContainText('C$$EXIT()')
  const out = join(tmpdir(), `labsim-popout-${Date.now()}.csv`)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as unknown as typeof dialog.showSaveDialog
  }, out)
  await expect(async () => {
    await pop.getByTitle('Save Data').click()
    const { readFileSync } = await import('fs')
    expect(readFileSync(out, 'utf8')).toBe('Sample,Value\r\n0,0\r\n1,0.5\r\n2,2\r\n3,4.5\r\n')
  }).toPass()

  const closed = pop.waitForEvent('close')
  await pop.getByRole('button', { name: /^Dock Graphs/ }).click()
  await closed
  await expect(page.locator('.graph-panel canvas.graph-canvas')).toHaveAttribute('data-points', '4')
})
