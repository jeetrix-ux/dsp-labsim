# Step 7: Polish and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish DSP LabSim with four pieces:
- **New CCS Project wizard:** creates `main.c`, `C6748.cmd` and `labsim.json`, and the build honours `labsim.json`.
- **Preferences page:** C6000 compiler location and workspace.
- **Memory Browser view:** an address or symbol, in hex, integer, float or character formats.
- **Portable Windows `.exe`:** built with electron-builder.

**Architecture:**
- **Project creation** runs in the main process (`src/main/newProject.ts`). It validates its input with a pure function shared with the renderer's dialog (`src/shared/newProject.ts`).
- **`labsim.json`** overrides the `.cproject` options inside `readBuildConfig`, so the cl6x build, the fallback build, the debugger and the CLI all see the same options.
- **Memory Browser** follows the Step 6 graph pattern:
  - a pure formatter (`src/renderer/src/memory/format.ts`);
  - a zustand store that resolves the address with the `address` debug request, reads with `readMemory` and refreshes on every halt;
  - a view that is a tab of the bottom panel.
- **Packaging** uses electron-builder's `portable` target, with the local Electron build (`electronDist`), and ships `resources/C6748.cmd` as an extra resource.

**Tech Stack:** Electron 44, electron-vite 5, React 19, zustand 5, vitest 4.1, Playwright for Electron. There is one new dev dependency, `electron-builder@26.15.3`.

## Global Constraints

From the spec, verbatim:
- "**New CCS Project** creates `main.c` (the CCS "Empty Project (with main.c)" template), a copy of `C6748.cmd` from `ccs_base/c6000/include`, and a `labsim.json` holding build options (heap/stack size, opt level, defines)."
- "Settings: the path to the C6000 compiler is auto-detected (`C:\ti\ccs*\ccs\tools\compiler\ti-cgt-c6000_*`) and can be overridden."
- "A **Memory Browser** view (address or symbol, format 32-bit float / hex / int) is a late-stage addition that reuses `readMemory`."
- "7. **Polish:** Memory Browser, New Project wizard, settings page, portable `.exe` packaging."
- "Build output goes to `<project>/.labsim/Debug/`, never CCS's own `Debug/`."

Project rules:
- Never write to `~/workspace_v12` or `~/dsp_ccs_lab`. Tests and checks use temporary workspaces.
- Write files that contain backslashes with the Write/Edit tools, or with a node script using `String.raw`. Never use heredocs, sed or Python for them.
- Menu names follow CCS 12: File > New > CCS Project, View > Memory Browser, Window > Preferences.

## File map

| File | Responsibility |
|---|---|
| `src/shared/newProject.ts` | `NewProjectOptions`, defaults, `validateNewProject`, `SYMBOL` / `SIZE` patterns |
| `src/main/build/projectConfig.ts` | `applyLabsimJson`; `readBuildConfig` applies `labsim.json`; `BuildConfig.notes` |
| `src/main/build/builder.ts`, `fallback.ts` | Print `labsim.json` problems in the Build Console |
| `src/main/newProject.ts` | `MAIN_C_TEMPLATE`, `labsimJson`, `createProject`, `findLinkerCmd` |
| `resources/C6748.cmd` | The linker command file shipped with the app (a copy of CCS's) |
| `src/main/ipc.ts`, `src/main/index.ts`, `src/main/menu.ts`, `src/preload/index.ts`, `src/shared/api.ts` | `project:create`, `build:compilerInfo`, `build:autoCompiler`; menus File > New > CCS Project, View > Memory Browser, Window > Preferences |
| `src/renderer/src/store.ts` | `dialog`, `createProject`, `compiler`, `loadCompiler`, `useAutoCompiler`, bottom tab `memory` |
| `src/renderer/src/components/NewProjectDialog.tsx`, `PreferencesDialog.tsx` | The two dialogs |
| `src/renderer/src/memory/format.ts` | Memory formats, rows, float text |
| `src/renderer/src/memoryStore.ts` | Memory Browser state: address, format, paging, refresh on halt |
| `src/renderer/src/components/MemoryView.tsx`, `BottomPanel.tsx` | The Memory Browser tab |
| `electron-builder.yml`, `package.json` | Portable `.exe` packaging |
| `tests/e2e/polish.spec.ts`, `tests/e2e/packaged.spec.ts` | Wizard, Preferences, Memory Browser; packaged-app smoke test |
| `README.md`, spec | How to run, test and package; the Step 7 notes |

---

### Task 1: `labsim.json` build options

`labsim.json` is written by the New Project wizard (Task 2), and a student may also edit it by hand. Its options override the `.cproject` Debug configuration:

```json
{
  "heapSize": "0x800",
  "stackSize": "0x800",
  "optLevel": "off",
  "defines": ["c6748"]
}
```

Every field is optional. A field with a bad value is ignored, and the build says why in the Build Console as `LabSim: labsim.json: …`. If the file is not valid JSON, all of it is ignored, with one message.

**Files:**
- Create: `src/shared/newProject.ts`
- Modify: `src/main/build/projectConfig.ts` (add `notes?: string[]` to `BuildConfig`; add `LABSIM_JSON`, `applyLabsimJson`; call it in `readBuildConfig`)
- Modify: `src/main/build/builder.ts:64` and `src/main/build/fallback.ts:88`: print `cfg.notes`.
- Test: `tests/unit/build/projectConfig.test.ts`, `tests/unit/build/builder.test.ts`, `tests/unit/newProjectOptions.test.ts`

**Interfaces:**
- Produces, in `@shared/newProject`:
  - `type OptLevel = 'off' | '0' | '1' | '2' | '3'`, `OPT_LEVELS: OptLevel[]`
  - `interface NewProjectOptions { name: string; heapSize: string; stackSize: string; optLevel: OptLevel; defines: string[] }`
  - `NEW_PROJECT_DEFAULTS: Omit<NewProjectOptions, 'name'>`
  - `SIZE: RegExp`, `SYMBOL: RegExp`, `PROJECT_NAME: RegExp`
  - `validateNewProject(o: NewProjectOptions): string | null`
- Produces, in `projectConfig.ts`: `LABSIM_JSON = 'labsim.json'`, `applyLabsimJson(cfg: BuildConfig, text: string): string[]`. `BuildConfig.notes?: string[]` holds the problems `readBuildConfig` found.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/newProjectOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NEW_PROJECT_DEFAULTS, validateNewProject } from '@shared/newProject'

const ok = { name: 'lab1', ...NEW_PROJECT_DEFAULTS }

describe('validateNewProject', () => {
  it('accepts CCS-style names and the defaults', () => {
    expect(NEW_PROJECT_DEFAULTS).toEqual({ heapSize: '0x800', stackSize: '0x800', optLevel: 'off', defines: ['c6748'] })
    expect(validateNewProject(ok)).toBeNull()
    expect(validateNewProject({ ...ok, name: 'fir_filter-2.v1' })).toBeNull()
    expect(validateNewProject({ ...ok, heapSize: '4096', defines: ['c6748', 'USE_Q15=1'] })).toBeNull()
  })

  it('explains what is wrong', () => {
    expect(validateNewProject({ ...ok, name: '' })).toBe('Enter a project name.')
    expect(validateNewProject({ ...ok, name: 'my lab' })).toBe(
      'A project name starts with a letter or _ and uses only letters, digits, _, - and . (at most 64 characters).'
    )
    expect(validateNewProject({ ...ok, heapSize: '2k' })).toBe('Heap size must be a number such as 0x800.')
    expect(validateNewProject({ ...ok, stackSize: '' })).toBe('Stack size must be a number such as 0x800.')
    expect(validateNewProject({ ...ok, optLevel: '4' as never })).toBe('Optimization level must be off, 0, 1, 2 or 3.')
    expect(validateNewProject({ ...ok, defines: ['c6748', '2bad'] })).toBe("'2bad' is not a valid predefined symbol.")
  })
})
```

Append to `tests/unit/build/projectConfig.test.ts`. Change its first import line to `import { applyLabsimJson, defaultConfig, parseCproject, readBuildConfig } from '../../../src/main/build/projectConfig'`, and add `import { mkdtempSync, writeFileSync } from 'fs'` and `import { tmpdir } from 'os'` (keep the existing `readFileSync` import):

```ts
describe('labsim.json', () => {
  it('overrides heap, stack, optimisation and defines', () => {
    const cfg = defaultConfig('p', DIR, CGT)
    expect(applyLabsimJson(cfg, '{ "heapSize": "0x2000", "stackSize": "4096", "optLevel": "2", "defines": ["c6748", "N=64"] }')).toEqual([])
    expect([cfg.heapSize, cfg.stackSize, cfg.optLevel, cfg.defines]).toEqual(['0x2000', '4096', '2', ['c6748', 'N=64']])
    expect(applyLabsimJson(cfg, '{ "optLevel": "off" }')).toEqual([])
    expect(cfg.optLevel).toBeNull()
  })

  it('ignores bad fields and says why', () => {
    const cfg = defaultConfig('p', DIR, CGT)
    expect(applyLabsimJson(cfg, '{ "heapSize": "big", "optLevel": 5, "defines": "c6748", "stackSize": "0x400" }')).toEqual([
      'labsim.json: heapSize must be a size such as "0x800"; ignored.',
      'labsim.json: optLevel must be "off", "0", "1", "2" or "3"; ignored.',
      'labsim.json: defines must be a list of symbols such as ["c6748"]; ignored.'
    ])
    expect([cfg.heapSize, cfg.stackSize, cfg.optLevel, cfg.defines]).toEqual(['0x800', '0x400', null, ['c6748']])
    expect(applyLabsimJson(cfg, '[1]')).toEqual(['labsim.json must hold a JSON object; its options were ignored.'])
    expect(applyLabsimJson(cfg, '{ oops')[0]).toMatch(/^labsim\.json is not valid JSON \(.+\); its options were ignored\.$/)
  })

  it('is read by readBuildConfig, after .cproject', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'labsim-cfg-'))
    writeFileSync(join(dir, 'main.c'), 'int main(void) { return 0; }\n')
    writeFileSync(join(dir, 'C6748.cmd'), '')
    writeFileSync(join(dir, 'labsim.json'), '{ "stackSize": "0x1000", "optLevel": "9" }')
    const cfg = await readBuildConfig(dir, CGT)
    expect(cfg.stackSize).toBe('0x1000')
    expect(cfg.linkerCommandFile).toBe('C6748.cmd')
    expect(cfg.notes).toEqual(['labsim.json: optLevel must be "off", "0", "1", "2" or "3"; ignored.'])
    writeFileSync(join(dir, 'labsim.json'), '{}')
    expect((await readBuildConfig(dir, CGT)).notes).toBeUndefined()
  })
})
```

Append to the `describe('runBuild without a compiler (LabSim fallback)', …)` block in `tests/unit/build/builder.test.ts`:

```ts
  it('prints labsim.json problems in the Build Console', async () => {
    const dir = project('p', GOOD, { 'labsim.json': '{ "heapSize": "lots" }' })
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(true)
    expect(log).toContainEqual({ text: 'LabSim: labsim.json: heapSize must be a size such as "0x800"; ignored.', kind: 'error' })
  })
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/newProjectOptions.test.ts tests/unit/build/projectConfig.test.ts tests/unit/build/builder.test.ts`
Expected: FAIL. `@shared/newProject` does not resolve, and `applyLabsimJson` is not exported.

- [ ] **Step 3: Create the shared options module**

Create `src/shared/newProject.ts`:

```ts
/** File > New > CCS Project: the options the wizard asks for, written to the project's labsim.json. */

