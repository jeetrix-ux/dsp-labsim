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

test('shows the workspace projects and a console banner', async () => {
  await expect(page.locator('.tree-row', { hasText: 'demo' })).toBeVisible()
  await expect(page.locator('.tree-row', { hasText: 'demo' })).toContainText('[Active - Debug]')
  await expect(page.locator('.console')).toContainText(`Workspace: ${ws} (1 project)`)
})

test('expands a project to show its files', async () => {
  await page.locator('.tree-row', { hasText: 'demo' }).locator('.twisty').click()
  await expect(page.locator('.tree-row', { hasText: 'main.c' })).toBeVisible()
})

test('switches to the CCS Debug perspective and back', async () => {
  await page.getByRole('button', { name: 'CCS Debug' }).click()
  await expect(page.locator('.view-title', { hasText: /^Debug$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Variables' })).toBeVisible()
  await expect(page.getByTitle('Resume (F8)')).toBeDisabled()
  await page.getByRole('button', { name: 'CCS Edit' }).click()
  await expect(page.locator('.view-title', { hasText: 'Project Explorer' })).toBeVisible()
})

test('build and debug buttons are present but disabled in this step', async () => {
  await expect(page.getByTitle('Build Project (Ctrl+B)')).toBeDisabled()
  await expect(page.getByTitle('Debug (F11)')).toBeDisabled()
})
