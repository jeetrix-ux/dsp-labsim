# Step 1: App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Electron app that looks like CCS 12. It opens a workspace of CCS projects, shows them in a Project Explorer, edits files in Monaco tabs with save and dirty markers, switches between the CCS Edit and CCS Debug perspectives, and has a Console view.

**Architecture:** electron-vite produces three bundles: main (Node: filesystem, settings, menu, IPC), preload (a `contextBridge` API called `window.labsim`), and renderer (React + zustand store + Monaco). All filesystem access goes through main, which refuses paths outside the workspace. The renderer store takes the API as a parameter, so it is unit-tested in Node with a fake API.

**Tech Stack:** Electron 44, electron-vite 5, Vite 7.3, React 19, TypeScript 5.9, zustand 5, monaco-editor 0.56 + @monaco-editor/react 4.7, vitest 4.1 (unit), @playwright/test 1.63 (Electron e2e).

Spec: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md` (sections "Architecture", "Workspace and projects", "Delivery steps" item 1).

## Global Constraints

- Platform: Windows 11. Paths contain backslashes and may contain spaces (`~/workspace_v12/fir lowpass`).
- Default workspace: `~/workspace_v12` if it exists; env `LABSIM_WORKSPACE` overrides it (for tests); otherwise `~/labsim_workspace`, which is created.
- Env `LABSIM_USERDATA` overrides Electron's userData dir (for tests).
- Projects: subfolders of the workspace that contain `.project` or a `.c`/`.h` file. Skip names starting with `.` and `RemoteSystemsTempFiles`.
- The Project Explorer hides dot-entries (`.project`, `.cproject`, `.settings`, `.launches`, `.labsim`).
- Main must never read or write a path outside the current workspace.
- Line endings are preserved: CCS files are CRLF, and a save must write back what Monaco holds.
- The interpreter directory `src/interp/` is not created in this step, and nothing in `src/main` may be imported by the renderer.
- Build/Debug/Graph controls exist but are disabled in this step.

## File Structure

```
dsp-labsim/
  package.json                     scripts + deps
  electron.vite.config.ts          three bundles, aliases @shared / @renderer
  tsconfig.json                    references node + web configs
  tsconfig.node.json               main, preload, shared, tests, configs
  tsconfig.web.json                renderer, shared
  vitest.config.ts                 unit tests only (tests/unit)
  playwright.config.ts             e2e (tests/e2e)
  src/shared/api.ts                ProjectInfo, FileNode, MenuCommand, LabsimApi, window typing
  src/shared/files.ts              isTextFile, basename, languageFor
  src/main/index.ts                app lifecycle, window, wiring
  src/main/settings.ts             load/save settings, resolveWorkspace
  src/main/workspace.ts            listProjects, readTree, assertInside, read/write text
  src/main/ipc.ts                  ipcMain handlers
  src/main/menu.ts                 application menu → 'menu' IPC events
  src/preload/index.ts             window.labsim bridge
  src/renderer/index.html
  src/renderer/src/main.tsx        React root
  src/renderer/src/monacoSetup.ts  local Monaco (no CDN) + worker
  src/renderer/src/store.ts        createAppStore(api) — all UI state + actions
  src/renderer/src/appStore.ts     singleton store bound to window.labsim, useApp hook
  src/renderer/src/App.tsx         perspectives layout, menu handling, title
  src/renderer/src/styles.css      CCS-like light theme
  src/renderer/src/components/
    icons.tsx                      inline SVG icons
    Splitter.tsx                   draggable two-pane split
    ViewHeader.tsx                 view title bar
    Toolbar.tsx                    main toolbar + perspective switch
    ProjectExplorer.tsx            project/file tree
    EditorArea.tsx                 tabs + Monaco
    BottomPanel.tsx                Console / Problems tabs
    ConsoleView.tsx
    ProblemsView.tsx
    DebugViews.tsx                 Debug view + Variables/Expressions/Breakpoints (empty in step 1)
  tests/unit/workspace.test.ts
  tests/unit/settings.test.ts
  tests/unit/files.test.ts
  tests/unit/store.test.ts
  tests/e2e/shell.spec.ts
```

---

### Task 1: Scaffold that opens a window

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`
- Create: `src/main/index.ts` (minimal version), `src/preload/index.ts` (minimal), `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx` (minimal)
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Produces: `npm run build` → `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`; `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run dev`.

- [ ] **Step 1: Create package.json and install dependencies**

```json
{
  "name": "dsp-labsim",
  "version": "0.1.0",
  "private": true,
  "description": "Practise TMS320C6748 DSP lab code without the board: CCS-style build, debug and graphs.",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:e2e": "electron-vite build && playwright test"
  }
}
```

Run:
```bash
npm install --save-dev electron@44 electron-vite@5 vite@7 @vitejs/plugin-react@5 typescript@5.9 vitest@4.1 @playwright/test@1.63 @types/node@24 @types/react@19 @types/react-dom@19
npm install react@19 react-dom@19 zustand@5 monaco-editor@0.56 @monaco-editor/react@4.7
```
Expected: both installs finish without `ERESOLVE` errors. (If `@monaco-editor/react` complains about its React peer range, re-run the second command with `--legacy-peer-deps` and note it in the commit message.)

- [ ] **Step 2: Config files**

`.gitignore`:
```
node_modules/
out/
dist/
test-results/
playwright-report/
```

`electron.vite.config.ts`:
```ts
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: { resolve: { alias: shared } },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()]
  }
})
```

`tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "tests/**/*", "*.config.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"], "@renderer/*": ["src/renderer/src/*"] }
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:
```ts
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' }
})
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: 'tests/e2e', timeout: 60_000, workers: 1, reporter: 'list' })
```

- [ ] **Step 3: Write the failing e2e test**

`tests/e2e/shell.spec.ts`:
```ts
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
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: FAIL. The build fails because `src/main/index.ts` does not exist.

- [ ] **Step 5: Minimal main, preload and renderer**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

if (process.env.LABSIM_USERDATA) app.setPath('userData', process.env.LABSIM_USERDATA)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'DSP LabSim',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

void app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:
```ts
export {}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>DSP LabSim</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/src/App.tsx`:
```tsx
export function App(): JSX.Element {
  return <div>DSP LabSim</div>
}
```

- [ ] **Step 6: Run the test to make sure it passes**

Run: `npm run test:e2e`
Expected: `1 passed`.
Also run `npm run typecheck`. Expected: no output, exit 0. If React 19 types reject the global `JSX.Element`, use `React.JSX.Element` and `import type React from 'react'` in every component in this plan.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + Vite + React app with e2e harness"
```

---

### Task 2: Workspace and settings services (main process)

**Files:**
- Create: `src/shared/api.ts`, `src/shared/files.ts`, `src/main/workspace.ts`, `src/main/settings.ts`
- Test: `tests/unit/workspace.test.ts`, `tests/unit/settings.test.ts`, `tests/unit/files.test.ts`

**Interfaces:**
- Produces (`src/shared/api.ts`):
  - `interface ProjectInfo { name: string; dir: string; isCcsProject: boolean }`
  - `interface FileNode { name: string; path: string; kind: 'file' | 'dir'; children?: FileNode[] }`
  - `type MenuCommand = 'file.save' | 'file.saveAll' | 'file.refresh' | 'file.switchWorkspace' | 'window.editPerspective' | 'window.debugPerspective'`
  - `interface LabsimApi { getWorkspace(): Promise<string>; switchWorkspace(): Promise<string | null>; listProjects(): Promise<ProjectInfo[]>; readTree(projectDir: string): Promise<FileNode[]>; readFile(path: string): Promise<string>; writeFile(path: string, content: string): Promise<void>; onMenu(cb: (cmd: MenuCommand) => void): () => void }`
- Produces (`src/shared/files.ts`): `isTextFile(path: string): boolean`, `basename(path: string): string`, `languageFor(path: string): 'c' | 'plaintext'`
- Produces (`src/main/workspace.ts`): `listProjects(workspace: string): Promise<ProjectInfo[]>`, `readTree(dir: string): Promise<FileNode[]>`, `assertInside(root: string, p: string): string` (returns the resolved absolute path or throws `Error('Path outside workspace: <p>')`), `readTextFile(workspace: string, p: string): Promise<string>`, `writeTextFile(workspace: string, p: string, content: string): Promise<void>`
- Produces (`src/main/settings.ts`): `interface Settings { workspace?: string }`, `loadSettings(file: string): Promise<Settings>`, `saveSettings(file: string, s: Settings): Promise<void>`, `resolveWorkspace(s: Settings, home: string, override?: string): Promise<string>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/files.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { basename, isTextFile, languageFor } from '@shared/files'

