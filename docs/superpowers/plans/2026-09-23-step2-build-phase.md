# Step 2: Build Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project → Build runs the real TI `cl6x` exactly the way a CCS-generated makefile does. It streams a CCS-format "CDT Build Console", fills the Problems view and editor squiggles from TI's diagnostics, rebuilds incrementally, supports Clean and Rebuild, and produces a `ProgramImage`: every global and static data symbol with its linked address and size, plus the stack, heap and memory map. Steps 4-6 use that image.

**Architecture:** Pure, unit-tested modules in `src/main/build/`: toolchain discovery, `.cproject` parsing, command-line construction, diagnostic parsing, dependency files, an ELF32 reader, a `.map` parser and program-image assembly. A `builder.ts` orchestrator spawns `cl6x` (no shell, no gmake) from `<project>/.labsim/Debug`. The renderer calls it over IPC and receives console lines as events.

**Tech Stack:** as Step 1 (Electron 44, React 19, zustand 5, Monaco 0.56, vitest 4.1, Playwright 1.63), plus Node `child_process`. The TI C6000 CGT v8.3.12 is installed at `C:\ti\ccs1281\ccs\tools\compiler\ti-cgt-c6000_8.3.12`.

Spec: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md` → "Build phase".

## Global Constraints

- Command lines must match the CCS 12 generated makefile for the Debug configuration (captured from `~/workspace_v12/exp11/Debug/{subdir_rules.mk,makefile}`):
  - compile: `"<cgt>/bin/cl6x" -mv6740 --include_path="<proj>" --include_path="<cgt>/include" --define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number --preproc_with_compile --preproc_dependency="main.d_raw" "<src>"`
  - link: `"<cgt>/bin/cl6x" -mv6740 --define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number -z -m"<name>.map" --heap_size=0x800 --stack_size=0x800 -i"<cgt>/lib" -i"<cgt>/include" --reread_libs --diag_wrap=off --display_error_number --warn_sections --xml_link_info="<name>_linkInfo.xml" --rom_model -o "<name>.out" "./main.obj" "<cmd>" -llibc.a`
  - Paths in displayed command lines use forward slashes, as CCS prints them.
- Build output directory: `<project>/.labsim/Debug`. Never write into the project's own `Debug/` (CCS owns it).
- Build options come from the Debug configuration in `<project>/.cproject` when present. Defaults: silicon 6740, define `c6748`, include paths `${PROJECT_ROOT}` and `${CG_TOOL_ROOT}/include`, diag_warning 225, heap 0x800, stack 0x800, library `libc.a`, search paths `${CG_TOOL_ROOT}/lib` and `${CG_TOOL_ROOT}/include`, no -O.
- Diagnostics format (with `--diag_wrap=off --display_error_number`): `"<file>", line <n>: error|warning|remark #<id>[-D]: <text>`. cl6x prints these on **stderr**, and the console shows stderr lines red. Linker messages without a location: `error #10234-D: unresolved symbols remain`, preceded by an ` undefined  first referenced` table.
- The ELF `.out` is little-endian ELF32 (machine 140). File statics are LOCAL symbols grouped after an STT_FILE symbol whose name is a GUID, and the same GUID is the STT_FILE symbol in that source's `.obj`. Function-local statics are named `name$N`.
- Console name: `CDT Build Console [<project>]`. First line `**** Build of configuration Debug for project <project> ****`, last line `**** Build Finished ****`.
- No shell and no gmake: `child_process.spawn(cl6x, args, { cwd })`, so project names with spaces (`fir lowpass`) work.

## File Structure

```
src/shared/program.ts          MemoryRegion, SectionInfo, SymbolInfo, ProgramImage
src/shared/build.ts            Toolchain, Diagnostic, BuildKind, BuildResult, BuildOutputLine
src/main/build/toolchain.ts    findToolchain, toolchainAt, compareVersions
src/main/build/projectConfig.ts BuildConfig, defaultConfig, parseCproject, readBuildConfig
src/main/build/commands.ts     Arg, renderCommand, toSpawnArgs, compileArgs, linkArgs
src/main/build/diagnostics.ts  parseDiagnostics
src/main/build/depfile.ts      parseDepFile, isStale
src/main/build/elf.ts          readElf (ELF32 LE sections + symbols with file ids)
src/main/build/mapfile.ts      parseMemoryConfiguration, parseGlobalSymbols
src/main/build/image.ts        buildProgramImage (pure), loadProgramImage (fs)
src/main/build/runProcess.ts   spawn + line buffering
src/main/build/builder.ts      runBuild: clean / incremental build / rebuild, console text, persistence
src/main/ipc.ts, menu.ts, index.ts, settings.ts, src/preload/index.ts, src/shared/api.ts   (modified)
src/renderer/src/store.ts, App.tsx, components/{Toolbar,ProblemsView,EditorArea,ConsoleView}.tsx, styles.css (modified)
tests/fixtures/ccs/exp11.cproject   copy of ~/workspace_v12/exp11/.cproject
tests/fixtures/ccs/C6748.cmd        copy of ~/workspace_v12/exp11/C6748.cmd
tests/fixtures/elf/g.c, g.out, g.map, main.obj   a cl6x-built program with globals/statics
tests/unit/build/*.test.ts
tests/e2e/build.spec.ts
```

---

### Task 1: Shared types, toolchain discovery, project configuration

**Files:**
- Create: `src/shared/program.ts`, `src/shared/build.ts`, `src/main/build/toolchain.ts`, `src/main/build/projectConfig.ts`
- Create fixture: `tests/fixtures/ccs/exp11.cproject`
- Test: `tests/unit/build/toolchain.test.ts`, `tests/unit/build/projectConfig.test.ts`

**Interfaces:**
- Produces (`src/shared/build.ts`): `interface Toolchain { root: string; version: string; cl6x: string }`; `type Severity = 'error' | 'warning' | 'remark'`; `interface Diagnostic { file: string | null; line: number | null; severity: Severity; code: string; message: string }`; `type BuildKind = 'build' | 'rebuild' | 'clean'`; `interface BuildResult { ok: boolean; diagnostics: Diagnostic[]; image: ProgramImage | null }`; `interface BuildOutputLine { console: string; text: string; kind: 'out' | 'info' | 'error' }`
- Produces (`src/shared/program.ts`): `MemoryRegion { name; origin; length; attr }`, `SectionInfo { name; addr; size; nobits }`, `SymbolInfo { name; addr; size; section; kind: 'object' | 'func' }`, `ProgramImage { outFile; entry; memory; sections; globals: Record<string, SymbolInfo>; statics: Record<string, Record<string, SymbolInfo>>; stack: { start; size }; heap: { start; size } }`
- Produces (`toolchain.ts`): `compareVersions(a, b): number`, `toolchainAt(root): Promise<Toolchain | null>`, `findToolchain(override?: string, tiRoot = 'C:\\ti'): Promise<Toolchain | null>`
- Produces (`projectConfig.ts`): `interface BuildConfig { projectName; projectDir; silicon; defines: string[]; includePaths: string[]; optLevel: string | null; diagWarnings: string[]; heapSize; stackSize; libraries: string[]; searchPaths: string[]; linkerCommandFile: string | null }`, `defaultConfig(name, dir, cgtRoot)`, `parseCproject(xml, name, dir, cgtRoot)`, `readBuildConfig(projectDir, cgtRoot): Promise<BuildConfig>`

- [ ] **Step 1: Copy the fixture**

```bash
mkdir -p tests/fixtures/ccs && cp ~/workspace_v12/exp11/.cproject tests/fixtures/ccs/exp11.cproject && cp ~/workspace_v12/exp11/C6748.cmd tests/fixtures/ccs/C6748.cmd
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/build/toolchain.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { compareVersions, findToolchain } from '../../../src/main/build/toolchain'

let ti: string
function fakeCgt(dir: string): string {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'cl6x.exe'), '')
  return dir
}
beforeEach(() => { ti = mkdtempSync(join(tmpdir(), 'labsim-ti-')) })
afterEach(() => rmSync(ti, { recursive: true, force: true }))

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('8.3.12', '8.3.2')).toBeGreaterThan(0)
    expect(compareVersions('8.5.0.LTS', '8.3.12')).toBeGreaterThan(0)
    expect(compareVersions('7.4.24', '7.4.24')).toBe(0)
  })
})

describe('findToolchain', () => {
  it('finds the CGT inside a CCS install', async () => {
    const root = fakeCgt(join(ti, 'ccs1281', 'ccs', 'tools', 'compiler', 'ti-cgt-c6000_8.3.12'))
    fakeCgt(join(ti, 'ccs1281', 'ccs', 'tools', 'compiler', 'ti-cgt-arm_20.2.7.LTS'))
    const tc = await findToolchain(undefined, ti)
    expect(tc).toEqual({ root, version: '8.3.12', cl6x: join(root, 'bin', 'cl6x.exe') })
  })
  it('prefers the newest of several installs, including standalone ones', async () => {
    fakeCgt(join(ti, 'ccs1281', 'ccs', 'tools', 'compiler', 'ti-cgt-c6000_8.3.12'))
    const newer = fakeCgt(join(ti, 'ti-cgt-c6000_8.5.0.LTS'))
    expect((await findToolchain(undefined, ti))?.root).toBe(newer)
  })
  it('uses a valid override and rejects an invalid one', async () => {
    const custom = fakeCgt(join(ti, 'somewhere', 'ti-cgt-c6000_7.4.24'))
    expect((await findToolchain(custom, ti))?.version).toBe('7.4.24')
    expect(await findToolchain(join(ti, 'nope'), ti)).toBeNull()
  })
  it('returns null when nothing is installed', async () => {
    expect(await findToolchain(undefined, join(ti, 'missing'))).toBeNull()
  })
})
```

`tests/unit/build/projectConfig.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { defaultConfig, parseCproject } from '../../../src/main/build/projectConfig'

const CGT = 'C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12'
const DIR = 'C:\\ws\\exp11'

describe('parseCproject', () => {
  it('reads the Debug configuration of a real CCS 12 project', () => {
    const xml = readFileSync(join(__dirname, '../../fixtures/ccs/exp11.cproject'), 'utf8')
    const cfg = parseCproject(xml, 'exp11', DIR, CGT)
    expect(cfg).toEqual({
      projectName: 'exp11',
      projectDir: DIR,
      silicon: '6740',
      defines: ['c6748'],
      includePaths: ['C:/ws/exp11', 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include'],
      optLevel: null,
      diagWarnings: ['225'],
      heapSize: '0x800',
      stackSize: '0x800',
      libraries: ['libc.a'],
      searchPaths: ['C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/lib', 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include'],
      linkerCommandFile: 'C6748.cmd'
    })
  })
  it('picks up changed heap, stack, optimisation and defines', () => {
    const xml = `<cproject><storageModule><cconfiguration>
      <storageModule><configuration name="Release"><option superClass="x.linkerID.HEAP_SIZE" value="0x9999"/></configuration></storageModule>
      <storageModule><configuration artifactName="\${ProjName}" name="Debug">
        <option id="a.1" superClass="com.ti.x.compilerID.OPT_LEVEL" value="com.ti.x.compilerID.OPT_LEVEL.2" valueType="enumerated"/>
        <option superClass="com.ti.x.linkerID.HEAP_SIZE" value="0x2000" valueType="string"/>
        <option value="0x1000" superClass="com.ti.x.linkerID.STACK_SIZE"/>
        <option superClass="com.ti.x.compilerID.DEFINE" valueType="definedSymbols">
          <listOptionValue builtIn="false" value="c6748"/>
          <listOptionValue builtIn="false" value="USE_Q15=1"/>
        </option>
      </configuration></storageModule>
    </cconfiguration></storageModule></cproject>`
    const cfg = parseCproject(xml, 'p', DIR, CGT)
    expect(cfg.optLevel).toBe('2')
    expect(cfg.heapSize).toBe('0x2000')
    expect(cfg.stackSize).toBe('0x1000')
    expect(cfg.defines).toEqual(['c6748', 'USE_Q15=1'])
    expect(cfg.libraries).toEqual(['libc.a'])
  })
  it('treats OPT_LEVEL.off as no optimisation', () => {
    const xml = `<configuration name="Debug"><option superClass="c.compilerID.OPT_LEVEL" value="c.compilerID.OPT_LEVEL.off"/></configuration>`
    expect(parseCproject(xml, 'p', DIR, CGT).optLevel).toBeNull()
  })
})

describe('defaultConfig', () => {
  it('matches what CCS generates for a new C6748 project', () => {
    const cfg = defaultConfig('p', DIR, CGT)
    expect(cfg.defines).toEqual(['c6748'])
    expect(cfg.includePaths).toEqual(['C:/ws/exp11', 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include'])
    expect([cfg.heapSize, cfg.stackSize]).toEqual(['0x800', '0x800'])
    expect(cfg.linkerCommandFile).toBeNull()
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run tests/unit/build`
Expected: FAIL with `Cannot find module '../../../src/main/build/toolchain'` (and `projectConfig`).

