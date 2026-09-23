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
  return [`-mv${cfg.silicon}`, ...(cfg.optLevel !== null ? [`-O${cfg.optLevel}`] : [])]
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
