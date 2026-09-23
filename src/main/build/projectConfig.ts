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
  /** C89 (cl6x's default, relaxed) or C99 (--c99), from the project's C_DIALECT option. */
  dialect: 'c89' | 'c99'
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