- [ ] **Step 4: Implement**

`src/shared/program.ts`:
```ts
/** A MEMORY region from the linker command file, as listed in the .map "MEMORY CONFIGURATION". */
export interface MemoryRegion {
  name: string
  origin: number
  length: number
  attr: string
}

export interface SectionInfo {
  name: string
  addr: number
  size: number
  /** Uninitialised (SHT_NOBITS) section such as .bss, .far, .stack, .sysmem. */
  nobits: boolean
}

export interface SymbolInfo {
  /** Name as in the ELF symbol table; function-local statics look like `name$1`. */
  name: string
  addr: number
  /** Bytes; 0 when the linker did not record a size (the interpreter uses the C type). */
  size: number
  section: string
  kind: 'object' | 'func'
}

/** Where the real linker put everything. Produced by the build, consumed by the interpreter and graphs. */
export interface ProgramImage {
  outFile: string
  entry: number
  memory: MemoryRegion[]
  sections: SectionInfo[]
  globals: Record<string, SymbolInfo>
  /** Absolute source path → local (static) data symbols defined in that translation unit. */
  statics: Record<string, Record<string, SymbolInfo>>
  stack: { start: number; size: number }
  heap: { start: number; size: number }
}
```

`src/shared/build.ts`:
```ts
import type { ProgramImage } from './program'

export interface Toolchain {
  /** CGT root, e.g. C:\ti\ccs1281\ccs\tools\compiler\ti-cgt-c6000_8.3.12 */
  root: string
  version: string
  cl6x: string
}

export type Severity = 'error' | 'warning' | 'remark'

export interface Diagnostic {
  /** Absolute path, or null for linker messages without a location. */
  file: string | null
  line: number | null
  severity: Severity
  /** TI diagnostic id as printed, e.g. '20', '179-D', '10234-D'. */
  code: string
  message: string
}

export type BuildKind = 'build' | 'rebuild' | 'clean'

export interface BuildResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Linked program layout; null after a clean or a failed build. */
  image: ProgramImage | null
}

export interface BuildOutputLine {
  console: string
  text: string
  kind: 'out' | 'info' | 'error'
}
```

`src/main/build/toolchain.ts`:
```ts
import { promises as fs } from 'fs'
import * as path from 'path'
import type { Toolchain } from '@shared/build'

const CGT_DIR = /^ti-cgt-c6000_(.+)$/

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

export async function toolchainAt(root: string): Promise<Toolchain | null> {
  const cl6x = path.join(root, 'bin', 'cl6x.exe')
  if (!(await exists(cl6x))) return null
  return { root, version: CGT_DIR.exec(path.basename(root))?.[1] ?? 'unknown', cl6x }
}

/** The override when it is a valid CGT root; otherwise the newest C6000 CGT under <tiRoot> or <tiRoot>/ccs*\/ccs/tools/compiler. */
export async function findToolchain(override?: string, tiRoot = 'C:\\ti'): Promise<Toolchain | null> {
  if (override) return toolchainAt(override)
  const candidates: string[] = []
  for (const d of await subdirs(tiRoot)) {
    const name = path.basename(d)
    if (CGT_DIR.test(name)) candidates.push(d)
    if (name.startsWith('ccs')) {
      for (const c of await subdirs(path.join(d, 'ccs', 'tools', 'compiler'))) {
        if (CGT_DIR.test(path.basename(c))) candidates.push(c)
      }
    }
  }
  const found = (await Promise.all(candidates.map(toolchainAt))).filter((t): t is Toolchain => t !== null)
  found.sort((a, b) => compareVersions(b.version, a.version))
  return found[0] ?? null
}
```

`src/main/build/projectConfig.ts`:
```ts
import { promises as fs } from 'fs'
import * as path from 'path'

export interface BuildConfig {
  projectName: string
  projectDir: string
  silicon: string
  defines: string[]
  /** Absolute, forward slashes (as CCS prints them). */
  includePaths: string[]
  /** '0'..'4', or null for no -O option. */
  optLevel: string | null
  diagWarnings: string[]
  heapSize: string
  stackSize: string
  libraries: string[]
  searchPaths: string[]
  /** Project-relative linker command file name from .cproject, if any. */
  linkerCommandFile: string | null
}

const fwd = (p: string): string => p.replace(/\\/g, '/')

export function defaultConfig(name: string, dir: string, cgtRoot: string): BuildConfig {
  return {
    projectName: name,
    projectDir: dir,
    silicon: '6740',
    defines: ['c6748'],
    includePaths: [fwd(dir), fwd(cgtRoot) + '/include'],
    optLevel: null,
    diagWarnings: ['225'],
    heapSize: '0x800',
    stackSize: '0x800',
    libraries: ['libc.a'],
    searchPaths: [fwd(cgtRoot) + '/lib', fwd(cgtRoot) + '/include'],
    linkerCommandFile: null
  }
}

interface RawOption {
  value: string | null
  list: string[]
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = m[2]
  return out
}

/** Options of the Debug configuration, keyed by the last segment of their superClass (e.g. HEAP_SIZE). */
function debugOptions(xml: string): Map<string, RawOption> {
  const options = new Map<string, RawOption>()
  const start = xml.search(/<configuration\b[^>]*\bname="Debug"/)
  if (start < 0) return options
  const endTag = xml.indexOf('</configuration>', start)
  const block = xml.slice(start, endTag < 0 ? undefined : endTag)
  const re = /<option\b([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    const a = attrs(m[1])
    const key = (a.superClass ?? '').split('.').pop() ?? ''
    const list: string[] = []
    if (m[2] !== '/') {
      const close = block.indexOf('</option>', re.lastIndex)
      const body = block.slice(re.lastIndex, close < 0 ? undefined : close)
      for (const lv of body.matchAll(/<listOptionValue\b([^>]*)\/?>/g)) {
        const v = attrs(lv[1]).value
        if (v !== undefined) list.push(v)
      }
    }
    if (!options.has(key)) options.set(key, { value: a.value ?? null, list })
  }
  return options
}

export function parseCproject(xml: string, name: string, dir: string, cgtRoot: string): BuildConfig {
  const cfg = defaultConfig(name, dir, cgtRoot)
  const opts = debugOptions(xml)
  const expand = (s: string): string =>
    fwd(
      s
        .replace(/\$\{PROJECT_ROOT\}|\$\{PROJECT_LOC\}/g, dir)
        .replace(/\$\{CG_TOOL_ROOT\}/g, cgtRoot)
        .replace(/\$\{ProjName\}/g, name)
    )
  const list = (key: string): string[] | null => {
    const o = opts.get(key)
    return o && o.list.length > 0 ? o.list : null
  }
  const value = (key: string): string | null => opts.get(key)?.value ?? null

  cfg.silicon = value('SILICON_VERSION') ?? cfg.silicon
  cfg.defines = list('DEFINE') ?? cfg.defines
  cfg.includePaths = (list('INCLUDE_PATH') ?? null)?.map(expand) ?? cfg.includePaths
  cfg.diagWarnings = list('DIAG_WARNING') ?? cfg.diagWarnings
  cfg.heapSize = value('HEAP_SIZE') ?? cfg.heapSize
  cfg.stackSize = value('STACK_SIZE') ?? cfg.stackSize
  cfg.libraries = list('LIBRARY') ?? cfg.libraries
  cfg.searchPaths = (list('SEARCH_PATH') ?? null)?.map(expand) ?? cfg.searchPaths
  const opt = value('OPT_LEVEL')?.split('.').pop() ?? null
  cfg.optLevel = opt !== null && /^[0-4]$/.test(opt) ? opt : null
  const tag = (list('OPT_TAGS') ?? []).find((t) => t.startsWith('LINKER_COMMAND_FILE='))
  cfg.linkerCommandFile = tag ? tag.slice('LINKER_COMMAND_FILE='.length) || null : null
  return cfg
}

export async function readBuildConfig(projectDir: string, cgtRoot: string): Promise<BuildConfig> {
  const name = path.basename(projectDir)
  let cfg: BuildConfig
  try {
    cfg = parseCproject(await fs.readFile(path.join(projectDir, '.cproject'), 'utf8'), name, projectDir, cgtRoot)
  } catch {
    cfg = defaultConfig(name, projectDir, cgtRoot)
  }
  const files = await fs.readdir(projectDir)
  if (!cfg.linkerCommandFile || !files.includes(cfg.linkerCommandFile)) {
    cfg.linkerCommandFile = files.find((f) => f.toLowerCase().endsWith('.cmd')) ?? null
  }
  return cfg
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/build`
Expected: 9 passed. `npm run typecheck` exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(build): toolchain discovery and .cproject build options"
```

---

### Task 2: Command lines, diagnostics, dependency files

**Files:**
- Create: `src/main/build/commands.ts`, `src/main/build/diagnostics.ts`, `src/main/build/depfile.ts`
- Test: `tests/unit/build/commands.test.ts`, `tests/unit/build/diagnostics.test.ts`, `tests/unit/build/depfile.test.ts`

**Interfaces:**
- Consumes: `BuildConfig`, `defaultConfig` (Task 1), `Toolchain`, `Diagnostic` (Task 1).
- Produces (`commands.ts`): `type Arg = string | { flag: string; path: string }`; `renderCommand(exe: string, args: Arg[]): string`; `toSpawnArgs(args: Arg[]): string[]`; `compileArgs(cfg: BuildConfig, src: { rel: string; objDir: string | null; depFile: string }): Arg[]`; `linkArgs(cfg: BuildConfig, objs: string[], cmdFile: string | null): Arg[]`
- Produces (`diagnostics.ts`): `parseDiagnostics(output: string, cwd: string): Diagnostic[]`
- Produces (`depfile.ts`): `parseDepFile(text: string, cwd: string): string[]`, `isStale(target: string, deps: string[]): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/build/commands.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { compileArgs, linkArgs, renderCommand, toSpawnArgs } from '../../../src/main/build/commands'
import { defaultConfig } from '../../../src/main/build/projectConfig'

const CGT = 'C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12'
const CL6X = 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/bin/cl6x'
const cfg = defaultConfig('exp11', 'C:\\Users\\jeetm\\workspace_v12\\exp11', CGT)

