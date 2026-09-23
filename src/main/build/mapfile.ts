import type { MemoryRegion } from '@shared/program'

export function parseMemoryConfiguration(map: string): MemoryRegion[] {
  const start = map.indexOf('MEMORY CONFIGURATION')
  if (start < 0) return []
  const regions: MemoryRegion[] = []
  const lines = map.slice(start).split(/\r?\n/)
  const row = /^\s+(\S+)\s+([0-9a-fA-F]{8})\s+([0-9a-fA-F]{8})\s+[0-9a-fA-F]{8}\s+[0-9a-fA-F]{8}\s+(\S+)/
  let seenRows = false
  for (const line of lines.slice(1)) {
    const m = row.exec(line)
    if (m) {
      regions.push({ name: m[1], origin: parseInt(m[2], 16), length: parseInt(m[3], 16), attr: m[4] })
      seenRows = true
    } else if (seenRows && line.trim() === '') {
      break
    }
  }
  return regions
}

/** "GLOBAL SYMBOLS: SORTED ALPHABETICALLY BY Name" → name → address (UNDEFED entries skipped). */
export function parseGlobalSymbols(map: string): Record<string, number> {
  const start = map.indexOf('GLOBAL SYMBOLS: SORTED ALPHABETICALLY BY Name')
  if (start < 0) return {}
  const end = map.indexOf('GLOBAL SYMBOLS: SORTED BY Symbol Address', start)
  const out: Record<string, number> = {}
  for (const line of map.slice(start, end < 0 ? undefined : end).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{8})\s+(\S+)\s*$/.exec(line)
    if (m) out[m[2]] = parseInt(m[1], 16)
  }
  return out
}
