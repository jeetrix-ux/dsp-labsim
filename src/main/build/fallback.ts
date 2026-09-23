import { promises as fs, readFileSync } from 'fs'
import * as path from 'path'
import type { BuildResult, Diagnostic } from '@shared/build'
import type { TranslationUnit } from '../../interp/frontend/ast'
import type { FrontDiagnostic } from '../../interp/frontend/diag'
import { isBuiltinFile } from '../../interp/frontend/preprocessor'
import { compileUnit, linkProgram, type CompileOptions, type LinkProblem } from '../../interp/frontend/program'
import { failBuild, type Emit } from './buildResult'
import { parseDiagnostics } from './diagnostics'
import { layoutProgram } from './fallbackImage'
import { parseLinkerCommandFile } from './linkerCmd'
import { readBuildConfig, type BuildConfig } from './projectConfig'
import { findSources, objectName } from './sources'

/** Stands in for the compiler root when there is no compiler, so `${CG_TOOL_ROOT}` paths stay recognisable. */
export const FALLBACK_CGT = '${CG_TOOL_ROOT}'

const fwd = (p: string): string => p.replace(/\\/g, '/')

/** The project's include paths without the compiler's own include directory: LabSim has built-in headers. */
export function userIncludePaths(cfg: BuildConfig, cgtRoot: string): string[] {
  const cgt = fwd(cgtRoot).toLowerCase()
  return cfg.includePaths.filter((p) => {
    const q = fwd(p).toLowerCase()
    return !q.startsWith(cgt) && !/\/ti-cgt-c6000[^/]*\/include\/?$/.test(q)
  })
}