describe('compileArgs', () => {
  it('reproduces the CCS 12 subdir_rules.mk compile line', () => {
    const args = compileArgs(cfg, { rel: '../../main.c', objDir: null, depFile: 'main.d_raw' })
    expect(renderCommand(CL6X, args)).toBe(
      '"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/bin/cl6x" -mv6740 ' +
        '--include_path="C:/Users/jeetm/workspace_v12/exp11" ' +
        '--include_path="C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include" ' +
        '--define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number ' +
        '--preproc_with_compile --preproc_dependency="main.d_raw" "../../main.c"'
    )
  })
  it('passes unquoted values to spawn', () => {
    const args = toSpawnArgs(compileArgs(cfg, { rel: '../../main.c', objDir: null, depFile: 'main.d_raw' }))
    expect(args[1]).toBe('--include_path=C:/Users/jeetm/workspace_v12/exp11')
    expect(args.at(-1)).toBe('../../main.c')
  })
  it('adds -O and an object directory when needed', () => {
    const args = compileArgs({ ...cfg, optLevel: '2' }, { rel: '../../src/fir.c', objDir: 'src', depFile: 'src/fir.d_raw' })
    const line = renderCommand(CL6X, args)
    expect(line).toContain('cl6x" -mv6740 -O2 --include_path=')
    expect(line).toContain('--preproc_dependency="src/fir.d_raw" --obj_directory="src" "../../src/fir.c"')
  })
})

describe('linkArgs', () => {
  it('reproduces the CCS 12 makefile link line', () => {
    const args = linkArgs(cfg, ['./main.obj'], '../../C6748.cmd')
    expect(renderCommand(CL6X, args)).toBe(
      '"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/bin/cl6x" -mv6740 --define=c6748 -g ' +
        '--diag_warning=225 --diag_wrap=off --display_error_number -z -m"exp11.map" ' +
        '--heap_size=0x800 --stack_size=0x800 ' +
        '-i"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/lib" ' +
        '-i"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include" ' +
        '--reread_libs --diag_wrap=off --display_error_number --warn_sections ' +
        '--xml_link_info="exp11_linkInfo.xml" --rom_model -o "exp11.out" "./main.obj" "../../C6748.cmd" -llibc.a'
    )
  })
  it('spawns -o and the object list as separate, unquoted arguments', () => {
    const args = toSpawnArgs(linkArgs({ ...cfg, projectName: 'fir lowpass' }, ['./main.obj'], '../../C6748.cmd'))
    expect(args).toContain('-mfir lowpass.map')
    const o = args.indexOf('-o')
    expect(args[o + 1]).toBe('fir lowpass.out')
    expect(args.slice(-3)).toEqual(['./main.obj', '../../C6748.cmd', '-llibc.a'])
  })
})
```

`tests/unit/build/diagnostics.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { parseDiagnostics } from '../../../src/main/build/diagnostics'

const CWD = 'C:\\ws\\bad\\.labsim\\Debug'
const MAIN = join('C:\\ws\\bad', 'main.c')

const COMPILE = [
  '"../../main.c", line 6: error #20: identifier "y" is undefined',
  '"../../main.c", line 7: warning #551-D: variable "x" is used before its value is set',
  '"../../main.c", line 8: error #66: expected a ";"',
  '"../../main.c", line 5: warning #179-D: variable "unused" was declared but never referenced',
  '2 errors detected in the compilation of "../../main.c".',
  '',
  '>> Compilation failure'
].join('\r\n')

const LINK = [
  '<Linking>',
  '',
  ' undefined  first referenced                                                                         ',
  '  symbol        in file                                                                              ',
  ' ---------  ----------------                                                                         ',
  ' main       C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12\\lib\\rts6740_elf.lib<args_main.c.obj>',
  ' helper     ./util.obj                                                                           ',
  '',
  'error #10234-D: unresolved symbols remain',
  'error #10010: errors encountered during linking; "bad.out" not built',
  '',
  '>> Compilation failure'
].join('\n')

describe('parseDiagnostics', () => {
  it('parses located compiler errors and warnings', () => {
    expect(parseDiagnostics(COMPILE, CWD)).toEqual([
      { file: MAIN, line: 6, severity: 'error', code: '20', message: 'identifier "y" is undefined' },
      { file: MAIN, line: 7, severity: 'warning', code: '551-D', message: 'variable "x" is used before its value is set' },
      { file: MAIN, line: 8, severity: 'error', code: '66', message: 'expected a ";"' },
      { file: MAIN, line: 5, severity: 'warning', code: '179-D', message: 'variable "unused" was declared but never referenced' }
    ])
  })
  it('turns the undefined-symbol table and linker errors into diagnostics', () => {
    expect(parseDiagnostics(LINK, CWD)).toEqual([
      { file: null, line: null, severity: 'error', code: '10234-D', message: 'unresolved symbol main, first referenced in C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12\\lib\\rts6740_elf.lib<args_main.c.obj>' },
      { file: null, line: null, severity: 'error', code: '10234-D', message: 'unresolved symbol helper, first referenced in ./util.obj' },
      { file: null, line: null, severity: 'error', code: '10234-D', message: 'unresolved symbols remain' },
      { file: null, line: null, severity: 'error', code: '10010', message: 'errors encountered during linking; "bad.out" not built' }
    ])
  })
  it('maps fatal errors to errors and keeps remarks', () => {
    const d = parseDiagnostics('"../../a.c", line 1: fatal error #1965: cannot open source file "nope.h"\n"../../a.c", line 2: remark #1532-D: (ULP 5.1) Detected sprintf', CWD)
    expect(d.map((x) => [x.severity, x.code])).toEqual([['error', '1965'], ['remark', '1532-D']])
  })
})
```

`tests/unit/build/depfile.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isStale, parseDepFile } from '../../../src/main/build/depfile'

describe('parseDepFile', () => {
  it('resolves every dependency against the build directory', () => {
    const text = [
      'main.obj: ../../main.c',
      'main.obj: C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include/stdio.h',
      'main.obj: C:/ws/fir\\ lowpass/coeffs.h',
      ''
    ].join('\r\n')
    expect(parseDepFile(text, 'C:\\ws\\p\\.labsim\\Debug')).toEqual([
      join('C:\\ws\\p', 'main.c'),
      join('C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include/stdio.h'),
      join('C:/ws/fir lowpass/coeffs.h')
    ])
  })
})

describe('isStale', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'labsim-dep-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const at = (name: string, secs: number): string => {
    const p = join(dir, name)
    writeFileSync(p, name)
    utimesSync(p, secs, secs)
    return p
  }
  it('is stale when the target is missing', async () => {
    expect(await isStale(join(dir, 'x.obj'), [at('x.c', 100)])).toBe(true)
  })
  it('is stale when a dependency is newer or missing', async () => {
    const obj = at('x.obj', 200)
    expect(await isStale(obj, [at('x.c', 100), at('x.h', 300)])).toBe(true)
    expect(await isStale(obj, [at('y.c', 100), join(dir, 'gone.h')])).toBe(true)
  })
  it('is fresh when every dependency is older', async () => {
    expect(await isStale(at('x.obj', 200), [at('x.c', 100), at('x.h', 150)])).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/unit/build`
Expected: the 3 new files FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`src/main/build/commands.ts`:
```ts
import type { BuildConfig } from './projectConfig'

/** A plain argument, or an option whose value is a path that CCS prints in double quotes. */
export type Arg = string | { flag: string; path: string }

export function renderCommand(exe: string, args: Arg[]): string {
  const shown = args.map((a) => (typeof a === 'string' ? a : `${a.flag}"${a.path}"`))
  return [`"${exe.replace(/\\/g, '/')}"`, ...shown].join(' ')
}

export function toSpawnArgs(args: Arg[]): string[] {
  const out: string[] = []
  for (const a of args) {
    if (typeof a === 'string') out.push(a)
    else if (a.flag.endsWith(' ')) out.push(a.flag.trimEnd(), a.path)
    else out.push(a.flag + a.path)
  }
  return out
}

function common(cfg: BuildConfig): Arg[] {
  return [
    `-mv${cfg.silicon}`,
    ...(cfg.optLevel !== null ? [`-O${cfg.optLevel}`] : [])
  ]
}

function diagFlags(cfg: BuildConfig): string[] {
  return ['-g', ...cfg.diagWarnings.map((w) => `--diag_warning=${w}`), '--diag_wrap=off', '--display_error_number']
}

export function compileArgs(cfg: BuildConfig, src: { rel: string; objDir: string | null; depFile: string }): Arg[] {
  return [
    ...common(cfg),
    ...cfg.includePaths.map((p) => ({ flag: '--include_path=', path: p })),
    ...cfg.defines.map((d) => `--define=${d}`),
    ...diagFlags(cfg),
    '--preproc_with_compile',
    { flag: '--preproc_dependency=', path: src.depFile },
    ...(src.objDir ? [{ flag: '--obj_directory=', path: src.objDir }] : []),
    { flag: '', path: src.rel }
  ]
}

export function linkArgs(cfg: BuildConfig, objs: string[], cmdFile: string | null): Arg[] {
  const name = cfg.projectName
  return [
    ...common(cfg),
    ...cfg.defines.map((d) => `--define=${d}`),
    ...diagFlags(cfg),
    '-z',
    { flag: '-m', path: `${name}.map` },
    `--heap_size=${cfg.heapSize}`,
    `--stack_size=${cfg.stackSize}`,
    ...cfg.searchPaths.map((p) => ({ flag: '-i', path: p })),
    '--reread_libs',
    '--diag_wrap=off',
    '--display_error_number',
    '--warn_sections',
    { flag: '--xml_link_info=', path: `${name}_linkInfo.xml` },
    '--rom_model',
    { flag: '-o ', path: `${name}.out` },
    ...objs.map((o) => ({ flag: '', path: o })),
    ...(cmdFile ? [{ flag: '', path: cmdFile }] : []),
    ...cfg.libraries.map((l) => `-l${l}`)
  ]
}
```

`src/main/build/diagnostics.ts`:
```ts
import * as path from 'path'
import type { Diagnostic, Severity } from '@shared/build'

const LOCATED = /^"(.+?)", line (\d+): (fatal error|error|warning|remark) #(\d+(?:-D)?): (.*)$/
const UNLOCATED = /^(fatal error|error|warning|remark) #(\d+(?:-D)?): (.*)$/
const UNDEFINED_ROW = /^\s+(\S+)\s+(.+?)\s*$/

const severity = (s: string): Severity => (s === 'fatal error' ? 'error' : (s as Severity))

/** Parses cl6x compiler/linker output (run with --diag_wrap=off --display_error_number). */
export function parseDiagnostics(output: string, cwd: string): Diagnostic[] {
  const out: Diagnostic[] = []
  const lines = output.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m = LOCATED.exec(line)
    if (m) {
      out.push({ file: path.resolve(cwd, m[1]), line: Number(m[2]), severity: severity(m[3]), code: m[4], message: m[5] })
      continue
    }
    m = UNLOCATED.exec(line)
    if (m) {
      out.push({ file: null, line: null, severity: severity(m[1]), code: m[2], message: m[3] })
      continue
    }
    if (/^\s*undefined\s+first referenced/.test(line)) {
      // Skip the "symbol  in file" line and the dashes, then read rows until a blank line.
      i += 2
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') {
        i++
        const row = UNDEFINED_ROW.exec(lines[i])
        if (row) {
          out.push({ file: null, line: null, severity: 'error', code: '10234-D', message: `unresolved symbol ${row[1]}, first referenced in ${row[2]}` })
        }
      }
    }
  }
  return out
}
```

`src/main/build/depfile.ts`:
```ts
import { promises as fs } from 'fs'
import * as path from 'path'

