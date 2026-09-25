# Publish DSP LabSim for Windows and macOS: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends can download DSP LabSim from one link and run it on Windows (installer or portable `.exe`) or on a Mac (`.dmg`, Apple Silicon and Intel). Every release is built and tested by GitHub Actions, on real Windows and macOS machines.

**Architecture:**
- **Hosting.** The source lives in a GitHub repository under the `jeetrix-ux` account.
- **Releases.** Pushing a tag `vX.Y.Z` runs a workflow on `windows-latest` and `macos-latest`. It runs the unit tests and the e2e tests, builds with electron-builder, and attaches the installers to a draft GitHub Release. Publishing that draft makes the downloads public.
- **Where the code changes.** The app becomes path-neutral: no `\\` joins in the renderer, and a per-OS compiler search. On macOS it gets an application menu. The TI-copyrighted `C6748.cmd` is replaced with LabSim's own linker file, built from the C6748 memory map.

**Tech Stack:** electron-builder 26 (NSIS, portable, dmg and zip targets), GitHub Actions, and the `gh` CLI (logged in as `jeetrix-ux`). Nothing new is added to the app itself.

## Decisions to confirm before starting

The defaults are marked; the plan follows them unless told otherwise.

| # | Decision | Default | Alternative |
|---|---|---|---|
| D1 | Repository visibility | **Public** repo `jeetrix-ux/dsp-labsim`; the Releases page is the download link | Private source, with release files shared through Google Drive (no CI-published downloads for friends without repo access) |
| D2 | Licence for LabSim's own code | **MIT** | Keep "all rights reserved" (no LICENSE file) |
| D3 | Code signing | **None** (free). Friends click past one warning, and the steps are written in the README | Apple Developer Program ($99/yr) for a notarized Mac app; a Windows code-signing certificate |
| D4 | Mac architectures | **Universal** `.dmg` (one file, Apple Silicon + Intel) | Separate arm64 and x64 files (smaller downloads) |

## What friends will see

- **Windows.**
  - They get `DSP-LabSim-Setup-X.Y.Z.exe` (an installer with a Start-menu entry) or `DSP-LabSim-X.Y.Z-portable.exe`.
  - An unsigned build shows *"Windows protected your PC"*. They click **More info → Run anyway** once.
  - If CCS is installed, they get the real cl6x builds; otherwise, the LabSim front-end.
- **macOS.**
  - They get `DSP-LabSim-X.Y.Z-universal.dmg` and drag the app to Applications.
  - An unsigned build is blocked the first time. They open **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine "/Applications/DSP LabSim.app"` in Terminal.
  - TI does not appear to publish the C6000 compiler for macOS, so Mac builds use the LabSim front-end. Its diagnostics already follow cl6x 8.3. If a Mac `cl6x` is ever found under `/Applications/ti` or `~/ti`, it is used.
- **Both.**
  - The workspace defaults to `~/workspace_v12`; File → Switch Workspace changes it.
  - Graphs, the Memory Browser and debugging work the same on both.
  - Live-audio (codec/McASP) experiments are out of scope everywhere.

## Global Constraints

- Never write to `~/workspace_v12` or `~/dsp_ccs_lab`; tests use temporary workspaces.
- Write files containing backslashes with the Write/Edit tools or a `String.raw` node script.
- Windows behaviour must not change. The existing 666 unit tests and 20 e2e tests keep passing on Windows.
- Nothing is pushed to GitHub, and no release is published, without the user's go-ahead: the repo creation in Task 6 and the release in Task 7.

## File map

| File | Change |
|---|---|
| `resources/C6748.cmd`, `tests/fixtures/ccs/C6748.cmd`, `src/cli/defaultCmd.ts` | LabSim's own linker file, with the same memory map and sections |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | MIT for LabSim; notices for TI RTS-derived code, Electron, Monaco, React and zustand |
| `src/shared/files.ts` | `joinPath`, `pathSep`, `samePath` (one definition used everywhere) |
| `src/renderer/src/store.ts`, `debugStore.ts`, `components/EditorArea.tsx`, `src/interp/debug/lines.ts` | Use the shared path helpers; `toModelPath` handles POSIX paths |
| `src/main/chosenFiles.ts` | Platform `path.resolve`; lower-case only on Windows |
| `src/main/build/toolchain.ts`, `src/main/newProject.ts` | Per-OS compiler name and TI install roots |
| `src/main/menu.ts` | macOS application menu; Preferences under it (Cmd+,) |
| `build/icon.png` | 1024×1024 app icon (electron-builder derives `.ico` and `.icns`) |
| `electron-builder.yml`, `package.json` | NSIS + portable (Windows), dmg + zip universal (macOS), `publish: github` |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | Tests on push; build + release on tag |
| `README.md` | Download and first-run instructions for friends |

---

### Task 1: Replace TI's linker file and add licences

TI's `C6748.cmd` carries "Copyright (c) 2010 Texas Instruments" and no licence, so it should not ship in a public repo or app. LabSim writes its own file, with the same memory regions (these are hardware facts from the C6748 datasheet) and the same section placement.

**Files:**
- Modify: `resources/C6748.cmd`, `tests/fixtures/ccs/C6748.cmd`, `src/cli/defaultCmd.ts:1` (comment only)
- Create: `LICENSE`, `THIRD_PARTY_NOTICES.md`
- Test: `tests/unit/build/linkerCmd.test.ts` (existing), `tests/unit/build/builder.test.ts` (existing, real cl6x on this PC)

- [ ] **Step 1: Write LabSim's linker command file**

Write `resources/C6748.cmd` with the Write tool, using CRLF line ends as before:

```
/* C6748.cmd - linker command file written for DSP LabSim.                  */
/* Memory map of the TMS320C6748 (SPRS590); every section goes to the 128 kB */
/* shared RAM, which is what the LCDK lab projects use.                      */