export type OptLevel = 'off' | '0' | '1' | '2' | '3'
export const OPT_LEVELS: OptLevel[] = ['off', '0', '1', '2', '3']

export interface NewProjectOptions {
  name: string
  heapSize: string
  stackSize: string
  optLevel: OptLevel
  /** Predefined symbols (--define), e.g. c6748 or N=64. */
  defines: string[]
}

/** What CCS 12 sets for a new TMS320C6748 project. */
export const NEW_PROJECT_DEFAULTS: Omit<NewProjectOptions, 'name'> = { heapSize: '0x800', stackSize: '0x800', optLevel: 'off', defines: ['c6748'] }

export const PROJECT_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
export const SIZE = /^(0x[0-9a-f]+|\d+)$/i
export const SYMBOL = /^[A-Za-z_]\w*(=\S*)?$/

export function validateNewProject(o: NewProjectOptions): string | null {
  if (!o.name) return 'Enter a project name.'
  if (!PROJECT_NAME.test(o.name)) return 'A project name starts with a letter or _ and uses only letters, digits, _, - and . (at most 64 characters).'
  if (!SIZE.test(o.heapSize)) return 'Heap size must be a number such as 0x800.'
  if (!SIZE.test(o.stackSize)) return 'Stack size must be a number such as 0x800.'
  if (!OPT_LEVELS.includes(o.optLevel)) return 'Optimization level must be off, 0, 1, 2 or 3.'
  const bad = o.defines.find((d) => !SYMBOL.test(d))
  return bad === undefined ? null : `'${bad}' is not a valid predefined symbol.`
}
```

- [ ] **Step 4: Apply `labsim.json` in `readBuildConfig`**

In `src/main/build/projectConfig.ts`:

1. Add `import { SIZE, SYMBOL } from '@shared/newProject'` after the `path` import.
2. Add this as the last field of `BuildConfig`:

```ts
  /** Problems found in labsim.json; the builds print them. */
  notes?: string[]
```

3. Add this after `parseCproject`:

```ts
export const LABSIM_JSON = 'labsim.json'

/** Applies a project's labsim.json over `cfg`; returns why any field was ignored. */
export function applyLabsimJson(cfg: BuildConfig, text: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return [`labsim.json is not valid JSON (${e instanceof Error ? e.message : String(e)}); its options were ignored.`]
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['labsim.json must hold a JSON object; its options were ignored.']
  const o = raw as Record<string, unknown>
  const problems: string[] = []
  for (const key of ['heapSize', 'stackSize'] as const) {
    const v = o[key]
    if (v === undefined) continue
    if (typeof v === 'string' && SIZE.test(v.trim())) cfg[key] = v.trim()
    else problems.push(`labsim.json: ${key} must be a size such as "0x800"; ignored.`)
  }
  if (o.optLevel !== undefined) {
    if (o.optLevel === 'off' || o.optLevel === null) cfg.optLevel = null
    else if (typeof o.optLevel === 'string' && /^[0-3]$/.test(o.optLevel)) cfg.optLevel = o.optLevel
    else problems.push('labsim.json: optLevel must be "off", "0", "1", "2" or "3"; ignored.')
  }
  if (o.defines !== undefined) {
    if (Array.isArray(o.defines) && o.defines.every((d) => typeof d === 'string' && SYMBOL.test(d))) cfg.defines = o.defines as string[]
    else problems.push('labsim.json: defines must be a list of symbols such as ["c6748"]; ignored.')
  }
  return problems
}
```

4. In `readBuildConfig`, put this just before `return cfg`:

```ts
  if (files.includes(LABSIM_JSON)) {
    const notes = applyLabsimJson(cfg, await fs.readFile(path.join(projectDir, LABSIM_JSON), 'utf8'))
    if (notes.length > 0) cfg.notes = notes
  }
```

- [ ] **Step 5: Print the notes in both builds**

In `src/main/build/builder.ts`, add this line right after `const cfg = await readBuildConfig(projectDir, toolchain.root)`:

```ts
  for (const n of cfg.notes ?? []) emit(`LabSim: ${n}`, 'error')
```

In `src/main/build/fallback.ts`, add the same line right after `const cfg = await readBuildConfig(projectDir, FALLBACK_CGT)`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `npx vitest run tests/unit && npm run typecheck`
Expected: all unit tests PASS, and typecheck prints no errors. The existing `toEqual` checks on `BuildConfig` still pass, because `notes` is absent when there are no problems.

- [ ] **Step 7: Commit**

```bash
git add src/shared/newProject.ts src/main/build tests/unit
git commit -m "feat(build): labsim.json build options (heap, stack, optimisation, defines) override .cproject"
```

---

### Task 2: Creating a project in the main process

The linker command file comes from CCS's own copy when CCS is installed (`C:\ti\ccs*\ccs\ccs_base\c6000\include\C6748.cmd`, newest `ccs*` first). Otherwise it comes from the copy shipped in `resources/`. Tests point `LABSIM_TI_ROOT` at an empty folder to force the shipped copy.

**Files:**
- Create: `resources/C6748.cmd` (a copy of `tests/fixtures/ccs/C6748.cmd`, which is byte-identical to CCS 12.8.1's)
- Create: `src/main/newProject.ts`
- Modify: `src/shared/api.ts`: re-export `NewProjectOptions`; add `createProject`; add the menu command `file.newProject`.
- Modify: `src/preload/index.ts`, `src/main/ipc.ts` (`project:create`), `src/main/menu.ts` (File > New > CCS Project...)
- Modify: `tests/unit/store.test.ts`: add `createProject` to the fake.
- Test: `tests/unit/newProject.test.ts`

**Interfaces:**
- Consumes (Task 1): `NewProjectOptions`, `validateNewProject`.
- Produces:
  - `MAIN_C_TEMPLATE: string` (CRLF)
  - `labsimJson(o): string`
  - `createProject(workspace: string, o: NewProjectOptions, linkerCmd: string): Promise<string>` (returns the new folder; throws `Error` with a user-facing message)
  - `findLinkerCmd(bundled: string, tiRoot?: string): Promise<string>`
  - `LabsimApi.createProject(o: NewProjectOptions): Promise<string>`
  - `MenuCommand` gains `'file.newProject'`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/newProject.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/newProject.test.ts`
Expected: FAIL, because it cannot resolve `../../src/main/newProject`.

- [ ] **Step 3: Implement it**

Create `src/main/newProject.ts`:

```ts
import { promises as fs } from 'fs'
import * as path from 'path'
import { validateNewProject, type NewProjectOptions } from '@shared/newProject'

/** CCS's "Empty Project (with main.c)" template, with Windows line ends as CCS writes it. */
export const MAIN_C_TEMPLATE = ['', '/**', ' * main.c', ' */', 'int main(void)', '{', '\treturn 0;', '}', ''].join('\r\n')

export function labsimJson(o: NewProjectOptions): string {
  return JSON.stringify({ heapSize: o.heapSize, stackSize: o.stackSize, optLevel: o.optLevel, defines: o.defines }, null, 2) + '\n'
}

/** Creates <workspace>/<name> with main.c, C6748.cmd and labsim.json; returns the new folder. */
export async function createProject(workspace: string, o: NewProjectOptions, linkerCmd: string): Promise<string> {
  const error = validateNewProject(o)
  if (error) throw new Error(error)
  const taken = (await fs.readdir(workspace)).some((e) => e.toLowerCase() === o.name.toLowerCase())
  if (taken) throw new Error(`'${o.name}' already exists in the workspace.`)
  const dir = path.join(workspace, o.name)
  await fs.mkdir(dir)
  await fs.writeFile(path.join(dir, 'main.c'), MAIN_C_TEMPLATE)
  await fs.copyFile(linkerCmd, path.join(dir, 'C6748.cmd'))
  await fs.writeFile(path.join(dir, 'labsim.json'), labsimJson(o))
  return dir
}

/** CCS's own C6748.cmd from the newest CCS install under tiRoot, else the copy shipped with LabSim. */
export async function findLinkerCmd(bundled: string, tiRoot = 'C:\\ti'): Promise<string> {
  let installs: string[] = []
  try {
    installs = (await fs.readdir(tiRoot)).filter((n) => /^ccs\d+$/i.test(n)).sort().reverse()
  } catch {
    return bundled
  }
  for (const d of installs) {
    const p = path.join(tiRoot, d, 'ccs', 'ccs_base', 'c6000', 'include', 'C6748.cmd')
    try {
      await fs.access(p)
      return p
    } catch {
      // not in this install
    }
  }
  return bundled
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/newProject.test.ts`
Expected: PASS. `ccs1300` has no `C6748.cmd`, so `ccs1281` wins.

