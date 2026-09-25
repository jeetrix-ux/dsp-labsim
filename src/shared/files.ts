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

/** The separator a path already uses: Windows paths from the main process use '\', macOS ones '/'. */
export const pathSep = (p: string): '/' | '\\' => (p.includes('\\') ? '\\' : '/')

export function joinPath(dir: string, name: string): string {
  const sep = pathSep(dir)
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

const normPath = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

/** Same file? Ignores separators and case (NTFS and APFS are case-insensitive by default). */
export const samePath = (a: string, b: string): boolean => normPath(a) === normPath(b)

/** Monaco model URI. `Uri.parse('C:\\x')` would treat `c:` as a scheme, and POSIX paths already start with '/'. */
export function toModelPath(p: string): string {
  const f = p.replace(/\\/g, '/')
  return 'file://' + (f.startsWith('/') ? f : '/' + f)
}

export function languageFor(p: string): 'c' | 'plaintext' {
  const e = extname(p)
  return e === '.c' || e === '.h' ? 'c' : 'plaintext'
}