MEMORY
{
    DSPL2ROM     o = 0x00700000  l = 0x00100000   /* 1 MB L2 ROM              */
    DSPL2RAM     o = 0x00800000  l = 0x00040000   /* 256 kB L2 RAM            */
    DSPL1PRAM    o = 0x00E00000  l = 0x00008000   /* 32 kB L1 program RAM     */
    DSPL1DRAM    o = 0x00F00000  l = 0x00008000   /* 32 kB L1 data RAM        */
    SHDSPL2ROM   o = 0x11700000  l = 0x00100000   /* L2 ROM, global address   */
    SHDSPL2RAM   o = 0x11800000  l = 0x00040000   /* L2 RAM, global address   */
    SHDSPL1PRAM  o = 0x11E00000  l = 0x00008000   /* L1P RAM, global address  */
    SHDSPL1DRAM  o = 0x11F00000  l = 0x00008000   /* L1D RAM, global address  */
    EMIFACS0     o = 0x40000000  l = 0x20000000   /* EMIFA CS0, 512 MB SDRAM  */
    EMIFACS2     o = 0x60000000  l = 0x02000000   /* EMIFA CS2, 32 MB async   */
    EMIFACS3     o = 0x62000000  l = 0x02000000   /* EMIFA CS3, 32 MB async   */
    EMIFACS4     o = 0x64000000  l = 0x02000000   /* EMIFA CS4, 32 MB async   */
    EMIFACS5     o = 0x66000000  l = 0x02000000   /* EMIFA CS5, 32 MB async   */
    SHRAM        o = 0x80000000  l = 0x00020000   /* 128 kB shared RAM        */
    DDR2         o = 0xC0000000  l = 0x20000000   /* 512 MB DDR2              */
}