- [ ] **Step 5: Ship the linker command file**

Run: `mkdir -p resources && cp tests/fixtures/ccs/C6748.cmd resources/C6748.cmd`

- [ ] **Step 6: Wire the API, IPC and menu**

In `src/shared/api.ts`:
1. Add `import type { NewProjectOptions } from './newProject'` and `export type { NewProjectOptions } from './newProject'`.
2. Add `| 'file.newProject'` as the first member of `MenuCommand`.
3. Add this to `LabsimApi`:

```ts
  /** Creates a project in the workspace (File > New > CCS Project); resolves to its folder. */
  createProject(opts: NewProjectOptions): Promise<string>
```

In `src/preload/index.ts`, add `createProject: (opts) => ipcRenderer.invoke('project:create', opts),` after `writeFile`.

In `src/main/ipc.ts`:
1. Change the electron import to `import { app, dialog, ipcMain, type BrowserWindow } from 'electron'`.
2. Add `import type { NewProjectOptions } from '@shared/newProject'` and `import { createProject, findLinkerCmd } from './newProject'`.
3. Add this after the `fs:write` handler:

```ts
  /** The C6748.cmd shipped in resources/ (extraResources when packaged). */
  const bundledCmd = (): string =>
    app.isPackaged ? path.join(process.resourcesPath, 'C6748.cmd') : path.join(app.getAppPath(), 'resources', 'C6748.cmd')
  ipcMain.handle('project:create', async (_e, o: NewProjectOptions) =>
    createProject(ctx.getWorkspace(), o, await findLinkerCmd(bundledCmd(), process.env.LABSIM_TI_ROOT ?? 'C:\\ti'))
  )
```

In `src/main/menu.ts`, make this the first item of the File submenu (before Save):

```ts
        { label: 'New', submenu: [{ label: 'CCS Project...', click: send('file.newProject') }] },
        { type: 'separator' },
```

In `tests/unit/store.test.ts`, add this line to the `api: FakeApi` literal. Task 3 replaces it with a real fake.

```ts
    createProject: async () => '',
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck prints no errors, and all unit tests PASS.

At this point `App.tsx`'s `handleMenu` has no case for `file.newProject`. That is fine: the switch has no exhaustiveness check, and Task 3 adds the case.

- [ ] **Step 8: Commit**

```bash
git add resources src/main/newProject.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts src/main/menu.ts tests/unit
git commit -m "feat(project): create CCS-style projects (main.c, C6748.cmd, labsim.json) from the main process"
```

---

### Task 3: New CCS Project wizard (renderer)

The dialog mirrors the CCS 12 "New CCS Project" page:
- read-only rows show the target (TMS320C6748), the connection (Texas Instruments XDS100v3 USB Debug Probe), the output type (Executable) and the template ("Empty Project (with main.c)");
- editable rows take the project name and, under *Advanced settings*, the heap and stack size, the optimization level and the predefined symbols.

**Finish** creates the project, refreshes the Project Explorer, selects and expands the project, and opens `main.c`.

**Files:**
- Modify: `src/renderer/src/store.ts`: add `DialogKind`, `dialog`, `openDialog`, `closeDialog`, `createProject`, `ipcError`.
- Create: `src/renderer/src/components/NewProjectDialog.tsx`
- Modify: `src/renderer/src/App.tsx`: the `file.newProject` case; render the dialog.
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: Task 1's `NEW_PROJECT_DEFAULTS`, `OPT_LEVELS`, `validateNewProject`, `NewProjectOptions`, and Task 2's `api.createProject`.
- Produces:
  - `type DialogKind = 'newProject' | 'preferences'` (Task 4 uses `'preferences'`)
  - `AppState.dialog: DialogKind | null`, `openDialog(d)`, `closeDialog()`
  - `AppState.createProject(o): Promise<string | null>`, which resolves to an error message, or to null on success
  - `ipcError(e: unknown): string`, exported from `store.ts`
  - The dialog is `role="dialog"` named "New CCS Project". Its fields are labelled "Project name", "Heap size", "Stack size", "Optimization level" and "Predefined symbols", and its buttons are "Finish" and "Cancel".

- [ ] **Step 1: Write the failing tests**

In `tests/unit/store.test.ts`:
1. Add `NewProjectOptions` to the `@shared/api` type import. Add `import { NEW_PROJECT_DEFAULTS } from '@shared/newProject'`.
2. Add `created: NewProjectOptions[]` to the `FakeApi` type.
3. Replace the `createProject: async () => '',` line from Task 2 with:

```ts
    created: [],
    createProject: async (o: NewProjectOptions) => {
      if (o.name === 'dup') throw new Error("Error invoking remote method 'project:create': Error: 'dup' already exists in the workspace.")
      api.created.push(o)
      const dir = `${WS}\\${o.name}`
      projects.push({ name: o.name, dir, isCcsProject: false })
      api.files[`${dir}\\main.c`] = 'int main(void)\r\n{\r\n\treturn 0;\r\n}\r\n'
      return dir
    },
