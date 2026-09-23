import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let ws: string

test.beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-ws-'))
  mkdirSync(join(ws, 'demo'))
  writeFileSync(join(ws, 'demo', '.project'), '<projectDescription><name>demo</name></projectDescription>')
  writeFileSync(join(ws, 'demo', 'main.c'), '#include <stdio.h>\r\nint main(void)\r\n{\r\n    return 0;\r\n}\r\n')
  const userData = mkdtempSync(join(tmpdir(), 'labsim-ud-'))
  app = await electron.launch({ args: ['.'], env: { ...process.env, LABSIM_WORKSPACE: ws, LABSIM_USERDATA: userData } })
  page = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
})

test('window is titled DSP LabSim', async () => {
  await expect(page).toHaveTitle(/DSP LabSim/)
})
