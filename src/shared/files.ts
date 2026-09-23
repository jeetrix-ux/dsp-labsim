const TEXT_EXTENSIONS = new Set([
  '.c', '.h', '.cmd', '.asm', '.s', '.gel', '.txt', '.md', '.map', '.json', '.dat', '.csv', '.xml', '.ccxml', '.mk', '.opt'
])

export function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i).toLowerCase()
}

export function isTextFile(p: string): boolean {
  return TEXT_EXTENSIONS.has(extname(p))
}

export function languageFor(p: string): 'c' | 'plaintext' {
  const e = extname(p)
  return e === '.c' || e === '.h' ? 'c' : 'plaintext'
}