SECTIONS
{
    .text > SHRAM      .stack > SHRAM     .bss > SHRAM       .cio > SHRAM
    .const > SHRAM     .data > SHRAM      .switch > SHRAM    .sysmem > SHRAM
    .far > SHRAM       .args > SHRAM      .ppinfo > SHRAM    .ppdata > SHRAM
    .pinit > SHRAM     .cinit > SHRAM     .binit > SHRAM     .init_array > SHRAM
    .neardata > SHRAM  .fardata > SHRAM   .rodata > SHRAM
    .c6xabi.exidx > SHRAM
    .c6xabi.extab > SHRAM
}
```

Copy it over the test fixture: `cp resources/C6748.cmd tests/fixtures/ccs/C6748.cmd`. Change the comment on `src/cli/defaultCmd.ts:1` to `/** MEMORY and SECTIONS of LabSim's C6748.cmd (resources/), for programs without a .cmd file. */`.

- [ ] **Step 2: Prove that the addresses are unchanged**

Run: `npx vitest run tests/unit/build`
Expected: PASS. The builder tests link with the real cl6x on this PC, and the linker-command tests parse the file; the section placement is identical. Then run `npx vitest run tests/unit/interp/run-corpus.test.ts`. The corpus projects use their own `.cmd`, so the golden outputs must be unchanged.

- [ ] **Step 3: Licences**

Create `LICENSE` with the standard MIT text, `Copyright (c) 2026 jeetrix-ux` (per D2).

Create `THIRD_PARTY_NOTICES.md`. It lists:
- **TI's C6000 run-time support library**, for the parts ported in `src/interp/runtime` (printf formatting, heap, `rand`, ctype and the math edge cases), with the BSD-3-Clause notice from `ti-cgt-c6000_8.3.12/lib/src` headers. Copy the exact licence block from one of those headers, such as `_printfi.c`.
- **Electron, Monaco Editor, React and zustand**, all MIT.

Also add `"license": "MIT"` to `package.json`.

- [ ] **Step 4: Commit**

```bash
git add resources tests/fixtures/ccs src/cli/defaultCmd.ts LICENSE THIRD_PARTY_NOTICES.md package.json
git commit -m "chore: ship LabSim's own C6748.cmd; MIT licence and third-party notices"
```

---

### Task 2: Path-neutral code

These places assume Windows paths today:
- `store.createProject` joins with `\\`;
- `samePath` and `fileKey` turn `/` into `\\`, which is harmless, but they are defined three times;
- `toModelPath` builds `file:////Users/…` for a POSIX path;
- `ChosenFiles` uses `path.win32`;
- the toolchain looks only in `C:\ti` for `cl6x.exe`.

**Files:**
- Modify: `src/shared/files.ts`, `src/renderer/src/store.ts:36` and `createProject`, `src/renderer/src/debugStore.ts:19`, `src/renderer/src/components/EditorArea.tsx:10-13`, `src/interp/debug/lines.ts:9`, `src/main/chosenFiles.ts`, `src/main/build/toolchain.ts`, `src/main/newProject.ts`
- Test: `tests/unit/files.test.ts`, `tests/unit/chosenFiles.test.ts`, `tests/unit/build/toolchain.test.ts`

**Interfaces:**
- Produces, in `@shared/files`:
  - `pathSep(p: string): '/' | '\\'`
  - `joinPath(dir: string, name: string): string`
  - `samePath(a: string, b: string): boolean`
  - `toModelPath(p: string): string`
- Produces, in `toolchain.ts`: `CL6X = process.platform === 'win32' ? 'cl6x.exe' : 'cl6x'`, and `tiRoots(): string[]`

- [ ] **Step 1: Failing tests for the helpers**

Append to `tests/unit/files.test.ts`:

```ts
import { joinPath, pathSep, samePath, toModelPath } from '@shared/files'

describe('paths on either OS', () => {
  it('joins with the separator the folder already uses', () => {
    expect(pathSep('C:\\ws\\lab1')).toBe('\\')
    expect(pathSep('/Users/amy/workspace_v12/lab1')).toBe('/')
    expect(joinPath('C:\\ws\\lab1', 'main.c')).toBe('C:\\ws\\lab1\\main.c')
    expect(joinPath('/Users/amy/ws/lab1', 'main.c')).toBe('/Users/amy/ws/lab1/main.c')
    expect(joinPath('/Users/amy/ws/lab1/', 'main.c')).toBe('/Users/amy/ws/lab1/main.c')
  })

  it('compares paths without caring about separators or case', () => {
    expect(samePath('C:\\ws\\Lab1\\main.c', 'c:/ws/lab1/main.c')).toBe(true)
    expect(samePath('/Users/amy/ws/main.c', '/Users/amy/ws/Main.c')).toBe(true)
    expect(samePath('/a/b.c', '/a/c.c')).toBe(false)
  })

  it('makes Monaco URIs for Windows and POSIX paths', () => {
    expect(toModelPath('C:\\ws\\lab1\\main.c')).toBe('file:///C:/ws/lab1/main.c')
    expect(toModelPath('/Users/amy/ws/main.c')).toBe('file:///Users/amy/ws/main.c')
  })
})
```

