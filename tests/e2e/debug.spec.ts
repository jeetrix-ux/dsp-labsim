import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs'
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

const DBG = [
  '#include <stdio.h>', //                  1
  'float y[4];', //                         2
  'int square(int v)', //                   3
  '{', //                                   4
  '    return v * v;', //                   5
  '}', //                                   6
  'int main(void)', //                      7
  '{', //                                   8
  '    int i;', //                          9
  '    for (i = 0; i < 4; i++) {', //       10
  '        y[i] = square(i) * 0.5f;', //    11
  '    }', //                               12
  '    printf("done %d\\n", square(3));', // 13
  '    return 0;', //                       14
  '}' //                                    15
].join('\n') + '\n'

test.beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-dbg-'))
  addProject('dbg', DBG)
  addProject('ask', '#include <stdio.h>\nint main(void)\n{\n    int n = 0;\n    printf("n? ");\n    scanf("%d", &n);\n    printf("twice %d\\n", n * 2);\n    return 0;\n}\n')
  addProject('crash', 'int main(void)\n{\n    int z = 0;\n    return 7 / z;\n}\n')
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
const debugTree = () => page.locator('.debug-tree')
const variable = (name: string) => page.locator(`.var-row[data-name="${name}"]`)
const lineNumber = (n: number) => page.locator('.monaco-editor .line-numbers', { hasText: new RegExp(`^${n}$`) })

test('stops at main, breaks, steps, evaluates and runs to C$$EXIT', async () => {
  await row('dbg').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(debugTree()).toContainText('main() at main.c:10')
  await expect(debugTree()).toContainText('XDS100v3 USB Debug Probe_0/C674X_0 (Suspended)')
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('square(i)')
  await lineNumber(11).dblclick()
  await page.getByRole('button', { name: 'Breakpoints' }).click()
  await expect(page.locator('.bp-row')).toContainText('main.c, line 11')
  await page.getByTitle('Resume (F8)').click()
  await expect(debugTree()).toContainText('(Suspended - SW Breakpoint)')
  await expect(debugTree()).toContainText('main() at main.c:11')
  await page.getByRole('button', { name: 'Variables' }).click()
  await expect(variable('i')).toContainText('0')
  await page.getByTitle('Step Into (F5)').click()
  await expect(debugTree()).toContainText('square() at main.c:5')
  await page.getByTitle('Step Return (F7)').click()
  await expect(debugTree()).toContainText('main() at main.c:10')
  await page.getByTitle('Resume (F8)').click()
  await expect(debugTree()).toContainText('main() at main.c:11')
  await expect(variable('i')).toContainText('1')
  await page.getByRole('button', { name: 'Expressions' }).click()
  await page.getByLabel('Add new expression').fill('y[0] + i * 2')
  await page.getByLabel('Add new expression').press('Enter')
  await expect(variable('y[0] + i * 2')).toContainText('2')
  await lineNumber(11).dblclick()
  await page.getByTitle('Resume (F8)').click()
  await expect(debugTree()).toContainText('C$$EXIT()')
  await expect(page.locator('.console')).toContainText('[C674X_0] done 9')
  await page.getByLabel('Add new expression').fill('y[3]')
  await page.getByLabel('Add new expression').press('Enter')
  await expect(variable('y[3]')).toContainText('4.5')
  await page.getByTitle('Terminate (Ctrl+F2)').click()
  await expect(page.getByText('No debug session is running.')).toBeVisible()
})

test('gives a typed console line to scanf', async () => {
  await row('ask').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(debugTree()).toContainText('main() at main.c:4')
  await page.keyboard.press('F8')
  const input = page.getByLabel('Console input')
  await expect(input).toBeVisible()
  await expect(page.locator('.console')).toContainText('[C674X_0] n?')
  await input.fill('21')
  await input.press('Enter')
  await expect(page.locator('.console')).toContainText('[C674X_0] twice 42')
  await expect(debugTree()).toContainText('C$$EXIT()')
})

test('halts at the line of a runtime error', async () => {
  await row('crash').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(debugTree()).toContainText('main() at main.c:3')
  await page.getByTitle('Resume (F8)').click()
  await expect(page.locator('.console')).toContainText('LabSim: Division by zero (main.c:4)')
  await expect(debugTree()).toContainText('main() at main.c:4')
  await expect(page.locator('.monaco-editor .pc-line')).toHaveCount(1)
})
