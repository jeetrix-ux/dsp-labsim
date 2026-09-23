import * as path from 'path'

const norm = (p: string): string => path.win32.resolve(p).toLowerCase()

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