Macs use case-insensitive APFS by default, so a case-insensitive `samePath` is right on both systems.

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/files.test.ts`
Expected: FAIL, because `joinPath` is not exported.

- [ ] **Step 3: Implement it in `src/shared/files.ts`**

```ts
export const pathSep = (p: string): '/' | '\\' => (p.includes('\\') ? '\\' : '/')

export const joinPath = (dir: string, name: string): string => {
  const sep = pathSep(dir)
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
export const samePath = (a: string, b: string): boolean => norm(a) === norm(b)

/** Monaco model URI. `Uri.parse('C:\\x')` would treat `c:` as a scheme, and POSIX paths already start with '/'. */
export const toModelPath = (p: string): string => {
  const f = p.replace(/\\/g, '/')
  return 'file://' + (f.startsWith('/') ? f : '/' + f)
}
```

Then make every caller use these helpers:
- `store.ts`: change `createProject`'s `${dir}\\main.c` to `joinPath(dir, 'main.c')`. `inside()` already accepts both separators.
- `debugStore.ts`: replace the local `samePath` with `export { samePath } from '@shared/files'`, because other modules import it from there.
- `EditorArea.tsx`: import `samePath` and `toModelPath` from `@shared/files`, keep `export { toModelPath }`, and delete the local copies.
- `lines.ts`: `fileKey` stays as it is. It is an internal key, and it gives the same result on both systems.

Run: `npx vitest run tests/unit && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: `ChosenFiles` on both systems**

Replace `norm` in `src/main/chosenFiles.ts`:

```ts
const norm = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
```

In `tests/unit/chosenFiles.test.ts`, make the case-folding assertion Windows-only. Wrap the `c:\\DATA\\y.csv` line in `if (process.platform === 'win32')`, and add a POSIX case: `c.add('/tmp/y.csv'); expect(c.assert('/tmp/./y.csv')).toBe('/tmp/./y.csv')`.

- [ ] **Step 5: Look for the compiler per OS**

In `src/main/build/toolchain.ts`:

```ts
export const CL6X = process.platform === 'win32' ? 'cl6x.exe' : 'cl6x'

/** Where TI installs CCS and the CGT on this OS. */
export function tiRoots(): string[] {
  if (process.platform === 'win32') return ['C:\\ti']
  const home = process.env.HOME ?? ''
  return ['/Applications/ti', `${home}/ti`]
}
```

Make these changes:
- `toolchainAt` uses `path.join(root, 'bin', CL6X)`.
- `findToolchain(override, roots = tiRoots())` loops over every root.
- `findLinkerCmd(bundled, root?)` in `newProject.ts` uses `root ? [root] : tiRoots()`.
- The error text `does not contain bin\\cl6x.exe` in `ipc.ts` becomes `` `does not contain bin/${CL6X}` ``.
- In `toolchain.test.ts`, the fake installs create `bin/${CL6X}`. They pass the root list explicitly, so the tests are the same on both systems.

Run: `npx vitest run tests/unit && npm run typecheck`
Expected: PASS on Windows.

- [ ] **Step 6: Commit**

```bash
git add src tests/unit
git commit -m "refactor: path-neutral helpers and per-OS compiler search, ready for macOS"
```

---

### Task 3: The macOS application menu

On macOS the first menu is always the application menu. Without one, "File" would sit where "DSP LabSim" belongs.

**Files:**
- Modify: `src/main/menu.ts`
- Test: `tests/unit/menu.test.ts` (new; the menu template becomes a pure function)

- [ ] **Step 1: Make the template testable**

Split `buildMenu` into `menuTemplate(platform: NodeJS.Platform, send: (cmd: MenuCommand) => () => void): MenuItemConstructorOptions[]` and a small `buildMenu` that calls it with `process.platform`. On `darwin`, prepend:

```ts
{
  label: 'DSP LabSim',
  submenu: [
    { role: 'about' },
    { type: 'separator' },
    { label: 'Settings...', accelerator: 'Cmd+,', click: send('window.preferences') },
    { type: 'separator' },
    { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' }
  ]
}
```

On darwin, also drop *Exit* from File and *Preferences...* from Window, because both now live in the app menu.

- [ ] **Step 2: Test both platforms**

Create `tests/unit/menu.test.ts`. It mocks `electron`, because `menu.ts` imports `Menu`:

```ts
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() } }))
const { menuTemplate } = await import('../../src/main/menu')

const labels = (t: { label?: string }[]) => t.map((m) => m.label)
const send = () => () => {}

describe('menu', () => {
  it('matches CCS on Windows', () => {
    expect(labels(menuTemplate('win32', send))).toEqual(['File', 'Edit', 'View', 'Project', 'Run', 'Tools', 'Window'])
  })
  it('adds the application menu on macOS', () => {
    const t = menuTemplate('darwin', send)
    expect(labels(t)[0]).toBe('DSP LabSim')
    expect(JSON.stringify(t[0])).toContain('Cmd+,')
  })
})
```

Run: `npx vitest run tests/unit/menu.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/menu.ts tests/unit/menu.test.ts
git commit -m "feat(mac): application menu with Settings (Cmd+,) and Quit"
```

---

### Task 4: App icon and packaging for both systems

**Files:**
- Create: `build/icon.png` (1024×1024)
- Modify: `electron-builder.yml`, `package.json`

- [ ] **Step 1: Draw the icon**

Generate `build/icon.png` with a small Playwright/canvas script run from the repo (it is not kept in the repo). The design:
- a rounded square in CCS blue `#3a6ea5`;
- a white discrete-time stem plot of a sine (7 stems with dots);
- no text.

Check it at 1024 px and at 32 px, where the stems must still read.

- [ ] **Step 2: Configure both platforms**

Replace `electron-builder.yml`:

```yaml
appId: app.labsim.dsp
productName: DSP LabSim
directories:
  output: dist
  buildResources: build
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
publish:
  provider: github
  owner: jeetrix-ux
  repo: dsp-labsim
  releaseType: draft
win:
  target:
    - nsis
    - portable
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  artifactName: DSP-LabSim-Setup-${version}.${ext}
portable:
  artifactName: DSP-LabSim-${version}-portable.${ext}
mac:
  category: public.app-category.education
  target:
    - target: dmg
      arch: universal
    - target: zip
      arch: universal
  # No Apple certificate (D3): ad-hoc sign so the Apple Silicon build launches.
  identity: "-"
  hardenedRuntime: false
dmg:
  artifactName: DSP-LabSim-${version}-universal.${ext}
```

`electronDist` is dropped. A universal Mac build needs both Electron architectures, which electron-builder downloads, and Windows builds download once and then cache.

In `package.json`, set these scripts:

```json
    "dist": "electron-vite build && electron-builder --publish never",
    "dist:dir": "electron-vite build && electron-builder --dir --publish never",
    "release": "electron-vite build && electron-builder --publish always",
```

- [ ] **Step 3: Check the Windows side locally**

Run: `npm run dist`
Expected:
- `dist/DSP-LabSim-Setup-<version>.exe` and `dist/DSP-LabSim-<version>-portable.exe` both exist;
- both use the new icon;
- `npx playwright test tests/e2e/packaged.spec.ts` still passes against `dist/win-unpacked`.

- [ ] **Step 4: Commit**

```bash
git add build/icon.png electron-builder.yml package.json package-lock.json
git commit -m "build: icon, NSIS installer + portable for Windows, universal dmg/zip for macOS"
```

---

### Task 5: GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `tests/e2e/packaged.spec.ts` (find the unpacked app on either OS)

- [ ] **Step 1: The packaged test on either OS**

In `tests/e2e/packaged.spec.ts`, replace the `EXE` constant:

```ts
const EXE =
  process.platform === 'darwin'
    ? join(__dirname, '../../dist/mac-universal/DSP LabSim.app/Contents/MacOS/DSP LabSim')
    : join(__dirname, '../../dist/win-unpacked/DSP LabSim.exe')
```

- [ ] **Step 2: CI on every push**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npx vitest run
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

- [ ] **Step 3: Release on a tag**

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx vitest run
      - run: npm run dist:dir
      - run: npx playwright test tests/e2e/packaged.spec.ts
      - run: npm run release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The packaged smoke test runs before publishing. If the app built for that OS cannot create and debug a project, no files are uploaded.

- [ ] **Step 4: Commit**

```bash
git add .github tests/e2e/packaged.spec.ts
git commit -m "ci: test on Windows and macOS; build and attach installers to a draft release on tags"
```

---

### Task 6: Create the repository and run CI (needs the user's go-ahead)

- [ ] **Step 1: Check nothing private is committed**

Run: `git ls-files | xargs grep -l -i -E "hemcrown|password|token|\\.ssh" || true`
Expected: no hits other than the workflow's `GITHUB_TOKEN` reference.

Also skim `tests/fixtures/golden/*.txt`. They hold program outputs from the lab exercises, with no names or roll numbers.

- [ ] **Step 2: Create and push (only after the user confirms D1)**

```bash
gh repo create jeetrix-ux/dsp-labsim --public --source . --remote origin --push --description "Practise TMS320C6748 DSP labs without the board: CCS-style build, debug and graphs"
```

Pushing `main` starts `ci.yml`.

- [ ] **Step 3: Watch CI and fix macOS failures**

Run: `gh run watch --exit-status`

These are the likely Mac-only failures, with their fixes:
- **Hard-coded `C:\\` paths in tests.** Unit tests that pass Windows paths to real `path` functions need `path.join` or a `process.platform` guard. Pure string tests, such as the fake-API store tests, are fine as they are.
- **Monaco model URIs.** Task 2's `toModelPath` covers these.
- **Keyboard shortcuts in e2e.** The app handles `Ctrl+…` keys itself, and Playwright sends `Control` on macOS too, so these should pass.

Fix, commit and push until both jobs are green.

---

### Task 7: First release and friend instructions (needs the user's go-ahead)

**Files:**
- Modify: `README.md` (a "Download and first run" section), `package.json` (version)

- [ ] **Step 1: Friend instructions in the README**

Add a section with exactly these steps:

**Windows**
1. Download `DSP-LabSim-Setup-X.Y.Z.exe` (installs, with a Start-menu entry) or the `-portable.exe` (runs from anywhere) from the Releases page.
2. If you see "Windows protected your PC", click **More info → Run anyway**. It happens once; the app is not signed.
3. With CCS 12 installed, builds use TI's cl6x. Otherwise they use LabSim's own compiler.

**macOS (Apple Silicon or Intel)**
1. Download `DSP-LabSim-X.Y.Z-universal.dmg`, open it, and drag **DSP LabSim** into **Applications**.
2. Open it once. macOS says it cannot verify the app. Go to **System Settings → Privacy & Security** and click **Open Anyway**. Alternatively, run `xattr -dr com.apple.quarantine "/Applications/DSP LabSim.app"` in Terminal.
3. Builds use LabSim's own C compiler (TI's is Windows-only). Projects copied from a Windows CCS workspace open unchanged.