/** Parses a cl6x --preproc_dependency file ("main.obj: <dep>" per line) into absolute paths. */
export function parseDepFile(text: string, cwd: string): string[] {
  const deps: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const sep = line.indexOf(': ')
    if (sep < 0) continue
    const dep = line.slice(sep + 2).trim().replace(/\\ /g, ' ')
    if (dep) deps.push(path.resolve(cwd, dep))
  }
  return deps
}

async function mtime(p: string): Promise<number | null> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return null
  }
}

/** True when target is missing, or any dependency is missing or newer than it. */
export async function isStale(target: string, deps: string[]): Promise<boolean> {
  const t = await mtime(target)
  if (t === null) return true
  for (const d of deps) {
    const m = await mtime(d)
    if (m === null || m > t) return true
  }
  return false
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/build`
Expected: 9 + 12 = 21 passed. `npm run typecheck` exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(build): CCS command lines, TI diagnostic parser, dependency tracking"
```

---

### Task 3: ELF reader, map parser, program image

**Files:**
- Create: `src/main/build/elf.ts`, `src/main/build/mapfile.ts`, `src/main/build/image.ts`
- Create fixtures: `tests/fixtures/elf/g.c`, `g.out`, `g.map`, `main.obj`
- Test: `tests/unit/build/elf.test.ts`, `tests/unit/build/image.test.ts`

**Interfaces:**
- Consumes: `ProgramImage`, `MemoryRegion`, `SymbolInfo` (Task 1).
- Produces (`elf.ts`): `interface ElfSection { name; addr; size; type; flags }`, `interface ElfSymbol { name; value; size; bind; type; shndx; fileId: string | null }`, `interface ElfFile { entry; machine; sections; symbols }`, `STT = { NOTYPE: 0, OBJECT: 1, FUNC: 2, SECTION: 3, FILE: 4, COMMON: 5 }`, `STB = { LOCAL: 0, GLOBAL: 1, WEAK: 2 }`, `readElf(buf: Uint8Array): ElfFile`, `fileIdOf(obj: ElfFile): string | null`
- Produces (`mapfile.ts`): `parseMemoryConfiguration(map: string): MemoryRegion[]`, `parseGlobalSymbols(map: string): Record<string, number>`
- Produces (`image.ts`): `buildProgramImage(out: ElfFile, mapText: string, units: { source: string; fileId: string | null }[], outFile: string): ProgramImage`, `loadProgramImage(outFile: string, mapFile: string, objs: { source: string; objPath: string }[]): Promise<ProgramImage>`

- [ ] **Step 1: Create the fixtures with the real compiler**

`tests/fixtures/elf/g.c`:
```c
#include <stdio.h>
float x[64];
float h[3] = { 1.0f, 2.0f, 1.0f };
static int counter;
static const short table[4] = { 1, 2, 3, 4 };
double big[2000];
struct pt { int a; float b; } pts[5];
int main(void)
{
    static float local_static[8];
    float local[16];
    int i;
    for (i = 0; i < 16; i++) local[i] = i;
    local_static[0] = local[3] + x[0] + h[1] + table[2] + counter + big[1] + pts[0].b;
    printf("%f\n", local_static[0]);
    return 0;
}
```

Build it (Git Bash):
```bash
CGT="C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12"; T=$(mktemp -d); mkdir -p "$T/g/Debug"
cp tests/fixtures/elf/g.c "$T/g/main.c"; cp tests/fixtures/ccs/C6748.cmd "$T/g/"
( cd "$T/g/Debug" && "$CGT/bin/cl6x" -mv6740 --include_path="$T/g" --include_path="$CGT/include" --define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number --preproc_with_compile --preproc_dependency="main.d_raw" "../main.c" \
  && "$CGT/bin/cl6x" -mv6740 --define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number -z -m"g.map" --heap_size=0x800 --stack_size=0x800 -i"$CGT/lib" -i"$CGT/include" --reread_libs --warn_sections --rom_model -o "g.out" "./main.obj" "../C6748.cmd" -llibc.a )
cp "$T/g/Debug/g.out" "$T/g/Debug/g.map" "$T/g/Debug/main.obj" tests/fixtures/elf/
```
Expected: `<Linking>` and three files copied (g.out ≈ 250 KB, main.obj ≈ 20 KB).

- [ ] **Step 2: Write the failing tests**

`tests/unit/build/elf.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileIdOf, readElf, STB, STT } from '../../../src/main/build/elf'
import { parseGlobalSymbols, parseMemoryConfiguration } from '../../../src/main/build/mapfile'

const FIX = join(__dirname, '../../fixtures/elf')
const out = readElf(readFileSync(join(FIX, 'g.out')))
const obj = readElf(readFileSync(join(FIX, 'main.obj')))
const map = readFileSync(join(FIX, 'g.map'), 'utf8')

describe('readElf', () => {
  it('reads the header and allocated sections', () => {
    expect(out.machine).toBe(140)
    const names = out.sections.map((s) => s.name)
    for (const n of ['.text', '.stack', '.sysmem', '.far', '.fardata', '.const', '.cio']) expect(names).toContain(n)
  })
  it('agrees with the linker map on every global address', () => {
    const fromMap = parseGlobalSymbols(map)
    expect(Object.keys(fromMap).length).toBeGreaterThan(50)
    for (const s of out.symbols) {
      if ((s.bind === STB.GLOBAL || s.bind === STB.WEAK) && s.name in fromMap && s.shndx !== 0) {
        expect({ name: s.name, addr: s.value }).toEqual({ name: s.name, addr: fromMap[s.name] })
      }
    }
    expect(fromMap.x).toBeDefined()
    expect(fromMap.main).toBeDefined()
  })
  it('records sizes for globals and ties locals to their translation unit', () => {
    const x = out.symbols.find((s) => s.name === 'x')!
    expect([x.size, x.bind]).toEqual([256, STB.GLOBAL])
    const guid = fileIdOf(obj)
    expect(guid).toMatch(/^\{[0-9A-F-]+\}$/)
    const statics = out.symbols.filter((s) => s.bind === STB.LOCAL && s.fileId === guid && s.type === STT.OBJECT).map((s) => s.name)
    expect(statics).toEqual(expect.arrayContaining(['counter', 'table', 'local_static$1']))
  })
  it('rejects files that are not little-endian ELF32', () => {
    expect(() => readElf(new Uint8Array([1, 2, 3, 4]))).toThrow('Not an ELF32 little-endian file')
  })
})

describe('parseMemoryConfiguration', () => {
  it('lists the C6748 memory regions', () => {
    const mem = parseMemoryConfiguration(map)
    expect(mem).toHaveLength(15)
    expect(mem.find((m) => m.name === 'SHRAM')).toEqual({ name: 'SHRAM', origin: 0x80000000, length: 0x20000, attr: 'RWIX' })
    expect(mem.find((m) => m.name === 'DDR2')).toEqual({ name: 'DDR2', origin: 0xc0000000, length: 0x20000000, attr: 'RWIX' })
  })
})
```

`tests/unit/build/image.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileIdOf, readElf } from '../../../src/main/build/elf'
import { buildProgramImage, loadProgramImage } from '../../../src/main/build/image'
import { parseGlobalSymbols } from '../../../src/main/build/mapfile'

const FIX = join(__dirname, '../../fixtures/elf')
const SRC = 'C:\\ws\\g\\main.c'
const map = readFileSync(join(FIX, 'g.map'), 'utf8')
const image = buildProgramImage(
  readElf(readFileSync(join(FIX, 'g.out'))),
  map,
  [{ source: SRC, fileId: fileIdOf(readElf(readFileSync(join(FIX, 'main.obj')))) }],
  join(FIX, 'g.out')
)

describe('buildProgramImage', () => {
  it('places user globals where the linker put them', () => {
    const fromMap = parseGlobalSymbols(map)
    for (const n of ['x', 'h', 'big', 'pts', 'main']) expect(image.globals[n].addr).toBe(fromMap[n])
    expect(image.globals.x).toMatchObject({ size: 256, section: '.far', kind: 'object' })
    expect(image.globals.big).toMatchObject({ size: 16000, kind: 'object' })
    expect(image.globals.h.section).toBe('.fardata')
    expect(image.globals.main.kind).toBe('func')
  })
  it('groups statics by source file', () => {
    const s = image.statics[SRC]
    expect(Object.keys(s).sort()).toEqual(['counter', 'local_static$1', 'table'])
    expect(s.table).toMatchObject({ size: 8, section: '.const' })
    expect(s['local_static$1'].size).toBe(32)
  })
  it('finds stack, heap, entry point and memory map', () => {
    expect(image.stack.size).toBe(0x800)
    expect(image.heap.size).toBe(0x800)
    expect(image.stack.start).toBe(image.sections.find((x) => x.name === '.stack')!.addr)
    expect(image.entry).toBe(parseGlobalSymbols(map)._c_int00)
    expect(image.memory.map((m) => m.name)).toContain('SHRAM')
  })
})

describe('loadProgramImage', () => {
  it('reads the files and produces the same image', async () => {
    const loaded = await loadProgramImage(join(FIX, 'g.out'), join(FIX, 'g.map'), [{ source: SRC, objPath: join(FIX, 'main.obj') }])
    expect(loaded).toEqual(image)
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run tests/unit/build/elf tests/unit/build/image`
Expected: FAIL with `Cannot find module '../../../src/main/build/elf'`.

- [ ] **Step 4: Implement**

`src/main/build/elf.ts`:
```ts
export interface ElfSection {
  name: string
  addr: number
  size: number
  type: number
  flags: number
}

export interface ElfSymbol {
  name: string
  value: number
  size: number
  bind: number
  type: number
  shndx: number
  /** For LOCAL symbols: name of the STT_FILE symbol that precedes them (a GUID for cl6x objects). */
  fileId: string | null
}

export interface ElfFile {
  entry: number
  machine: number
  sections: ElfSection[]
  symbols: ElfSymbol[]
}

export const STT = { NOTYPE: 0, OBJECT: 1, FUNC: 2, SECTION: 3, FILE: 4, COMMON: 5 } as const
export const STB = { LOCAL: 0, GLOBAL: 1, WEAK: 2 } as const
export const SHT_SYMTAB = 2
export const SHT_NOBITS = 8
export const SHF_ALLOC = 2

export function readElf(buf: Uint8Array): ElfFile {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const isElf = buf.length > 52 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46
  if (!isElf || buf[4] !== 1 || buf[5] !== 1) throw new Error('Not an ELF32 little-endian file')
  const u16 = (o: number): number => dv.getUint16(o, true)
  const u32 = (o: number): number => dv.getUint32(o, true)
  const cstr = (o: number): string => {
    let end = o
    while (end < buf.length && buf[end] !== 0) end++
    return new TextDecoder('latin1').decode(buf.subarray(o, end))
  }

  const entry = u32(24)
  const machine = u16(18)
  const shoff = u32(32)
  const shentsize = u16(46)
  const shnum = u16(48)
  const shstrndx = u16(50)

  const raw = Array.from({ length: shnum }, (_, i) => {
    const b = shoff + i * shentsize
    return { name: u32(b), type: u32(b + 4), flags: u32(b + 8), addr: u32(b + 12), offset: u32(b + 16), size: u32(b + 20), link: u32(b + 24), entsize: u32(b + 36) }
  })
  const shstr = raw[shstrndx]?.offset ?? 0
  const sections: ElfSection[] = raw.map((s) => ({ name: cstr(shstr + s.name), addr: s.addr, size: s.size, type: s.type, flags: s.flags }))

  const symbols: ElfSymbol[] = []
  for (const s of raw) {
    if (s.type !== SHT_SYMTAB) continue
    const strtab = raw[s.link].offset
    const count = s.size / (s.entsize || 16)
    let fileId: string | null = null
    for (let j = 0; j < count; j++) {
      const b = s.offset + j * 16
      const info = buf[b + 12]
      const sym: ElfSymbol = {
        name: cstr(strtab + u32(b)),
        value: u32(b + 4),
        size: u32(b + 8),
        bind: info >> 4,
        type: info & 0xf,
        shndx: u16(b + 14),
        fileId: null
      }
      if (sym.type === STT.FILE) fileId = sym.name
      else if (sym.bind === STB.LOCAL) sym.fileId = fileId
      symbols.push(sym)
    }
  }
  return { entry, machine, sections, symbols }
}

/** The STT_FILE symbol of a relocatable object: cl6x writes one per translation unit. */
export function fileIdOf(obj: ElfFile): string | null {
  return obj.symbols.find((s) => s.type === STT.FILE)?.name ?? null
}
```

`src/main/build/mapfile.ts`:
```ts
import type { MemoryRegion } from '@shared/program'

export function parseMemoryConfiguration(map: string): MemoryRegion[] {
  const start = map.indexOf('MEMORY CONFIGURATION')
  if (start < 0) return []
  const regions: MemoryRegion[] = []
  const lines = map.slice(start).split(/\r?\n/)
  const row = /^\s+(\S+)\s+([0-9a-fA-F]{8})\s+([0-9a-fA-F]{8})\s+[0-9a-fA-F]{8}\s+[0-9a-fA-F]{8}\s+(\S+)/
  let seenRows = false
  for (const line of lines.slice(1)) {
    const m = row.exec(line)
    if (m) {
      regions.push({ name: m[1], origin: parseInt(m[2], 16), length: parseInt(m[3], 16), attr: m[4] })
      seenRows = true
    } else if (seenRows && line.trim() === '') {
      break
    }
  }
  return regions
}

/** "GLOBAL SYMBOLS: SORTED ALPHABETICALLY BY Name" → name → address (UNDEFED entries skipped). */
export function parseGlobalSymbols(map: string): Record<string, number> {
  const start = map.indexOf('GLOBAL SYMBOLS: SORTED ALPHABETICALLY BY Name')
  if (start < 0) return {}
  const end = map.indexOf('GLOBAL SYMBOLS: SORTED BY Symbol Address', start)
  const out: Record<string, number> = {}
  for (const line of map.slice(start, end < 0 ? undefined : end).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{8})\s+(\S+)\s*$/.exec(line)
    if (m) out[m[2]] = parseInt(m[1], 16)
  }
  return out
}
```

`src/main/build/image.ts`:
```ts
import { promises as fs } from 'fs'
import type { ProgramImage, SectionInfo, SymbolInfo } from '@shared/program'
import { fileIdOf, readElf, SHF_ALLOC, SHT_NOBITS, STB, STT, type ElfFile, type ElfSymbol } from './elf'
import { parseMemoryConfiguration } from './mapfile'

const SHN_LORESERVE = 0xff00

function isDefinedData(s: ElfSymbol): boolean {
  return s.shndx !== 0 && s.shndx < SHN_LORESERVE && (s.type === STT.OBJECT || s.type === STT.COMMON)
}

export function buildProgramImage(
  out: ElfFile,
  mapText: string,
  units: { source: string; fileId: string | null }[],
  outFile: string
): ProgramImage {
  const sections: SectionInfo[] = out.sections
    .filter((s) => (s.flags & SHF_ALLOC) !== 0 && s.size > 0)
    .map((s) => ({ name: s.name, addr: s.addr, size: s.size, nobits: s.type === SHT_NOBITS }))
  const info = (s: ElfSymbol, kind: SymbolInfo['kind']): SymbolInfo => ({
    name: s.name,
    addr: s.value,
    size: s.size,
    section: out.sections[s.shndx]?.name ?? '',
    kind
  })

  const globals: Record<string, SymbolInfo> = {}
  const statics: Record<string, Record<string, SymbolInfo>> = {}
  const sourceOf = new Map(units.filter((u) => u.fileId).map((u) => [u.fileId as string, u.source]))
  for (const u of units) statics[u.source] = {}

  for (const s of out.symbols) {
    const isGlobal = s.bind === STB.GLOBAL || s.bind === STB.WEAK
    if (isGlobal && isDefinedData(s)) globals[s.name] = info(s, 'object')
    else if (isGlobal && s.type === STT.FUNC && s.shndx !== 0) globals[s.name] = info(s, 'func')
    else if (s.bind === STB.LOCAL && isDefinedData(s) && s.fileId && sourceOf.has(s.fileId)) {
      statics[sourceOf.get(s.fileId) as string][s.name] = info(s, 'object')
    }
  }

  const section = (name: string): { start: number; size: number } => {
    const s = sections.find((x) => x.name === name)
    return s ? { start: s.addr, size: s.size } : { start: 0, size: 0 }
  }
  return {
    outFile,
    entry: out.entry,
    memory: parseMemoryConfiguration(mapText),
    sections,
    globals,
    statics,
    stack: section('.stack'),
    heap: section('.sysmem')
  }
}

export async function loadProgramImage(
  outFile: string,
  mapFile: string,
  objs: { source: string; objPath: string }[]
): Promise<ProgramImage> {
  const out = readElf(await fs.readFile(outFile))
  const units = await Promise.all(
    objs.map(async (o) => ({ source: o.source, fileId: fileIdOf(readElf(await fs.readFile(o.objPath))) }))
  )
  return buildProgramImage(out, await fs.readFile(mapFile, 'utf8'), units, outFile)
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/build`
Expected: 21 + 9 = 30 passed. `npm run typecheck` exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(build): ELF32 reader, map parser and program image"
```

---

### Task 4: Process runner and the build orchestrator

**Files:**
- Create: `src/main/build/runProcess.ts`, `src/main/build/builder.ts`
- Test: `tests/unit/build/builder.test.ts` (uses the real cl6x; skipped when it is not installed)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces (`runProcess.ts`): `runProcess(exe: string, args: string[], cwd: string, onLine: (text: string, stream: 'stdout' | 'stderr') => void): Promise<number>` (exit code, -1 if it could not start)
- Produces (`builder.ts`): `OUT_SUBDIR = '.labsim/Debug'` (joined with path.join); `interface BuildRequest { projectDir: string; kind: BuildKind; toolchain: Toolchain | null; onOutput(text: string, kind: 'out' | 'info' | 'error'): void }`; `runBuild(req: BuildRequest): Promise<BuildResult>`; `findSources(projectDir: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

`tests/unit/build/builder.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Toolchain } from '@shared/build'
import { findToolchain } from '../../../src/main/build/toolchain'
import { findSources, OUT_SUBDIR, runBuild } from '../../../src/main/build/builder'

const FIX = join(__dirname, '../../fixtures')
const tc: Toolchain | null = await findToolchain()

let ws: string
let log: { text: string; kind: string }[]
const onOutput = (text: string, kind: 'out' | 'info' | 'error'): void => { log.push({ text, kind }) }
const text = (): string => log.map((l) => l.text).join('\n')

function project(name: string, main: string, extra: Record<string, string> = {}): string {
  const dir = join(ws, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'main.c'), main)
  copyFileSync(join(FIX, 'ccs', 'C6748.cmd'), join(dir, 'C6748.cmd'))
  for (const [f, c] of Object.entries(extra)) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), c)
  }
  return dir
}

const GOOD = '#include <stdio.h>\nfloat y[8];\nstatic int n;\nint main(void)\n{\n    int i;\n    for (i = 0; i < 8; i++) y[i] = i * 0.5f;\n    n = 8;\n    printf("done %d\\n", n);\n    return 0;\n}\n'
const BAD = '#include <stdio.h>\nint main(void)\n{\n    int unused = 3;\n    z = 4;\n    return 0;\n}\n'

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-build-'))
  log = []
})
afterEach(() => rmSync(ws, { recursive: true, force: true }))

describe('findSources', () => {
  it('lists .c files, skipping Debug, Release and dot folders', async () => {
    const dir = project('p', GOOD, { 'src/fir.c': '', 'Debug/old.c': '', 'Release/r.c': '', '.labsim/x.c': '', 'notes.txt': '' })
    expect(await findSources(dir)).toEqual([join(dir, 'main.c'), join(dir, 'src', 'fir.c')])
  })
})

describe('runBuild without a compiler', () => {
  it('fails with an explanation', async () => {
    const r = await runBuild({ projectDir: project('p', GOOD), kind: 'build', toolchain: null, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0].message).toContain('C6000 compiler (cl6x) not found')
    expect(text()).toContain('**** Build Finished ****')
  })
})

describe.skipIf(!tc)('runBuild with cl6x', () => {
  it('builds, reports CCS-style console output and returns the program image', async () => {
    const dir = project('good', GOOD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
    const out = text()
    expect(log[0].text).toBe('**** Build of configuration Debug for project good ****')
    expect(out).toContain('Building file: "../../main.c"')
    expect(out).toContain('Invoking: C6000 Compiler')
    expect(out).toContain('Finished building: "../../main.c"')
    expect(out).toContain('Building target: "good.out"')
    expect(out).toContain('Invoking: C6000 Linker')
    expect(out).toContain('<Linking>')
    expect(out).toContain('Finished building target: "good.out"')
    expect(log.at(-1)?.text).toBe('**** Build Finished ****')
    expect(existsSync(join(dir, OUT_SUBDIR, 'good.out'))).toBe(true)
    expect(existsSync(join(dir, 'Debug'))).toBe(false)
    expect(r.image?.globals.y.size).toBe(32)
    expect(Object.keys(r.image?.statics[join(dir, 'main.c')] ?? {})).toEqual(['n'])
  }, 60_000)

  it('does nothing on a second build and recompiles after an edit', async () => {
    const dir = project('inc', GOOD)
    await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    log = []
    const again = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(again.ok).toBe(true)
    expect(again.image).not.toBeNull()
    expect(text()).not.toContain('Invoking: C6000 Compiler')
    expect(text()).toContain("'inc.out' is up to date.")
    const future = Date.now() / 1000 + 10
    utimesSync(join(dir, 'main.c'), future, future)
    log = []
    await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(text()).toContain('Invoking: C6000 Compiler')
    expect(text()).toContain('Invoking: C6000 Linker')
  }, 90_000)

  it('reports compile errors, skips the link and keeps warnings across builds', async () => {
    const dir = project('bad', BAD)
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(false)
    expect(r.image).toBeNull()
    expect(r.diagnostics).toContainEqual({ file: join(dir, 'main.c'), line: 5, severity: 'error', code: '20', message: 'identifier "z" is undefined' })
    expect(r.diagnostics.some((d) => d.severity === 'warning' && d.code === '179-D')).toBe(true)
    expect(log.some((l) => l.kind === 'error' && l.text.includes('error #20'))).toBe(true)
    expect(text()).not.toContain('Invoking: C6000 Linker')
    expect(text()).toContain('"bad.out" not built')
  }, 60_000)

  it('keeps diagnostics of files that were not recompiled', async () => {
    const dir = project('warn', '#include <stdio.h>\nint main(void)\n{\n    int unused = 3;\n    return 0;\n}\n')
    const first = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(first.diagnostics.map((d) => d.code)).toEqual(['179-D'])
    const second = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(second.diagnostics.map((d) => d.code)).toEqual(['179-D'])
  }, 60_000)

  it('cleans and rebuilds', async () => {
    const dir = project('cr', GOOD)
    await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    log = []
    const c = await runBuild({ projectDir: dir, kind: 'clean', toolchain: tc, onOutput })
    expect(c.ok).toBe(true)
    expect(existsSync(join(dir, OUT_SUBDIR))).toBe(false)
    expect(log[0].text).toBe('**** Clean-only build of configuration Debug for project cr ****')
    log = []
    const rb = await runBuild({ projectDir: dir, kind: 'rebuild', toolchain: tc, onOutput })
    expect(rb.ok).toBe(true)
    expect(text()).toContain('Invoking: C6000 Compiler')
  }, 90_000)

  it('handles a project folder with a space in its name', async () => {
    const r = await runBuild({ projectDir: project('fir lowpass', GOOD), kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(true)
    expect(text()).toContain('Building target: "fir lowpass.out"')
  }, 60_000)

  it('fails clearly without a linker command file', async () => {
    const dir = project('nocmd', GOOD)
    rmSync(join(dir, 'C6748.cmd'))
    const r = await runBuild({ projectDir: dir, kind: 'build', toolchain: tc, onOutput })
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.message.includes('No linker command file'))).toBe(true)
  }, 60_000)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/build/builder`
Expected: FAIL with `Cannot find module '../../../src/main/build/builder'`.

- [ ] **Step 3: Implement**

`src/main/build/runProcess.ts`:
```ts
import { spawn } from 'child_process'

/** Runs a program without a shell, reporting complete output lines. Resolves to the exit code (-1 if it could not start). */
export function runProcess(
  exe: string,
  args: string[],
  cwd: string,
  onLine: (text: string, stream: 'stdout' | 'stderr') => void
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true })
    const pending = { stdout: '', stderr: '' }
    const feed = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const parts = (pending[stream] + chunk.toString('utf8')).split(/\r?\n/)
      pending[stream] = parts.pop() ?? ''
      for (const p of parts) onLine(p, stream)
    }
    child.stdout.on('data', (c: Buffer) => feed('stdout', c))
    child.stderr.on('data', (c: Buffer) => feed('stderr', c))
    child.on('error', (err) => {
      onLine(`Could not run ${exe}: ${err.message}`, 'stderr')
      resolve(-1)
    })
    child.on('close', (code) => {
      for (const s of ['stdout', 'stderr'] as const) if (pending[s]) onLine(pending[s], s)
      resolve(code ?? -1)
    })
  })
}
```

`src/main/build/builder.ts`:
```ts
import { promises as fs } from 'fs'
import * as path from 'path'
import type { BuildKind, BuildResult, Diagnostic, Toolchain } from '@shared/build'
import { compileArgs, linkArgs, renderCommand, toSpawnArgs } from './commands'
import { isStale, parseDepFile } from './depfile'
import { parseDiagnostics } from './diagnostics'
import { loadProgramImage } from './image'
import { readBuildConfig } from './projectConfig'
import { runProcess } from './runProcess'

export const OUT_SUBDIR = path.join('.labsim', 'Debug')
const SKIP_DIRS = new Set(['debug', 'release'])
const FLAGS_FILE = 'labsim-flags.json'
const DIAGS_FILE = 'labsim-diagnostics.json'

export interface BuildRequest {
  projectDir: string
  kind: BuildKind
  toolchain: Toolchain | null
  onOutput(text: string, kind: 'out' | 'info' | 'error'): void
}

type Emit = BuildRequest['onOutput']

export async function findSources(projectDir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory() && !(dir === projectDir && SKIP_DIRS.has(e.name.toLowerCase()))) await walk(p)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.c')) out.push(p)
    }
  }
  await walk(projectDir)
  // Files in the project root first, then subfolders, each alphabetical.
  return out.sort((a, b) => {
    const da = path.dirname(a) === projectDir ? 0 : 1
    const db = path.dirname(b) === projectDir ? 0 : 1
    return da - db || a.localeCompare(b)
  })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

const fwd = (p: string): string => p.replace(/\\/g, '/')

function fail(emit: Emit, message: string): BuildResult {
  emit(message, 'error')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: false, diagnostics: [{ file: null, line: null, severity: 'error', code: 'LABSIM', message }], image: null }
}

async function clean(projectDir: string, name: string, emit: Emit): Promise<BuildResult> {
  emit(`**** Clean-only build of configuration Debug for project ${name} ****`, 'out')
  emit('', 'out')
  await fs.rm(path.join(projectDir, OUT_SUBDIR), { recursive: true, force: true })
  emit(`Removed ${fwd(OUT_SUBDIR)}`, 'out')
  emit('Finished clean', 'out')
  emit(' ', 'out')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: true, diagnostics: [], image: null }
}

export async function runBuild(req: BuildRequest): Promise<BuildResult> {
  const { projectDir, kind, toolchain } = req
  const emit = req.onOutput
  const name = path.basename(projectDir)
  const outDir = path.join(projectDir, OUT_SUBDIR)

  if (kind === 'clean') return clean(projectDir, name, emit)
  if (kind === 'rebuild') {
    await clean(projectDir, name, emit)
    emit('', 'out')
  }

  emit(`**** Build of configuration Debug for project ${name} ****`, 'out')
  emit('', 'out')
  if (!toolchain) {
    return fail(emit, 'C6000 compiler (cl6x) not found. Install Code Composer Studio or set the compiler location in Window > Preferences.')
  }

  const cfg = await readBuildConfig(projectDir, toolchain.root)
  const sources = await findSources(projectDir)
  if (sources.length === 0) return fail(emit, `No C source files in project ${name}.`)
  await fs.mkdir(outDir, { recursive: true })

  // Any change of options or compiler invalidates every object.
  const flags = JSON.stringify({ cfg, cgt: toolchain.root })
  const forced = (await readJson<string>(path.join(outDir, FLAGS_FILE), '')) !== flags
  const stored = await readJson<Record<string, Diagnostic[]>>(path.join(outDir, DIAGS_FILE), {})
  const perSource: Record<string, Diagnostic[]> = {}

  const objs: { source: string; objPath: string; objRel: string }[] = []
  let failed = 0
  let compiled = 0
  for (const src of sources) {
    const relToProject = fwd(path.relative(projectDir, src))
    const subdir = path.posix.dirname(relToProject) === '.' ? null : path.posix.dirname(relToProject)
    const base = path.basename(src, path.extname(src))
    const objRel = (subdir ? `${subdir}/` : '') + `${base}.obj`
    const depRel = (subdir ? `${subdir}/` : '') + `${base}.d_raw`
    const objPath = path.join(outDir, objRel)
    objs.push({ source: src, objPath, objRel: `./${objRel}` })

    let deps: string[] = [src]
    try {
      deps = [src, ...parseDepFile(await fs.readFile(path.join(outDir, depRel), 'utf8'), outDir)]
    } catch {
      /* no dependency file yet: stale anyway because the object is missing */
    }
    if (!forced && !(await isStale(objPath, deps))) {
      perSource[src] = stored[src] ?? []
      continue
    }

    compiled++
    const rel = fwd(path.relative(outDir, src))
    if (subdir) await fs.mkdir(path.join(outDir, subdir), { recursive: true })
    const args = compileArgs(cfg, { rel, objDir: subdir, depFile: depRel })
    emit(`Building file: "${rel}"`, 'out')
    emit('Invoking: C6000 Compiler', 'out')
    emit(renderCommand(toolchain.cl6x, args), 'out')
    const captured: string[] = []
    const code = await runProcess(toolchain.cl6x, toSpawnArgs(args), outDir, (line, stream) => {
      captured.push(line)
      emit(line, stream === 'stderr' ? 'error' : 'out')
    })
    perSource[src] = parseDiagnostics(captured.join('\n'), outDir)
    if (code !== 0) {
      failed++
      await fs.rm(objPath, { force: true })
    } else {
      emit(`Finished building: "${rel}"`, 'out')
      emit(' ', 'out')
    }
  }

  await fs.writeFile(path.join(outDir, DIAGS_FILE), JSON.stringify(perSource), 'utf8')
  await fs.writeFile(path.join(outDir, FLAGS_FILE), JSON.stringify(flags), 'utf8')
  const diagnostics = Object.values(perSource).flat()
  const outName = `${name}.out`

  if (failed > 0) {
    emit(`Build stopped: ${failed} file${failed === 1 ? '' : 's'} failed to compile; "${outName}" not built.`, 'error')
    emit('', 'out')
    emit('**** Build Finished ****', 'out')
    return { ok: false, diagnostics, image: null }
  }

  if (!cfg.linkerCommandFile) {
    const r = fail(emit, `No linker command file (.cmd) in project ${name}. Copy C6748.cmd from another project.`)
    return { ...r, diagnostics: [...diagnostics, ...r.diagnostics] }
  }
  const cmdPath = path.join(projectDir, cfg.linkerCommandFile)
  const outPath = path.join(outDir, outName)
  const mapPath = path.join(outDir, `${name}.map`)
  const needLink = compiled > 0 || forced || (await isStale(outPath, [...objs.map((o) => o.objPath), cmdPath]))

  if (needLink) {
    const args = linkArgs(cfg, objs.map((o) => o.objRel), fwd(path.relative(outDir, cmdPath)))
    emit(`Building target: "${outName}"`, 'out')
    emit('Invoking: C6000 Linker', 'out')
    emit(renderCommand(toolchain.cl6x, args), 'out')
    const captured: string[] = []
    const code = await runProcess(toolchain.cl6x, toSpawnArgs(args), outDir, (line, stream) => {
      captured.push(line)
      emit(line, stream === 'stderr' ? 'error' : 'out')
    })
    diagnostics.push(...parseDiagnostics(captured.join('\n'), outDir))
    if (code !== 0) {
      await fs.rm(outPath, { force: true })
      emit('', 'out')
      emit('**** Build Finished ****', 'out')
      return { ok: false, diagnostics, image: null }
    }
    emit(`Finished building target: "${outName}"`, 'out')
    emit(' ', 'out')
  } else {
    emit(`'${outName}' is up to date.`, 'out')
  }

  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  const image = await loadProgramImage(outPath, mapPath, objs.map((o) => ({ source: o.source, objPath: o.objPath })))
  return { ok: true, diagnostics, image }
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/build/builder`
Expected: 9 passed (7 of them use the real cl6x; each takes a few seconds). Then run `npm test`: every unit test passes. `npm run typecheck` exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(build): cl6x build orchestrator with incremental builds, clean and rebuild"
```

---

### Task 5: IPC, menu, settings and renderer build state

**Files:**
- Modify: `src/shared/api.ts`, `src/main/settings.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/store.ts`
- Test: `tests/unit/store.test.ts` (extend)

**Interfaces:**
- Consumes: `runBuild`, `findToolchain`, `toolchainAt` (Tasks 1, 4), shared build types.
- Produces (`LabsimApi` additions): `getToolchain(): Promise<Toolchain | null>`, `chooseCompiler(): Promise<Toolchain | null>`, `build(projectDir: string, kind: BuildKind): Promise<BuildResult>`, `onBuildOutput(cb: (line: BuildOutputLine) => void): () => void`
- Produces (`MenuCommand` additions): `'project.build' | 'project.rebuild' | 'project.clean' | 'window.compilerLocation'`
- Produces (`AppState` additions): `building: boolean`, `diagnostics: Diagnostic[]`, `reveal: { path: string; line: number; seq: number } | null`, `build(kind: BuildKind): Promise<BuildResult | null>`, `chooseCompiler(): Promise<void>`, `openAt(path: string, line: number): Promise<void>`, `appendBuildOutput(line: BuildOutputLine): void`, and `buildConsoleName(projectDir: string): string` (exported function).
- Behaviour change: `openFile` also selects the project that contains the file. `init` prints a second banner line with the compiler status.

- [ ] **Step 1: Extend the store tests (failing)**

In `tests/unit/store.test.ts`:

1. Change the import line to
```ts
import type { BuildKind, BuildResult, Diagnostic, FileNode, LabsimApi, MenuCommand, ProjectInfo, Toolchain } from '@shared/api'
import { buildConsoleName, createAppStore, isDirty, MAIN_CONSOLE, type AppStore } from '../../src/renderer/src/store'
```
2. In `fakeApi()`, add these fields to the returned object and its type (`& { buildCalls: [string, BuildKind][]; nextBuild: BuildResult; toolchain: Toolchain | null }`):
```ts
    buildCalls: [] as [string, BuildKind][],
    nextBuild: { ok: true, diagnostics: [], image: null } as BuildResult,
    toolchain: { root: 'C:\\ti\\cgt', version: '8.3.12', cl6x: 'C:\\ti\\cgt\\bin\\cl6x.exe' } as Toolchain | null,
    getToolchain: async () => api.toolchain,
    chooseCompiler: async () => api.toolchain,
    build: async (dir: string, kind: BuildKind) => {
      api.buildCalls.push([dir, kind])
      return api.nextBuild
    },
    onBuildOutput: () => () => {},
```
3. Replace the `init` test body's last assertion with:
```ts
    expect(s.consoles[MAIN_CONSOLE].map((l) => l.text)).toEqual([
      `Workspace: ${WS} (1 project)`,
      'C6000 compiler: C:\\ti\\cgt (v8.3.12)'
    ])
```
4. Append:
```ts
describe('compiler status', () => {
  it('warns at startup when cl6x is missing', async () => {
    api = fakeApi()
    api.toolchain = null
    store = createAppStore(api)
    await store.getState().init()
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)).toMatchObject({ kind: 'error' })
    expect(store.getState().consoles[MAIN_CONSOLE].at(-1)?.text).toContain('not found')
  })
})

