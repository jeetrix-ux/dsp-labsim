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
