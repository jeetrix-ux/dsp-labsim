import { readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import * as path from 'path'
import type { HostFiles } from '../exec/machine'

/** CIO host files: the paths a program opens resolve against the project folder. */
export function nodeHostFiles(dir: string): HostFiles {
  const at = (p: string): string => path.resolve(dir, p)
  return {
    readAll: (p) => {
      try {
        return new Uint8Array(readFileSync(at(p)))
      } catch {
        return null
      }
    },
    writeAll: (p, data) => {
      try {
        writeFileSync(at(p), data)
        return true
      } catch {
        return false
      }
    },
    remove: (p) => {
      try {
        rmSync(at(p))
        return true
      } catch {
        return false
      }
    },
    rename: (a, b) => {
      try {
        renameSync(at(a), at(b))
        return true
      } catch {
        return false
      }
    }
  }
}