describe('build', () => {
  const ERR: Diagnostic = { file: MAIN, line: 2, severity: 'error', code: '20', message: 'identifier "y" is undefined' }

  it('saves modified files, then builds the selected project into its build console', async () => {
    await store.getState().openFile(MAIN)
    store.getState().editTab(MAIN, 'changed')
    api.nextBuild = { ok: false, diagnostics: [ERR], image: null }
    const r = await store.getState().build('build')
    expect(api.files[MAIN]).toBe('changed')
    expect(api.buildCalls).toEqual([[P, 'build']])
    expect(r?.ok).toBe(false)
    const s = store.getState()
    expect(s.diagnostics).toEqual([ERR])
    expect(s.building).toBe(false)
    expect(s.activeConsole).toBe(buildConsoleName(P))
    expect(s.bottomTab).toBe('console')
  })
  it('clears the previous build console and appends streamed lines', async () => {
    const name = buildConsoleName(P)
    expect(name).toBe('CDT Build Console [exp11]')
    store.getState().print(name, 'old')
    const pending = store.getState().build('build')
    store.getState().appendBuildOutput({ console: name, text: '<Linking>', kind: 'out' })
    await pending
    expect(store.getState().consoles[name].map((l) => l.text)).toEqual(['<Linking>'])
  })
  it('does nothing without a selected project', async () => {
    store.setState({ selectedProject: null })
    expect(await store.getState().build('build')).toBeNull()
    expect(api.buildCalls).toEqual([])
  })
})