```

4. Append:

```ts
describe('new project', () => {
  it('creates the project, selects and expands it, opens main.c and closes the dialog', async () => {
    store.getState().openDialog('newProject')
    expect(store.getState().dialog).toBe('newProject')
    expect(await store.getState().createProject({ name: 'lab1', ...NEW_PROJECT_DEFAULTS })).toBeNull()
    const dir = `${WS}\\lab1`
    expect(api.created).toEqual([{ name: 'lab1', ...NEW_PROJECT_DEFAULTS }])
    expect(store.getState().projects.map((p) => p.name)).toContain('lab1')
    expect(store.getState()).toMatchObject({ dialog: null, selectedProject: dir, activeTab: `${dir}\\main.c` })
    expect(store.getState().expanded[dir]).toBe(true)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toBe(`Created project lab1 in ${dir}`)
  })

  it('returns the error without the IPC prefix and keeps the dialog open', async () => {
    store.getState().openDialog('newProject')
    expect(await store.getState().createProject({ name: 'dup', ...NEW_PROJECT_DEFAULTS })).toBe("'dup' already exists in the workspace.")
    expect(store.getState().dialog).toBe('newProject')
    store.getState().closeDialog()
    expect(store.getState().dialog).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: FAIL with `store.getState().openDialog is not a function`.

- [ ] **Step 3: Add the dialog state and `createProject` to the store**

In `src/renderer/src/store.ts`:
1. Add `NewProjectOptions` to the `@shared/api` type import.
2. Add these after `isDirty`:

```ts
export type DialogKind = 'newProject' | 'preferences'

/** An IPC rejection's message without Electron's "Error invoking remote method 'x': Error: " prefix. */
export const ipcError = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
```

3. Add these to `AppState` (after `chooseCompiler(): Promise<void>`):

```ts
  dialog: DialogKind | null
  openDialog(d: DialogKind): void
  closeDialog(): void
  /** File > New > CCS Project; resolves to an error to show in the dialog, or null when done. */
  createProject(o: NewProjectOptions): Promise<string | null>
```

4. Add `dialog: null,` to the initial state (next to `bottomTab: 'console',`).
5. Add these actions before `async openAt(path, line) {`:

```ts
    openDialog(dialog) {
      set({ dialog })
    },

    closeDialog() {
      set({ dialog: null })
    },

    async createProject(o) {
      let dir: string
      try {
        dir = await api.createProject(o)
      } catch (e) {
        return ipcError(e)
      }
      await get().refresh()
      set({ selectedProject: dir, dialog: null })
      if (!get().expanded[dir]) await get().toggleExpand(dir)
      await get().openFile(`${dir}\\main.c`)
      get().print(MAIN_CONSOLE, `Created project ${o.name} in ${dir}`, 'info')
      return null
    },
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: PASS

- [ ] **Step 5: Create the dialog**

Create `src/renderer/src/components/NewProjectDialog.tsx`:

```tsx
import { useState, type JSX } from 'react'
import { NEW_PROJECT_DEFAULTS, OPT_LEVELS, validateNewProject, type NewProjectOptions, type OptLevel } from '@shared/newProject'
import { appStore, useApp } from '../appStore'

const splitSymbols = (text: string): string[] => text.split(/[\s,;]+/).filter(Boolean)

function Body(): JSX.Element {
  const st = appStore.getState()
  const [name, setName] = useState('')
  const [heapSize, setHeap] = useState(NEW_PROJECT_DEFAULTS.heapSize)
  const [stackSize, setStack] = useState(NEW_PROJECT_DEFAULTS.stackSize)
  const [optLevel, setOpt] = useState<OptLevel>(NEW_PROJECT_DEFAULTS.optLevel)
  const [symbols, setSymbols] = useState(NEW_PROJECT_DEFAULTS.defines.join(' '))
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const opts: NewProjectOptions = { name: name.trim(), heapSize: heapSize.trim(), stackSize: stackSize.trim(), optLevel, defines: splitSymbols(symbols) }
  const invalid = validateNewProject(opts)

  const finish = async (): Promise<void> => {
    if (invalid || busy) return
    setBusy(true)
    setFailure(await st.createProject(opts))
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && st.closeDialog()}>
      <div
        className="modal wizard-dialog"
        role="dialog"
        aria-label="New CCS Project"
        onKeyDown={(e) => {
          if (e.key === 'Escape') st.closeDialog()
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) void finish()
        }}
      >
        <div className="modal-title">New CCS Project</div>
        <div className="wizard-note">Create a new CCS project for the TMS320C6748 (LCDK).</div>
        <table className="grid prop-table">
          <tbody>
            <tr className="prop-group"><td colSpan={2}>Target</td></tr>
            <tr><td>Target</td><td>C674x Floating-point DSP: TMS320C6748</td></tr>
            <tr><td>Connection</td><td>Texas Instruments XDS100v3 USB Debug Probe</td></tr>
            <tr className="prop-group"><td colSpan={2}>Project</td></tr>
            <tr>
              <td>Project name</td>
              <td><input aria-label="Project name" autoFocus spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} /></td>
            </tr>
            <tr><td>Output type</td><td>Executable</td></tr>
            <tr><td>Project template</td><td>Empty Project (with main.c)</td></tr>
            <tr className="prop-group"><td colSpan={2}>Advanced settings</td></tr>
            <tr>
              <td>Heap size</td>
              <td><input aria-label="Heap size" spellCheck={false} value={heapSize} onChange={(e) => setHeap(e.target.value)} /></td>
            </tr>
            <tr>
              <td>Stack size</td>
              <td><input aria-label="Stack size" spellCheck={false} value={stackSize} onChange={(e) => setStack(e.target.value)} /></td>
            </tr>
            <tr>
              <td>Optimization level</td>
              <td>
                <select aria-label="Optimization level" value={optLevel} onChange={(e) => setOpt(e.target.value as OptLevel)}>
                  {OPT_LEVELS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>Predefined symbols</td>
              <td><input aria-label="Predefined symbols" spellCheck={false} value={symbols} onChange={(e) => setSymbols(e.target.value)} /></td>
            </tr>
          </tbody>
        </table>
        <div className="modal-error" role="alert">{failure ?? (name ? invalid : null) ?? ''}</div>
        <div className="modal-buttons">
          <span className="tb-spacer" />
          <button disabled={!!invalid || busy} onClick={() => void finish()}>Finish</button>
          <button onClick={() => st.closeDialog()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function NewProjectDialog(): JSX.Element | null {
  const open = useApp((s) => s.dialog === 'newProject')
  return open ? <Body /> : null
}
```

- [ ] **Step 6: Wire it into `App.tsx` and add styles**

In `src/renderer/src/App.tsx`:
1. Add `import { NewProjectDialog } from './components/NewProjectDialog'`.
2. Add `case 'file.newProject': s.openDialog('newProject'); break` as the first case in `handleMenu`'s switch that uses `s` (next to `file.save`).
3. Render `<NewProjectDialog />` right after `<GraphPropertiesDialog />`.

Append to `src/renderer/src/styles.css`:

```css
.wizard-dialog { width: 560px; }
.wizard-note { padding: 8px 12px 4px; color: var(--muted); }
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: typecheck prints no errors, all unit tests pass, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src tests/unit/store.test.ts
git commit -m "feat(ui): File > New > CCS Project wizard"
```

---

### Task 4: Preferences page

**Window > Preferences...** opens a dialog with two sections:
- **C6000 Compiler** shows the compiler in use: its version and folder, and whether it was auto-detected or chosen, or "Not found" when builds use the LabSim front-end. It has **Browse...** (the existing folder picker) and **Use Auto-detect** (forget the chosen folder and search `C:\ti` again).
- **Workspace** shows the workspace folder and has **Switch Workspace...**.

The old *Preferences > C6000 Compiler Location...* submenu item and its `window.compilerLocation` command go away.

**Files:**
- Modify: `src/main/index.ts`: `compilerChosen`, `resetCompilerRoot` in the IPC context.
- Modify: `src/main/ipc.ts`: `build:compilerInfo`, `build:autoCompiler`.
- Modify: `src/shared/api.ts`, `src/preload/index.ts`, `src/main/menu.ts`
- Modify: `src/renderer/src/store.ts`: `compiler`, `loadCompiler`, `autoDetectCompiler`; `chooseCompiler` refreshes `compiler`; the not-found messages.
- Modify: `src/main/build/fallback.ts:86`: the message now names Window > Preferences.
- Create: `src/renderer/src/components/PreferencesDialog.tsx`
- Modify: `src/renderer/src/App.tsx`, `tests/unit/store.test.ts`

**Interfaces:**
- Consumes (Task 3): `DialogKind` `'preferences'`, `openDialog`, `closeDialog`.
- Produces:
  - `interface CompilerInfo { toolchain: Toolchain | null; chosen: boolean }` in `@shared/api`
  - `LabsimApi.compilerInfo(): Promise<CompilerInfo>`, `LabsimApi.autoDetectCompiler(): Promise<Toolchain | null>`
  - `MenuCommand` loses `'window.compilerLocation'` and gains `'window.preferences'`
  - `AppState.compiler: CompilerInfo | null`, `loadCompiler(): Promise<void>`, `autoDetectCompiler(): Promise<void>`
  - The dialog is `role="dialog"` named "Preferences". Its buttons are "Browse...", "Use Auto-detect", "Switch Workspace..." and "Close". The compiler status is in `.pref-compiler`, and the workspace is in `.pref-workspace`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/store.test.ts`, add `autoCalls: number` to the `FakeApi` type. Add these to the `api` literal:

```ts
    autoCalls: 0,
    compilerInfo: async () => ({ toolchain: api.toolchain, chosen: api.toolchain !== null }),
    autoDetectCompiler: async () => {
      api.autoCalls++
      api.toolchain = null
      return null
    },
```

Then append:

```ts
describe('preferences', () => {
  it('loads the compiler in use and switches to auto-detect', async () => {
    await store.getState().loadCompiler()
    expect(store.getState().compiler).toEqual({ toolchain: api.toolchain, chosen: true })
    await store.getState().autoDetectCompiler()
    expect(api.autoCalls).toBe(1)
    expect(store.getState().compiler).toEqual({ toolchain: null, chosen: false })
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toBe('C6000 compiler: not found by auto-detect; builds will use the LabSim front-end.')
  })

  it('refreshes the compiler after Browse', async () => {
    await store.getState().chooseCompiler()
    expect(store.getState().compiler?.toolchain?.version).toBe('8.3.12')
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: FAIL with `store.getState().loadCompiler is not a function`.

- [ ] **Step 3: Main process: know whether the compiler was chosen, and forget it**

In `src/main/ipc.ts`, add these to `IpcContext` after `setCompilerRoot`:

```ts
  /** True when a compiler folder was chosen (settings or LABSIM_COMPILER_ROOT) rather than auto-detected. */
  compilerChosen(): Promise<boolean>
  /** Forgets the chosen folder and auto-detects again. */
  resetCompilerRoot(): Promise<Toolchain | null>
```

Then add these handlers after `build:chooseCompiler`:

```ts
  ipcMain.handle('build:compilerInfo', async () => ({ toolchain: ctx.getToolchain(), chosen: await ctx.compilerChosen() }))
  ipcMain.handle('build:autoCompiler', () => ctx.resetCompilerRoot())
```

In `src/main/index.ts`, add these to the object passed to `registerIpc`, after `setCompilerRoot`:

```ts
    compilerChosen: async () => process.env.LABSIM_COMPILER_ROOT !== undefined || !!(await loadSettings(settingsFile())).compilerRoot,
    resetCompilerRoot: async () => {
      const s = await loadSettings(settingsFile())
      delete s.compilerRoot
      await saveSettings(settingsFile(), s)
      toolchain = await findToolchain(process.env.LABSIM_COMPILER_ROOT)
      return toolchain
    },
```


- [ ] **Step 4: API, preload and menu**

In `src/shared/api.ts`:
1. Replace `| 'window.compilerLocation'` with `| 'window.preferences'`.
2. Add this after `FileDialogOptions`:

```ts
export interface CompilerInfo {
  toolchain: Toolchain | null
  /** The folder was chosen in Preferences (or by LABSIM_COMPILER_ROOT), not auto-detected. */
  chosen: boolean
}
```

3. Add this to `LabsimApi` after `chooseCompiler`:

```ts
  compilerInfo(): Promise<CompilerInfo>
  /** Forgets the chosen compiler folder and auto-detects again; resolves to the toolchain now in use. */
  autoDetectCompiler(): Promise<Toolchain | null>
```

In `src/preload/index.ts`, add these after `chooseCompiler`:

```ts
  compilerInfo: () => ipcRenderer.invoke('build:compilerInfo'),
  autoDetectCompiler: () => ipcRenderer.invoke('build:autoCompiler'),
```

In `src/main/menu.ts`, replace the Preferences line with:

```ts
        { label: 'Preferences...', click: send('window.preferences') },
```

- [ ] **Step 5: Store**

In `src/renderer/src/store.ts`:
1. Add `CompilerInfo` to the `@shared/api` type import.
2. Replace the not-found message in `init`:

```ts
      else get().print(MAIN_CONSOLE, "C6000 compiler (cl6x) not found. Builds will use the LabSim front-end; choose TI's compiler in Window > Preferences.", 'error')
```

3. Add these to `AppState`, next to `chooseCompiler`:

```ts
  compiler: CompilerInfo | null
  loadCompiler(): Promise<void>
  autoDetectCompiler(): Promise<void>
```

4. Add `compiler: null,` to the initial state.
5. Replace `chooseCompiler` and add the two new actions:

```ts
    async chooseCompiler() {
      try {
        const tc = await api.chooseCompiler()
        if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version})`, 'info')
      } catch (e) {
        get().print(MAIN_CONSOLE, ipcError(e), 'error')
      }
      await get().loadCompiler()
    },

    async loadCompiler() {
      set({ compiler: await api.compilerInfo() })
    },

    async autoDetectCompiler() {
      const tc = await api.autoDetectCompiler()
      if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version}), auto-detected`, 'info')
      else get().print(MAIN_CONSOLE, 'C6000 compiler: not found by auto-detect; builds will use the LabSim front-end.', 'info')
      await get().loadCompiler()
    },
```

In `src/main/build/fallback.ts`, change the second fallback message to:

```ts
  emit("Its diagnostics follow cl6x 8.3. Choose TI's compiler in Window > Preferences to build with it.", 'info')
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `npx vitest run tests/unit`
Expected: PASS. If any existing test asserted the old wording "Window > Preferences > C6000 Compiler Location", update it to the new wording from Step 5. Run `grep -rn "Compiler Location" tests` first; the plan's author found no such assertions.

- [ ] **Step 7: Create the dialog**

Create `src/renderer/src/components/PreferencesDialog.tsx`:

```tsx
import { useEffect, type JSX } from 'react'
import { appStore, useApp } from '../appStore'

function Body(): JSX.Element {
  const st = appStore.getState()
  const compiler = useApp((s) => s.compiler)
  const workspace = useApp((s) => s.workspace)

  useEffect(() => {
    void appStore.getState().loadCompiler()
  }, [])

  const tc = compiler?.toolchain
  const status = compiler === null ? 'Looking for the compiler…' : tc ? `TI C6000 compiler v${tc.version} (${compiler.chosen ? 'chosen' : 'auto-detected'})` : 'Not found: builds use the LabSim front-end.'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && st.closeDialog()}>
      <div className="modal prefs-dialog" role="dialog" aria-label="Preferences" onKeyDown={(e) => e.key === 'Escape' && st.closeDialog()}>
        <div className="modal-title">Preferences</div>
        <section className="pref-section">
          <h3>C6000 Compiler</h3>
          <div className="pref-compiler">{status}</div>
          {tc && <div className="pref-path" title={tc.root}>{tc.root}</div>}
          <div className="pref-hint">LabSim looks for C:\ti\ccs*\ccs\tools\compiler\ti-cgt-c6000_* and uses the newest one.</div>
          <div className="pref-actions">
            <button onClick={() => void st.chooseCompiler()}>Browse...</button>
            <button disabled={compiler !== null && !compiler.chosen} onClick={() => void st.autoDetectCompiler()}>Use Auto-detect</button>
          </div>
        </section>
        <section className="pref-section">
          <h3>Workspace</h3>
          <div className="pref-workspace pref-path" title={workspace}>{workspace}</div>
          <div className="pref-actions">
            <button
              onClick={() => {
                st.closeDialog()
                void st.switchWorkspace()
              }}
            >
              Switch Workspace...
            </button>
          </div>
        </section>
        <div className="modal-buttons">
          <span className="tb-spacer" />
          <button autoFocus onClick={() => st.closeDialog()}>Close</button>
        </div>
      </div>
    </div>
  )
}

export function PreferencesDialog(): JSX.Element | null {
  const open = useApp((s) => s.dialog === 'preferences')
  return open ? <Body /> : null
}
```

- [ ] **Step 8: Wire it into `App.tsx` and add styles**

In `src/renderer/src/App.tsx`:
1. Add `import { PreferencesDialog } from './components/PreferencesDialog'`.
2. Replace `case 'window.compilerLocation': void s.chooseCompiler(); break` with `case 'window.preferences': s.openDialog('preferences'); break`.
3. Render `<PreferencesDialog />` after `<NewProjectDialog />`.

Append to `src/renderer/src/styles.css`:

```css
.prefs-dialog { width: 560px; }
.pref-section { padding: 8px 12px; border-bottom: 1px solid #eef0f3; }
.pref-section h3 { margin: 0 0 6px; font-size: 13px; }
.pref-path { font-family: Consolas, 'Courier New', monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pref-hint { margin-top: 4px; color: var(--muted); font-size: 12px; }
.pref-actions { display: flex; gap: 6px; margin-top: 8px; }
.pref-actions button { padding: 3px 10px; }
```

- [ ] **Step 9: Verify**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: typecheck is clean, the unit tests pass, and the build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src tests/unit/store.test.ts
git commit -m "feat(ui): Window > Preferences with the compiler (browse / auto-detect) and workspace"
```

---

### Task 5: Memory Browser formatter

The Memory Browser shows 16 bytes per row and 32 rows per page (512 bytes). It offers CCS's format names. TI style hex has no `0x`, and C style has it. Bytes are little-endian, as on the C6748. A cell whose bytes cannot be read shows question marks.

**Files:**
- Create: `src/renderer/src/memory/format.ts`
- Test: `tests/unit/memory/format.test.ts`

**Interfaces:**
- Produces:
  - `MEMORY_FORMATS`, `type MemoryFormat`
  - `ROW_BYTES = 16`, `PAGE_ROWS = 32`, `PAGE_BYTES = 512`
  - `unitSize(f): 1 | 2 | 4`, `alignDown(addr, f): number`, `hexAddr(n): string` (`0x80001000`)
  - `float32Text(v: number): string`
  - `interface MemoryRow { address: number; cells: string[] }`
  - `formatRows(start: number, bytes: (number | null)[], f: MemoryFormat): MemoryRow[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/memory/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { alignDown, float32Text, formatRows, hexAddr, PAGE_BYTES, unitSize } from '../../../src/renderer/src/memory/format'

/** One 16-byte row: 0.5f, -1, 'A' 'B' 0 0x7f, 0x12345678. */
const ROW = [0x00, 0x00, 0x00, 0x3f, 0xff, 0xff, 0xff, 0xff, 0x41, 0x42, 0x00, 0x7f, 0x78, 0x56, 0x34, 0x12]

describe('memory formats', () => {
  it('formats 32-bit words', () => {
    const cells = (f: Parameters<typeof formatRows>[2]) => formatRows(0x80001000, ROW, f)[0].cells
    expect(cells('32-Bit Hex - TI Style')).toEqual(['3F000000', 'FFFFFFFF', '7F004241', '12345678'])
    expect(cells('32-Bit Hex - C Style')).toEqual(['0x3F000000', '0xFFFFFFFF', '0x7F004241', '0x12345678'])
    expect(cells('32-Bit Signed Int')).toEqual(['1056964608', '-1', '2130723393', '305419896'])
    expect(cells('32-Bit Unsigned Int')).toEqual(['1056964608', '4294967295', '2130723393', '305419896'])
    expect(cells('32-Bit Floating Point')[0]).toBe('0.5')
    expect(cells('32-Bit Floating Point')[1]).toBe('NaN')
  })

  it('formats 16-bit, 8-bit and characters', () => {
    const cells = (f: Parameters<typeof formatRows>[2]) => formatRows(0, ROW, f)[0].cells
    expect(cells('16-Bit Hex - TI Style').slice(0, 3)).toEqual(['0000', '3F00', 'FFFF'])
    expect(cells('16-Bit Signed Int').slice(2, 4)).toEqual(['-1', '-1'])
    expect(cells('8-Bit Hex - TI Style')).toHaveLength(16)
    expect(cells('8-Bit Hex - TI Style')[3]).toBe('3F')
    expect(cells('Character').slice(8, 12)).toEqual(['A', 'B', '.', '.'])
  })

  it('marks unreadable bytes and numbers the rows', () => {
    const bytes = [...ROW, ...Array<null>(16).fill(null)]
    const rows = formatRows(0x80001000, bytes, '32-Bit Hex - TI Style')
    expect(rows.map((r) => r.address)).toEqual([0x80001000, 0x80001010])
    expect(rows[1].cells).toEqual(['????????', '????????', '????????', '????????'])
    expect(formatRows(0, bytes, 'Character')[1].cells[0]).toBe('?')
    expect(formatRows(0, bytes, '32-Bit Floating Point')[1].cells[0]).toBe('????????')
  })

  it('aligns, prints addresses and float text', () => {
    expect(PAGE_BYTES).toBe(512)
    expect(unitSize('16-Bit Signed Int')).toBe(2)
    expect(alignDown(0x80001003, '32-Bit Floating Point')).toBe(0x80001000)
    expect(alignDown(0x80001003, 'Character')).toBe(0x80001003)
    expect(hexAddr(0x80001000)).toBe('0x80001000')
    expect(hexAddr(0x10)).toBe('0x00000010')
    expect(float32Text(Math.fround(0.1))).toBe('0.1')
    expect(float32Text(Math.fround(-1.75e-7))).toBe('-1.75e-7')
    expect(float32Text(Infinity)).toBe('Inf')
    expect(float32Text(-0)).toBe('0')
  })
})
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/memory`
Expected: FAIL, because it cannot resolve `format`.

- [ ] **Step 3: Implement the formatter**

Create `src/renderer/src/memory/format.ts`:

```ts
/** The Memory Browser's formats (CCS's names) and row layout. */

export const MEMORY_FORMATS = [
  '32-Bit Hex - TI Style',
  '32-Bit Hex - C Style',
  '32-Bit Signed Int',
  '32-Bit Unsigned Int',
  '32-Bit Floating Point',
  '16-Bit Hex - TI Style',
  '16-Bit Signed Int',
  '8-Bit Hex - TI Style',
  'Character'
] as const
export type MemoryFormat = (typeof MEMORY_FORMATS)[number]

export const ROW_BYTES = 16
export const PAGE_ROWS = 32
export const PAGE_BYTES = ROW_BYTES * PAGE_ROWS

export function unitSize(f: MemoryFormat): 1 | 2 | 4 {
  return f.startsWith('32') ? 4 : f.startsWith('16') ? 2 : 1
}

export const alignDown = (addr: number, f: MemoryFormat): number => (addr - (addr % unitSize(f))) >>> 0

export const hexAddr = (n: number): string => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

/** The shortest decimal that reads back as the same float32. */
export function float32Text(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf'
  if (v === 0) return '0'
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p))
    if (Math.fround(n) === v) return String(n)
  }
  return String(v)
}

export interface MemoryRow {
  address: number
  cells: string[]
}

function cell(b: (number | null)[], f: MemoryFormat): string {
  const size = b.length
  if (b.some((x) => x === null)) return f === 'Character' ? '?' : '?'.repeat(size * 2)
  const bytes = b as number[]
  const u = bytes.reduceRight((acc, x) => acc * 256 + x, 0)
  const hex = u.toString(16).toUpperCase().padStart(size * 2, '0')
  switch (f) {
    case '32-Bit Hex - C Style':
      return `0x${hex}`
    case '32-Bit Signed Int':
      return String(u | 0)
    case '32-Bit Unsigned Int':
      return String(u)
    case '16-Bit Signed Int':
      return String(u >= 0x8000 ? u - 0x10000 : u)
    case '32-Bit Floating Point':
      return float32Text(new DataView(Uint8Array.from(bytes).buffer).getFloat32(0, true))
    case 'Character':
      return u >= 32 && u < 127 ? String.fromCharCode(u) : '.'
    default:
      return hex
  }
}

/** bytes[i] is the byte at start + i, or null where memory cannot be read. */
export function formatRows(start: number, bytes: (number | null)[], f: MemoryFormat): MemoryRow[] {
  const size = unitSize(f)
  const rows: MemoryRow[] = []
  for (let r = 0; r + ROW_BYTES <= bytes.length; r += ROW_BYTES) {
    const cells: string[] = []
    for (let i = r; i < r + ROW_BYTES; i += size) cells.push(cell(bytes.slice(i, i + size), f))
    rows.push({ address: (start + r) >>> 0, cells })
  }
  return rows
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/memory && npm run typecheck`
Expected: PASS, and typecheck prints no errors.

Some expected values, worked out:
- `0x7F004241` is the bytes `41 42 00 7F` read little-endian.
- `-1.75e-7` is the shortest float32 round-trip text: `toPrecision(3)` gives `1.75e-7`.
- `-0` shows as `0`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/memory/format.ts tests/unit/memory/format.test.ts
git commit -m "feat(memory): Memory Browser formats and row layout"
```

---

### Task 6: Memory Browser store

**Go** evaluates the text in the selected frame with the Step 6 `address` request. Whatever it evaluates to is used as the address: `y`, `&x[4]`, `0x80000000`, `buf + 2`. The start is aligned down to the format's unit size, and one page (512 bytes) is read.

If the whole page is not readable, each 16-byte row is read on its own, and the unreadable rows show `?`.

The page refreshes on every halt and when the format changes. Previous Page and Next Page move by one page.

**Files:**
- Create: `src/renderer/src/memoryStore.ts`
- Test: `tests/unit/memoryStore.test.ts`

**Interfaces:**
- Consumes:
  - Task 5: `alignDown`, `formatRows`, `MemoryFormat`, `MemoryRow`, `PAGE_BYTES`, `PAGE_ROWS`, `ROW_BYTES`.
  - Step 6's `graphStore.ts`: `DebugSource` and `NO_SESSION`.
  - `@shared/debug`'s `AddressResult`.
- Produces:
  - `createMemoryStore(api: LabsimApi, debug: DebugSource)`, which returns a zustand vanilla store of `MemoryState`:
    - fields: `expr: string`, `format: MemoryFormat` (default `'32-Bit Hex - TI Style'`), `base: number | null`, `rows: MemoryRow[]`, `error: string | null`
    - actions: `go(expr: string): Promise<void>`, `setFormat(f: MemoryFormat): Promise<void>`, `page(delta: number): Promise<void>`, `refresh(): Promise<void>`
  - `type MemoryStore = ReturnType<typeof createMemoryStore>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/memoryStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { LabsimApi } from '@shared/api'
import type { DebugCommand } from '@shared/debug'
import type { SessionStatus } from '../../src/renderer/src/debugStore'
import { NO_SESSION } from '../../src/renderer/src/graphStore'
import { createMemoryStore, type MemoryStore } from '../../src/renderer/src/memoryStore'

const Y = 0x80001000
type Mini = { status: SessionStatus; project: string | null; selectedFrame: number }

function fakeApi() {
  const api = {
    requests: [] as DebugCommand[],
    /** Readable bytes by address. */
    mem: new Map<number, number>(),
    debugRequest: async (cmd: DebugCommand): Promise<unknown> => {
      api.requests.push(cmd)
      if (cmd.cmd === 'address') return cmd.expr === 'y' ? { address: Y } : cmd.expr === 'odd' ? { address: Y + 3 } : { error: `identifier "${cmd.expr}" is undefined` }
      if (cmd.cmd === 'readMemory') {
        const out: number[] = []
        for (let i = 0; i < cmd.length; i++) {
          const b = api.mem.get(cmd.addr + i)
          if (b === undefined) return null
          out.push(b)
        }
        return out
      }
      return null
    }
  }
  return api
}

let api: ReturnType<typeof fakeApi>
let debug: StoreApi<Mini>
let mem: MemoryStore
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  api = fakeApi()
  // y = { 0.5f, 1.0f } and 256 more readable bytes; everything from Y + 264 on is unmapped.
  ;[0x00, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x80, 0x3f].forEach((b, i) => api.mem.set(Y + i, b))
  for (let i = 8; i < 264; i++) api.mem.set(Y + i, 0)
  debug = createStore<Mini>()(() => ({ status: 'suspended', project: 'C:\\ws\\p', selectedFrame: 2 }))
  mem = createMemoryStore(api as unknown as LabsimApi, debug)
})

describe('Memory Browser store', () => {
  it('goes to a symbol in the selected frame and reads a page, row by row where unmapped', async () => {
    await mem.getState().go(' y ')
    const s = mem.getState()
    expect(s).toMatchObject({ expr: 'y', base: Y, error: null })
    expect(api.requests[0]).toEqual({ cmd: 'address', frame: 2, expr: 'y' })
    expect(api.requests[1]).toEqual({ cmd: 'readMemory', addr: Y, length: 512 })
    expect(s.rows).toHaveLength(32)
    expect(s.rows[0].cells).toEqual(['3F000000', '3F800000', '00000000', '00000000'])
    expect(s.rows[15].cells).toEqual(['00000000', '00000000', '00000000', '00000000'])
    expect(s.rows[16].cells).toEqual(['????????', '????????', '????????', '????????'])
    expect(s.rows[31].cells[0]).toBe('????????')
  })

  it('changes format, aligns the start and pages', async () => {
    await mem.getState().go('odd')
    expect(mem.getState().base).toBe(Y)
    await mem.getState().setFormat('32-Bit Floating Point')
    expect(mem.getState().rows[0].cells.slice(0, 2)).toEqual(['0.5', '1'])
    await mem.getState().page(1)
    expect(mem.getState().base).toBe(Y + 512)
    expect(mem.getState().rows[0].cells[0]).toBe('????????')
    await mem.getState().page(-1)
    expect(mem.getState().base).toBe(Y)
  })

  it('explains bad input and a missing session', async () => {
    await mem.getState().go('')
    expect(mem.getState().error).toBe('Enter an address or an expression such as y or &x[4].')
    await mem.getState().go('nosuch')
    expect(mem.getState().error).toBe('Invalid address: identifier "nosuch" is undefined')
    debug.setState({ status: 'idle' })
    await mem.getState().go('y')
    expect(mem.getState().error).toBe(NO_SESSION)
  })

  it('refreshes on every halt', async () => {
    await mem.getState().go('y')
    api.mem.set(Y, 0x11)
    debug.setState({ status: 'running' })
    debug.setState({ status: 'suspended' })
    await settle()
    expect(mem.getState().rows[0].cells[0]).toBe('3F000011')
  })
})
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/memoryStore.test.ts`
Expected: FAIL, because it cannot resolve `memoryStore`.

- [ ] **Step 3: Implement the store**

Create `src/renderer/src/memoryStore.ts`:

```ts
import { createStore } from 'zustand/vanilla'
import type { LabsimApi } from '@shared/api'
import type { AddressResult } from '@shared/debug'
import type { SessionStatus } from './debugStore'
import { NO_SESSION, type DebugSource } from './graphStore'
import { alignDown, formatRows, PAGE_BYTES, PAGE_ROWS, ROW_BYTES, type MemoryFormat, type MemoryRow } from './memory/format'
import { ipcError } from './store'

export interface MemoryState {
  expr: string
  format: MemoryFormat
  /** The first address shown; null until Go. */
  base: number | null
  rows: MemoryRow[]
  /** Shown in place of the rows. */
  error: string | null
  go(expr: string): Promise<void>
  setFormat(f: MemoryFormat): Promise<void>
  page(delta: number): Promise<void>
  refresh(): Promise<void>
}

const HALTED: SessionStatus[] = ['suspended', 'exited', 'halted']
const LIVE: SessionStatus[] = ['running', ...HALTED]
const LAST_PAGE = 0x1_0000_0000 - PAGE_BYTES

export function createMemoryStore(api: LabsimApi, debug: DebugSource) {
  return createStore<MemoryState>()((set, get) => {
    let seq = 0

    /** Reads the page at `base`: in one request, or row by row when part of it is unmapped. */
    const load = async (base: number): Promise<void> => {
      const mine = ++seq
      try {
        let bytes = (await api.debugRequest({ cmd: 'readMemory', addr: base, length: PAGE_BYTES })) as (number | null)[] | null
        if (!bytes) {
          bytes = []
          for (let r = 0; r < PAGE_ROWS; r++) {
            const row = (await api.debugRequest({ cmd: 'readMemory', addr: base + r * ROW_BYTES, length: ROW_BYTES })) as number[] | null
            bytes.push(...(row ?? Array<null>(ROW_BYTES).fill(null)))
          }
        }
        if (mine === seq) set({ base, rows: formatRows(base, bytes, get().format), error: null })
      } catch (e) {
        if (mine === seq) set({ error: ipcError(e) })
      }
    }

    debug.subscribe((s, prev) => {
      if (s.status !== prev.status && HALTED.includes(s.status)) void get().refresh()
    })

    return {
      expr: '',
      format: '32-Bit Hex - TI Style',
      base: null,
      rows: [],
      error: null,

      async go(text) {
        const expr = text.trim()
        set({ expr })
        if (!expr) return set({ error: 'Enter an address or an expression such as y or &x[4].' })
        if (!LIVE.includes(debug.getState().status)) return set({ error: NO_SESSION })
        let r: AddressResult
        try {
          r = (await api.debugRequest({ cmd: 'address', frame: debug.getState().selectedFrame, expr })) as AddressResult
        } catch (e) {
          return set({ error: ipcError(e) })
        }
        if ('error' in r) return set({ error: `Invalid address: ${r.error}` })
        await load(Math.min(alignDown(r.address, get().format), LAST_PAGE))
      },

      async setFormat(format) {
        set({ format })
        const base = get().base
        if (base !== null && LIVE.includes(debug.getState().status)) await load(alignDown(base, format))
      },

      async page(delta) {
        const base = get().base
        if (base === null || !LIVE.includes(debug.getState().status)) return
        await load(Math.max(0, Math.min(LAST_PAGE, base + delta * PAGE_BYTES)))
      },

      async refresh() {
        const base = get().base
        if (base !== null && LIVE.includes(debug.getState().status)) await load(base)
      }
    }
  })
}

export type MemoryStore = ReturnType<typeof createMemoryStore>
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/memoryStore.test.ts && npm run typecheck`
Expected: PASS, and typecheck prints no errors.

Why row 16 is unreadable: readable bytes end at `Y + 264`, so row 16 (`Y + 256` .. `Y + 271`) is only partly mapped. Its 16-byte read fails, and the whole row shows `?`. The browser reports readability one row at a time, which is all the spec asks for.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/memoryStore.ts tests/unit/memoryStore.test.ts
git commit -m "feat(memory): Memory Browser store (go, format, paging, refresh on halt)"
```

---

### Task 7: Memory Browser view and View menu

The Memory Browser is a tab of the bottom panel, next to Console and Problems. It opens from **View > Memory Browser** or from its tab.

**Files:**
- Create: `src/renderer/src/components/MemoryView.tsx`
- Modify:
  - `src/renderer/src/store.ts`: `BottomTab` gains `'memory'`.
  - `src/renderer/src/components/BottomPanel.tsx`: the third tab.
  - `src/renderer/src/appStore.ts`: `memoryStore`, `useMemory`.
  - `src/renderer/src/App.tsx`: `view.memoryBrowser`.
  - `src/main/menu.ts`: the View menu.
  - `src/shared/api.ts`: `MenuCommand` gains `'view.memoryBrowser'`.
  - `src/renderer/src/styles.css`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: Task 5's `MEMORY_FORMATS` and `hexAddr`, and Task 6's `createMemoryStore`.
- Produces:
  - Tabs: the bottom tab button is named "Memory Browser".
  - Inputs: the address field is labelled "Memory address", and the format select is labelled "Memory format".
  - Buttons: "Go", "Previous Page", "Next Page", "Refresh".
  - Rows: each is `tr.mem-row`, with `td.mem-addr` and `td.mem-cell`. Errors appear in `.memory-error`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/store.test.ts`:

```ts
describe('bottom panel', () => {
  it('can show the Memory Browser', () => {
    store.getState().setBottomTab('memory')
    expect(store.getState().bottomTab).toBe('memory')
  })
})
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npm run typecheck`
Expected: FAIL with `Argument of type '"memory"' is not assignable to parameter of type 'BottomTab'`. (vitest alone would pass, since it does not typecheck.)

- [ ] **Step 3: Extend `BottomTab` and add the store instance**

In `src/renderer/src/store.ts`, change the type to `export type BottomTab = 'console' | 'problems' | 'memory'`.

In `src/renderer/src/appStore.ts`:
1. Add `import { createMemoryStore, type MemoryState } from './memoryStore'`.
2. Add `export const memoryStore = createMemoryStore(window.labsim, debugStore)` after `graphStore`.
3. Add:

```ts
/** Select a slice of the Memory Browser's state (same rule as useApp). */
export function useMemory<T>(selector: (s: MemoryState) => T): T {
  return useStore(memoryStore, selector)
}
```

- [ ] **Step 4: Create the view**

Create `src/renderer/src/components/MemoryView.tsx`:

```tsx
import { useState, type JSX } from 'react'
import { memoryStore, useMemory } from '../appStore'
import { hexAddr, MEMORY_FORMATS, type MemoryFormat } from '../memory/format'

export function MemoryView(): JSX.Element {
  const expr = useMemory((s) => s.expr)
  const format = useMemory((s) => s.format)
  const base = useMemory((s) => s.base)
  const rows = useMemory((s) => s.rows)
  const error = useMemory((s) => s.error)
  const [text, setText] = useState(expr)
  const m = memoryStore.getState()

  return (
    <div className="memory-wrap">
      <div className="console-bar memory-bar">
        <input
          className="memory-input"
          aria-label="Memory address"
          placeholder="Enter an address or expression, e.g. y or 0x80000000"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void m.go(text)}
        />
        <button className="link-btn" onClick={() => void m.go(text)}>Go</button>
        <select aria-label="Memory format" value={format} onChange={(e) => void m.setFormat(e.target.value as MemoryFormat)}>
          {MEMORY_FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <button className="icon-btn" title="Previous Page" aria-label="Previous Page" disabled={base === null} onClick={() => void m.page(-1)}>▲</button>
        <button className="icon-btn" title="Next Page" aria-label="Next Page" disabled={base === null} onClick={() => void m.page(1)}>▼</button>
        <button className="link-btn" disabled={base === null} onClick={() => void m.refresh()}>Refresh</button>
      </div>
      {error ? (
        <div className="memory-error" role="alert">{error}</div>
      ) : base === null ? (
        <div className="empty">Enter an address or a symbol (y, &amp;x[4], 0x80000000) while debugging, then press Enter.</div>
      ) : (
        <div className="memory-body">
          <table className="memory-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.address} className="mem-row">
                  <td className="mem-addr">{hexAddr(r.address)}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="mem-cell">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add the tab, the menu command and styles**

Replace `src/renderer/src/components/BottomPanel.tsx` with:

```tsx
import type { JSX } from 'react'
import { appStore, useApp } from '../appStore'
import type { BottomTab } from '../store'
import { ConsoleView } from './ConsoleView'
import { MemoryView } from './MemoryView'
import { ProblemsView } from './ProblemsView'

const TABS: [BottomTab, string][] = [
  ['console', 'Console'],
  ['problems', 'Problems'],
  ['memory', 'Memory Browser']
]

export function BottomPanel(): JSX.Element {
  const tab = useApp((s) => s.bottomTab)
  const st = appStore.getState()
  return (
    <div className="view">
      <div className="view-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'vtab active' : 'vtab'} onClick={() => st.setBottomTab(id)}>{label}</button>
        ))}
      </div>
      <div className="view-body">{tab === 'console' ? <ConsoleView /> : tab === 'problems' ? <ProblemsView /> : <MemoryView />}</div>
    </div>
  )
}
```

In `src/shared/api.ts`, add `| 'view.memoryBrowser'` to `MenuCommand`.

In `src/main/menu.ts`, add this right after the Edit menu entry:

```ts
    { label: 'View', submenu: [{ label: 'Memory Browser', click: send('view.memoryBrowser') }] },
