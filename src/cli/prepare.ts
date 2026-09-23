import { promises as fs } from 'fs'
import * as path from 'path'
import type { ProgramImage } from '@shared/program'
import type { TranslationUnit } from '../interp/frontend/ast'
import { compileUnit, linkProgram, type Program } from '../interp/frontend/program'
import { FALLBACK_CGT, frontendOptions, renderDiagnostic } from '../main/build/fallback'
import { layoutProgram } from '../main/build/fallbackImage'
import { parseLinkerCommandFile } from '../main/build/linkerCmd'
import { defaultConfig, readBuildConfig } from '../main/build/projectConfig'
import { findSources } from '../main/build/sources'
import { DEFAULT_CMD } from './defaultCmd'

export type Prepared =
  | { ok: true; program: Program; image: ProgramImage; dir: string }
  | { ok: false; messages: string[]; dir: string }

/**
 * Builds a project folder or a single .c file the way the fallback build does (LabSim's front-end and the synthetic
 * linker), without writing anything. `rewrite` changes a source's text in memory, e.g. to select a lab experiment.
 */
export async function prepare(target: string, opts: { rewrite?: (file: string, text: string) => string } = {}): Promise<Prepared> {
  const isFile = (await fs.stat(target)).isFile()
  const dir = isFile ? path.dirname(target) : target
  const cfg = isFile ? defaultConfig(path.basename(target, '.c'), dir, FALLBACK_CGT) : await readBuildConfig(dir, FALLBACK_CGT)
  const sources = isFile ? [target] : await findSources(dir)
  if (sources.length === 0) return { ok: false, messages: [`LabSim: no C source files in ${dir}`], dir }
  const base = frontendOptions(cfg, FALLBACK_CGT)
  const rewrite = opts.rewrite
  const options = rewrite
    ? {
        ...base,
        readFile: (f: string): string | null => {
          const text = base.readFile(f)
          return text === null ? null : rewrite(f, text)
        }
      }
    : base
  const messages: string[] = []
  const units: TranslationUnit[] = []
  for (const src of sources) {
    const r = compileUnit(src, options)
    for (const d of r.diagnostics) if (d.severity === 'error') messages.push(renderDiagnostic(d, dir))
    if (r.unit) units.push(r.unit)
  }
  if (units.length < sources.length) return { ok: false, messages, dir }
  const link = linkProgram(units)
  if (!link.program) {
    return {
      ok: false,
      messages: link.problems.map((p) => (p.kind === 'unresolved' ? `LabSim: unresolved symbol ${p.name}` : `LabSim: symbol ${p.name} is defined twice`)),
      dir
    }
  }
  const cmdText = !isFile && cfg.linkerCommandFile ? await fs.readFile(path.join(dir, cfg.linkerCommandFile), 'utf8') : DEFAULT_CMD
  const layout = layoutProgram(link.program, parseLinkerCommandFile(cmdText), {
    heapSize: Number(cfg.heapSize),
    stackSize: Number(cfg.stackSize),
    outFile: ''
  })
  if (!layout.image) return { ok: false, messages: [layout.error], dir }
  return { ok: true, program: link.program, image: layout.image, dir }
}
