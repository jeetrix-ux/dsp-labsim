import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NEW_PROJECT_DEFAULTS } from '@shared/newProject'
import { createProject, findLinkerCmd, labsimJson, MAIN_C_TEMPLATE } from '../../src/main/newProject'

let ws: string
let cmd: string
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-new-'))
  cmd = join(ws, '..', `${ws.split(/[\\/]/).pop()}-C6748.cmd`)
  writeFileSync(cmd, '/* C6748.cmd */\r\n')
})
afterEach(() => {
  rmSync(ws, { recursive: true, force: true })
  rmSync(cmd, { force: true })
})

describe('createProject', () => {
  it('writes main.c, C6748.cmd and labsim.json', async () => {
    const dir = await createProject(ws, { name: 'lab1', ...NEW_PROJECT_DEFAULTS, optLevel: '2' }, cmd)
    expect(dir).toBe(join(ws, 'lab1'))
    expect(readFileSync(join(dir, 'main.c'), 'utf8')).toBe(MAIN_C_TEMPLATE)
    expect(MAIN_C_TEMPLATE).toBe('\r\n/**\r\n * main.c\r\n */\r\nint main(void)\r\n{\r\n\treturn 0;\r\n}\r\n')
    expect(readFileSync(join(dir, 'C6748.cmd'), 'utf8')).toBe('/* C6748.cmd */\r\n')
    expect(JSON.parse(readFileSync(join(dir, 'labsim.json'), 'utf8'))).toEqual({ heapSize: '0x800', stackSize: '0x800', optLevel: '2', defines: ['c6748'] })
  })

  it('refuses invalid options and existing names (any case)', async () => {
    await expect(createProject(ws, { name: 'my lab', ...NEW_PROJECT_DEFAULTS }, cmd)).rejects.toThrow('A project name starts with a letter')
    mkdirSync(join(ws, 'Lab1'))
    await expect(createProject(ws, { name: 'lab1', ...NEW_PROJECT_DEFAULTS }, cmd)).rejects.toThrow("'lab1' already exists in the workspace.")
  })

  it('writes labsim.json with two-space indentation', () => {
    expect(labsimJson({ name: 'x', ...NEW_PROJECT_DEFAULTS })).toBe(
      '{\n  "heapSize": "0x800",\n  "stackSize": "0x800",\n  "optLevel": "off",\n  "defines": [\n    "c6748"\n  ]\n}\n'
    )
  })
})

describe('findLinkerCmd', () => {
  it("prefers the newest CCS install's C6748.cmd, else the bundled one", async () => {
    const ti = join(ws, 'ti')
    expect(await findLinkerCmd(cmd, ti)).toBe(cmd)
    for (const v of ['ccs1200', 'ccs1281']) {
      mkdirSync(join(ti, v, 'ccs', 'ccs_base', 'c6000', 'include'), { recursive: true })
      writeFileSync(join(ti, v, 'ccs', 'ccs_base', 'c6000', 'include', 'C6748.cmd'), v)
    }
    mkdirSync(join(ti, 'ccs1300'))
    expect(await findLinkerCmd(cmd, ti)).toBe(join(ti, 'ccs1281', 'ccs', 'ccs_base', 'c6000', 'include', 'C6748.cmd'))
  })
})