describe('navigation', () => {
  it('opening a file selects its project', async () => {
    store.setState({ selectedProject: null })
    await store.getState().openFile(MAIN)
    expect(store.getState().selectedProject).toBe(P)
  })
  it('openAt opens the file and requests a reveal of the line', async () => {
    await store.getState().openAt(MAIN, 7)
    await store.getState().openAt(MAIN, 9)
    expect(store.getState().activeTab).toBe(MAIN)
    expect(store.getState().reveal).toEqual({ path: MAIN, line: 9, seq: 2 })
  })
})
```

Run: `npx vitest run store`
Expected: FAIL (type errors surface as `buildConsoleName is not a function` / missing fields).

- [ ] **Step 2: Shared API**

Replace `src/shared/api.ts` with:
```ts
import type { BuildKind, BuildOutputLine, BuildResult, Toolchain } from './build'

export type { BuildKind, BuildOutputLine, BuildResult, Diagnostic, Toolchain } from './build'

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
  | 'project.build'
  | 'project.rebuild'
  | 'project.clean'
  | 'window.editPerspective'
  | 'window.debugPerspective'
  | 'window.compilerLocation'

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
  getToolchain(): Promise<Toolchain | null>
  /** Folder picker for the C6000 CGT root; resolves to the toolchain now in use (null if none). */
  chooseCompiler(): Promise<Toolchain | null>
  build(projectDir: string, kind: BuildKind): Promise<BuildResult>
  onBuildOutput(cb: (line: BuildOutputLine) => void): () => void
}

