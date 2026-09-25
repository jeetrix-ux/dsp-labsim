import * as path from 'path'

/** Windows paths compare in any case; macOS keeps the path as the dialog returned it. */
const norm = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))

/** Paths the user picked in a save dialog: the only files the renderer may write outside the workspace. */
export class ChosenFiles {
  private readonly paths = new Set<string>()

  add(p: string): void {
    this.paths.add(norm(p))
  }

  assert(p: string): string {
    if (!this.paths.has(norm(p))) throw new Error(`${p} was not chosen in a save dialog`)
    return p
  }
}