describe('files helpers', () => {
  it('recognises lab source and text files', () => {
    for (const f of ['main.c', 'x.H', 'C6748.cmd', 'a.asm', 'b.gel', 'exp11.map', 'notes.txt', 'data.dat', 'z.csv']) {
      expect(isTextFile(f)).toBe(true)
    }
  })
  it('rejects binaries', () => {
    for (const f of ['exp11.out', 'main.obj', 'libc.a', 'pic.png', 'noext']) expect(isTextFile(f)).toBe(false)
  })
  it('takes the basename of Windows and POSIX paths', () => {
    expect(basename('C:\\ws\\fir lowpass\\main.c')).toBe('main.c')
    expect(basename('/tmp/ws/main.c')).toBe('main.c')
  })
  it('picks the C language for .c and .h', () => {
    expect(languageFor('a\\main.c')).toBe('c')
    expect(languageFor('a\\x.h')).toBe('c')
    expect(languageFor('a\\C6748.cmd')).toBe('plaintext')
  })
})
```

`tests/unit/workspace.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertInside, listProjects, readTextFile, readTree, writeTextFile } from '../../src/main/workspace'

let ws: string
const touch = (p: string, s = ''): void => writeFileSync(join(ws, p), s)

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-unit-'))
  mkdirSync(join(ws, 'exp11'))
  touch('exp11/.project', '<x/>')
  touch('exp11/main.c', 'int main(void){return 0;}')
  mkdirSync(join(ws, 'exp11', 'Debug'))
  touch('exp11/Debug/exp11.map')
  mkdirSync(join(ws, 'exp11', '.settings'))
  mkdirSync(join(ws, 'fir lowpass'))
  touch('fir lowpass/main.c')
  mkdirSync(join(ws, 'Alpha'))
  touch('Alpha/util.h')
  mkdirSync(join(ws, 'docs'))
  touch('docs/readme.txt')
  mkdirSync(join(ws, 'RemoteSystemsTempFiles'))
  touch('RemoteSystemsTempFiles/x.c')
  mkdirSync(join(ws, '.metadata'))
  touch('.metadata/y.c')
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

describe('listProjects', () => {
  it('finds CCS projects and plain C folders, sorted case-insensitively', async () => {
    const ps = await listProjects(ws)
    expect(ps.map((p) => p.name)).toEqual(['Alpha', 'exp11', 'fir lowpass'])
    expect(ps.find((p) => p.name === 'exp11')).toEqual({ name: 'exp11', dir: join(ws, 'exp11'), isCcsProject: true })
    expect(ps.find((p) => p.name === 'Alpha')?.isCcsProject).toBe(false)
  })
})

describe('readTree', () => {
  it('hides dot entries and lists folders before files', async () => {
    const tree = await readTree(join(ws, 'exp11'))
    expect(tree.map((n) => n.name)).toEqual(['Debug', 'main.c'])
    expect(tree[0].kind).toBe('dir')
    expect(tree[0].children?.map((n) => n.name)).toEqual(['exp11.map'])
    expect(tree[1]).toEqual({ name: 'main.c', path: join(ws, 'exp11', 'main.c'), kind: 'file' })
  })
})

describe('assertInside', () => {
  it('accepts paths inside the workspace', () => {
    expect(assertInside(ws, join(ws, 'exp11', 'main.c'))).toBe(join(ws, 'exp11', 'main.c'))
  })
  it('rejects escapes and foreign absolute paths', () => {
    expect(() => assertInside(ws, join(ws, '..', 'evil.c'))).toThrow('Path outside workspace')
    expect(() => assertInside(ws, 'C:\\Windows\\win.ini')).toThrow('Path outside workspace')
    expect(() => assertInside(ws, ws + '-other\\a.c')).toThrow('Path outside workspace')
  })
})

describe('text files', () => {
  it('round-trips content and preserves CRLF', async () => {
    const p = join(ws, 'exp11', 'main.c')
    await writeTextFile(ws, p, 'a\r\nb\r\n')
    expect(readFileSync(p, 'utf8')).toBe('a\r\nb\r\n')
    expect(await readTextFile(ws, p)).toBe('a\r\nb\r\n')
  })
  it('refuses to write outside the workspace', async () => {
    await expect(writeTextFile(ws, join(ws, '..', 'x.c'), 'x')).rejects.toThrow('Path outside workspace')
  })
})
```

`tests/unit/settings.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadSettings, resolveWorkspace, saveSettings } from '../../src/main/settings'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'labsim-home-')) })
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('settings', () => {
  it('returns {} for a missing or corrupt file', async () => {
    expect(await loadSettings(join(home, 'nope.json'))).toEqual({})
  })
  it('round-trips', async () => {
    const f = join(home, 'cfg', 'settings.json')
    await saveSettings(f, { workspace: 'C:\\ws' })
    expect(await loadSettings(f)).toEqual({ workspace: 'C:\\ws' })
  })
})