**Both**
- Put your projects in `~/workspace_v12`, or use **File → Switch Workspace**.
- Programs that need the LCDK's audio codec or interrupts cannot run in LabSim.

- [ ] **Step 2: Version and tag**

```bash
npm version 1.0.0 --no-git-tag-version
git commit -am "release: 1.0.0"
git tag v1.0.0
git push origin main v1.0.0
gh run watch --exit-status
```

- [ ] **Step 3: Publish the draft**

Run: `gh release view v1.0.0`
Expected: four files: the Setup `.exe`, the portable `.exe`, the universal `.dmg` and the `.zip`.

Write the release notes: what LabSim is, the two first-run warnings, and the known limits (no live audio, timing is an estimate).

Then publish: `gh release edit v1.0.0 --draft=false`

Share `https://github.com/jeetrix-ux/dsp-labsim/releases/latest` with friends.

- [ ] **Step 4: A real Mac check**

CI proves that the Mac build launches, builds and debugs (the packaged smoke test runs on `macos-latest`, Apple Silicon). Ask one friend with a Mac to:
- install it;
- create a project with File → New → CCS Project;
- run it;
- open a Single Time graph.

This checks the Gatekeeper steps, which CI cannot test.

---

## Later (not in this plan)

- **Signing.** Apple Developer Program ($99/yr) removes the Mac warning and allows notarization. A Windows OV certificate, or Azure Artifact Signing where eligible, removes SmartScreen.
- **Update notice.** On start, the app could check `https://api.github.com/repos/jeetrix-ux/dsp-labsim/releases/latest` and show "Version X is available" with a link. This works without signing. Full auto-update needs a signed Mac app.
