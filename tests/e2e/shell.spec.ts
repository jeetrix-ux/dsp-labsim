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

test('exposes the workspace API to the renderer', async () => {
  const result = await page.evaluate(async () => {
    const projects = await window.labsim.listProjects()
    const tree = await window.labsim.readTree(projects[0].dir)
    const src = await window.labsim.readFile(tree[0].path)
    let escaped = 'no error'
    try {
      await window.labsim.readFile(projects[0].dir + '\\..\\..\\outside.c')
    } catch (e) {
      escaped = String(e)
    }
    return { names: projects.map((p) => p.name), file: tree[0].name, src, escaped, ws: await window.labsim.getWorkspace() }
  })
  expect(result.names).toEqual(['demo'])
  expect(result.file).toBe('main.c')
  expect(result.src).toContain('int main(void)')
  expect(result.escaped).toContain('Path outside workspace')
  expect(result.ws).toBe(ws)
})