describe('resolveWorkspace', () => {
  it('prefers the override, then settings, then ~/workspace_v12', async () => {
    const a = join(home, 'a'); const b = join(home, 'b'); const v12 = join(home, 'workspace_v12')
    for (const d of [a, b, v12]) mkdirSync(d)
    expect(await resolveWorkspace({ workspace: b }, home, a)).toBe(a)
    expect(await resolveWorkspace({ workspace: b }, home)).toBe(b)
    expect(await resolveWorkspace({ workspace: join(home, 'missing') }, home)).toBe(v12)
  })
  it('creates ~/labsim_workspace when nothing else exists', async () => {
    const ws = await resolveWorkspace({}, home)
    expect(ws).toBe(join(home, 'labsim_workspace'))
    expect(existsSync(ws)).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm test`
Expected: FAIL. `Failed to resolve import "@shared/files"` and the matching errors for `workspace` and `settings`.

- [ ] **Step 3: Implement**

`src/shared/api.ts`:
```ts
export interface ProjectInfo {
  name: string
  dir: string
  isCcsProject: boolean
}

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: FileNode[]
}

export type MenuCommand =
  | 'file.save'
  | 'file.saveAll'
  | 'file.refresh'
  | 'file.switchWorkspace'
  | 'window.editPerspective'
  | 'window.debugPerspective'

export interface LabsimApi {
  getWorkspace(): Promise<string>
  /** Shows a folder picker; resolves to the new workspace or null if cancelled. */
  switchWorkspace(): Promise<string | null>
  listProjects(): Promise<ProjectInfo[]>
  readTree(projectDir: string): Promise<FileNode[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  /** Subscribes to application-menu commands; returns an unsubscribe function. */
  onMenu(cb: (cmd: MenuCommand) => void): () => void
}

declare global {
  interface Window {
    labsim: LabsimApi
  }
}
```

`src/shared/files.ts`:
```ts
const TEXT_EXTENSIONS = new Set([
  '.c', '.h', '.cmd', '.asm', '.s', '.gel', '.txt', '.md', '.map', '.json', '.dat', '.csv', '.xml', '.ccxml', '.mk', '.opt'
])

export function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i).toLowerCase()
}

export function isTextFile(p: string): boolean {
  return TEXT_EXTENSIONS.has(extname(p))
}

export function languageFor(p: string): 'c' | 'plaintext' {
  const e = extname(p)
  return e === '.c' || e === '.h' ? 'c' : 'plaintext'
}
```

`src/main/workspace.ts`:
```ts
import { promises as fs } from 'fs'
import * as path from 'path'
import type { FileNode, ProjectInfo } from '@shared/api'

const SKIP_DIRS = new Set(['RemoteSystemsTempFiles'])
const MAX_DEPTH = 6

const byKindThenName = (a: FileNode, b: FileNode): number =>
  a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export async function listProjects(workspace: string): Promise<ProjectInfo[]> {
  const entries = await fs.readdir(workspace, { withFileTypes: true })
  const projects: ProjectInfo[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const dir = path.join(workspace, e.name)
    const files = await fs.readdir(dir)
    const isCcsProject = files.includes('.project')
    if (isCcsProject || files.some((f) => /\.(c|h)$/i.test(f))) projects.push({ name: e.name, dir, isCcsProject })
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function readTree(dir: string, depth = 0): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) nodes.push({ name: e.name, path: p, kind: 'dir', children: await readTree(p, depth + 1) })
    else if (e.isFile()) nodes.push({ name: e.name, path: p, kind: 'file' })
  }
  return nodes.sort(byKindThenName)
}

export function assertInside(root: string, p: string): string {
  const abs = path.resolve(root, p)
  const rel = path.relative(path.resolve(root), abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path outside workspace: ${p}`)
  return abs
}

export async function readTextFile(workspace: string, p: string): Promise<string> {
  return fs.readFile(assertInside(workspace, p), 'utf8')
}

export async function writeTextFile(workspace: string, p: string, content: string): Promise<void> {
  await fs.writeFile(assertInside(workspace, p), content, 'utf8')
}
```

`src/main/settings.ts`:
```ts
import { promises as fs } from 'fs'
import * as path from 'path'

export interface Settings {
  workspace?: string
}

export async function loadSettings(file: string): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Settings
  } catch {
    return {}
  }
}

export async function saveSettings(file: string, s: Settings): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(s, null, 2), 'utf8')
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

export async function resolveWorkspace(s: Settings, home: string, override?: string): Promise<string> {
  for (const candidate of [override, s.workspace, path.join(home, 'workspace_v12')]) {
    if (candidate && (await isDir(candidate))) return path.resolve(candidate)
  }
  const fallback = path.join(home, 'labsim_workspace')
  await fs.mkdir(fallback, { recursive: true })
  return fallback
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test`
Expected: all tests in `files`, `workspace` and `settings` pass (14 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): workspace scanning, safe file IO and settings"
```

---

### Task 3: IPC bridge, application menu and main wiring

**Files:**
- Create: `src/main/ipc.ts`, `src/main/menu.ts`
- Modify: `src/main/index.ts` (full replacement), `src/preload/index.ts` (full replacement)
- Test: `tests/e2e/shell.spec.ts` (add a test)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `window.labsim: LabsimApi` in the renderer. IPC channels are `ws:get`, `ws:switch`, `ws:projects`, `ws:tree`, `fs:read`, `fs:write`, and `menu` (main → renderer, payload `MenuCommand`).

- [ ] **Step 1: Write the failing e2e test** (append to `tests/e2e/shell.spec.ts`)

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: the new test FAILS with `Cannot read properties of undefined (reading 'listProjects')`.

- [ ] **Step 3: Implement**

`src/main/ipc.ts`:
```ts
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { assertInside, listProjects, readTextFile, readTree, writeTextFile } from './workspace'

export interface IpcContext {
  getWorkspace(): string
  setWorkspace(dir: string): Promise<void>
  getWindow(): BrowserWindow | null
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('ws:get', () => ctx.getWorkspace())
  ipcMain.handle('ws:switch', async () => {
    const win = ctx.getWindow()
    const options = { title: 'Select Workspace', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || r.filePaths.length === 0) return null
    await ctx.setWorkspace(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('ws:projects', () => listProjects(ctx.getWorkspace()))
  ipcMain.handle('ws:tree', (_e, dir: string) => readTree(assertInside(ctx.getWorkspace(), dir)))
  ipcMain.handle('fs:read', (_e, p: string) => readTextFile(ctx.getWorkspace(), p))
  ipcMain.handle('fs:write', (_e, p: string, content: string) => writeTextFile(ctx.getWorkspace(), p, content))
}
```

`src/main/menu.ts`:
```ts
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/api'

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (cmd: MenuCommand) => (): void => getWindow()?.webContents.send('menu', cmd)
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('file.save') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: send('file.saveAll') },
        { type: 'separator' },
        { label: 'Refresh', click: send('file.refresh') },
        { label: 'Switch Workspace...', click: send('file.switchWorkspace') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    {
      label: 'Project',
      submenu: [
        { label: 'Build Project', accelerator: 'CmdOrCtrl+B', enabled: false },
        { label: 'Rebuild Project', enabled: false },
        { label: 'Clean...', enabled: false }
      ]
    },
    { label: 'Run', submenu: [{ label: 'Debug', accelerator: 'F11', enabled: false }] },
    { label: 'Tools', submenu: [{ label: 'Graph', submenu: [{ label: 'Single Time', enabled: false }] }] },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Open Perspective',
          submenu: [
            { label: 'CCS Edit', click: send('window.editPerspective') },
            { label: 'CCS Debug', click: send('window.debugPerspective') }
          ]
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

`src/main/index.ts` (full replacement):
```ts
import { app, BrowserWindow, dialog } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { loadSettings, resolveWorkspace, saveSettings } from './settings'

if (process.env.LABSIM_USERDATA) app.setPath('userData', process.env.LABSIM_USERDATA)

let mainWindow: BrowserWindow | null = null
let workspace = ''
const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'DSP LabSim',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => win.show())
  // The renderer blocks unload while files are modified; ask before discarding them.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Discard changes and exit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Some files have unsaved changes.'
    })
    if (choice === 0) event.preventDefault()
  })
  win.on('closed', () => {
    mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

void app.whenReady().then(async () => {
  workspace = await resolveWorkspace(await loadSettings(settingsFile()), homedir(), process.env.LABSIM_WORKSPACE)
  registerIpc({
    getWorkspace: () => workspace,
    setWorkspace: async (dir) => {
      workspace = dir
      await saveSettings(settingsFile(), { ...(await loadSettings(settingsFile())), workspace: dir })
    },
    getWindow: () => mainWindow
  })
  buildMenu(() => mainWindow)
  mainWindow = createWindow()
})

app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts` (full replacement):
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LabsimApi, MenuCommand } from '@shared/api'

const api: LabsimApi = {
  getWorkspace: () => ipcRenderer.invoke('ws:get'),
  switchWorkspace: () => ipcRenderer.invoke('ws:switch'),
  listProjects: () => ipcRenderer.invoke('ws:projects'),
  readTree: (projectDir) => ipcRenderer.invoke('ws:tree', projectDir),
  readFile: (path) => ipcRenderer.invoke('fs:read', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:write', path, content),
  onMenu(cb) {
    const handler = (_e: IpcRendererEvent, cmd: MenuCommand): void => cb(cmd)
    ipcRenderer.on('menu', handler)
    return () => ipcRenderer.removeListener('menu', handler)
  }
}

contextBridge.exposeInMainWorld('labsim', api)
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm run test:e2e`
Expected: `2 passed`. Then run `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: IPC bridge, application menu and workspace wiring"
```

---

### Task 4: Renderer state store

**Files:**
- Create: `src/renderer/src/store.ts`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: `LabsimApi`, `ProjectInfo`, `FileNode` (Task 2); `basename`, `isTextFile` (Task 2).
- Produces:
  - `type Perspective = 'edit' | 'debug'`, `type BottomTab = 'console' | 'problems'`, `type ConsoleKind = 'out' | 'info' | 'error'`
  - `interface ConsoleLine { text: string; kind: ConsoleKind }`
  - `interface EditorTab { path: string; title: string; content: string; savedContent: string }`
  - `const MAIN_CONSOLE = 'DSP LabSim'`
  - `isDirty(t: EditorTab): boolean`
  - `interface AppState` with the fields and actions below
  - `createAppStore(api: LabsimApi): StoreApi<AppState>`, `type AppStore = ReturnType<typeof createAppStore>`

- [ ] **Step 1: Write the failing test**

`tests/unit/store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { FileNode, LabsimApi, MenuCommand, ProjectInfo } from '@shared/api'
import { createAppStore, isDirty, MAIN_CONSOLE, type AppStore } from '../../src/renderer/src/store'

const WS = 'C:\\ws'
const P = `${WS}\\exp11`
const MAIN = `${P}\\main.c`
const CMD = `${P}\\C6748.cmd`
const OUT = `${P}\\Debug\\exp11.out`

function fakeApi(): LabsimApi & { files: Record<string, string>; treeCalls: number; nextWorkspace: string | null } {
  const projects: ProjectInfo[] = [{ name: 'exp11', dir: P, isCcsProject: true }]
  const tree: FileNode[] = [
    { name: 'Debug', path: `${P}\\Debug`, kind: 'dir', children: [{ name: 'exp11.out', path: OUT, kind: 'file' }] },
    { name: 'C6748.cmd', path: CMD, kind: 'file' },
    { name: 'main.c', path: MAIN, kind: 'file' }
  ]
  const api = {
    files: { [MAIN]: 'int main(void)\r\n{\r\n}\r\n', [CMD]: 'MEMORY {}' } as Record<string, string>,
    treeCalls: 0,
    nextWorkspace: null as string | null,
    getWorkspace: async () => WS,
    switchWorkspace: async () => api.nextWorkspace,
    listProjects: async () => projects,
    readTree: async () => {
      api.treeCalls++
      return tree
    },
    readFile: async (p: string) => {
      if (!(p in api.files)) throw new Error(`ENOENT ${p}`)
      return api.files[p]
    },
    writeFile: async (p: string, c: string) => {
      api.files[p] = c
    },
    onMenu: (_cb: (c: MenuCommand) => void) => () => {}
  }
  return api
}

let api: ReturnType<typeof fakeApi>
let store: AppStore
beforeEach(async () => {
  api = fakeApi()
  store = createAppStore(api)
  await store.getState().init()
})

describe('init', () => {
  it('loads workspace and projects, selects the first project, prints a banner', () => {
    const s = store.getState()
    expect(s.workspace).toBe(WS)
    expect(s.projects.map((p) => p.name)).toEqual(['exp11'])
    expect(s.selectedProject).toBe(P)
    expect(s.consoles[MAIN_CONSOLE].at(-1)).toEqual({ text: `Workspace: ${WS} (1 project)`, kind: 'info' })
  })
})

describe('project tree', () => {
  it('loads a project tree once, on first expand', async () => {
    await store.getState().toggleExpand(P)
    expect(store.getState().expanded[P]).toBe(true)
    expect(store.getState().trees[P]).toHaveLength(3)
    await store.getState().toggleExpand(P)
    await store.getState().toggleExpand(P)
    expect(api.treeCalls).toBe(1)
  })
})

describe('editor tabs', () => {
  it('opens a file once and activates it', async () => {
    await store.getState().openFile(MAIN)
    await store.getState().openFile(CMD)
    await store.getState().openFile(MAIN)
    const s = store.getState()
    expect(s.tabs.map((t) => t.title)).toEqual(['main.c', 'C6748.cmd'])
    expect(s.activeTab).toBe(MAIN)
  })
  it('does not open binary files and says why', async () => {
    await store.getState().openFile(OUT)
    expect(store.getState().tabs).toHaveLength(0)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toContain('exp11.out')
  })
  it('reports read errors in the console', async () => {
    await store.getState().openFile(`${P}\\gone.c`)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)).toMatchObject({ kind: 'error' })
  })
  it('tracks dirty state and saves exactly what the editor holds', async () => {
    await store.getState().openFile(MAIN)
    store.getState().editTab(MAIN, 'int main(void)\r\n{\r\n  return 1;\r\n}\r\n')
    expect(isDirty(store.getState().tabs[0])).toBe(true)
    await store.getState().saveTab()
    expect(api.files[MAIN]).toBe('int main(void)\r\n{\r\n  return 1;\r\n}\r\n')
    expect(isDirty(store.getState().tabs[0])).toBe(false)
  })
  it('saveAll writes every dirty tab', async () => {
    await store.getState().openFile(MAIN)
    await store.getState().openFile(CMD)
    store.getState().editTab(MAIN, 'a')
    store.getState().editTab(CMD, 'b')
    await store.getState().saveAll()
    expect([api.files[MAIN], api.files[CMD]]).toEqual(['a', 'b'])
  })
  it('closing the active tab activates its right neighbour, else the left', async () => {
    await store.getState().openFile(MAIN)
    await store.getState().openFile(CMD)
    store.getState().setActiveTab(MAIN)
    store.getState().closeTab(MAIN)
    expect(store.getState().activeTab).toBe(CMD)
    store.getState().closeTab(CMD)
    expect(store.getState().activeTab).toBeNull()
  })
})

describe('workspace switching', () => {
  it('refuses while files are modified', async () => {
    await store.getState().openFile(MAIN)
    store.getState().editTab(MAIN, 'x')
    api.nextWorkspace = 'C:\\other'
    await store.getState().switchWorkspace()
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.kind).toBe('error')
  })
  it('closes tabs and reloads when a folder is picked', async () => {
    await store.getState().openFile(MAIN)
    api.nextWorkspace = 'C:\\other'
    await store.getState().switchWorkspace()
    expect(store.getState().tabs).toHaveLength(0)
  })
})

describe('console', () => {
  it('splits multi-line text into lines and clears', () => {
    store.getState().print('Build', 'a\r\nb', 'out')
    expect(store.getState().consoles.Build).toEqual([{ text: 'a', kind: 'out' }, { text: 'b', kind: 'out' }])
    store.getState().clearConsole('Build')
    expect(store.getState().consoles.Build).toEqual([])
  })
})

describe('perspective', () => {
  it('switches', () => {
    store.getState().setPerspective('debug')
    expect(store.getState().perspective).toBe('debug')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- store`
Expected: FAIL with `Failed to resolve import "../../src/renderer/src/store"`.

- [ ] **Step 3: Implement**

`src/renderer/src/store.ts`:
```ts
import { createStore } from 'zustand/vanilla'
import type { FileNode, LabsimApi, ProjectInfo } from '@shared/api'
import { basename, isTextFile } from '@shared/files'

export type Perspective = 'edit' | 'debug'
export type BottomTab = 'console' | 'problems'
export type ConsoleKind = 'out' | 'info' | 'error'

export interface ConsoleLine {
  text: string
  kind: ConsoleKind
}

export interface EditorTab {
  path: string
  title: string
  content: string
  savedContent: string
}

export const MAIN_CONSOLE = 'DSP LabSim'

export const isDirty = (t: EditorTab): boolean => t.content !== t.savedContent

export interface AppState {
  workspace: string
  projects: ProjectInfo[]
  /** Project dir → its file tree, loaded on first expand. */
  trees: Record<string, FileNode[]>
  /** Project or folder path → expanded in the explorer. */
  expanded: Record<string, boolean>
  selectedProject: string | null
  tabs: EditorTab[]
  activeTab: string | null
  perspective: Perspective
  consoles: Record<string, ConsoleLine[]>
  activeConsole: string
  bottomTab: BottomTab

  init(): Promise<void>
  refresh(): Promise<void>
  switchWorkspace(): Promise<void>
  toggleExpand(path: string): Promise<void>
  selectProject(dir: string): void
  openFile(path: string): Promise<void>
  closeTab(path: string): void
  setActiveTab(path: string): void
  editTab(path: string, content: string): void
  /** Saves the given tab, or the active one; a no-op when it is not dirty. */
  saveTab(path?: string): Promise<void>
  saveAll(): Promise<void>
  setPerspective(p: Perspective): void
  print(consoleName: string, text: string, kind?: ConsoleKind): void
  clearConsole(consoleName: string): void
  setActiveConsole(consoleName: string): void
  setBottomTab(tab: BottomTab): void
}

export function createAppStore(api: LabsimApi) {
  return createStore<AppState>()((set, get) => ({
    workspace: '',
    projects: [],
    trees: {},
    expanded: {},
    selectedProject: null,
    tabs: [],
    activeTab: null,
    perspective: 'edit',
    consoles: { [MAIN_CONSOLE]: [] },
    activeConsole: MAIN_CONSOLE,
    bottomTab: 'console',

    async init() {
      const workspace = await api.getWorkspace()
      const projects = await api.listProjects()
      set({ workspace, projects, trees: {}, expanded: {}, selectedProject: projects[0]?.dir ?? null })
      const n = projects.length
      get().print(MAIN_CONSOLE, `Workspace: ${workspace} (${n} project${n === 1 ? '' : 's'})`, 'info')
    },

    async refresh() {
      const projects = await api.listProjects()
      const trees: Record<string, FileNode[]> = {}
      for (const dir of Object.keys(get().trees)) {
        if (projects.some((p) => p.dir === dir)) trees[dir] = await api.readTree(dir)
      }
      set({ projects, trees })
    },

    async switchWorkspace() {
      if (get().tabs.some(isDirty)) {
        get().print(MAIN_CONSOLE, 'Save or close modified files before switching workspace.', 'error')
        return
      }
      const picked = await api.switchWorkspace()
      if (!picked) return
      set({ tabs: [], activeTab: null })
      await get().init()
    },

    async toggleExpand(path) {
      const open = !get().expanded[path]
      const isProject = get().projects.some((p) => p.dir === path)
      if (open && isProject && !get().trees[path]) {
        const tree = await api.readTree(path)
        set((s) => ({ trees: { ...s.trees, [path]: tree } }))
      }
      set((s) => ({ expanded: { ...s.expanded, [path]: open } }))
    },

    selectProject(dir) {
      set({ selectedProject: dir })
    },

    async openFile(path) {
      if (get().tabs.some((t) => t.path === path)) {
        set({ activeTab: path })
        return
      }
      if (!isTextFile(path)) {
        get().print(MAIN_CONSOLE, `${basename(path)} is not a text file and cannot be opened in the editor.`, 'info')
        return
      }
      let content: string
      try {
        content = await api.readFile(path)
      } catch (e) {
        get().print(MAIN_CONSOLE, `Could not open ${path}: ${String(e)}`, 'error')
        return
      }
      set((s) => ({
        tabs: [...s.tabs, { path, title: basename(path), content, savedContent: content }],
        activeTab: path
      }))
    },

    closeTab(path) {
      set((s) => {
        const i = s.tabs.findIndex((t) => t.path === path)
        if (i < 0) return {}
        const tabs = s.tabs.filter((t) => t.path !== path)
        const activeTab = s.activeTab !== path ? s.activeTab : ((tabs[i] ?? tabs[i - 1])?.path ?? null)
        return { tabs, activeTab }
      })
    },

    setActiveTab(path) {
      set({ activeTab: path })
    },

    editTab(path, content) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content } : t)) }))
    },

    async saveTab(path) {
      const target = path ?? get().activeTab
      const tab = get().tabs.find((t) => t.path === target)
      if (!tab || !isDirty(tab)) return
      const content = tab.content
      try {
        await api.writeFile(tab.path, content)
      } catch (e) {
        get().print(MAIN_CONSOLE, `Could not save ${tab.path}: ${String(e)}`, 'error')
        return
      }
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === tab.path ? { ...t, savedContent: content } : t)) }))
    },

    async saveAll() {
      for (const t of get().tabs.filter(isDirty)) await get().saveTab(t.path)
    },

    setPerspective(perspective) {
      set({ perspective })
    },

    print(consoleName, text, kind = 'out') {
      const lines = text.split(/\r?\n/).map((t) => ({ text: t, kind }))
      set((s) => ({ consoles: { ...s.consoles, [consoleName]: [...(s.consoles[consoleName] ?? []), ...lines] } }))
    },

    clearConsole(consoleName) {
      set((s) => ({ consoles: { ...s.consoles, [consoleName]: [] } }))
    },

    setActiveConsole(consoleName) {
      set({ activeConsole: consoleName })
    },

    setBottomTab(bottomTab) {
      set({ bottomTab })
    }
  }))
}

