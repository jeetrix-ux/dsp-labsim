import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CMD = join(__dirname, '../fixtures/ccs/C6748.cmd')
let app: ElectronApplication
let page: Page
let ws: string

function addProject(name: string, main: string): void {
  mkdirSync(join(ws, name))
  writeFileSync(join(ws, name, '.project'), `<projectDescription><name>${name}</name></projectDescription>`)
  writeFileSync(join(ws, name, 'main.c'), main.replace(/\n/g, '\r\n'))
  copyFileSync(CMD, join(ws, name, 'C6748.cmd'))
}

const FILL = [
  'float y[4];',
  'int main(void)',
  '{',
  '    int i;',
  '    for (i = 0; i < 4; i++)',
  '        y[i] = i * i * 0.5f;',
  '    return 0;',
  '}'
].join('\n') + '\n'

const SPIN = ['volatile int n;', 'int main(void)', '{', '    for (;;)', '        n++;', '}'].join('\n') + '\n'

test.beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-graph-'))
  addProject('fill', FILL)
  addProject('spin', SPIN)
  const userData = mkdtempSync(join(tmpdir(), 'labsim-ud-'))
  const noCompiler = mkdtempSync(join(tmpdir(), 'labsim-nocgt-'))
  app = await electron.launch({ args: ['.'], env: { ...process.env, LABSIM_WORKSPACE: ws, LABSIM_USERDATA: userData, LABSIM_COMPILER_ROOT: noCompiler } })
  page = await app.firstWindow()
  await expect(page.locator('.tree-row').first()).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
})

const row = (name: string) => page.locator('.tree-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })
const dialog = () => page.getByRole('dialog', { name: 'Graph Properties' })
const canvas = () => page.locator('canvas.graph-canvas')

async function debugUntilMain(project: string): Promise<void> {
  await row(project).click()
  await page.getByTitle('Debug (F11)').click()
  await expect(page.locator('.debug-tree')).toContainText('main() at main.c')
}

async function openGraph(fields: Record<string, string>, selects: Record<string, string> = {}): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'tools.graphSingleTime'))
  await expect(dialog()).toBeVisible()
  for (const [label, value] of Object.entries(fields)) await dialog().getByLabel(label, { exact: true }).fill(value)
  for (const [label, value] of Object.entries(selects)) await dialog().getByLabel(label, { exact: true }).selectOption(value)
  await dialog().getByRole('button', { name: 'OK' }).click()
  await expect(dialog()).toBeHidden()
}

test('graphs y at every halt and saves the data as CSV', async () => {
  await debugUntilMain('fill')
  await openGraph({ 'Start Address': 'y', 'Acquisition Buffer Size': '4', 'Display Data Size': '4' }, { 'Dsp Data Type': '32 bit floating point' })
  await expect(page.locator('.graph-tab > span')).toHaveText(['Single Time - 1'])
  await expect(canvas()).toHaveAttribute('data-points', '4')

  await page.getByTitle('Resume (F8)').click()
  await expect(page.locator('.debug-tree')).toContainText('C$$EXIT')
  const out = join(ws, 'y.csv')
  await app.evaluate(({ dialog: d }, file) => {
    d.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as unknown as typeof d.showSaveDialog
  }, out)
  await expect(async () => {
    await page.getByTitle('Save Data').click()
    expect(readFileSync(out, 'utf8')).toBe('Sample,Value\r\n0,0\r\n1,0.5\r\n2,2\r\n3,4.5\r\n')
  }).toPass()

  await page.getByTitle('Show Graph Properties').click()
  await dialog().getByLabel('Start Address', { exact: true }).fill('nosuch')
  await dialog().getByRole('button', { name: 'OK' }).click()
  await expect(page.locator('.graph-error')).toContainText('Invalid start address:')
  await expect(page.locator('.graph-error')).toContainText('nosuch')
})

test('Continuous Refresh plots a variable while the program runs', async () => {
  await debugUntilMain('spin')
  await openGraph({ 'Start Address': 'n' })
  await page.getByTitle('Continuous Refresh').click()
  await page.getByTitle('Resume (F8)').click()
  await expect.poll(async () => Number(await canvas().getAttribute('data-points')), { timeout: 10000 }).toBeGreaterThan(5)
  await page.getByTitle('Suspend (Alt+F8)').click()
  await expect(page.locator('.debug-tree')).toContainText('(Suspended)')
})