declare global {
  interface Window {
    labsim: LabsimApi
  }
}
```

- [ ] **Step 3: Main process**

`src/main/settings.ts`: change the interface to
```ts
export interface Settings {
  workspace?: string
  /** C6000 CGT root chosen by the user; auto-detected when absent. */
  compilerRoot?: string
}
```

Replace `src/main/ipc.ts` with:
```ts
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import * as path from 'path'
import type { BuildKind, BuildOutputLine, Toolchain } from '@shared/build'
import type { ProgramImage } from '@shared/program'
import { runBuild } from './build/builder'
import { toolchainAt } from './build/toolchain'
import { assertInside, listProjects, readTextFile, readTree, writeTextFile } from './workspace'

export interface IpcContext {
  getWorkspace(): string
  setWorkspace(dir: string): Promise<void>
  getWindow(): BrowserWindow | null
  getToolchain(): Toolchain | null
  setCompilerRoot(root: string): Promise<Toolchain | null>
  /** Latest successful link per project dir; the debugger (Step 5) loads from here. */
  images: Map<string, ProgramImage>
}

export function registerIpc(ctx: IpcContext): void {
  const pickFolder = async (title: string): Promise<string | null> => {
    const win = ctx.getWindow()
    const options = { title, properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  }

  ipcMain.handle('ws:get', () => ctx.getWorkspace())
  ipcMain.handle('ws:switch', async () => {
    const dir = await pickFolder('Select Workspace')
    if (dir) await ctx.setWorkspace(dir)
    return dir
  })
  ipcMain.handle('ws:projects', () => listProjects(ctx.getWorkspace()))
  ipcMain.handle('ws:tree', (_e, dir: string) => readTree(assertInside(ctx.getWorkspace(), dir)))
  ipcMain.handle('fs:read', (_e, p: string) => readTextFile(ctx.getWorkspace(), p))
  ipcMain.handle('fs:write', (_e, p: string, content: string) => writeTextFile(ctx.getWorkspace(), p, content))

  ipcMain.handle('build:toolchain', () => ctx.getToolchain())
  ipcMain.handle('build:chooseCompiler', async () => {
    const dir = await pickFolder('Select the C6000 compiler folder (ti-cgt-c6000_x.y.z)')
    if (!dir) return ctx.getToolchain()
    if (!(await toolchainAt(dir))) throw new Error(`${dir} does not contain bin\\cl6x.exe`)
    return ctx.setCompilerRoot(dir)
  })

  let building = false
  ipcMain.handle('build:run', async (_e, projectDir: string, kind: BuildKind) => {
    const dir = assertInside(ctx.getWorkspace(), projectDir)
    if (building) throw new Error('A build is already running.')
    building = true
    const consoleName = `CDT Build Console [${path.basename(dir)}]`
    try {
      const result = await runBuild({
        projectDir: dir,
        kind,
        toolchain: ctx.getToolchain(),
        onOutput: (text, lineKind) => {
          const line: BuildOutputLine = { console: consoleName, text, kind: lineKind }
          ctx.getWindow()?.webContents.send('build:output', line)
        }
      })
      if (result.image) ctx.images.set(dir, result.image)
      else ctx.images.delete(dir)
      return result
    } finally {
      building = false
    }
  })
}
```

In `src/main/menu.ts`, replace the `Project` entry and the `Window` entry with:
```ts
    {
      label: 'Project',
      submenu: [
        { label: 'Build Project', accelerator: 'CmdOrCtrl+B', click: send('project.build') },
        { label: 'Rebuild Project', click: send('project.rebuild') },
        { label: 'Clean...', click: send('project.clean') }
      ]
    },
```
```ts
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
        { label: 'Preferences', submenu: [{ label: 'C6000 Compiler Location...', click: send('window.compilerLocation') }] },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' }
      ]
    }
```

In `src/main/index.ts`:
- add imports:
```ts
import type { Toolchain } from '@shared/build'
import type { ProgramImage } from '@shared/program'
import { findToolchain } from './build/toolchain'
```
- after `let workspace = ''` add:
```ts
let toolchain: Toolchain | null = null
const images = new Map<string, ProgramImage>()
```
- replace the `whenReady` body with:
```ts
void app.whenReady().then(async () => {
  const settings = await loadSettings(settingsFile())
  workspace = await resolveWorkspace(settings, homedir(), process.env.LABSIM_WORKSPACE)
  toolchain = await findToolchain(process.env.LABSIM_COMPILER_ROOT ?? settings.compilerRoot)
  registerIpc({
    getWorkspace: () => workspace,
    setWorkspace: async (dir) => {
      workspace = dir
      await saveSettings(settingsFile(), { ...(await loadSettings(settingsFile())), workspace: dir })
    },
    getWindow: () => mainWindow,
    getToolchain: () => toolchain,
    setCompilerRoot: async (root) => {
      toolchain = await findToolchain(root)
      await saveSettings(settingsFile(), { ...(await loadSettings(settingsFile())), compilerRoot: root })
      return toolchain
    },
    images
  })
  buildMenu(() => mainWindow)
  mainWindow = createWindow()
})
```
(`LABSIM_COMPILER_ROOT` lets e2e tests simulate a missing compiler by pointing it at an empty folder.)

In `src/preload/index.ts`, extend the imports and the `api` object:
```ts
import type { BuildOutputLine, LabsimApi, MenuCommand } from '@shared/api'
```
```ts
  getToolchain: () => ipcRenderer.invoke('build:toolchain'),
  chooseCompiler: () => ipcRenderer.invoke('build:chooseCompiler'),
  build: (projectDir, kind) => ipcRenderer.invoke('build:run', projectDir, kind),
  onBuildOutput(cb) {
    const handler = (_e: IpcRendererEvent, line: BuildOutputLine): void => cb(line)
    ipcRenderer.on('build:output', handler)
    return () => ipcRenderer.removeListener('build:output', handler)
  },
```

- [ ] **Step 4: Renderer store**

In `src/renderer/src/store.ts`:
- change the imports to
```ts
import { createStore } from 'zustand/vanilla'
import type { BuildKind, BuildOutputLine, BuildResult, Diagnostic, FileNode, LabsimApi, ProjectInfo } from '@shared/api'
import { basename, isTextFile } from '@shared/files'
```
- add after `isDirty`:
```ts
export const buildConsoleName = (projectDir: string): string => `CDT Build Console [${basename(projectDir)}]`

const inside = (dir: string, file: string): boolean =>
  file.toLowerCase().startsWith(dir.toLowerCase() + '\\') || file.toLowerCase().startsWith(dir.toLowerCase() + '/')
```
- add to `AppState` (fields, then actions):
```ts
  building: boolean
  diagnostics: Diagnostic[]
  /** Editor request to show a line; seq changes on every request. */
  reveal: { path: string; line: number; seq: number } | null
