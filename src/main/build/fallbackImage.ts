import type { ProgramImage, SectionInfo, SymbolInfo } from '@shared/program'
import type { VarSym } from '../../interp/frontend/ast'
import { isBuiltinFile } from '../../interp/frontend/preprocessor'
import type { Program } from '../../interp/frontend/program'
import { alignOf, alignUp, isAggregate, sizeOf, type Type } from '../../interp/frontend/types'
import type { LinkerCommandFile } from './linkerCmd'

/** Code size assumed for .text: LabSim generates no code; this is about the size of a program that uses printf. */
export const TEXT_ESTIMATE = 0x7000
const CIO_SIZE = 0x120
const NOBITS = new Set(['.stack', '.sysmem', '.bss', '.far', '.cio'])

export type Layout = { image: ProgramImage; error: null } | { image: null; error: string }

const isConstObject = (t: Type): boolean => (t.kind === 'array' ? isConstObject(t.of) : !!t.const && !t.volatile)

/** The section cl6x (EABI, far aggregates) puts an object in. */
export function sectionOf(v: VarSym): string {
  if (isConstObject(v.type)) return '.const'
  if (isAggregate(v.type)) return v.init ? '.fardata' : '.far'
  return v.init ? '.neardata' : '.bss'
}

/** Lays the program's data out the way the TI linker would, in the regions the .cmd file names. */
export function layoutProgram(program: Program, cmd: LinkerCommandFile, opts: { heapSize: number; stackSize: number; outFile: string }): Layout {
  const sizes = new Map<string, number>([['.text', TEXT_ESTIMATE], ['.stack', opts.stackSize], ['.sysmem', opts.heapSize], ['.cio', CIO_SIZE]])
  const placed: { sym: VarSym; section: string; offset: number }[] = []
  for (const u of program.units) {
    for (const v of u.objects) {
      if (!v.defined || v.storage === 'extern' || isBuiltinFile(v.loc.file)) continue
      if (v.external && program.globals.get(v.name) !== v) continue
      const section = sectionOf(v)
      const align = Math.max(alignOf(v.type), isAggregate(v.type) && sizeOf(v.type) >= 8 ? 8 : 1)
      const offset = alignUp(sizes.get(section) ?? 0, align)
      sizes.set(section, offset + sizeOf(v.type))
      placed.push({ sym: v, section, offset })
    }
  }

  const defaultRegion = cmd.sections[0]?.region ?? cmd.memory[0]?.name
  const order = [...cmd.sections.map((s) => s.name), ...[...sizes.keys()].filter((n) => !cmd.sections.some((s) => s.name === n))]
  const cursor = new Map(cmd.memory.map((m) => [m.name, m.origin]))
  const sections: SectionInfo[] = []
  for (const name of order) {
    const size = sizes.get(name)
    if (!size || sections.some((s) => s.name === name)) continue
    const regionName = cmd.sections.find((s) => s.name === name)?.region ?? defaultRegion
    const region = cmd.memory.find((m) => m.name === regionName)
    if (!region) return { image: null, error: `error #10099-D: program will not fit into available memory.  no memory region for section "${name}"` }
    const addr = alignUp(cursor.get(region.name) as number, 8)
    const end = region.origin + region.length
    if (addr + size > end) {
      const free = Math.max(0, end - addr).toString(16)
      return {
        image: null,
        error: `error #10099-D: program will not fit into available memory.  placement fails for section "${name}" size 0x${size.toString(16)} page 0.  Available memory ranges:  ${region.name} size: 0x${region.length.toString(16)} unused: 0x${free} max hole: 0x${free}`
      }
    }
    cursor.set(region.name, addr + size)
    sections.push({ name, addr, size, nobits: NOBITS.has(name) })
  }

  const base = (name: string): number => sections.find((s) => s.name === name)?.addr ?? 0
  const globals: Record<string, SymbolInfo> = {}
  const statics: Record<string, Record<string, SymbolInfo>> = {}
  for (const u of program.units) statics[u.file] = {}
  for (const p of placed) {
    const info: SymbolInfo = { name: p.sym.linkName, addr: base(p.section) + p.offset, size: sizeOf(p.sym.type), section: p.section, kind: 'object' }
    if (p.sym.external) globals[p.sym.name] = info
    else statics[p.sym.file][p.sym.linkName] = info
  }
  const text = base('.text')
  globals._c_int00 = { name: '_c_int00', addr: text, size: 0, section: '.text', kind: 'func' }
  let fnAddr = text + 0x100
  for (const name of [...program.functions.keys()].sort()) {
    globals[name] = { name, addr: fnAddr, size: 0, section: '.text', kind: 'func' }
    fnAddr += 0x100
  }
  globals['C$$EXIT'] = { name: 'C$$EXIT', addr: text + TEXT_ESTIMATE - 0x20, size: 0, section: '.text', kind: 'func' }
  const range = (name: string): { start: number; size: number } => {
    const s = sections.find((x) => x.name === name)
    return s ? { start: s.addr, size: s.size } : { start: 0, size: 0 }
  }
  return {
    image: { outFile: opts.outFile, entry: text, memory: cmd.memory, sections, globals, statics, stack: range('.stack'), heap: range('.sysmem') },
    error: null
  }
}