export type AppStore = ReturnType<typeof createAppStore>
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npm test`
Expected: all unit tests pass (14 from Task 2 + 12 store tests = 26).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(renderer): app state store with tabs, tree, console, perspectives"
```

---

### Task 5: Workbench UI (layout, toolbar, explorer, console, debug perspective)

**Files:**
- Create: `src/renderer/src/appStore.ts`, `src/renderer/src/styles.css`, `src/renderer/src/components/icons.tsx`, `Splitter.tsx`, `ViewHeader.tsx`, `Toolbar.tsx`, `ProjectExplorer.tsx`, `BottomPanel.tsx`, `ConsoleView.tsx`, `ProblemsView.tsx`, `DebugViews.tsx`, and a temporary `EditorArea.tsx` (replaced in Task 6)
- Modify: `src/renderer/src/App.tsx` (full replacement), `src/renderer/src/main.tsx` (full replacement)
- Test: `tests/e2e/shell.spec.ts` (add tests)

**Interfaces:**
- Consumes: `createAppStore`, `AppState`, `isDirty`, `MAIN_CONSOLE` (Task 4); `MenuCommand` (Task 2); `window.labsim` (Task 3).
- Produces: `appStore` singleton and `useApp(selector)` hook (`src/renderer/src/appStore.ts`). DOM hooks used by tests and later steps: `.tree-row`, `.console`, `.tab`, `.tab.active`, `.view-title`, `.persp` buttons named `CCS Edit` / `CCS Debug`, toolbar buttons whose `title` is `Save (Ctrl+S)`, `Build Project (Ctrl+B)`, `Debug (F11)`.