```
```ts
  build(kind: BuildKind): Promise<BuildResult | null>
  chooseCompiler(): Promise<void>
  openAt(path: string, line: number): Promise<void>
  appendBuildOutput(line: BuildOutputLine): void
```
- add initial values `building: false, diagnostics: [], reveal: null,` next to `bottomTab: 'console',`
- replace `init` with:
```ts
    async init() {
      const workspace = await api.getWorkspace()
      const projects = await api.listProjects()
      set({ workspace, projects, trees: {}, expanded: {}, selectedProject: projects[0]?.dir ?? null })
      const n = projects.length
      get().print(MAIN_CONSOLE, `Workspace: ${workspace} (${n} project${n === 1 ? '' : 's'})`, 'info')
      const tc = await api.getToolchain()
      if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version})`, 'info')
      else get().print(MAIN_CONSOLE, 'C6000 compiler (cl6x) not found. Set it in Window > Preferences > C6000 Compiler Location.', 'error')
    },
```
- in `openFile`, just before the final `set((s) => ({ tabs: [...`, add:
```ts
      const owner = get().projects.find((p) => inside(p.dir, path))
      if (owner) set({ selectedProject: owner.dir })
```
and do the same selection in the early-return branch (tab already open) before `set({ activeTab: path })`.
- add the new actions before `setBottomTab`:
```ts
    async build(kind) {
      const dir = get().selectedProject
      if (!dir || get().building) return null
      await get().saveAll()
      const consoleName = buildConsoleName(dir)
      set((s) => ({ building: true, consoles: { ...s.consoles, [consoleName]: [] }, activeConsole: consoleName, bottomTab: 'console' }))
      try {
        const result = await api.build(dir, kind)
        set({ diagnostics: result.diagnostics })
        return result
      } catch (e) {
        get().print(consoleName, `Build failed: ${String(e)}`, 'error')
        return null
      } finally {
        set({ building: false })
      }
    },

    async chooseCompiler() {
      try {
        const tc = await api.chooseCompiler()
        if (tc) get().print(MAIN_CONSOLE, `C6000 compiler: ${tc.root} (v${tc.version})`, 'info')
      } catch (e) {
        get().print(MAIN_CONSOLE, String(e), 'error')
      }
    },

    async openAt(path, line) {
      await get().openFile(path)
      if (get().activeTab !== path) return
      set((s) => ({ reveal: { path, line, seq: (s.reveal?.seq ?? 0) + 1 } }))
    },

    appendBuildOutput(line) {
      get().print(line.console, line.text, line.kind)
    },
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npm test` then `npm run typecheck`.
Expected: all unit tests pass (store now has 18 tests); typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: build IPC, Project menu, compiler location and renderer build state"
```

---

### Task 6: Build UI: toolbar, console colours, Problems view, editor markers

**Files:**
- Modify: `src/renderer/src/components/Toolbar.tsx`, `ProblemsView.tsx`, `EditorArea.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`
- Modify: `tests/e2e/shell.spec.ts` (the Step 1 "disabled" test)
- Test: `tests/e2e/build.spec.ts`

**Interfaces:**
- Consumes: store additions from Task 5; `toModelPath` (Step 1).
- Produces: DOM hooks `.problems-row` (one per diagnostic, `data-severity`), `.problems-group` headers `Errors (n items)` / `Warnings (n items)` / `Infos (n items)`, toolbar Build button enabled when a project is selected and no build is running.

- [ ] **Step 1: Update the Step 1 e2e test and write the failing build e2e test**

In `tests/e2e/shell.spec.ts`, replace the test `build and debug buttons are present but disabled in this step` with:
```ts
test('build is enabled; debug stays disabled until the debugger exists', async () => {
  await expect(page.getByTitle('Build Project (Ctrl+B)')).toBeEnabled()
  await expect(page.getByTitle('Debug (F11)')).toBeDisabled()
})
```

`tests/e2e/build.spec.ts`:
```ts
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
    await expect(page.locator('.monaco-editor .current-line')).toBeVisible()
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

test('explains a missing compiler', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'labsim-nocgt-'))
  await launch({ LABSIM_COMPILER_ROOT: empty })
  await expect(page.locator('.console .cl-error')).toContainText('C6000 compiler (cl6x) not found')
  await row('alpha_good').click()
  await page.getByTitle('Build Project (Ctrl+B)').click()
  await expect(page.locator('.console')).toContainText('**** Build Finished ****')
  await page.getByRole('button', { name: 'Problems' }).click()
  await expect(page.locator('.problems-row[data-severity="error"]')).toContainText('C6000 compiler (cl6x) not found')
})
```

Run: `npm run test:e2e`
Expected: the new build tests FAIL (the Build button is disabled or Problems shows no rows). The Step 1 tests still pass.

- [ ] **Step 2: Toolbar Build button**

In `src/renderer/src/components/Toolbar.tsx`, inside `Toolbar()` add:
```ts
  const canBuild = useApp((s) => s.selectedProject !== null && !s.building)
```
and replace the Build button line with:
```tsx
      <TbButton title="Build Project (Ctrl+B)" disabled={!canBuild} onClick={() => void st.build('build')}><HammerIcon /></TbButton>
```

- [ ] **Step 3: Problems view**

Replace `src/renderer/src/components/ProblemsView.tsx` with:
```tsx
import { useState, type JSX } from 'react'
import type { Diagnostic } from '@shared/api'
import { basename } from '@shared/files'
import { appStore, useApp } from '../appStore'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function folderOf(workspace: string, file: string | null): string {
  if (!file) return ''
  const dir = file.slice(0, Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')))
  return (dir.startsWith(workspace) ? dir.slice(workspace.length) : dir).replace(/\\/g, '/') || '/'
}

function Group({ title, items, workspace }: { title: string; items: Diagnostic[]; workspace: string }): JSX.Element | null {
  const [open, setOpen] = useState(true)
  if (items.length === 0) return null
  return (
    <>
      <tr className="problems-group" onClick={() => setOpen(!open)}>
        <td colSpan={5}>{open ? '▾' : '▸'} {title} ({plural(items.length, 'item')})</td>
      </tr>
      {open &&
        items.map((d, i) => (
          <tr
            key={i}
            className="problems-row"
            data-severity={d.severity}
            onDoubleClick={() => {
              if (d.file && d.line) void appStore.getState().openAt(d.file, d.line)
            }}
          >
            <td className={`sev sev-${d.severity}`}>#{d.code} {d.message}</td>
            <td>{d.file ? basename(d.file) : ''}</td>
            <td>{folderOf(workspace, d.file)}</td>
            <td>{d.line ? `line ${d.line}` : ''}</td>
            <td>C/C++ Problem</td>
          </tr>
        ))}
    </>
  )
}

export function ProblemsView(): JSX.Element {
  const diags = useApp((s) => s.diagnostics)
  const workspace = useApp((s) => s.workspace)
  const errors = diags.filter((d) => d.severity === 'error')
  const warnings = diags.filter((d) => d.severity === 'warning')
  const infos = diags.filter((d) => d.severity === 'remark')
  return (
    <div className="table-wrap">
      <div className="table-caption">
        {plural(errors.length, 'error')}, {plural(warnings.length, 'warning')}, {plural(infos.length, 'other')}
      </div>
      <table className="grid">
        <thead>
          <tr><th>Description</th><th>Resource</th><th>Path</th><th>Location</th><th>Type</th></tr>
        </thead>
        <tbody>
          <Group title="Errors" items={errors} workspace={workspace} />
          <Group title="Warnings" items={warnings} workspace={workspace} />
          <Group title="Infos" items={infos} workspace={workspace} />
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Editor markers and reveal**

In `src/renderer/src/components/EditorArea.tsx`:
- change the React import to `import { useCallback, useEffect, useRef, type JSX } from 'react'` and add `import type { editor as MonacoEditor } from 'monaco-editor'`.
- add below `toModelPath`:
```ts
const samePath = (a: string, b: string): boolean => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()
```
- inside `EditorArea()`, after `const st = appStore.getState()`, add:
```ts
  const diagnostics = useApp((s) => s.diagnostics)
  const reveal = useApp((s) => s.reveal)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const revealedSeq = useRef(0)

  const applyMarkers = useCallback(() => {
    for (const t of appStore.getState().tabs) {
      const model = monaco.editor.getModel(monaco.Uri.parse(toModelPath(t.path)))
      if (!model) continue
      const markers = diagnostics
        .filter((d) => d.file && d.line && samePath(d.file, t.path) && d.line <= model.getLineCount())
        .map((d) => ({
          severity:
            d.severity === 'error' ? monaco.MarkerSeverity.Error : d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
          message: `#${d.code} ${d.message}`,
          startLineNumber: d.line as number,
          endLineNumber: d.line as number,
          startColumn: model.getLineFirstNonWhitespaceColumn(d.line as number) || 1,
          endColumn: model.getLineMaxColumn(d.line as number)
        }))
      monaco.editor.setModelMarkers(model, 'cl6x', markers)
    }
  }, [diagnostics])

  const applyReveal = useCallback(() => {
    const ed = editorRef.current
    const r = appStore.getState().reveal
    if (!ed || !r || r.seq === revealedSeq.current || !samePath(r.path, appStore.getState().activeTab ?? '')) return
    revealedSeq.current = r.seq
    ed.revealLineInCenter(r.line)
    ed.setPosition({ lineNumber: r.line, column: 1 })
    ed.focus()
  }, [])

  useEffect(applyMarkers, [applyMarkers, tabs, active])
  useEffect(applyReveal, [applyReveal, reveal, active])
```
- replace `onMount` with:
```ts
  const onMount: OnMount = (editor, m) => {
    editorRef.current = editor
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void appStore.getState().saveTab())
    applyMarkers()
    applyReveal()
  }
```
- add `onMount` re-application when the active model changes: in the `<Editor>` props nothing changes (`@monaco-editor/react` keeps one editor instance and swaps models, so the two effects above cover tab switches).

- [ ] **Step 5: App wiring and styles**

In `src/renderer/src/App.tsx`:
- in `handleMenu`, add cases:
```ts
    case 'project.build': void s.build('build'); break
    case 'project.rebuild': void s.build('rebuild'); break
    case 'project.clean': void s.build('clean'); break
    case 'window.compilerLocation': void s.chooseCompiler(); break
```
- replace the first `useEffect` with:
```ts
  useEffect(() => {
    void appStore.getState().init()
    const offMenu = window.labsim.onMenu(handleMenu)
    const offBuild = window.labsim.onBuildOutput((line) => appStore.getState().appendBuildOutput(line))
    return () => {
      offMenu()
      offBuild()
    }
  }, [])
```

Append to `src/renderer/src/styles.css`:
```css
.problems-group td { font-weight: 600; cursor: pointer; background: #f7f9fb; }
.problems-row { cursor: default; }
.problems-row:hover { background: #eef3f9; }
.sev::before { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; content: ''; vertical-align: -1px; }
.sev-error::before { background: #c9302c; }
.sev-warning::before { background: #d9a400; }
.sev-remark::before { background: #3a6ea5; }
```

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: typecheck exits 0; all unit tests pass; e2e: 7 shell + 4 build = 11 passed.

- [ ] **Step 7: Try it on the real workspace (read-only for sources)**

Run: `npm run dev`. Select `exp11` and press the hammer. The console shows the CCS-format build and `Finished building target: "exp11.out"`. Build again and it says `'exp11.out' is up to date.`. Building writes only to `exp11/.labsim/`; the sources and CCS's `Debug/` folder stay untouched. Check with the same before/after mtime diff used in Step 1, ignoring `.labsim`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(renderer): Build button, CCS Problems view, editor error markers"
```