```

In `src/renderer/src/App.tsx`, add `case 'view.memoryBrowser': s.setBottomTab('memory'); break` next to the other `s.` cases.

Append to `src/renderer/src/styles.css`:

```css
.memory-wrap { display: flex; flex-direction: column; height: 100%; }
.memory-input { width: 280px; font-family: Consolas, 'Courier New', monospace; }
.memory-body { flex: 1; min-height: 0; overflow: auto; }
.memory-table { border-collapse: collapse; font-family: Consolas, 'Courier New', monospace; font-size: 12px; }
.memory-table td { padding: 1px 10px 1px 0; white-space: nowrap; }
.mem-addr { padding-left: 8px !important; color: #1f4f86; }
.memory-error { padding: 8px; color: #c9302c; }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: typecheck is clean, all unit tests pass, and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src tests/unit/store.test.ts
git commit -m "feat(ui): Memory Browser tab and View > Memory Browser"
```

---

### Task 8: Portable `.exe` packaging

The packaging works like this:
- `npm run dist` builds `dist/DSP-LabSim-<version>-portable.exe`, a single file that runs without installing.
- `npm run dist:dir` builds the unpacked app in `dist/win-unpacked/`. The packaged-app smoke test launches that.
- electron-builder uses the Electron already in `node_modules` (`electronDist`), so it does not download Electron again.
- It still downloads its NSIS tools once, for the portable target.
- Everything the app needs at runtime is bundled by electron-vite into `out/`, so `node_modules` is left out of the package.

**Files:**
- Modify: `package.json` (dev dependency, `dist` and `dist:dir` scripts, `author`)
- Create: `electron-builder.yml`
- Create: `tests/e2e/packaged.spec.ts`

**Interfaces:**
- Consumes (Tasks 2–3): the File > New > CCS Project wizard; `LABSIM_TI_ROOT` makes it use `resources/C6748.cmd`.
- Produces: `npm run dist`, `npm run dist:dir`, and the artifact `dist/DSP-LabSim-0.1.0-portable.exe`.

- [ ] **Step 1: Install electron-builder**

Run: `npm install --save-dev electron-builder@26.15.3`
Expected: it installs, and `package.json` lists `"electron-builder": "^26.15.3"` in `devDependencies`. If npm fails because a postinstall step needs the network, report the error and stop.

- [ ] **Step 2: Configure the package**

Create `electron-builder.yml`:

```yaml
appId: app.labsim.dsp
productName: DSP LabSim
directories:
  output: dist
# electron-vite bundles the main, preload, worker and renderer code into out/; no node_modules are needed at runtime.
files:
  - out/**/*
  - package.json
  - "!node_modules/**/*"
extraResources:
  - from: resources
    to: .
    filter:
      - C6748.cmd
asar: true
npmRebuild: false
electronDist: node_modules/electron/dist
win:
  target: portable
portable:
  artifactName: DSP-LabSim-${version}-portable.exe
```

In `package.json`:
1. Add `"author": "DSP LabSim"` after `"description"`. electron-builder warns without an author.
2. Add these to `scripts`, after `"test:e2e"`:

```json
    "dist": "electron-vite build && electron-builder --win portable",
    "dist:dir": "electron-vite build && electron-builder --win dir",
```

- [ ] **Step 3: Write the packaged-app smoke test**

Create `tests/e2e/packaged.spec.ts`:

```ts
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
```

- [ ] **Step 4: Build the unpacked app and run the smoke test**

Run: `npm run dist:dir`
Expected: it ends with electron-builder listing `dist\win-unpacked`, and `dist/win-unpacked/DSP LabSim.exe` exists.

Run: `npx playwright test tests/e2e/packaged.spec.ts`
Expected: 1 passed.

If the Debug step fails because the worker cannot load from inside the asar archive (the Console shows `LabSim's debugger stopped: …` and a path containing `app.asar`), unpack the main bundle. Add this to `electron-builder.yml` under `asar: true`:

```yaml
asarUnpack:
  - out/main/**/*
```

Then run `npm run dist:dir` and the test again.

- [ ] **Step 5: Build the portable `.exe`**

Run: `npm run dist`
Expected: `dist/DSP-LabSim-0.1.0-portable.exe` exists and is roughly 80–120 MB (Electron plus the bundle).

Run: `ls -la dist/*.exe`

- [ ] **Step 6: Make sure the default e2e run still passes**

Run: `npm run test:e2e`
Expected: every test passes. `packaged.spec.ts` runs, because `dist/win-unpacked` now exists.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json electron-builder.yml tests/e2e/packaged.spec.ts
git commit -m "build: portable Windows .exe with electron-builder, and a packaged-app smoke test"
```

---

### Task 9: End-to-end checks, README and spec notes

**Files:**
- Create: `tests/e2e/polish.spec.ts`
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`: a "Polish (Step 7)" section before "## Error handling summary".

**Interfaces:**
- Consumes the DOM hooks from Tasks 3, 4 and 7, and the menu commands `file.newProject`, `window.preferences` and `view.memoryBrowser`.

- [ ] **Step 1: Write the e2e tests**

Create `tests/e2e/polish.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the e2e tests**

Run: `npm run test:e2e`
Expected: all tests pass: 16 from before, 3 new, and the packaged smoke test when `dist/win-unpacked` exists.

- [ ] **Step 3: Write the README**

Create `README.md`:

````markdown
# DSP LabSim

Practise the TMS320C6748 (LCDK) DSP lab without the board. DSP LabSim looks and behaves like Code Composer Studio 12:

- **Edit and build.** It opens CCS workspaces unchanged. It builds with TI's `cl6x` when CCS is installed, and otherwise with its own C front-end, whose diagnostics follow cl6x 8.3.
- **Debug.** It runs the program in a C6748 simulator:
  - Resume/Suspend/Terminate/Restart;
  - editor breakpoints and Step Into/Over/Return;
  - the Variables, Expressions and Breakpoints views;
  - the CIO console with stdin.
- **Tools > Graph > Single Time.** CCS's properties, refresh on halt and Continuous Refresh.
- **View > Memory Browser.** An address or symbol, in hex, int, float or character formats.
- **File > New > CCS Project.** `main.c`, `C6748.cmd` and `labsim.json`.

## Use it

Download `DSP-LabSim-<version>-portable.exe` and run it. There is nothing to install.

- **Workspace.** It opens `%USERPROFILE%\workspace_v12` if that exists; switch with File > Switch Workspace.
- **Build output.** It goes to `<project>\.labsim\Debug`, so CCS's own `Debug` folder is never touched.
- **Compiler.** It is auto-detected under `C:\ti`. Choose another in Window > Preferences.

### `labsim.json`

A project's `labsim.json` overrides its `.cproject` build options. All fields are optional:

| Field | Example | Meaning |
|---|---|---|
| `heapSize` | `"0x800"` | `--heap_size` |
| `stackSize` | `"0x800"` | `--stack_size` |
| `optLevel` | `"off"`, `"0"`…`"3"` | `-O` level |
| `defines` | `["c6748", "N=64"]` | `--define` symbols |

## Develop

```bash
npm install
npm run dev          # the app with hot reload
npm test             # unit tests (vitest)
npm run test:e2e     # builds, then runs the Playwright tests against Electron
npm run typecheck
npm run labsim -- run path/to/main.c   # headless run of one C file
npm run dist:dir     # unpacked app in dist/win-unpacked (the packaged-app test uses it)
npm run dist         # dist/DSP-LabSim-<version>-portable.exe
```

Environment variables for tests:

| Variable | Effect |
|---|---|
| `LABSIM_WORKSPACE` | Workspace folder |
| `LABSIM_USERDATA` | Settings folder |
| `LABSIM_COMPILER_ROOT` | C6000 CGT folder to use; an empty folder simulates "not installed" |
| `LABSIM_TI_ROOT` | Where to look for CCS's `C6748.cmd`; an empty folder forces the bundled copy |

The design is in `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, and there is one plan per delivery step in `docs/superpowers/plans/`.
````

- [ ] **Step 4: Record the Step 7 notes in the spec**

In `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, insert this section right before `## Error handling summary`:

```markdown
## Polish (Step 7)

**New CCS Project.** File > New > CCS Project asks for:
- the project name;
- under Advanced settings, the heap size, the stack size, the optimization level (off, 0–3) and the predefined symbols (default `c6748`).

It writes three files:
- `main.c`, CCS's "Empty Project (with main.c)" template, with CRLF line ends;
- `C6748.cmd`, copied from the newest `C:\ti\ccs*\ccs\ccs_base\c6000\include`, or from the copy shipped in `resources/`;
- `labsim.json`, the build options.

Names follow CCS rules: they start with a letter or `_`, use letters, digits, `_`, `-` and `.`, and differ from existing folders in more than case.

**labsim.json.** It overrides `.cproject` inside `readBuildConfig`, so the cl6x build, the fallback build, the debugger and the CLI all agree. A bad field is ignored, with a `LabSim: labsim.json: …` line in the Build Console.

**Preferences.** Window > Preferences shows:
- the compiler in use, auto-detected or chosen, with Browse... and Use Auto-detect;
- the workspace, with Switch Workspace....

**Memory Browser.** It is a bottom-panel tab, opened from View > Memory Browser.
- **Address.** Go evaluates the address or expression in the selected frame, with the same rules as a graph's Start Address, and aligns it down to the format's unit.
- **Page.** It shows 32 rows of 16 bytes. Previous Page and Next Page move 512 bytes.
- **Formats.** They use CCS's names: 32-bit hex (TI/C style), signed/unsigned int, float, 16-bit hex/int, 8-bit hex and character.
- **Unreadable memory.** Such rows show `?`.
- **Refresh.** The page refreshes on every halt.
- **Editing.** Memory is read-only in this view; change values in the Expressions view.

**Packaging.** `npm run dist` builds a portable `DSP-LabSim-<version>-portable.exe` with electron-builder, using the local Electron. `npm run dist:dir` builds the unpacked app, which the packaged-app smoke test launches.
```

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npx vitest run && npm run test:e2e`
Expected: typecheck is clean, all unit tests pass, and all e2e tests pass.

Then confirm that nothing was written to the user's workspace:
Run: `ls -d ~/workspace_v12/*/.labsim 2>/dev/null; ls ~/workspace_v12 | head -50`
Expected: the same `.labsim` list as before this step (16pointDIT, FFT, dft_8_m, exp_10, fft_m, highpassiir), and no `lab1`, `packed` or other new project folder.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/polish.spec.ts README.md docs/superpowers/specs/2026-09-23-dsp-labsim-design.md
git commit -m "test(e2e): New Project wizard, Preferences and Memory Browser; README and Step 7 spec notes"
```
