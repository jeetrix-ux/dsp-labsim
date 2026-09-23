import type { MemoryRegion } from '@shared/program'

export interface LinkerCommandFile {
  memory: MemoryRegion[]
  /** Output sections and the MEMORY region each is placed in, in file order. */
  sections: { name: string; region: string }[]
}

function block(src: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*\\{`).exec(src)
  if (!m) return ''
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(m.index + m[0].length, i)
  }
  return src.slice(m.index + m[0].length)
}

function num(s: string): number {
  if (/^0x/i.test(s)) return parseInt(s, 16)
  if (/k$/i.test(s)) return parseInt(s, 10) * 1024
  if (/h$/i.test(s)) return parseInt(s.slice(0, -1), 16)
  return Number(s)
}

/** Reads MEMORY and SECTIONS from a TI linker command file (the forms CCS templates use). */
export function parseLinkerCommandFile(text: string): LinkerCommandFile {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
  const memory: MemoryRegion[] = []
  const region = /(\w+)\s*(?:\(\s*(\w+)\s*\))?\s*:?\s*(?:org|origin|o)\s*=\s*(\w+)\s*,?\s*(?:len|length|l)\s*=\s*(\w+)/gi
  for (const m of block(src, 'MEMORY').matchAll(region)) {
    memory.push({ name: m[1], origin: num(m[3]), length: num(m[4]), attr: (m[2] ?? 'RWIX').toUpperCase() })
  }
  const sections: { name: string; region: string }[] = []
  const placement = /([.\w$]+)\s*(?::\s*)?(?:(?:load|run)\s*=?\s*)?>\s*(\w+)/g
  for (const m of block(src, 'SECTIONS').matchAll(placement)) sections.push({ name: m[1], region: m[2] })
  return { memory, sections }
}
