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
    // '$C$SL1' and similar are compiler-generated (string literals), not user variables.
    else if (s.bind === STB.LOCAL && isDefinedData(s) && !s.name.startsWith('$') && s.fileId && sourceOf.has(s.fileId)) {
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