- [ ] **Step 1: Write the failing e2e tests** (append to `tests/e2e/shell.spec.ts`)

```ts
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:e2e`
Expected: the 4 new tests FAIL (for example `locator('.tree-row')` resolves to 0 elements); the 2 earlier tests still pass.

- [ ] **Step 3: Implement the store binding and main entry**

`src/renderer/src/appStore.ts`:
```ts
import { useStore } from 'zustand'
import { createAppStore, type AppState } from './store'

export const appStore = createAppStore(window.labsim)

/** Select a slice of app state. Return primitives or existing references only (zustand 5 re-renders on new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector)
}
```

`src/renderer/src/main.tsx` (full replacement):
```tsx
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: Implement the shared components**

`src/renderer/src/components/icons.tsx`:
```tsx
const box = { width: 16, height: 16, viewBox: '0 0 16 16' }

export const SaveIcon = (): JSX.Element => (
  <svg {...box}><rect x="2" y="2" width="12" height="12" rx="1" fill="#3a6ea5" /><rect x="4" y="2" width="8" height="4" fill="#dfe8f2" /><rect x="4" y="9" width="8" height="5" fill="#fff" /></svg>
)
export const HammerIcon = (): JSX.Element => (
  <svg {...box}><rect x="2" y="2" width="8" height="4" rx="1" fill="#7a5230" transform="rotate(-35 6 4)" /><rect x="7" y="5" width="2.2" height="10" rx="1" fill="#b08040" transform="rotate(-35 8 10)" /></svg>
)
export const BugIcon = (): JSX.Element => (
  <svg {...box}><ellipse cx="8" cy="9.5" rx="4" ry="5" fill="#4d8f2f" /><circle cx="8" cy="4" r="2.3" fill="#2f5f1a" /><path d="M1 7h3M12 7h3M1 11h3M12 11h3M8 5v9" stroke="#1e3d10" strokeWidth="1" /></svg>
)
export const ResumeIcon = (): JSX.Element => (
  <svg {...box}><rect x="2" y="3" width="2" height="10" fill="#2e8b3a" /><path d="M6 3l8 5-8 5z" fill="#2e8b3a" /></svg>
)
export const SuspendIcon = (): JSX.Element => (
  <svg {...box}><rect x="3" y="3" width="3.5" height="10" fill="#d9a400" /><rect x="9.5" y="3" width="3.5" height="10" fill="#d9a400" /></svg>
)
export const TerminateIcon = (): JSX.Element => (
  <svg {...box}><rect x="3" y="3" width="10" height="10" rx="1" fill="#c9302c" /></svg>
)
export const StepIntoIcon = (): JSX.Element => (
  <svg {...box}><path d="M8 1v9M4.5 6.5L8 10l3.5-3.5" stroke="#d9a400" strokeWidth="2" fill="none" /><circle cx="8" cy="13.5" r="1.8" fill="#3a6ea5" /></svg>
)
export const StepOverIcon = (): JSX.Element => (
  <svg {...box}><path d="M2 9a6 6 0 0 1 11-3" stroke="#d9a400" strokeWidth="2" fill="none" /><path d="M14 2v5h-5z" fill="#d9a400" /><circle cx="8" cy="13.5" r="1.8" fill="#3a6ea5" /></svg>
)
export const StepReturnIcon = (): JSX.Element => (
  <svg {...box}><path d="M8 13V4M4.5 7.5L8 4l3.5 3.5" stroke="#d9a400" strokeWidth="2" fill="none" /><rect x="3" y="1" width="10" height="1.8" fill="#3a6ea5" /></svg>
)
export const RefreshIcon = (): JSX.Element => (
  <svg {...box}><path d="M13 8a5 5 0 1 1-1.5-3.5" stroke="#3a6ea5" strokeWidth="1.8" fill="none" /><path d="M14 1.5v4.5H9.5z" fill="#3a6ea5" /></svg>
)
export const ProjectIcon = (): JSX.Element => (
  <svg {...box}><path d="M1 4h5l1.5 1.5H15V14H1z" fill="#e8c16a" /><rect x="9" y="8" width="5" height="5" fill="#c9302c" /></svg>
)
export const FolderIcon = (): JSX.Element => (
  <svg {...box}><path d="M1 4h5l1.5 1.5H15V14H1z" fill="#e8c16a" /></svg>
)
export const FileIcon = ({ name }: { name: string }): JSX.Element => {
  const isC = /\.[ch]$/i.test(name)
  return (
    <svg {...box}>
      <path d="M3 1h7l3 3v11H3z" fill="#fff" stroke="#8a8a8a" />
      {isC && <text x="8" y="12" fontSize="7" textAnchor="middle" fill="#3a6ea5" fontWeight="bold">{/\.h$/i.test(name) ? 'h' : 'c'}</text>}
    </svg>
  )
}
```

`src/renderer/src/components/Splitter.tsx`:
```tsx
import { useRef, useState, type ReactNode } from 'react'

