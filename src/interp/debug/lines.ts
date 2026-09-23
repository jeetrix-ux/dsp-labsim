import type { Stmt } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import type { Program } from '../frontend/program'

/** Normalised source path → sorted lines where the executor stops. */
export type StatementLines = Map<string, number[]>

/** Paths from the editor and from the compiler differ in case and slashes on Windows. */
export const fileKey = (file: string): string => file.replace(/\//g, '\\').toLowerCase()

const isVla = (t: { kind: string; vla?: unknown }): boolean => t.kind === 'array' && !!t.vla

export function statementLines(program: Program): StatementLines {
  const sets = new Map<string, Set<number>>()
  const add = (loc: Loc): void => {
    const k = fileKey(loc.file)
    let s = sets.get(k)
    if (!s) sets.set(k, (s = new Set()))
    s.add(loc.line)
  }
  const walk = (s: Stmt): void => {
    switch (s.k) {
      case 'expr':
      case 'break':
      case 'continue':
      case 'return':
      case 'goto':
        add(s.loc)
        break
      case 'decl':
        if (s.vars.some((v) => v.init || isVla(v.type))) add(s.loc)
        break
      case 'block':
        s.body.forEach(walk)
        break
      case 'if':
        add(s.loc)
        walk(s.then)
        if (s.else) walk(s.else)
        break
      case 'while':
      case 'switch':
        add(s.loc)
        walk(s.body)
        break
      case 'do':
        walk(s.body)
        add(s.test.loc)
        break
      case 'for':
        if (s.init) walk(s.init)
        add(s.loc)
        walk(s.body)
        break
      case 'case':
      case 'default':
      case 'label':
        walk(s.body)
        break
      case 'empty':
        break
    }
  }
  for (const u of program.units) {
    for (const f of u.functions) {
      walk(f.body)
      add(f.end)
    }
  }
  const out: StatementLines = new Map()
  for (const [k, s] of sets) out.set(k, [...s].sort((a, b) => a - b))
  return out
}

/** The line a breakpoint at `line` really goes to: that line or the next statement line; null when there is none. */
export function verifyLine(lines: StatementLines, file: string, line: number): number | null {
  const list = lines.get(fileKey(file))
  if (!list) return null
  return list.find((l) => l >= line) ?? null
}