function readSource(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function frontendOptions(cfg: BuildConfig, cgtRoot: string): CompileOptions {
  return { readFile: readSource, includePaths: userIncludePaths(cfg, cgtRoot), defines: cfg.defines, dialect: cfg.dialect, diagWarnings: cfg.diagWarnings }
}

/** A front-end diagnostic as cl6x prints it, with the path relative to the build directory. */
export function renderDiagnostic(d: FrontDiagnostic, outDir: string): string {
  const what = d.code === 'LABSIM' ? `error: ${d.message}` : `${d.fatal ? 'fatal error' : d.severity} #${d.code}: ${d.message}`
  if (d.line === null || d.file === null) return `At end of source: ${what}`
  const shown = isBuiltinFile(d.file) ? d.file : fwd(path.relative(outDir, d.file))
  return `"${shown}", line ${d.line}: ${what}`
}

function summary(list: FrontDiagnostic[], rel: string): string[] {
  const n = list.filter((d) => d.severity === 'error').length
  if (n === 0) return []
  const s = n === 1 ? '' : 's'
  return list.some((d) => d.fatal)
    ? [`${n} catastrophic error${s} detected in the compilation of "${rel}".`, 'Compilation terminated.']
    : [`${n} error${s} detected in the compilation of "${rel}".`]
}

/** Link problems in the TI linker's words, so parseDiagnostics reads them like real linker output. */
function renderLinkProblems(problems: LinkProblem[], layoutError: string | null, outName: string, obj: (source: string) => string): string {
  const lines: string[] = []
  for (const p of problems) {
    if (p.kind === 'redefined') lines.push(`error #10056: symbol "${p.name}" redefined: first defined in "${obj(p.first)}"; redefined in "${obj(p.second)}"`)
  }
  const unresolved = problems.filter((p): p is Extract<LinkProblem, { kind: 'unresolved' }> => p.kind === 'unresolved')
  if (unresolved.length > 0) {
    lines.push('', ' undefined first referenced', '  symbol       in file', ' --------- ----------------')
    for (const u of unresolved) lines.push(` ${u.name.padEnd(9)} ${u.file.startsWith('rts') ? u.file : obj(u.file)}`)
    lines.push('', 'error #10234-D: unresolved symbols remain')
  }
  if (layoutError) lines.push(layoutError)
  if (lines.length === 0) return ''
  lines.push(`error #10010: errors encountered during linking; "${outName}" not built`)
  return lines.join('\n')
}

export interface FallbackRequest {
  projectDir: string
  outDir: string
  name: string
  emit: Emit
}

/** Builds with LabSim's own front-end and a synthetic linker when cl6x is not installed. */
export async function runFallbackBuild({ projectDir, outDir, name, emit }: FallbackRequest): Promise<BuildResult> {
  emit('LabSim: the C6000 compiler (cl6x) was not found, so this build uses the LabSim C front-end.', 'info')
  emit("Its diagnostics follow cl6x 8.3. Choose TI's compiler in Window > Preferences to build with it.", 'info')
  emit('', 'out')
  const cfg = await readBuildConfig(projectDir, FALLBACK_CGT)
  for (const n of cfg.notes ?? []) emit(`LabSim: ${n}`, 'error')
  const sources = await findSources(projectDir)
  if (sources.length === 0) return failBuild(emit, `No C source files in project ${name}.`)
  await fs.mkdir(outDir, { recursive: true })

  const opts = frontendOptions(cfg, FALLBACK_CGT)
  const diagnostics: Diagnostic[] = []
  const units: TranslationUnit[] = []
  let failed = 0
  for (const src of sources) {
    const rel = fwd(path.relative(outDir, src))
    emit(`Building file: "${rel}"`, 'out')
    emit('Invoking: LabSim C Front-End', 'out')
    const r = compileUnit(src, opts)
    for (const d of r.diagnostics) emit(renderDiagnostic(d, outDir), 'error')
    for (const line of summary(r.diagnostics, rel)) emit(line, 'error')
    diagnostics.push(...r.diagnostics.map(({ fatal: _fatal, ...d }) => d))
    if (!r.unit) {
      failed++
      emit('>> Compilation failure', 'out')
      continue
    }
    units.push(r.unit)
    emit(`Finished building: "${rel}"`, 'out')
    emit(' ', 'out')
  }

  const outName = `${name}.out`
  if (failed > 0) {
    emit(`Build stopped: ${failed} file${failed === 1 ? '' : 's'} failed to compile; "${outName}" not built.`, 'error')
    emit('', 'out')
    emit('**** Build Finished ****', 'out')
    return { ok: false, diagnostics, image: null }
  }
  if (!cfg.linkerCommandFile) {
    const r = failBuild(emit, `No linker command file (.cmd) in project ${name}. Copy C6748.cmd from another project.`)
    return { ...r, diagnostics: [...diagnostics, ...r.diagnostics] }
  }

  emit(`Building target: "${outName}"`, 'out')
  emit('Invoking: LabSim Linker (fallback)', 'out')
  const link = linkProgram(units)
  const cmd = parseLinkerCommandFile(await fs.readFile(path.join(projectDir, cfg.linkerCommandFile), 'utf8'))
  const layout = link.program
    ? layoutProgram(link.program, cmd, { heapSize: Number(cfg.heapSize), stackSize: Number(cfg.stackSize), outFile: path.join(outDir, outName) })
    : null
  const text = renderLinkProblems(link.problems, layout && !layout.image ? layout.error : null, outName, (f) => objectName(projectDir, f))
  if (text) {
    for (const line of text.split('\n')) emit(line, 'error')
    diagnostics.push(...parseDiagnostics(text, outDir))
  }
  if (!layout?.image) {
    emit('', 'out')
    emit('**** Build Finished ****', 'out')
    return { ok: false, diagnostics, image: null }
  }
  emit(`Finished building target: "${outName}"`, 'out')
  emit(' ', 'out')
  emit('', 'out')
  emit('**** Build Finished ****', 'out')
  return { ok: true, diagnostics, image: layout.image }
}

/** After a successful cl6x build: warns when LabSim's own front-end cannot read the program, because Debug needs it. */
export function frontendCheck(sources: string[], cfg: BuildConfig, cgtRoot: string, outDir: string, emit: Emit): void {
  const opts = frontendOptions(cfg, cgtRoot)
  const problems: string[] = []
  const units: TranslationUnit[] = []
  for (const src of sources) {
    const r = compileUnit(src, opts)
    for (const d of r.diagnostics) if (d.severity === 'error') problems.push(renderDiagnostic(d, outDir))
    if (r.unit) units.push(r.unit)
  }
  if (problems.length === 0) {
    for (const p of linkProgram(units).problems) if (p.kind === 'unresolved') problems.push(`"${p.name}" is not in LabSim's runtime library yet`)
  }
  if (problems.length === 0) return
  emit("LabSim: cl6x built this program, but LabSim's own front-end cannot run it yet (Debug will not start):", 'error')
  for (const p of problems.slice(0, 5)) emit(`    ${p}`, 'error')
}
