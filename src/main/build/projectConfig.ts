import { promises as fs } from 'fs'
import * as path from 'path'
import { SIZE, SYMBOL } from '@shared/newProject'

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
  /** C89 (cl6x's default, relaxed) or C99 (--c99), from the project's C_DIALECT option. */
  dialect: 'c89' | 'c99'
  /** Problems found in labsim.json; the builds print them. */
  notes?: string[]
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
    linkerCommandFile: null,
    dialect: 'c89'
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
  cfg.includePaths = list('INCLUDE_PATH')?.map(expand) ?? cfg.includePaths
  cfg.diagWarnings = list('DIAG_WARNING') ?? cfg.diagWarnings
  cfg.heapSize = value('HEAP_SIZE') ?? cfg.heapSize
  cfg.stackSize = value('STACK_SIZE') ?? cfg.stackSize
  cfg.libraries = list('LIBRARY') ?? cfg.libraries
  cfg.searchPaths = list('SEARCH_PATH')?.map(expand) ?? cfg.searchPaths
  const opt = value('OPT_LEVEL')?.split('.').pop() ?? null
  cfg.optLevel = opt !== null && /^[0-4]$/.test(opt) ? opt : null
  const tag = (list('OPT_TAGS') ?? []).find((t) => t.startsWith('LINKER_COMMAND_FILE='))
  cfg.linkerCommandFile = tag ? tag.slice('LINKER_COMMAND_FILE='.length) || null : null
  const dialect = value('C_DIALECT')?.split('.').pop()?.toUpperCase()
  cfg.dialect = dialect === 'C99' || dialect === 'C11' ? 'c99' : 'c89'
  return cfg
}

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
  if (files.includes(LABSIM_JSON)) {
    const notes = applyLabsimJson(cfg, await fs.readFile(path.join(projectDir, LABSIM_JSON), 'utf8'))
    if (notes.length > 0) cfg.notes = notes
  }
  return cfg
}
