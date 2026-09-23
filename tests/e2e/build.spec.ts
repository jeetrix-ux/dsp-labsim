import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findToolchain } from '../../src/main/build/toolchain'

const CMD = join(__dirname, '../fixtures/ccs/C6748.cmd')
let app: ElectronApplication
let page: Page
let ws: string

function addProject(name: string, main: string): void {
  mkdirSync(join(ws, name))
  writeFileSync(join(ws, name, '.project'), `<projectDescription><name>${name}</name></projectDescription>`)
  writeFileSync(join(ws, name, 'main.c'), main)
  copyFileSync(CMD, join(ws, name, 'C6748.cmd'))
}

async function launch(env: Record<string, string> = {}): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'labsim-ud-'))
  app = await electron.launch({ args: ['.'], env: { ...process.env, LABSIM_WORKSPACE: ws, LABSIM_USERDATA: userData, ...env } })
  page = await app.firstWindow()
  await expect(page.locator('.tree-row').first()).toBeVisible()
}

const row = (name: string) => page.locator('.tree-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })

test.beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-ws-'))
  addProject('alpha_good', '#include <stdio.h>\r\nfloat y[8];\r\nint main(void)\r\n{\r\n    y[0] = 1.0f;\r\n    printf("ok\\n");\r\n    return 0;\r\n}\r\n')
  addProject('beta_bad', '#include <stdio.h>\r\nint main(void)\r\n{\r\n    int unused = 3;\r\n    z = 4;\r\n    return 0;\r\n}\r\n')
})
test.afterEach(async () => {
  await app?.close()
})

test.describe('with cl6x installed', () => {
  test.beforeAll(async () => {
    test.skip(!(await findToolchain()), 'TI C6000 compiler not installed')
  })

  test('builds a project and shows the CCS build console', async () => {
    await launch()
    await expect(page.locator('.console')).toContainText('C6000 compiler:')
    await row('alpha_good').click()
    await page.getByTitle('Build Project (Ctrl+B)').click()
    const consoleBox = page.locator('.console')
    await expect(consoleBox).toContainText('**** Build Finished ****', { timeout: 60_000 })
    await expect(consoleBox).toContainText('**** Build of configuration Debug for project alpha_good ****')
    await expect(consoleBox).toContainText('Finished building target: "alpha_good.out"')
    await expect(page.getByLabel('Console')).toHaveValue('CDT Build Console [alpha_good]')
    await page.getByRole('button', { name: 'Problems' }).click()
    await expect(page.locator('.table-caption')).toHaveText('0 errors, 0 warnings, 0 others')
  })

  test('lists errors in Problems, marks them in the editor and jumps to the line', async () => {
    await launch()
    await row('beta_bad').click()
    await page.getByTitle('Build Project (Ctrl+B)').click()
    await expect(page.locator('.console')).toContainText('**** Build Finished ****', { timeout: 60_000 })
    await expect(page.locator('.console .cl-error', { hasText: 'error #20' })).toBeVisible()
    await page.getByRole('button', { name: 'Problems' }).click()
    await expect(page.locator('.table-caption')).toHaveText('1 error, 1 warning, 0 others')
    await expect(page.locator('.problems-group', { hasText: 'Errors (1 item)' })).toBeVisible()
    const err = page.locator('.problems-row[data-severity="error"]')
    await expect(err).toContainText('#20 identifier "z" is undefined')
    await expect(err).toContainText('main.c')
    await expect(err).toContainText('line 5')
    await err.dblclick()
    await expect(page.locator('.tab.active')).toContainText('main.c')
    await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(1)
    await expect(page.locator('.monaco-editor .line-numbers.active-line-number')).toHaveText('5')
  })

  test('the Project menu command builds too (Ctrl+B path) and Clean empties Problems', async () => {
    await launch()
    await row('beta_bad').click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'project.build'))
    await expect(page.locator('.console')).toContainText('**** Build Finished ****', { timeout: 60_000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'project.clean'))
    await expect(page.locator('.console')).toContainText('Finished clean')
    await page.getByRole('button', { name: 'Problems' }).click()
    await expect(page.locator('.table-caption')).toHaveText('0 errors, 0 warnings, 0 others')
  })
})

test('builds with the LabSim front-end when cl6x is missing', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'labsim-nocgt-'))
  await launch({ LABSIM_COMPILER_ROOT: empty })
  await expect(page.locator('.console .cl-error')).toContainText('C6000 compiler (cl6x) not found')
  await row('alpha_good').click()
  await page.getByTitle('Build Project (Ctrl+B)').click()
  const consoleBox = page.locator('.console')
  await expect(consoleBox).toContainText('**** Build Finished ****')
  await expect(consoleBox).toContainText('Invoking: LabSim C Front-End')
  await expect(consoleBox).toContainText('Finished building target: "alpha_good.out"')
  await page.getByRole('button', { name: 'Problems' }).click()
  await expect(page.locator('.table-caption')).toHaveText('0 errors, 0 warnings, 0 others')
  await row('beta_bad').click()
  await page.getByTitle('Build Project (Ctrl+B)').click()
  await expect(page.getByLabel('Console')).toHaveValue('CDT Build Console [beta_bad]')
  await expect(consoleBox).toContainText('**** Build Finished ****')
  await page.getByRole('button', { name: 'Problems' }).click()
  await expect(page.locator('.table-caption')).toHaveText('1 error, 1 warning, 0 others')
  await expect(page.locator('.problems-row[data-severity="error"]')).toContainText('#20 identifier "z" is undefined')
})