interface Props {
  direction: 'row' | 'column'
  /** Initial size in px of the fixed pane. */
  size: number
  /** Which pane keeps `size`; the other one takes the remaining space. */
  fixed: 'first' | 'second'
  min?: number
  children: [ReactNode, ReactNode]
}

export function Splitter({ direction, size: initial, fixed, min = 80, children }: Props): JSX.Element {
  const [size, setSize] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)

  const onPointerDown = (): void => {
    const move = (ev: PointerEvent): void => {
      const box = ref.current?.getBoundingClientRect()
      if (!box) return
      const total = direction === 'row' ? box.width : box.height
      const pos = direction === 'row' ? ev.clientX - box.left : ev.clientY - box.top
      const wanted = fixed === 'first' ? pos : total - pos
      setSize(Math.max(min, Math.min(total - min, wanted)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.classList.add('resizing')
  }

  const fixedStyle = { flex: `0 0 ${size}px` }
  return (
    <div ref={ref} className={`split split-${direction}`}>
      <div className="split-pane" style={fixed === 'first' ? fixedStyle : undefined}>{children[0]}</div>
      <div className="split-handle" onPointerDown={onPointerDown} />
      <div className="split-pane" style={fixed === 'second' ? fixedStyle : undefined}>{children[1]}</div>
    </div>
  )
}
```

`src/renderer/src/components/ViewHeader.tsx`:
```tsx
import type { ReactNode } from 'react'

export function ViewHeader({ title, actions }: { title: string; actions?: ReactNode }): JSX.Element {
  return (
    <div className="view-header">
      <span className="view-title">{title}</span>
      <span className="view-actions">{actions}</span>
    </div>
  )
}
```

`src/renderer/src/components/Toolbar.tsx`:
```tsx
import type { ReactNode } from 'react'
import { appStore, useApp } from '../appStore'
import { isDirty } from '../store'
import {
  BugIcon, HammerIcon, ResumeIcon, SaveIcon, StepIntoIcon, StepOverIcon, StepReturnIcon, SuspendIcon, TerminateIcon
} from './icons'

function TbButton(props: { title: string; disabled?: boolean; onClick?: () => void; children: ReactNode }): JSX.Element {
  return (
    <button className="tb-btn" title={props.title} aria-label={props.title} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

const Sep = (): JSX.Element => <span className="tb-sep" />

export function Toolbar(): JSX.Element {
  const perspective = useApp((s) => s.perspective)
  const canSave = useApp((s) => {
    const t = s.tabs.find((x) => x.path === s.activeTab)
    return !!t && isDirty(t)
  })
  const st = appStore.getState()
  return (
    <div className="toolbar">
      <TbButton title="Save (Ctrl+S)" disabled={!canSave} onClick={() => void st.saveTab()}><SaveIcon /></TbButton>
      <Sep />
      <TbButton title="Build Project (Ctrl+B)" disabled><HammerIcon /></TbButton>
      <TbButton title="Debug (F11)" disabled><BugIcon /></TbButton>
      {perspective === 'debug' && (
        <>
          <Sep />
          <TbButton title="Resume (F8)" disabled><ResumeIcon /></TbButton>
          <TbButton title="Suspend (Alt+F8)" disabled><SuspendIcon /></TbButton>
          <TbButton title="Terminate (Ctrl+F2)" disabled><TerminateIcon /></TbButton>
          <Sep />
          <TbButton title="Step Into (F5)" disabled><StepIntoIcon /></TbButton>
          <TbButton title="Step Over (F6)" disabled><StepOverIcon /></TbButton>
          <TbButton title="Step Return (F7)" disabled><StepReturnIcon /></TbButton>
        </>
      )}
      <span className="tb-spacer" />
      <div className="perspectives">
        <button className={perspective === 'edit' ? 'persp active' : 'persp'} onClick={() => st.setPerspective('edit')}>CCS Edit</button>
        <button className={perspective === 'debug' ? 'persp active' : 'persp'} onClick={() => st.setPerspective('debug')}>CCS Debug</button>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/ProjectExplorer.tsx`:
```tsx
import type { ReactNode } from 'react'
import type { FileNode } from '@shared/api'
import { appStore, useApp } from '../appStore'
import { FileIcon, FolderIcon, ProjectIcon, RefreshIcon } from './icons'
import { ViewHeader } from './ViewHeader'

interface RowProps {
  depth: number
  label: string
  icon: ReactNode
  suffix?: string
  expandable?: boolean
  expanded?: boolean
  selected?: boolean
  onClick?: () => void
  onToggle?: () => void
  onDoubleClick?: () => void
}

function TreeRow(p: RowProps): JSX.Element {
  return (
    <div
      className={p.selected ? 'tree-row selected' : 'tree-row'}
      style={{ paddingLeft: 4 + p.depth * 16 }}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      title={p.label}
    >
      <span
        className="twisty"
        onClick={(e) => {
          e.stopPropagation()
          p.onToggle?.()
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {p.expandable ? (p.expanded ? '▾' : '▸') : ''}
      </span>
      {p.icon}
      <span className="tree-label">{p.label}</span>
      {p.suffix && <span className="tree-suffix">{p.suffix}</span>}
    </div>
  )
}

function Nodes({ nodes, depth }: { nodes: FileNode[]; depth: number }): JSX.Element {
  const expanded = useApp((s) => s.expanded)
  const st = appStore.getState()
  return (
    <>
      {nodes.map((n) =>
        n.kind === 'dir' ? (
          <div key={n.path}>
            <TreeRow
              depth={depth}
              label={n.name}
              icon={<FolderIcon />}
              expandable
              expanded={!!expanded[n.path]}
              onToggle={() => void st.toggleExpand(n.path)}
              onDoubleClick={() => void st.toggleExpand(n.path)}
            />
            {expanded[n.path] && n.children && <Nodes nodes={n.children} depth={depth + 1} />}
          </div>
        ) : (
          <TreeRow key={n.path} depth={depth} label={n.name} icon={<FileIcon name={n.name} />} onDoubleClick={() => void st.openFile(n.path)} />
        )
      )}
    </>
  )
}

export function ProjectExplorer(): JSX.Element {
  const projects = useApp((s) => s.projects)
  const trees = useApp((s) => s.trees)
  const expanded = useApp((s) => s.expanded)
  const selected = useApp((s) => s.selectedProject)
  const st = appStore.getState()
  return (
    <div className="view">
      <ViewHeader
        title="Project Explorer"
        actions={<button className="icon-btn" title="Refresh" onClick={() => void st.refresh()}><RefreshIcon /></button>}
      />
      <div className="view-body tree">
        {projects.length === 0 && <div className="empty">No projects in this workspace.</div>}
        {projects.map((p) => (
          <div key={p.dir}>
            <TreeRow
              depth={0}
              label={p.name}
              suffix={p.dir === selected ? '  [Active - Debug]' : undefined}
              icon={<ProjectIcon />}
              expandable
              expanded={!!expanded[p.dir]}
              selected={p.dir === selected}
              onClick={() => st.selectProject(p.dir)}
              onToggle={() => void st.toggleExpand(p.dir)}
              onDoubleClick={() => void st.toggleExpand(p.dir)}
            />
            {expanded[p.dir] && trees[p.dir] && <Nodes nodes={trees[p.dir]} depth={1} />}
          </div>
        ))}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/ConsoleView.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { appStore, useApp } from '../appStore'

export function ConsoleView(): JSX.Element {
  const consoles = useApp((s) => s.consoles)
  const active = useApp((s) => s.activeConsole)
  const lines = consoles[active] ?? []
  const bodyRef = useRef<HTMLPreElement>(null)
  const st = appStore.getState()

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="console-wrap">
      <div className="console-bar">
        <select value={active} onChange={(e) => st.setActiveConsole(e.target.value)} aria-label="Console">
          {Object.keys(consoles).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button className="link-btn" onClick={() => st.clearConsole(active)}>Clear</button>
      </div>
      <pre ref={bodyRef} className="console">
        {lines.map((l, i) => (
          <div key={i} className={`cl-${l.kind}`}>{l.text || '\u00a0'}</div>
        ))}
      </pre>
    </div>
  )
}
```

`src/renderer/src/components/ProblemsView.tsx`:
```tsx
export function ProblemsView(): JSX.Element {
  return (
    <div className="table-wrap">
      <div className="table-caption">0 items</div>
      <table className="grid">
        <thead>
          <tr><th>Description</th><th>Resource</th><th>Path</th><th>Location</th><th>Type</th></tr>
        </thead>
        <tbody />
      </table>
    </div>
  )
}
```

`src/renderer/src/components/BottomPanel.tsx`:
```tsx
import { appStore, useApp } from '../appStore'
import { ConsoleView } from './ConsoleView'
import { ProblemsView } from './ProblemsView'

export function BottomPanel(): JSX.Element {
  const tab = useApp((s) => s.bottomTab)
  const st = appStore.getState()
  return (
    <div className="view">
      <div className="view-tabs">
        <button className={tab === 'console' ? 'vtab active' : 'vtab'} onClick={() => st.setBottomTab('console')}>Console</button>
        <button className={tab === 'problems' ? 'vtab active' : 'vtab'} onClick={() => st.setBottomTab('problems')}>Problems</button>
      </div>
      <div className="view-body">{tab === 'console' ? <ConsoleView /> : <ProblemsView />}</div>
    </div>
  )
}
```

`src/renderer/src/components/DebugViews.tsx`:
```tsx
import { useState } from 'react'
import { ViewHeader } from './ViewHeader'

export function DebugView(): JSX.Element {
  return (
    <div className="view">
      <ViewHeader title="Debug" />
      <div className="view-body"><div className="empty">No debug session is running.</div></div>
    </div>
  )
}

type VarTab = 'Variables' | 'Expressions' | 'Breakpoints'

export function VariablesPanel(): JSX.Element {
  const [tab, setTab] = useState<VarTab>('Variables')
  return (
    <div className="view">
      <div className="view-tabs">
        {(['Variables', 'Expressions', 'Breakpoints'] as const).map((t) => (
          <button key={t} className={tab === t ? 'vtab active' : 'vtab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="view-body">
        {tab === 'Breakpoints' ? (
          <div className="empty">No breakpoints.</div>
        ) : (
          <table className="grid">
            <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Location</th></tr></thead>
            <tbody />
          </table>
        )}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/EditorArea.tsx` (temporary, replaced in Task 6):
```tsx
export function EditorArea(): JSX.Element {
  return <div className="editor-area"><div className="empty">Double-click a file in the Project Explorer to open it.</div></div>
}
```

- [ ] **Step 5: Implement App and styles**

`src/renderer/src/App.tsx` (full replacement):
```tsx
import { useEffect } from 'react'
import type { MenuCommand } from '@shared/api'
import { basename } from '@shared/files'
import { appStore, useApp } from './appStore'
import { isDirty } from './store'
import { BottomPanel } from './components/BottomPanel'
import { DebugView, VariablesPanel } from './components/DebugViews'
import { EditorArea } from './components/EditorArea'
import { ProjectExplorer } from './components/ProjectExplorer'
import { Splitter } from './components/Splitter'
import { Toolbar } from './components/Toolbar'

function handleMenu(cmd: MenuCommand): void {
  const s = appStore.getState()
  switch (cmd) {
    case 'file.save': void s.saveTab(); break
    case 'file.saveAll': void s.saveAll(); break
    case 'file.refresh': void s.refresh(); break
    case 'file.switchWorkspace': void s.switchWorkspace(); break
    case 'window.editPerspective': s.setPerspective('edit'); break
    case 'window.debugPerspective': s.setPerspective('debug'); break
  }
}

function relativeTo(root: string, p: string): string {
  return p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, '/') : p
}

export function App(): JSX.Element {
  const perspective = useApp((s) => s.perspective)
  const workspace = useApp((s) => s.workspace)
  const active = useApp((s) => s.activeTab)
  const dirtyCount = useApp((s) => s.tabs.filter(isDirty).length)

  useEffect(() => {
    void appStore.getState().init()
    return window.labsim.onMenu(handleMenu)
  }, [])

  useEffect(() => {
    document.title = [workspace && basename(workspace), active && relativeTo(workspace, active), 'DSP LabSim']
      .filter(Boolean)
      .join(' - ')
  }, [workspace, active])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (dirtyCount > 0) {
        e.preventDefault()
        e.returnValue = false
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  const editorAndConsole = (
    <Splitter direction="column" size={220} fixed="second">
      {[<EditorArea key="editor" />, <BottomPanel key="bottom" />]}
    </Splitter>
  )

  return (
    <div className="app">
      <Toolbar />
      <div className="workbench">
        {perspective === 'edit' ? (
          <Splitter direction="row" size={260} fixed="first">
            {[<ProjectExplorer key="explorer" />, editorAndConsole]}
          </Splitter>
        ) : (
          <Splitter direction="column" size={210} fixed="first">
            {[
              <Splitter key="top" direction="row" size={520} fixed="first">
                {[<DebugView key="debug" />, <VariablesPanel key="vars" />]}
              </Splitter>,
              editorAndConsole
            ]}
          </Splitter>
        )}
      </div>
    </div>
  )
}
```

`src/renderer/src/styles.css`:
```css
:root {
  --bg: #e8ebef;
  --panel: #ffffff;
  --border: #c3c8cf;
  --header: #f3f5f7;
  --accent: #3a6ea5;
  --text: #1e1e1e;
  --muted: #6b7078;
  --select: #cfe2f7;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 12px;
  color: var(--text);
}
* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; overflow: hidden; background: var(--bg); }
body.resizing { cursor: col-resize; user-select: none; }
button { font: inherit; }

.app { display: flex; flex-direction: column; height: 100%; }
.workbench { flex: 1; min-height: 0; padding: 4px; }

.toolbar { display: flex; align-items: center; gap: 2px; height: 34px; padding: 0 6px; background: var(--header); border-bottom: 1px solid var(--border); }
.tb-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 24px; border: 1px solid transparent; border-radius: 3px; background: none; cursor: pointer; }
.tb-btn:hover:not(:disabled) { border-color: var(--border); background: #fff; }
.tb-btn:disabled { opacity: 0.35; cursor: default; }
.tb-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--border); }
.tb-spacer { flex: 1; }
.perspectives { display: flex; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.persp { padding: 3px 10px; border: none; background: #fff; cursor: pointer; }
.persp + .persp { border-left: 1px solid var(--border); }
.persp.active { background: var(--select); font-weight: 600; }

.split { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.split-row { flex-direction: row; }
.split-column { flex-direction: column; }
.split-pane { flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; }
.split-handle { flex: 0 0 4px; }
.split-row > .split-handle { cursor: col-resize; }
.split-column > .split-handle { cursor: row-resize; }

.view { display: flex; flex-direction: column; height: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.view-header { display: flex; align-items: center; height: 26px; padding: 0 6px; background: var(--header); border-bottom: 1px solid var(--border); }
.view-title { font-weight: 600; border-top: 2px solid var(--accent); padding: 3px 4px 2px; }
.view-actions { margin-left: auto; display: flex; gap: 2px; }
.view-body { flex: 1; min-height: 0; overflow: auto; }
.view-tabs { display: flex; height: 26px; background: var(--header); border-bottom: 1px solid var(--border); }
.vtab { padding: 0 12px; border: none; border-right: 1px solid var(--border); background: none; cursor: pointer; color: var(--muted); }
.vtab.active { background: var(--panel); color: var(--text); font-weight: 600; box-shadow: inset 0 2px 0 var(--accent); }
.icon-btn { display: inline-flex; border: none; background: none; padding: 2px; cursor: pointer; border-radius: 3px; }
.icon-btn:hover { background: #fff; }
.empty { padding: 12px; color: var(--muted); }

.tree { padding: 2px 0; }
.tree-row { display: flex; align-items: center; gap: 4px; height: 20px; white-space: nowrap; cursor: default; }
.tree-row:hover { background: #eef3f9; }
.tree-row.selected { background: var(--select); }
.twisty { display: inline-block; width: 12px; text-align: center; color: var(--muted); cursor: pointer; }
.tree-suffix { color: var(--muted); }

.editor-area { display: flex; flex-direction: column; height: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.tabbar { display: flex; height: 26px; background: var(--header); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 6px 0 10px; border-right: 1px solid var(--border); color: var(--muted); cursor: pointer; white-space: nowrap; }
.tab.active { background: var(--panel); color: var(--text); box-shadow: inset 0 2px 0 var(--accent); }
.tab-close { border: none; background: none; padding: 0 3px; cursor: pointer; color: var(--muted); border-radius: 3px; }
.tab-close:hover { background: #dde3ea; color: var(--text); }
.editor-host { flex: 1; min-height: 0; }

.console-wrap { display: flex; flex-direction: column; height: 100%; }
.console-bar { display: flex; align-items: center; gap: 8px; padding: 2px 6px; border-bottom: 1px solid #eee; }
.link-btn { border: none; background: none; color: var(--accent); cursor: pointer; }
.console { flex: 1; margin: 0; padding: 4px 8px; overflow: auto; font-family: Consolas, 'Courier New', monospace; font-size: 12px; }
.cl-info { color: #1f4f86; }
.cl-error { color: #c9302c; }

.table-wrap { padding: 0; }
.table-caption { padding: 3px 6px; color: var(--muted); }
table.grid { width: 100%; border-collapse: collapse; }
table.grid th { text-align: left; font-weight: 600; padding: 3px 6px; background: var(--header); border-bottom: 1px solid var(--border); border-right: 1px solid #e3e6ea; }
table.grid td { padding: 2px 6px; border-bottom: 1px solid #f0f0f0; }
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `npm run test:e2e`
Expected: `6 passed`. Then `npm run typecheck`, which should exit 0, and `npm test`, which should show 26 passed.

- [ ] **Step 7: Look at it**

Run: `npm run dev`. Check by eye that the window shows the toolbar, a Project Explorer listing the real `~/workspace_v12` projects (`16pointDIT`, `convolution`, … `splitradix`, 20 in all, with `RemoteSystemsTempFiles` hidden), the Console with the Workspace banner, and that the splitters drag. Close the window.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(renderer): CCS-style workbench with explorer, console and perspectives"
```

---

### Task 6: Monaco editor tabs with save

**Files:**
- Create: `src/renderer/src/monacoSetup.ts`
- Modify: `src/renderer/src/components/EditorArea.tsx` (full replacement), `src/renderer/src/main.tsx` (add one import)
- Test: `tests/e2e/shell.spec.ts` (add a test)

**Interfaces:**
- Consumes: `appStore`, `useApp` (Task 5); `isDirty` (Task 4); `languageFor` (Task 2).
- Produces: `toModelPath(path: string): string` (a `file:///C:/...` URI string for a Monaco model), exported from `EditorArea.tsx`. Step 5 will use it to put breakpoint decorations on the right model. Also `requestClose(path: string): Promise<void>`.

- [ ] **Step 1: Write the failing e2e test** (append to `tests/e2e/shell.spec.ts`; add `readFileSync` to the `fs` import at the top of the file)

```ts
test('opens a file in the editor, edits and saves it', async () => {
  await page.locator('.tree-row', { hasText: 'demo' }).locator('.twisty').click()
  await page.locator('.tree-row', { hasText: 'main.c' }).dblclick()
  const lines = page.locator('.monaco-editor .view-lines')
  await expect(lines).toContainText('int main(void)')
  await expect(page).toHaveTitle(/demo\/main\.c - DSP LabSim/)
  await lines.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('// edited')
  await expect(page.locator('.tab.active')).toContainText('*main.c')
  await page.getByTitle('Save (Ctrl+S)').click()
  await expect(page.locator('.tab.active')).not.toContainText('*')
  const onDisk = readFileSync(join(ws, 'demo', 'main.c'), 'utf8')
  expect(onDisk).toContain('// edited')
  expect(onDisk).toContain('\r\n')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:e2e`
Expected: the new test FAILS waiting for `.monaco-editor .view-lines`; the other 6 pass.

- [ ] **Step 3: Implement**

`src/renderer/src/monacoSetup.ts`:
```ts
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Use the bundled Monaco instead of the CDN copy @monaco-editor/react loads by default.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })
```

`src/renderer/src/main.tsx` (full replacement):
```tsx
import { createRoot } from 'react-dom/client'
import './monacoSetup'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/src/components/EditorArea.tsx` (full replacement):
```tsx
import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'
import { languageFor } from '@shared/files'
import { appStore, useApp } from '../appStore'
import { isDirty } from '../store'

/** Monaco model URI for a Windows path. `Uri.parse('C:\\x')` would treat `c:` as a scheme. */
export const toModelPath = (p: string): string => 'file:///' + p.replace(/\\/g, '/')

export async function requestClose(path: string): Promise<void> {
  const s = appStore.getState()
  const tab = s.tabs.find((t) => t.path === path)
  if (!tab) return
  if (isDirty(tab)) {
    if (!window.confirm(`'${tab.title}' has been modified. Save changes and close?`)) return
    await s.saveTab(path)
  }
  s.closeTab(path)
}

const EDITOR_OPTIONS = {
  fontFamily: "Consolas, 'Courier New', monospace",
  fontSize: 13,
  tabSize: 4,
  minimap: { enabled: false },
  glyphMargin: true,
  automaticLayout: true,
  scrollBeyondLastLine: false
} as const

export function EditorArea(): JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const active = useApp((s) => s.activeTab)
  const tab = tabs.find((t) => t.path === active)
  const st = appStore.getState()

  // Models outlive the <Editor> (keepCurrentModel); dispose them when their tab closes.
  const openPaths = useRef<string[]>([])
  useEffect(() => {
    const now = tabs.map((t) => t.path)
    for (const p of openPaths.current) {
      if (!now.includes(p)) monaco.editor.getModel(monaco.Uri.parse(toModelPath(p)))?.dispose()
    }
    openPaths.current = now
  }, [tabs])

  const onMount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void appStore.getState().saveTab())
  }

  return (
    <div className="editor-area">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.path}
            className={t.path === active ? 'tab active' : 'tab'}
            title={t.path}
            onMouseDown={() => st.setActiveTab(t.path)}
          >
            <span>{(isDirty(t) ? '*' : '') + t.title}</span>
            <button
              className="tab-close"
              aria-label={`Close ${t.title}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void requestClose(t.path)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="editor-host">
        {tab ? (
          <Editor
            path={toModelPath(tab.path)}
            defaultValue={tab.content}
            defaultLanguage={languageFor(tab.path)}
            theme="vs"
            keepCurrentModel
            options={EDITOR_OPTIONS}
            onMount={onMount}
            onChange={(v) => st.editTab(tab.path, v ?? '')}
          />
        ) : (
          <div className="empty">Double-click a file in the Project Explorer to open it.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run all checks**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: typecheck exits 0, `26 passed` (unit), `7 passed` (e2e).
If `?worker` import types are missing, confirm `"types": ["vite/client"]` is in `tsconfig.web.json`.

- [ ] **Step 5: Look at it against the real workspace**

Run: `npm run dev`. Then:
1. Expand `exp11` and double-click `main.c`. The C code shows with syntax colouring and the title reads `workspace_v12 - exp11/main.c - DSP LabSim`.
2. Type a character: the tab shows `*main.c`. Press Ctrl+Z to undo, then close the tab. The confirmation appears; choose Cancel and the tab stays open.
3. Open `C6748.cmd` (plain text) and switch between the tabs.
4. Switch to CCS Debug and back. The editor keeps its content and undo history.
5. **Do not save anything in the real workspace.** Close the window, then check `git -C ~/workspace_v12 status 2>/dev/null` or look at file timestamps to confirm nothing changed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): Monaco editor tabs with dirty tracking and save"
```
