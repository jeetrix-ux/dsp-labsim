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
