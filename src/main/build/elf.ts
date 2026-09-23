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
  const latin1 = new TextDecoder('latin1')
  const cstr = (o: number): string => {
    let end = o
    while (end < buf.length && buf[end] !== 0) end++
    return latin1.decode(buf.subarray(o, end))
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
