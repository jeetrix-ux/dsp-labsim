# Step 5: Debug Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Press Debug in the app and debug the program like in CCS. The target stops at `main`. The user can resume, suspend, terminate and restart, step into, over and out, run to a line, and use breakpoints, the Debug view, Variables and Expressions (with number formats and value editing), and a CIO console with stdin.

**Architecture:**
- **Where the program runs.** Each debug session is a Node worker thread in the main process (`src/main/debug/worker.ts`). It compiles the project with LabSim's front-end and loads it at the addresses of the last successful build (`ProgramImage`). It then runs Step 4's executor under a `Debugger` (`src/interp/debug/debugger.ts`, no Electron).
- **Stepping and breakpoints.** The debugger arms the executor's statement counter: `m.limit` is the next statement for stepping and breakpoints, and every 20 000 statements otherwise. At each check it decides whether to stop.
- **Pausing and commands.** While stopped, the worker blocks in `Atomics.wait` on a `SharedArrayBuffer` command slot. It still serves read-only requests (stack frames, variables, expressions, memory), and it also polls that slot while running (Suspend, breakpoint changes, memory reads for Step 6's graphs).
- **Events and the UI.** Replies and events go back with `postMessage`. The main process forwards them to the renderer, where a `debugStore` drives the Debug perspective.

**Tech Stack:** Electron 44 + electron-vite 5 (`?nodeWorker` import for the worker), React 19, zustand 5, Monaco (glyph-margin decorations), vitest 4.1, Playwright for Electron. There are no new dependencies.

## Global Constraints

- The interpreter (`src/interp/**`) has no Electron dependency. `Debugger` and `Inspector` run in plain Node and are unit-tested there.
- Debug starts with build if needed, then load (parse, lay out memory, run static initialisers), then run to `main`, then stop there. The perspective switches to **CCS Debug**.
- The Debug view is a tree: `<project> [Code Composer Studio - Device Debugging]` → `Texas Instruments XDS100v3 USB Debug Probe_0/C674X_0 (Suspended - SW Breakpoint)` → frames such as `main() at main.c:12`.
- Toolbar and keys: Resume F8, Suspend Alt+F8, Terminate Ctrl+F2, Restart, Step Into F5, Step Over F6, Step Return F7, Run to Line Ctrl+R, and Reload (build, then restart).
- Breakpoints:
  - Double-click the gutter (the line-number or glyph margin) to toggle one.
  - A breakpoint is verified against statement lines. One on a blank or comment line moves to the next statement.
  - The Breakpoints view lists breakpoints and toggles them.
- The Variables view shows the selected frame's locals, with expandable arrays, structs and pointers.
- The Expressions view evaluates user expressions (`y`, `y[3]`, `*p`, `x[i]*2`, `&h`) against the selected frame.
  - Values are editable.
  - A number-format menu offers natural, hex, decimal, binary and char.
  - Function calls are refused.
- Console: program output goes to the `<project>:CIO` console with the prefix `[C674X_0] `. A stdin line appears whenever the program waits in `scanf`, `getchar` or `gets`.
- End of program: the target is Suspended at `C$$EXIT`, and memory stays readable (Expressions, and graphs in Step 6).
- Runtime errors (illegal access, divide by zero, stack overflow) halt the target. The message appears in the Console and the offending line is highlighted.
- Never write to `~/workspace_v12` or `~/dsp_ccs_lab`. Tests use temporary workspaces; manual checks delete any `.labsim` folder they create.
- Write files that contain backslashes with the Write/Edit tools, or a node script using `String.raw`. Never use heredocs, `sed` or Python for them.

## File map

| File | Responsibility |
|---|---|
| `src/interp/frontend/parser.ts`, `ast.ts` | `parseExpression(text, unit, locals, diags)`; `TranslationUnit.scope` keeps the file scope (typedefs, tags) |
| `src/interp/debug/lines.ts` | `statementLines(program)`, `verifyLine`, `fileKey`: which lines can hold a breakpoint |
| `src/interp/debug/format.ts` | `formatValue`, `typeName`: CCS-style value text in every number format |
| `src/interp/debug/inspect.ts` | `Inspector`: stack frames, variables, expression evaluation, children, assignment |
| `src/interp/debug/debugger.ts` | `Debugger`: entry stop, breakpoints, stepping, suspend, stdin, post-mortem requests |
| `src/shared/debug.ts` | Protocol types: `DebugCommand`, `DebugRequest`, `DebugEvent`, `FrameInfo`, `VarNode`, `DebugLaunch` |
| `src/main/debug/channel.ts` | SharedArrayBuffer command slot: `createDebugBuffer`, `CommandSender` (main), `workerChannel` (worker) |
| `src/main/debug/worker.ts` | Worker entry: compile, load, run the `Debugger` |
| `src/main/debug/launch.ts` | `debugLaunch(projectDir, image, toolchain)`: sources and compile options for the worker |
| `src/main/debug/session.ts` | `DebugSession`: owns the worker, matches replies to requests, forwards events |
| `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/menu.ts` | `debug:*` IPC, the Run menu |
| `src/renderer/src/debugStore.ts` | Session state and actions for the UI |
| `src/renderer/src/components/DebugViews.tsx`, `VariablesTable.tsx`, `BreakpointsView.tsx` | Debug view tree, Variables/Expressions tables, Breakpoints view |
| `src/renderer/src/components/EditorArea.tsx`, `Toolbar.tsx`, `ConsoleView.tsx`, `App.tsx` | Gutter breakpoints and the current line, debug buttons, stdin line, keys |
| `tests/e2e/debug.spec.ts` | Build, debug, breakpoint, step, expressions, stdin and a runtime error, in the real app |

---
### Task 1: Debugger expressions and breakpoint lines from the front-end

**Files:**
- Modify: `src/interp/frontend/ast.ts` (`TranslationUnit.scope`)
- Modify: `src/interp/frontend/parser.ts` (keep the file scope, and add `parseExpression`)
- Create: `src/interp/debug/lines.ts`
- Test: `tests/unit/interp/debug/lines.test.ts`

**Interfaces:**
- Consumes: `build` from `tests/unit/interp/exec/harness.ts`, `Diags`, and `typeToString`.
- Produces:
  - `TranslationUnit.scope: object`, the parser's file scope, which is opaque outside the parser.
  - `parseExpression(text, unit, locals, diags): Expr | null`, which parses one C expression in the unit's file scope with `locals` visible.
  - `lines.ts`: `type StatementLines = Map<string, number[]>`, `fileKey(file)`, `statementLines(program)` and `verifyLine(lines, file, line): number | null`.

Only statements that run code can hold a breakpoint. These are the statements that tick the executor's counter (Step 4, `stmt.ts`):
- an expression statement, or a declaration with an initialiser or a variable-length array;
- `if`, `while`, `for` and `switch` (their own line);
- `do` (the line of its `while (…)`);
- `break`, `continue`, `return` and `goto`;
- a function's closing brace.

A breakpoint on any other line moves to the next such line in the same file, as CCS moves it.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/debug/lines.test.ts
import { describe, expect, it } from 'vitest'
import { Diags } from '../../../../src/interp/frontend/diag'
import { parseExpression } from '../../../../src/interp/frontend/parser'
import { typeToString } from '../../../../src/interp/frontend/types'
import { fileKey, statementLines, verifyLine } from '../../../../src/interp/debug/lines'
import { build, MAIN } from '../exec/harness'

const SRC = [
  'int sq(int v)', //         1
  '{', //                     2
  '    return v * v;', //     3
  '}', //                     4
  '', //                      5
  'int main(void)', //        6
  '{', //                     7
  '    int i;', //            8
  '    int s = 0;', //        9
  '    /* comment */', //     10
  '    for (i = 0; i < 3; i++)', // 11
  '        s += sq(i);', //   12
  '    do { s--; } while (s > 100);', // 13
  '    return s;', //         14
  '}' //                      15
].join('\n')

describe('statementLines', () => {
  it('lists the lines where the executor stops, per file', () => {
    const { program } = build(SRC)
    expect(statementLines(program).get(fileKey(MAIN))).toEqual([3, 4, 9, 11, 12, 13, 14, 15])
  })

  it('moves a breakpoint on a line without code to the next statement', () => {
    const lines = statementLines(build(SRC).program)
    expect([5, 8, 10, 11, 16].map((l) => verifyLine(lines, MAIN, l))).toEqual([9, 9, 11, 11, null])
    expect(verifyLine(lines, MAIN.toUpperCase().replace(/\\/g, '/'), 12)).toBe(12)
    expect(verifyLine(lines, 'C:\\other.c', 3)).toBeNull()
  })
})

describe('parseExpression', () => {
  const { program } = build('typedef struct { float re, im; } cplx;\ncplx z;\nint g[4];\nint main(void) { int k = 2; return g[k]; }')
  const unit = program.units[0]
  const locals = program.main.locals

  it('types an expression over globals, locals and typedefs', () => {
    const diags = new Diags([])
    const e = parseExpression('g[k] * 2 + z.re', unit, locals, diags)
    expect(diags.list).toEqual([])
    expect(typeToString(e!.type)).toBe('float')
    expect(typeToString(parseExpression('(cplx *)&g', unit, [], diags)!.type)).toBe('cplx *')
  })

  it('reports cl6x errors for unknown names and bad syntax', () => {
    const d1 = new Diags([])
    parseExpression('nosuch + 1', unit, [], d1)
    expect(d1.list.map((d) => d.message)).toEqual(['identifier "nosuch" is undefined'])
    const d2 = new Diags([])
    expect(parseExpression('g[', unit, [], d2)).toBeNull()
    expect(d2.errors).toBeGreaterThan(0)
    const d3 = new Diags([])
    expect(parseExpression('1 2', unit, [], d3)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/debug/lines.test.ts`
Expected: FAIL, because `src/interp/debug/lines` and `parseExpression` do not exist.

- [ ] **Step 3: Keep the file scope and add `parseExpression`**

In `src/interp/frontend/ast.ts`, add a field to `TranslationUnit` after `pragmas: Pragma[]`:

```ts
  /** The parser's file scope (typedefs, struct tags, file-level names), for expressions typed in the debugger. */
  scope: object
```

In `src/interp/frontend/parser.ts`:
- Change `import { loc as tokLoc, type Token } from './lexer'` to `import { loc as tokLoc, tokenize, type Token } from './lexer'`.
- Replace `parseUnit` with:

```ts
export function parseUnit(tokens: Token[], opts: ParseOptions, diags: Diags): TranslationUnit {
  return new Parser(tokens, opts, diags).unit()
}

/**
 * Parses one C expression typed in the debugger (Expressions view, graph start address) in the file scope of `unit`,
 * with a function's `locals` visible. Macros are not expanded, as in CCS. Returns null after a syntax error.
 */
export function parseExpression(text: string, unit: TranslationUnit, locals: VarSym[], diags: Diags): Expr | null {
  return new Parser(tokenize(text, '<expression>'), { file: unit.file, dialect: 'c99' }, diags).standalone(unit.scope as Scope, locals)
}
```

- In `Parser.unit()`, change the returned object to include the scope:

```ts
    return {
      file: this.opts.file,
      functions: this.functions,
      objects: this.objects,
      funcs: this.funcs,
      pragmas: this.opts.pragmas ?? [],
      scope: this.file
    }
```

- Add this method to `Parser`, right after `unit()`:

```ts
  /** One expression in `file` with `locals` in an inner scope; the whole input must be the expression. */
  standalone(file: Scope, locals: VarSym[]): Expr | null {
    const scope = new Scope(file)
    for (const v of locals) scope.syms.set(v.name, v)
    this.scope = scope
    try {
      const e = this.expression()
      if (this.tok.kind !== 'eof') {
        this.diags.error(this.at(), M.expectedExpression())
        return null
      }
      return e
    } catch (err) {
      if (err === ABORT) return null
      throw err
    }
  }
```

- [ ] **Step 4: Implement the breakpoint lines**

```ts path=src/interp/debug/lines.ts
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
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: every interp test passes, including 4 in `lines.test.ts`, and there are no type errors. If the typecheck lists a place that builds a `TranslationUnit` by hand, add `scope: {}` there.

- [ ] **Step 6: Commit**

```bash
git add src/interp tests/unit/interp/debug
git commit -m "feat(interp): parse debugger expressions in a unit's scope, and list breakpoint lines"
```

---
### Task 2: Inspecting a paused program (frames, variables, expressions)

**Files:**
- Create: `src/shared/debug.ts` (the whole debug protocol, used from Task 2 on)
- Create: `src/interp/debug/format.ts`, `src/interp/debug/inspect.ts`
- Modify: `src/interp/exec/machine.ts` (`scopes`), `src/interp/exec/stmt.ts` (`FunctionCode.scope`), `src/interp/run.ts` (fill `scopes`)
- Test: `tests/unit/interp/debug/format.test.ts`, `tests/unit/interp/debug/inspect.test.ts`

**Interfaces:**
- Consumes:
  - `parseExpression` (Task 1);
  - from Step 4: `ExprCompiler`, `FrameScope`, `Machine` (`frames`, `fp`, `loc`, `note`, `onLimit`, `limit`), `loadProgram`, `runProgram`, `captureIO`, `isLvalue` (sema), `kindOf`, `kindSize` and `hex`.
- Produces:
  - `src/shared/debug.ts`: `NumberFormat`, `FrameInfo`, `VarNode`, `StopReason`, `DebugCommand`, `DebugRequest`, `DebugEvent` and `DebugLaunch`.
  - `format.ts`: `formatValue(value, type, format)`, `typeName(type)` and `shortestFloat(v)`.
  - `inspect.ts`: `class Inspector(m)` with `frames()`, `variables(frame, formats?)`, `evaluate(frame, text, format?, name?)`, `children(frame, text, formats?)` and `assign(frame, text, valueText)`.
  - `Machine.scopes: Map<FunctionDef, FrameScope>`, filled by `loadProgram`.

Frame 0 is the innermost function. A frame's line is the current statement for frame 0, and the call site for the others. Any frame number outside the stack means "no frame": only globals, which is what Expressions show after the program ends.

Values are shown as CCS shows them:
- a float has its shortest round-trip digits (`0.1`, not `0.100000001`);
- a char also has its character (`100 'd'`);
- pointers, arrays and structs show their address (`0x80001230`), and char arrays add the string (`0x80001230 "dsp"`).

Hex and binary show the stored bits, including a float's.

- [ ] **Step 1: Write the failing tests**

```ts path=tests/unit/interp/debug/format.test.ts
import { describe, expect, it } from 'vitest'
import { formatValue, shortestFloat, typeName } from '../../../../src/interp/debug/format'
import { T, arrayOf, pointerTo } from '../../../../src/interp/frontend/types'

describe('formatValue', () => {
  it('shows integers, chars and pointers like CCS', () => {
    expect(formatValue(-5, T.int, 'natural')).toBe('-5')
    expect(formatValue(-5, T.int, 'hex')).toBe('0xFFFFFFFB')
    expect(formatValue(5, T.short, 'binary')).toBe('0b0000000000000101')
    expect(formatValue(65, T.char, 'natural')).toBe("65 'A'")
    expect(formatValue(10, T.uchar, 'char')).toBe("'\\n'")
    expect(formatValue(200, T.uchar, 'decimal')).toBe('200')
    expect(formatValue(-1n, T.llong, 'hex')).toBe('0xFFFFFFFFFFFFFFFF')
    expect(formatValue(0x80001230, pointerTo(T.float), 'natural')).toBe('0x80001230')
    expect(formatValue(0x80001000, arrayOf(T.int, 4), 'natural')).toBe('0x80001000')
  })
  it('shows floats with their shortest digits, or their bits', () => {
    expect(formatValue(Math.fround(0.1), T.float, 'natural')).toBe('0.1')
    expect(formatValue(Math.fround(1.5), T.float, 'hex')).toBe('0x3FC00000')
    expect(formatValue(0.1, T.double, 'natural')).toBe('0.1')
    expect(formatValue(-0.25, T.double, 'hex')).toBe('0xBFD0000000000000')
    expect(shortestFloat(Math.fround(3.14159265))).toBe('3.1415927')
  })
  it('names types the way CCS does', () => {
    expect(typeName(arrayOf(T.float, 8))).toBe('float[8]')
    expect(typeName(pointerTo(T.int))).toBe('int *')
  })
})
```

```ts path=tests/unit/interp/debug/inspect.test.ts
import { describe, expect, it } from 'vitest'
import { Inspector } from '../../../../src/interp/debug/inspect'
import type { Machine } from '../../../../src/interp/exec/machine'
import { captureIO, loadProgram, runProgram, type RunResult } from '../../../../src/interp/run'
import { build } from '../exec/harness'

const SRC = [
  'struct pt { int x; float y; };', //                              1
  'struct pt pts[2] = { { 1, 1.5f }, { 2, -0.25f } };', //          2
  'char name[8] = "dsp";', //                                       3
  'double total;', //                                               4
  'int scale(int v, float k)', //                                   5
  '{', //                                                           6
  '    int twice = v * 2;', //                                      7
  '    return (int)(twice * k);', //                                8
  '}', //                                                           9
  'int main(void)', //                                              10
  '{', //                                                           11
  '    int i;', //                                                  12
  '    int acc = 0;', //                                            13
  '    int *p = &acc;', //                                          14
  '    for (i = 0; i < 2; i++)', //                                 15
  '        acc += scale(pts[i].x, pts[i].y);', //                   16
  '    total = acc;', //                                            17
  '    return acc;', //                                             18
  '}' //                                                            19
].join('\n')

/** Runs SRC and calls `inspect` when statement `line` is about to run for the first time. */
function pauseAt(line: number, inspect: (ins: Inspector, m: Machine) => void): { r: RunResult; ins: Inspector } {
  const { program, image } = build(SRC)
  const m = loadProgram(program, image, captureIO().io)
  const ins = new Inspector(m)
  let done = false
  m.limit = m.ops + 1
  m.onLimit = () => {
    if (!done && m.loc.line === line) {
      done = true
      inspect(ins, m)
    }
    m.limit = m.ops + 1
  }
  return { r: runProgram(m), ins }
}

describe('Inspector', () => {
  it('lists frames innermost first with their current lines', () => {
    pauseAt(8, (ins) => {
      expect(ins.frames().map((f) => `${f.name}:${f.line}`)).toEqual(['scale:8', 'main:16'])
    })
  })

  it('shows the locals of each frame', () => {
    pauseAt(8, (ins) => {
      const inner = ins.variables(0)
      expect(inner.map((v) => [v.name, v.type, v.value])).toEqual([
        ['v', 'int', '1'],
        ['k', 'float', '1.5'],
        ['twice', 'int', '2']
      ])
      expect(inner[0].address).toMatch(/^0x8000[0-9A-F]{4}$/)
      const outer = ins.variables(1)
      expect(outer.map((v) => v.name)).toEqual(['i', 'acc', 'p'])
      expect(outer[2]).toMatchObject({ type: 'int *', expandable: true })
      expect(ins.children(1, 'p')).toMatchObject([{ name: '*p', value: '0' }])
    })
  })

  it('evaluates expressions, arrays, structs and char arrays', () => {
    pauseAt(8, (ins) => {
      expect(ins.evaluate(1, '*p + 3').value).toBe('3')
      expect(ins.evaluate(0, 'pts')).toMatchObject({ type: 'struct pt[2]', expandable: true })
      expect(ins.children(0, 'pts').map((c) => c.name)).toEqual(['[0]', '[1]'])
      expect(ins.children(0, 'pts[1]').map((c) => `${c.name}=${c.value}`)).toEqual(['x=2', 'y=-0.25'])
      expect(ins.evaluate(0, 'name').value).toMatch(/^0x[0-9A-F]{8} "dsp"$/)
      expect(ins.evaluate(0, 'name[0]').value).toBe("100 'd'")
      expect(ins.evaluate(0, 'v', 'hex').value).toBe('0x00000001')
      expect(ins.evaluate(0, 'k', 'hex').value).toBe('0x3FC00000')
      expect(ins.evaluate(0, '&pts[1]').type).toBe('struct pt *')
    })
  })

  it('reports errors instead of evaluating', () => {
    pauseAt(8, (ins) => {
      expect(ins.evaluate(0, 'nosuch').error).toBe('identifier "nosuch" is undefined')
      expect(ins.evaluate(0, 'scale(1, 2)').error).toBe('LabSim does not call functions from the Expressions view')
      expect(ins.evaluate(0, '*(int *)0').error).toBe('Illegal memory access at 0x00000000')
      expect(ins.evaluate(9, 'i').error).toBe('identifier "i" is undefined')
    })
  })

  it('changes a value, and the program continues with it', () => {
    const { r } = pauseAt(8, (ins) => {
      expect(ins.assign(0, 'twice', '10').value).toBe('10')
    })
    expect(r).toMatchObject({ status: 'exited', code: 14 })
  })

  it('evaluates globals after the program has ended', () => {
    const { r, ins } = pauseAt(99, () => {})
    expect(r.status).toBe('exited')
    expect(ins.frames()).toEqual([])
    expect(ins.evaluate(0, 'total').value).toBe('2')
  })
})
```

Why the last two expectations hold:
- With the value changed at line 8, the first call returns `(int)(10 * 1.5) = 15` and the second returns `(int)(4 * -0.25) = -1`, so `acc` is 14.
- Unchanged, the calls return 3 and -1, so `total` is 2.

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/debug`
Expected: FAIL, because `format` and `inspect` do not exist.

- [ ] **Step 3: Write the shared protocol**

```ts path=src/shared/debug.ts
import type { ProgramImage } from './program'

export type NumberFormat = 'natural' | 'hex' | 'decimal' | 'binary' | 'char'

export interface FrameInfo {
  /** 0 is the innermost function. */
  index: number
  name: string
  file: string | null
  line: number | null
}

/** One row of the Variables or Expressions view. */
export interface VarNode {
  name: string
  /** The expression that produces this row; also used to expand it and to change its value. */
  expr: string
  type: string
  value: string
  /** `0x…` for lvalues, empty otherwise. */
  address: string
  expandable: boolean
  error?: string
}

export type StopReason = 'entry' | 'breakpoint' | 'step' | 'suspend' | 'exit' | 'halt'

export type DebugCommand =
  | { cmd: 'resume' }
  | { cmd: 'stepInto' }
  | { cmd: 'stepOver' }
  | { cmd: 'stepReturn' }
  | { cmd: 'runToLine'; file: string; line: number }
  | { cmd: 'suspend' }
  | { cmd: 'terminate' }
  | { cmd: 'setBreakpoints'; file: string; lines: number[] }
  | { cmd: 'stackFrames' }
  | { cmd: 'variables'; frame: number; formats: Record<string, NumberFormat> }
  | { cmd: 'evaluate'; frame: number; expr: string; format: NumberFormat }
  | { cmd: 'children'; frame: number; expr: string; formats: Record<string, NumberFormat> }
  | { cmd: 'assign'; frame: number; expr: string; value: string }
  | { cmd: 'readMemory'; addr: number; length: number }
  | { cmd: 'input'; text: string | null }

export type DebugRequest = DebugCommand & { id: number }

export type DebugEvent =
  | { event: 'reply'; id: number; result?: unknown; error?: string }
  /** The program is loaded and about to run to main. */
  | { event: 'loaded' }
  /** It could not be compiled or loaded; the session is over. */
  | { event: 'failed'; messages: string[] }
  | { event: 'output'; text: string; stream: 'stdout' | 'stderr' }
  | { event: 'note'; text: string }
  | { event: 'running' }
  | { event: 'stopped'; reason: StopReason; file: string | null; line: number | null; message?: string; code?: number | null }
  /** The program waits for a console line (scanf, getchar, gets). */
  | { event: 'inputRequest' }
  /** The worker thread has gone (terminated, or it failed). */
  | { event: 'ended' }

/** What a debug worker needs to compile and load a project. */
export interface DebugLaunch {
  projectDir: string
  sources: string[]
  includePaths: string[]
  defines: string[]
  dialect: 'c89' | 'c99'
  diagWarnings: string[]
  image: ProgramImage
}
```

- [ ] **Step 4: Expose each function's frame layout**

In `src/interp/exec/machine.ts`:
- Add `import type { FrameScope } from './expr'` to the imports.
- Add this field to `Machine`, after `functions`:

```ts
  /** Each compiled function's frame layout, for the debugger's Variables and Expressions. */
  readonly scopes = new Map<FunctionDef, FrameScope>()
```

In `src/interp/exec/stmt.ts`, in `FunctionCode`:
- Add the field `scope!: FrameScope` after `readonly type: FunctionType`.
- In `compile()`, after `const frame = new FrameLayout(def)`, add `this.scope = frame`.

In `src/interp/run.ts`, in `loadProgram`, replace `for (const c of compiled) c.compile()` with:

```ts
  for (const c of compiled) {
    c.compile()
    m.scopes.set(c.def, c.scope)
  }
```

- [ ] **Step 5: Implement formatting**

```ts path=src/interp/debug/format.ts
import type { NumberFormat } from '@shared/debug'
import { hex } from '../exec/memory'
import { kindOf, kindSize } from '../exec/scalar'
import { typeToString, type Type } from '../frontend/types'

/** `float[8]`, `int *`: typeToString without the space before an array's brackets. */
export const typeName = (t: Type): string => typeToString(t).replace(/ \[/g, '[')

const ESCAPES: Record<number, string> = { 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 39: "\\'", 92: '\\\\' }

function charText(c: number): string {
  if (ESCAPES[c] !== undefined) return `'${ESCAPES[c]}'`
  if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`
  return `'\\x${c.toString(16).toUpperCase().padStart(2, '0')}'`
}

/** The fewest significant digits that read back as the same float. */
export function shortestFloat(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p))
    if (Math.fround(n) === v) return String(n)
  }
  return String(v)
}

function floatBits(v: number, single: boolean): bigint {
  const dv = new DataView(new ArrayBuffer(8))
  if (single) {
    dv.setFloat32(0, v)
    return BigInt(dv.getUint32(0))
  }
  dv.setFloat64(0, v)
  return dv.getBigUint64(0)
}

export function formatValue(value: unknown, t: Type, fmt: NumberFormat): string {
  const k = kindOf(t)
  if (k === 'void') return ''
  if (k === 'agg' || k === 'ptr') return `0x${hex(value as number)}`
  if (k === 'f32' || k === 'f64') {
    const x = value as number
    const single = k === 'f32'
    if (fmt === 'hex') return `0x${floatBits(x, single).toString(16).toUpperCase().padStart(single ? 8 : 16, '0')}`
    if (fmt === 'binary') return `0b${floatBits(x, single).toString(2).padStart(single ? 32 : 64, '0')}`
    return single ? shortestFloat(x) : String(x)
  }
  const n = BigInt(value as number | bigint)
  const bits = k === 'i40' || k === 'u40' ? 40 : kindSize(k) * 8
  const u = BigInt.asUintN(bits, n)
  switch (fmt) {
    case 'hex':
      return `0x${u.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}`
    case 'binary':
      return `0b${u.toString(2).padStart(bits, '0')}`
    case 'char':
      return charText(Number(u & 0xffn))
    case 'decimal':
      return n.toString()
    default:
      return k === 'i8' || k === 'u8' ? `${n} ${charText(Number(u & 0xffn))}` : n.toString()
  }
}
```

- [ ] **Step 6: Implement the inspector**

```ts path=src/interp/debug/inspect.ts
import type { FrameInfo, NumberFormat, VarNode } from '@shared/debug'
import { ExprCompiler, type FrameScope } from '../exec/expr'
import { LoadError, type Machine } from '../exec/machine'
import { Trap, hex } from '../exec/memory'
import type { Expr, FunctionDef, TranslationUnit, VarSym } from '../frontend/ast'
import { Diags } from '../frontend/diag'
import { parseExpression } from '../frontend/parser'
import { isLvalue } from '../frontend/sema'
import { isCharArray, isComplete, type Type } from '../frontend/types'
import { formatValue, typeName } from './format'

/** Without a frame (after the program ended) only objects with static storage have addresses. */
const NO_FRAME: FrameScope = {
  offset: (v) => {
    throw new LoadError(`'${v.name}' is not in scope`, null)
  },
  temp: () => {
    throw new LoadError('not available without a stack frame', null)
  }
}

const MAX_ELEMENTS = 1000

/** Parenthesises an expression unless it is a plain name, element or member chain. */
const wrap = (s: string): string => (/^[\w.[\]]+$/.test(s) ? s : `(${s})`)

function expandable(t: Type): boolean {
  if (t.kind === 'array') return (t.length ?? 0) > 0
  if (t.kind === 'struct' || t.kind === 'union') return (t.def.members?.length ?? 0) > 0
  if (t.kind === 'pointer') return t.to.kind !== 'void' && t.to.kind !== 'function' && isComplete(t.to)
  return false
}

const EXPR_KEYS = ['arg', 'left', 'right', 'ptr', 'index', 'target', 'value', 'test', 'then', 'else', 'callee', 'base', 'ap'] as const

function hasCall(e: Expr): boolean {
  if (e.k === 'call') return true
  const rec = e as unknown as Record<string, unknown>
  return EXPR_KEYS.some((key) => {
    const child = rec[key]
    return typeof child === 'object' && child !== null && 'k' in child && hasCall(child as Expr)
  })
}

interface Context {
  unit: TranslationUnit
  def: FunctionDef | null
  fp: number
  line: number
}

/** Looks into a paused (or finished) program: what the Debug, Variables and Expressions views show. */
export class Inspector {
  constructor(private readonly m: Machine) {}

  frames(): FrameInfo[] {
    const { m } = this
    const f = m.frames
    return f.map((_, k) => {
      const i = f.length - 1 - k
      const loc = i === f.length - 1 ? m.loc : f[i + 1].callSite
      return { index: k, name: f[i].fn.sym.name, file: loc.file, line: loc.line }
    })
  }

  variables(frame: number, formats: Record<string, NumberFormat> = {}): VarNode[] {
    const names = new Set(this.locals(this.context(frame)).map((v) => v.name))
    return [...names].map((name) => this.evaluate(frame, name, formats[name] ?? 'natural'))
  }

  evaluate(frame: number, text: string, format: NumberFormat = 'natural', name = text): VarNode {
    const base: VarNode = { name, expr: text, type: '', value: '', address: '', expandable: false }
    const r = this.compile(frame, text)
    if ('error' in r) return { ...base, error: r.error }
    const { e, ctx } = r
    return this.withFrame(ctx, base, () => {
      const ex = new ExprCompiler(this.m, ctx.def ? (this.m.scopes.get(ctx.def) ?? NO_FRAME) : NO_FRAME)
      const value = ex.value(e)()
      const address = isLvalue(e) ? (ex.address(e, 'none')() as number) : null
      let shown = formatValue(value, e.type, format)
      if (format === 'natural' && isCharArray(e.type)) shown += ` "${this.preview(value as number)}"`
      return { ...base, type: typeName(e.type), value: shown, address: address === null ? '' : `0x${hex(address)}`, expandable: expandable(e.type) }
    })
  }

  children(frame: number, text: string, formats: Record<string, NumberFormat> = {}): VarNode[] {
    const r = this.compile(frame, text)
    if ('error' in r) return []
    const t = r.e.type
    const w = wrap(text)
    const kids: [string, string][] = []
    if (t.kind === 'array') for (let i = 0; i < Math.min(t.length ?? 0, MAX_ELEMENTS); i++) kids.push([`[${i}]`, `${w}[${i}]`])
    else if (t.kind === 'struct' || t.kind === 'union') for (const mem of t.def.members ?? []) kids.push([mem.name, `${w}.${mem.name}`])
    else if (expandable(t)) kids.push([`*${text}`, `*${w}`])
    return kids.map(([name, expr]) => this.evaluate(frame, expr, formats[expr] ?? 'natural', name))
  }

  /** `expr = (value)`, then the new value; C conversions and cl6x's errors apply. */
  assign(frame: number, text: string, valueText: string): VarNode {
    const r = this.evaluate(frame, `${wrap(text)} = (${valueText})`)
    const now = this.evaluate(frame, text)
    return r.error ? { ...now, error: r.error } : now
  }

  private context(frame: number): Context {
    const { m } = this
    const f = m.frames
    const i = f.length - 1 - frame
    if (frame < 0 || i < 0) return { unit: this.unitOf(m.program.main), def: null, fp: m.fp, line: Infinity }
    const def = f[i].fn
    const loc = i === f.length - 1 ? m.loc : f[i + 1].callSite
    return { unit: this.unitOf(def), def, fp: f[i].fp, line: loc.line }
  }

  private unitOf(def: FunctionDef): TranslationUnit {
    return this.m.program.units.find((u) => u.functions.includes(def)) ?? this.m.program.units[0]
  }

  /** Parameters, local statics, then the locals declared up to the frame's line (a later one shadows an earlier one). */
  private locals(ctx: Context): VarSym[] {
    if (!ctx.def) return []
    const named = (v: VarSym): boolean => !v.hidden && v.name !== ''
    return [...ctx.def.params, ...ctx.def.statics.filter(named), ...ctx.def.locals.filter((v) => named(v) && v.loc.line <= ctx.line)]
  }

  private compile(frame: number, text: string): { e: Expr; ctx: Context } | { error: string } {
    const ctx = this.context(frame)
    const diags = new Diags([])
    const e = parseExpression(text, ctx.unit, this.locals(ctx), diags)
    const err = diags.list.find((d) => d.severity === 'error')
    if (!e || err) return { error: err?.message ?? 'not a C expression' }
    if (hasCall(e)) return { error: 'LabSim does not call functions from the Expressions view' }
    return { e, ctx }
  }

  /** Runs `run` with the frame pointer of the frame and without bounds notes; runtime errors become the row's error. */
  private withFrame(ctx: Context, base: VarNode, run: () => VarNode): VarNode {
    const m = this.m
    const fp = m.fp
    const note = m.note
    m.fp = ctx.fp
    m.note = () => {}
    try {
      return run()
    } catch (err) {
      if (err instanceof Trap || err instanceof LoadError) return { ...base, error: err.message }
      throw err
    } finally {
      m.fp = fp
      m.note = note
    }
  }

  private preview(addr: number): string {
    let s = ''
    for (let i = 0; i < 64; i++) {
      const b = this.m.mem.peek(addr + i, 1)
      if (!b || b[0] === 0) return s
      const c = b[0]
      s += c >= 32 && c < 127 && c !== 34 && c !== 92 ? String.fromCharCode(c) : `\\x${c.toString(16).padStart(2, '0')}`
    }
    return `${s}…`
  }
}
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: every interp test passes, including 3 in `format.test.ts` and 6 in `inspect.test.ts`, and there are no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/debug.ts src/interp tests/unit/interp/debug
git commit -m "feat(interp): inspect a paused program: frames, variables, expressions and value changes"
```

---
### Task 3: The debugger (stops, stepping, breakpoints, suspend, stdin)

**Files:**
- Create: `src/interp/debug/debugger.ts`
- Test: `tests/unit/interp/debug/debugger.test.ts`

**Interfaces:**
- Consumes:
  - `Inspector` (Task 2) and `statementLines`/`verifyLine`/`fileKey` (Task 1);
  - `runProgram` and `Machine` (`onLimit`, `limit`, `ops`, `loc`, `frames`, `mem.peek`);
  - the protocol types in `@shared/debug`.
- Produces:
  - `interface DebugChannel { wait(): DebugRequest; poll(): DebugRequest | null; send(event): void }`
  - `POLL_INTERVAL = 20000`
  - `class Debugger(m, channel, lines)` with `run()` and `readLine()`.
  - The worker (Task 4) wires `readLine` into the program's `RunIO`.

Behaviour:

| Situation | What the debugger does |
|---|---|
| Start | Stops at the first statement of `main` (`entry`). |
| While stopped | Blocks in `channel.wait()` and answers read-only requests. A control request (resume, a step, run to line) continues; `terminate` ends `run()`. |
| While running | Checks every `POLL_INTERVAL` statements, or every statement when a step, breakpoint or run-to-line target is armed. |
| At each check | Answers queued requests: `suspend` stops at the current statement; the others are answered in place, and memory reads keep graphs refreshing. |
| Step Into | Stops at the next statement on another line or in another function. |
| Step Over | Stops at the next statement on another line of this function or a caller. |
| Step Return | Stops at the next statement of a caller. |
| Breakpoint lines | Verified with `verifyLine`: a line without code moves to the next statement. |
| `main` returns, or `exit()` | Sends `stopped` with reason `exit` and the exit code, clears the frames, and keeps answering requests (memory stays readable). |
| A trap | Sends `stopped` with reason `halt` and the message. The frames stay, so the Debug view shows where it happened. |
| Waiting for stdin | `readLine()` sends `inputRequest` and waits for an `input` request (text, or null for end of input), still answering read-only requests. |

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/debug/debugger.test.ts
import { describe, expect, it } from 'vitest'
import type { ProgramImage } from '@shared/program'
import type { DebugCommand, DebugEvent, DebugRequest, VarNode } from '@shared/debug'
import { Debugger, type DebugChannel } from '../../../../src/interp/debug/debugger'
import { statementLines } from '../../../../src/interp/debug/lines'
import { captureIO, loadProgram } from '../../../../src/interp/run'
import { build, MAIN } from '../exec/harness'

/** Answers wait() from a script and poll() (only once the program runs) from a second queue. */
class FakeChannel implements DebugChannel {
  readonly events: DebugEvent[] = []
  private id = 0
  constructor(
    private readonly script: DebugCommand[],
    private readonly whileRunning: DebugCommand[] = []
  ) {}
  wait(): DebugRequest {
    const cmd = this.script.shift()
    if (!cmd) throw new Error(`script ended after ${JSON.stringify(this.events.slice(-2))}`)
    return { ...cmd, id: ++this.id }
  }
  poll(): DebugRequest | null {
    if (!this.events.some((e) => e.event === 'running')) return null
    const cmd = this.whileRunning.shift()
    return cmd ? { ...cmd, id: ++this.id } : null
  }
  send(event: DebugEvent): void {
    this.events.push(event)
  }
  stops(): string[] {
    return this.events.flatMap((e) => (e.event === 'stopped' ? [`${e.reason}:${e.line}`] : []))
  }
  reply(id: number): unknown {
    const r = this.events.find((e) => e.event === 'reply' && e.id === id)
    return r && r.event === 'reply' ? (r.error !== undefined ? { error: r.error } : r.result) : undefined
  }
}

function session(src: string, script: (image: ProgramImage) => DebugCommand[], whileRunning: DebugCommand[] = []): { ch: FakeChannel; stdout: string } {
  const { program, image } = build(src)
  const cap = captureIO()
  let dbg: Debugger | null = null
  const m = loadProgram(program, image, { ...cap.io, readLine: () => (dbg as Debugger).readLine() })
  const ch = new FakeChannel(script(image), whileRunning)
  dbg = new Debugger(m, ch, statementLines(program))
  dbg.run()
  return { ch, stdout: cap.stdout() }
}

const PROGRAM = [
  '#include <stdio.h>', //                  1
  'float y[4];', //                         2
  'int square(int v)', //                   3
  '{', //                                   4
  '    return v * v;', //                   5
  '}', //                                   6
  'int main(void)', //                      7
  '{', //                                   8
  '    int i;', //                          9
  '    for (i = 0; i < 4; i++) {', //       10
  '        y[i] = square(i) * 0.5f;', //    11
  '    }', //                               12
  '    printf("done %d\\n", square(3));', // 13
  '    return 0;', //                       14
  '}' //                                    15
].join('\n')

const value = (r: unknown): string => (r as VarNode).value

describe('Debugger', () => {
  it('stops at main, runs to the end and stays at C$$EXIT', () => {
    const { ch, stdout } = session(PROGRAM, () => [{ cmd: 'resume' }, { cmd: 'stackFrames' }, { cmd: 'evaluate', frame: 0, expr: 'y[3]', format: 'natural' }, { cmd: 'terminate' }])
    expect(ch.stops()).toEqual(['entry:10', 'exit:null'])
    expect(ch.events.find((e) => e.event === 'stopped' && e.reason === 'exit')).toMatchObject({ code: 0 })
    expect(stdout).toBe('done 9\n')
    expect(ch.reply(2)).toEqual([])
    expect(value(ch.reply(3))).toBe('4.5')
  })

  it('stops at breakpoints and steps into, out of and over calls', () => {
    const { ch } = session(PROGRAM, () => [
      { cmd: 'setBreakpoints', file: MAIN, lines: [11] }, // 1
      { cmd: 'resume' }, // 2
      { cmd: 'variables', frame: 0, formats: {} }, // 3
      { cmd: 'stepInto' }, // 4
      { cmd: 'stackFrames' }, // 5
      { cmd: 'stepReturn' }, // 6
      { cmd: 'stepOver' }, // 7
      { cmd: 'stepOver' }, // 8
      { cmd: 'resume' }, // 9
      { cmd: 'evaluate', frame: 0, expr: 'i', format: 'natural' }, // 10
      { cmd: 'setBreakpoints', file: MAIN, lines: [] }, // 11
      { cmd: 'resume' }, // 12
      { cmd: 'terminate' }
    ])
    expect(ch.stops()).toEqual(['entry:10', 'breakpoint:11', 'step:5', 'step:10', 'step:11', 'step:10', 'breakpoint:11', 'exit:null'])
    expect(ch.reply(1)).toEqual([11])
    expect((ch.reply(3) as VarNode[]).map((v) => `${v.name}=${v.value}`)).toEqual(['i=0'])
    expect((ch.reply(5) as { name: string; line: number }[]).map((f) => `${f.name}:${f.line}`)).toEqual(['square:5', 'main:11'])
    expect(value(ch.reply(10))).toBe('2')
  })

  it('moves breakpoints to the next statement and runs to a line', () => {
    const { ch } = session(PROGRAM, () => [
      { cmd: 'setBreakpoints', file: MAIN, lines: [12, 16] },
      { cmd: 'resume' },
      { cmd: 'runToLine', file: MAIN, line: 14 },
      { cmd: 'resume' },
      { cmd: 'terminate' }
    ])
    expect(ch.reply(1)).toEqual([13, null])
    expect(ch.stops()).toEqual(['entry:10', 'breakpoint:13', 'step:14', 'exit:null'])
  })

  it('suspends an endless loop', () => {
    const src = 'int main(void)\n{\n    volatile int n = 0;\n    for (;;)\n        n++;\n    return 0;\n}'
    const { ch } = session(src, () => [{ cmd: 'resume' }, { cmd: 'terminate' }], [{ cmd: 'suspend' }])
    const stops = ch.stops()
    expect(stops[0]).toBe('entry:3')
    expect(stops[1]).toMatch(/^suspend:[45]$/)
  })

  it('asks for console input and gives the line to scanf', () => {
    const src = '#include <stdio.h>\nint main(void)\n{\n    int n = 0;\n    scanf("%d", &n);\n    printf("n=%d\\n", n * 2);\n    return 0;\n}'
    const { ch, stdout } = session(src, () => [{ cmd: 'resume' }, { cmd: 'input', text: '21' }, { cmd: 'terminate' }])
    expect(ch.events.some((e) => e.event === 'inputRequest')).toBe(true)
    expect(stdout).toBe('n=42\n')
    expect(ch.stops()).toEqual(['entry:4', 'exit:null'])
  })

  it('halts on a runtime error and keeps the frames', () => {
    const src = 'int main(void)\n{\n    int z = 0;\n    return 5 / z;\n}'
    const { ch } = session(src, () => [{ cmd: 'resume' }, { cmd: 'stackFrames' }, { cmd: 'resume' }, { cmd: 'terminate' }])
    expect(ch.stops()).toEqual(['entry:3', 'halt:4'])
    expect(ch.events.find((e) => e.event === 'stopped' && e.reason === 'halt')).toMatchObject({ message: 'Division by zero' })
    expect((ch.reply(2) as unknown[]).length).toBe(1)
    expect(ch.reply(3)).toEqual({ error: 'The program has ended. Restart it to run again.' })
  })

  it('reads memory for the graphs', () => {
    const { ch } = session(PROGRAM, (image) => [{ cmd: 'readMemory', addr: image.globals.y.addr, length: 8 }, { cmd: 'readMemory', addr: 0, length: 4 }, { cmd: 'terminate' }])
    expect(ch.reply(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(ch.reply(2)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/debug/debugger.test.ts`
Expected: FAIL, because `src/interp/debug/debugger` does not exist.

- [ ] **Step 3: Implement the debugger**

```ts path=src/interp/debug/debugger.ts
import type { DebugEvent, DebugRequest, StopReason } from '@shared/debug'
import type { Machine } from '../exec/machine'
import type { Loc } from '../frontend/diag'
import { runProgram } from '../run'
import { Inspector } from './inspect'
import { fileKey, verifyLine, type StatementLines } from './lines'

/** How the debugger talks to the UI. In the app: a SharedArrayBuffer slot and postMessage (src/main/debug). */
export interface DebugChannel {
  /** Blocks until the next request. */
  wait(): DebugRequest
  /** A request that arrived while the program was running, or null. */
  poll(): DebugRequest | null
  send(event: DebugEvent): void
}

/** Statements between checks for Suspend and queued requests when nothing is armed. */
export const POLL_INTERVAL = 20000

interface Step {
  kind: 'entry' | 'into' | 'over' | 'return'
  file: string
  line: number
  depth: number
}

const TERMINATE = Symbol('terminate')

const CONTROL = new Set(['resume', 'stepInto', 'stepOver', 'stepReturn', 'runToLine'])

export class Debugger {
  private readonly ins: Inspector
  /** fileKey → verified breakpoint lines. */
  private readonly breakpoints = new Map<string, Set<number>>()
  private readonly keys = new Map<string, string>()
  private step: Step | null = null
  private target: { file: string; line: number } | null = null
  private suspendRequested = false
  private finished = false

  constructor(
    private readonly m: Machine,
    private readonly ch: DebugChannel,
    private readonly lines: StatementLines
  ) {
    this.ins = new Inspector(m)
  }

  /** Runs the program under the debugger until the UI terminates the session. */
  run(): void {
    const m = this.m
    m.onLimit = () => this.check()
    this.step = { kind: 'entry', file: '', line: 0, depth: 0 }
    m.limit = m.ops + 1
    try {
      const r = runProgram(m)
      this.finished = true
      if (r.status === 'exited') {
        m.frames.length = 0
        this.send({ event: 'stopped', reason: 'exit', file: null, line: null, code: r.code })
      } else this.send({ event: 'stopped', reason: 'halt', file: r.loc.file, line: r.loc.line, message: r.message })
      this.serve()
    } catch (e) {
      if (e !== TERMINATE) throw e
    }
  }

  /** The program's console input: asks the UI for a line and waits for it. */
  readLine(): string | null {
    this.send({ event: 'inputRequest' })
    for (;;) {
      const req = this.ch.wait()
      if (req.cmd === 'input') {
        this.reply(req.id, null)
        return req.text
      }
      if (req.cmd === 'terminate') {
        this.reply(req.id, null)
        throw TERMINATE
      }
      if (req.cmd === 'suspend' || CONTROL.has(req.cmd)) this.reply(req.id, null)
      else this.answer(req)
    }
  }

  private key(file: string): string {
    let k = this.keys.get(file)
    if (k === undefined) {
      k = fileKey(file)
      this.keys.set(file, k)
    }
    return k
  }

  private send(event: DebugEvent): void {
    this.ch.send(event)
  }

  private reply(id: number, result: unknown, error?: string): void {
    this.send(error === undefined ? { event: 'reply', id, result } : { event: 'reply', id, error })
  }

  /** The statement hook (Machine.onLimit): requests, then whether to stop here. */
  private check(): void {
    const m = this.m
    for (let req = this.ch.poll(); req; req = this.ch.poll()) {
      if (req.cmd === 'suspend') {
        this.suspendRequested = true
        this.reply(req.id, null)
      } else if (req.cmd === 'terminate') {
        this.reply(req.id, null)
        throw TERMINATE
      } else if (CONTROL.has(req.cmd)) this.reply(req.id, null)
      else this.answer(req)
    }
    const reason = this.reason()
    if (reason) this.pause(reason)
    m.limit = m.ops + (this.step || this.target || this.breakpoints.size > 0 ? 1 : POLL_INTERVAL)
  }

  private reason(): StopReason | null {
    const loc = this.m.loc
    const depth = this.m.frames.length
    if (this.suspendRequested) {
      this.suspendRequested = false
      return 'suspend'
    }
    const file = this.key(loc.file)
    const s = this.step
    if (s) {
      if (s.kind === 'entry') return 'entry'
      const moved = loc.line !== s.line || file !== s.file
      if (s.kind === 'into' && (moved || depth !== s.depth)) return 'step'
      if (s.kind === 'over' && (depth < s.depth || (depth === s.depth && moved))) return 'step'
      if (s.kind === 'return' && depth < s.depth) return 'step'
    }
    if (this.target && this.target.file === file && this.target.line === loc.line) return 'step'
    if (this.breakpoints.get(file)?.has(loc.line)) return 'breakpoint'
    return null
  }

  private pause(reason: StopReason): void {
    this.step = null
    this.target = null
    const loc: Loc = this.m.loc
    this.send({ event: 'stopped', reason, file: loc.file, line: loc.line })
    this.serve()
  }

  /** Answers requests while stopped; returns when the program should continue. */
  private serve(): void {
    for (;;) {
      const req = this.ch.wait()
      if (req.cmd === 'terminate') {
        this.reply(req.id, null)
        throw TERMINATE
      }
      if (req.cmd === 'suspend') {
        this.reply(req.id, null)
        continue
      }
      if (!CONTROL.has(req.cmd)) {
        this.answer(req)
        continue
      }
      if (this.finished) {
        this.reply(req.id, undefined, 'The program has ended. Restart it to run again.')
        continue
      }
      const error = this.control(req)
      if (error) {
        this.reply(req.id, undefined, error)
        continue
      }
      this.reply(req.id, null)
      this.send({ event: 'running' })
      return
    }
  }

  private control(req: DebugRequest): string | null {
    const loc = this.m.loc
    const here = { file: this.key(loc.file), line: loc.line, depth: this.m.frames.length }
    switch (req.cmd) {
      case 'stepInto':
        this.step = { kind: 'into', ...here }
        return null
      case 'stepOver':
        this.step = { kind: 'over', ...here }
        return null
      case 'stepReturn':
        this.step = { kind: 'return', ...here }
        return null
      case 'runToLine': {
        const line = verifyLine(this.lines, req.file, req.line)
        if (line === null) return 'There is no code at or after that line.'
        this.target = { file: this.key(req.file), line }
        return null
      }
      default:
        return null
    }
  }

  private answer(req: DebugRequest): void {
    try {
      switch (req.cmd) {
        case 'setBreakpoints': {
          const verified = req.lines.map((l) => verifyLine(this.lines, req.file, l))
          const set = new Set(verified.filter((l): l is number => l !== null))
          if (set.size > 0) this.breakpoints.set(this.key(req.file), set)
          else this.breakpoints.delete(this.key(req.file))
          this.m.limit = Math.min(this.m.limit, this.m.ops + 1)
          this.reply(req.id, verified)
          return
        }
        case 'stackFrames':
          this.reply(req.id, this.ins.frames())
          return
        case 'variables':
          this.reply(req.id, this.ins.variables(req.frame, req.formats))
          return
        case 'evaluate':
          this.reply(req.id, this.ins.evaluate(req.frame, req.expr, req.format))
          return
        case 'children':
          this.reply(req.id, this.ins.children(req.frame, req.expr, req.formats))
          return
        case 'assign':
          this.reply(req.id, this.ins.assign(req.frame, req.expr, req.value))
          return
        case 'readMemory': {
          const bytes = this.m.mem.peek(req.addr, req.length)
          this.reply(req.id, bytes ? [...bytes] : null)
          return
        }
        case 'input':
          this.reply(req.id, undefined, 'The program is not waiting for input.')
          return
        default:
          this.reply(req.id, undefined, `unexpected request ${req.cmd}`)
      }
    } catch (e) {
      this.reply(req.id, undefined, e instanceof Error ? e.message : String(e))
    }
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: every interp test passes, including 7 in `debugger.test.ts`, and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/interp/debug tests/unit/interp/debug
git commit -m "feat(interp): debugger with entry stop, breakpoints, stepping, suspend, stdin and post-mortem inspection"
```

---
### Task 4: Debug worker, channel, session and IPC

**Files:**
- Create: `src/main/debug/channel.ts`, `src/main/debug/launch.ts`, `src/main/debug/worker.ts`, `src/main/debug/session.ts`
- Modify:
  - `src/main/ipc.ts` (`debug:start`, `debug:request`, `debug:terminate`);
  - `src/preload/index.ts` and `src/shared/api.ts` (the four debug calls);
  - `src/main/menu.ts` (the Run menu);
  - `tsconfig.node.json` (`electron-vite/node` types);
  - `tests/unit/store.test.ts` (the fake API gains the new calls).
- Test: `tests/unit/debug/channel.test.ts`, `tests/unit/debug/launch.test.ts`, `tests/unit/debug/worker.test.ts` (runs against the built worker)

**Interfaces:**
- Consumes:
  - `Debugger` and `DebugChannel` (Task 3), and `statementLines` (Task 1);
  - `@shared/debug` (Task 2);
  - `loadProgram` and `LoadError`, `compileUnit` and `linkProgram`;
  - `renderDiagnostic`, `frontendOptions` and `FALLBACK_CGT` (`src/main/build/fallback`);
  - `readBuildConfig`, `findSources` and `nodeHostFiles`.
- Produces:
  - `channel.ts`: `createDebugBuffer()`, `class CommandSender(buffer)` with `send(req)`, and `workerChannel(buffer, post): DebugChannel`.
  - `launch.ts`: `debugLaunch(projectDir, image, toolchain): Promise<DebugLaunch>`.
  - `session.ts`: `class DebugSession(launch, onEvent)` with `request(cmd): Promise<unknown>`, `terminate(): Promise<void>` and `alive`.
  - `LabsimApi` gains:
    - `debugStart(projectDir): Promise<void>`
    - `debugRequest(cmd: DebugCommand): Promise<unknown>`
    - `debugTerminate(): Promise<void>`
    - `onDebugEvent(cb): () => void`
  - `MenuCommand` gains `'run.debug' | 'run.resume' | 'run.suspend' | 'run.terminate' | 'run.restart' | 'run.reload' | 'run.stepInto' | 'run.stepOver' | 'run.stepReturn' | 'run.toLine'`.

The command slot is a `SharedArrayBuffer`: an `Int32Array` header (`[0]` full flag, `[1]` byte length), then up to 1 MB of JSON.
- The main process writes one request at a time. It waits with `Atomics.waitAsync`, so it never blocks, until the worker has taken the previous one.
- The worker takes a request with `Atomics.wait` when stopped, or by checking the flag while running.
- Replies and events travel the other way with `postMessage`.

electron-vite bundles the worker because `session.ts` imports it with the `?nodeWorker` suffix.

The debug keys are shown in the Run menu but not registered there (`registerAccelerator: false`). The renderer handles them (Task 6), because Monaco would otherwise take F8 and the window would take Ctrl+R. For the same reason, the menu's Reload moves from Ctrl+R to Ctrl+Shift+R.

- [ ] **Step 1: Write the failing tests**

```ts path=tests/unit/debug/channel.test.ts
import { describe, expect, it } from 'vitest'
import type { DebugEvent } from '@shared/debug'
import { CommandSender, createDebugBuffer, workerChannel } from '../../../src/main/debug/channel'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('debug command slot', () => {
  it('hands requests to the worker side one at a time, in order', async () => {
    const buffer = createDebugBuffer()
    const sender = new CommandSender(buffer)
    const events: DebugEvent[] = []
    const ch = workerChannel(buffer, (e) => events.push(e))
    expect(ch.poll()).toBeNull()
    sender.send({ id: 1, cmd: 'resume' })
    sender.send({ id: 2, cmd: 'evaluate', frame: 0, expr: 'y[3]', format: 'hex' })
    expect(ch.poll()).toEqual({ id: 1, cmd: 'resume' })
    await tick()
    expect(ch.wait()).toEqual({ id: 2, cmd: 'evaluate', frame: 0, expr: 'y[3]', format: 'hex' })
    expect(ch.poll()).toBeNull()
    ch.send({ event: 'running' })
    expect(events).toEqual([{ event: 'running' }])
  })
})
```

```ts path=tests/unit/debug/launch.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProgramImage } from '@shared/program'
import { debugLaunch } from '../../../src/main/debug/launch'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'labsim-launch-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const IMAGE = { outFile: 'x.out', entry: 0, memory: [], sections: [], globals: {}, statics: {}, stack: { start: 0, size: 0 }, heap: { start: 0, size: 0 } } as ProgramImage

describe('debugLaunch', () => {
  it("collects the project's sources and compile options, without the compiler's include folder", async () => {
    writeFileSync(join(dir, 'main.c'), 'int main(void) { return 0; }\n')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'fir.c'), 'int fir;\n')
    const tc = { root: 'C:/ti/cgt', version: '8.3.12', cl6x: 'C:/ti/cgt/bin/cl6x.exe' }
    const launch = await debugLaunch(dir, IMAGE, tc)
    expect(launch.sources).toEqual([join(dir, 'main.c'), join(dir, 'src', 'fir.c')])
    expect(launch).toMatchObject({ projectDir: dir, defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'], image: IMAGE })
    expect(launch.includePaths.some((p) => p.includes('cgt'))).toBe(false)
  })
})
```

```ts path=tests/unit/debug/worker.test.ts
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { DebugEvent, DebugLaunch } from '@shared/debug'
import { prepare } from '../../../src/cli/prepare'
import { CommandSender, createDebugBuffer } from '../../../src/main/debug/channel'

/** The bundled worker from `npm run build` (electron-vite names the chunk). Skipped when the app is not built. */
const OUT = join(__dirname, '../../../out/main')
const workerFile = existsSync(OUT)
  ? readdirSync(OUT)
      .map((f) => join(OUT, f))
      .find((f) => f.endsWith('.js') && readFileSync(f, 'utf8').includes("LabSim's C front-end cannot load this program"))
  : undefined

describe.skipIf(!workerFile)('the built debug worker', () => {
  it('stops at main, resumes to the end and terminates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'labsim-worker-'))
    try {
      writeFileSync(join(dir, 'main.c'), '#include <stdio.h>\nint main(void)\n{\n    int k = 6;\n    printf("k=%d\\n", k * 7);\n    return 0;\n}\n')
      const p = await prepare(join(dir, 'main.c'))
      if (!p.ok) throw new Error(p.messages.join('\n'))
      const launch: DebugLaunch = { projectDir: dir, sources: [join(dir, 'main.c')], includePaths: [dir], defines: ['c6748'], dialect: 'c89', diagWarnings: ['225'], image: p.image }
      const buffer = createDebugBuffer()
      const sender = new CommandSender(buffer)
      const worker = new Worker(workerFile as string, { workerData: { launch, buffer } })
      const events: DebugEvent[] = []
      const next = (pred: (e: DebugEvent) => boolean): Promise<DebugEvent> =>
        new Promise((resolve) => {
          const found = events.find(pred)
          if (found) return resolve(found)
          const on = (e: DebugEvent): void => {
            if (pred(e)) {
              worker.off('message', on)
              resolve(e)
            }
          }
          worker.on('message', on)
        })
      worker.on('message', (e: DebugEvent) => events.push(e))
      expect(await next((e) => e.event === 'stopped')).toMatchObject({ reason: 'entry', line: 4 })
      sender.send({ id: 1, cmd: 'resume' })
      expect(await next((e) => e.event === 'stopped' && e.reason === 'exit')).toMatchObject({ code: 0 })
      expect(events.filter((e) => e.event === 'output').map((e) => (e.event === 'output' ? e.text : ''))).toEqual(['k=42\n'])
      const exited = new Promise((r) => worker.once('exit', r))
      sender.send({ id: 2, cmd: 'terminate' })
      await exited
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/debug`
Expected: FAIL, because `channel` and `launch` do not exist. The worker test is skipped until the app is built.

- [ ] **Step 3: Implement the channel and the launch description**

```ts path=src/main/debug/channel.ts
import type { DebugEvent, DebugRequest } from '@shared/debug'
import type { DebugChannel } from '../../interp/debug/debugger'

const FULL = 0
const LENGTH = 1
const HEADER = 16
/** Largest request in bytes of JSON; requests are small (an expression at most). */
const CAPACITY = 1 << 20

interface AtomicsWaitAsync {
  waitAsync(a: Int32Array, index: number, value: number): { async: boolean; value: Promise<string> | string }
}

export function createDebugBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER + CAPACITY)
}

/** Main-process side: writes requests into the slot one at a time, waiting (without blocking) for the worker to take each. */
export class CommandSender {
  private readonly ctl: Int32Array
  private readonly data: Uint8Array
  private readonly queue: DebugRequest[] = []
  private pumping = false

  constructor(buffer: SharedArrayBuffer) {
    this.ctl = new Int32Array(buffer, 0, 2)
    this.data = new Uint8Array(buffer, HEADER, CAPACITY)
  }

  send(req: DebugRequest): void {
    this.queue.push(req)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length > 0) {
        while (Atomics.load(this.ctl, FULL) !== 0) {
          const w = (Atomics as unknown as AtomicsWaitAsync).waitAsync(this.ctl, FULL, 1)
          if (w.async) await w.value
        }
        const bytes = new TextEncoder().encode(JSON.stringify(this.queue.shift()))
        if (bytes.length > CAPACITY) continue
        this.data.set(bytes)
        Atomics.store(this.ctl, LENGTH, bytes.length)
        Atomics.store(this.ctl, FULL, 1)
        Atomics.notify(this.ctl, FULL)
      }
    } finally {
      this.pumping = false
    }
  }
}

/** Worker side of the slot: `wait` blocks the worker thread (the program is stopped), `poll` does not. */
export function workerChannel(buffer: SharedArrayBuffer, post: (event: DebugEvent) => void): DebugChannel {
  const ctl = new Int32Array(buffer, 0, 2)
  const data = new Uint8Array(buffer, HEADER, CAPACITY)
  const decoder = new TextDecoder()
  const take = (): DebugRequest => {
    const n = Atomics.load(ctl, LENGTH)
    const req = JSON.parse(decoder.decode(data.slice(0, n))) as DebugRequest
    Atomics.store(ctl, FULL, 0)
    Atomics.notify(ctl, FULL)
    return req
  }
  return {
    wait: () => {
      Atomics.wait(ctl, FULL, 0)
      return take()
    },
    poll: () => (Atomics.load(ctl, FULL) === 1 ? take() : null),
    send: post
  }
}
```

```ts path=src/main/debug/launch.ts
import type { Toolchain } from '@shared/build'
import type { DebugLaunch } from '@shared/debug'
import type { ProgramImage } from '@shared/program'
import { FALLBACK_CGT, frontendOptions } from '../build/fallback'
import { readBuildConfig } from '../build/projectConfig'
import { findSources } from '../build/sources'

/** Everything a debug worker needs: the sources and front-end options of the build, and where the linker put things. */
export async function debugLaunch(projectDir: string, image: ProgramImage, toolchain: Toolchain | null): Promise<DebugLaunch> {
  const cgt = toolchain?.root ?? FALLBACK_CGT
  const cfg = await readBuildConfig(projectDir, cgt)
  const o = frontendOptions(cfg, cgt)
  return {
    projectDir,
    sources: await findSources(projectDir),
    includePaths: o.includePaths,
    defines: o.defines,
    dialect: o.dialect,
    diagWarnings: o.diagWarnings,
    image
  }
}
```

Run: `npx vitest run tests/unit/debug`
Expected: `channel` (1 test) and `launch` (1 test) pass; the worker test is skipped.

- [ ] **Step 4: Implement the worker and the session**

```ts path=src/main/debug/worker.ts
import { readFileSync } from 'fs'
import { parentPort, workerData } from 'worker_threads'
import type { DebugEvent, DebugLaunch } from '@shared/debug'
import { Debugger } from '../../interp/debug/debugger'
import { statementLines } from '../../interp/debug/lines'
import type { RunIO } from '../../interp/exec/machine'
import type { TranslationUnit } from '../../interp/frontend/ast'
import { compileUnit, linkProgram } from '../../interp/frontend/program'
import { LoadError, loadProgram } from '../../interp/run'
import { nodeHostFiles } from '../../interp/runtime/hostfs'
import { renderDiagnostic } from '../build/fallback'
import { workerChannel } from './channel'

const { launch, buffer } = workerData as { launch: DebugLaunch; buffer: SharedArrayBuffer }
const post = (event: DebugEvent): void => parentPort?.postMessage(event)

function start(): void {
  const readFile = (f: string): string | null => {
    try {
      return readFileSync(f, 'utf8')
    } catch {
      return null
    }
  }
  const options = { readFile, includePaths: launch.includePaths, defines: launch.defines, dialect: launch.dialect, diagWarnings: launch.diagWarnings }
  const units: TranslationUnit[] = []
  const errors: string[] = []
  for (const src of launch.sources) {
    const r = compileUnit(src, options)
    for (const d of r.diagnostics) if (d.severity === 'error') errors.push(renderDiagnostic(d, launch.projectDir))
    if (r.unit) units.push(r.unit)
  }
  if (errors.length > 0) {
    post({ event: 'failed', messages: ["LabSim's C front-end cannot load this program:", ...errors] })
    return
  }
  const link = linkProgram(units)
  if (!link.program) {
    post({ event: 'failed', messages: link.problems.map((p) => (p.kind === 'unresolved' ? `unresolved symbol ${p.name}` : `symbol ${p.name} is defined twice`)) })
    return
  }
  let dbg: Debugger | null = null
  const io: RunIO = {
    write: (text, stream) => post({ event: 'output', text, stream }),
    note: (text) => post({ event: 'note', text }),
    readLine: () => (dbg as Debugger).readLine(),
    files: nodeHostFiles(launch.projectDir)
  }
  try {
    const m = loadProgram(link.program, launch.image, io)
    dbg = new Debugger(m, workerChannel(buffer, post), statementLines(link.program))
  } catch (e) {
    if (!(e instanceof LoadError)) throw e
    post({ event: 'failed', messages: [`${e.loc ? `${e.loc.file}:${e.loc.line}: ` : ''}${e.message}`] })
    return
  }
  post({ event: 'loaded' })
  dbg.run()
}

start()
```

```ts path=src/main/debug/session.ts
import type { Worker } from 'worker_threads'
import type { DebugCommand, DebugEvent, DebugLaunch, DebugRequest } from '@shared/debug'
import { CommandSender, createDebugBuffer } from './channel'
import createDebugWorker from './worker?nodeWorker'

/** One debug session: a worker thread running the program under the Debugger. */
export class DebugSession {
  private readonly worker: Worker
  private readonly sender: CommandSender
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private ended = false

  constructor(
    launch: DebugLaunch,
    private readonly onEvent: (event: DebugEvent) => void
  ) {
    const buffer = createDebugBuffer()
    this.sender = new CommandSender(buffer)
    this.worker = createDebugWorker({ workerData: { launch, buffer } })
    this.worker.on('message', (event: DebugEvent) => {
      if (event.event !== 'reply') {
        this.onEvent(event)
        return
      }
      const p = this.pending.get(event.id)
      this.pending.delete(event.id)
      if (event.error !== undefined) p?.reject(new Error(event.error))
      else p?.resolve(event.result)
    })
    this.worker.on('error', (e) => this.onEvent({ event: 'failed', messages: [`LabSim's debugger stopped: ${e.message}`] }))
    this.worker.on('exit', () => this.finish())
  }

  get alive(): boolean {
    return !this.ended
  }

  request(cmd: DebugCommand): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error('The debug session has ended.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.sender.send({ ...cmd, id } as DebugRequest)
    })
  }

  /** Asks the worker to stop; kills it if it has not stopped within half a second. */
  async terminate(): Promise<void> {
    if (this.ended) return
    const exited = new Promise<void>((resolve) => this.worker.once('exit', () => resolve()))
    this.sender.send({ id: 0, cmd: 'terminate' })
    const timer = setTimeout(() => void this.worker.terminate(), 500)
    await exited
    clearTimeout(timer)
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    for (const p of this.pending.values()) p.reject(new Error('The debug session has ended.'))
    this.pending.clear()
    this.onEvent({ event: 'ended' })
  }
}
```

In `tsconfig.node.json`, change `"types": ["node"]` to `"types": ["node", "electron-vite/node"]`.

- [ ] **Step 5: Wire IPC, preload, the API and the menu**

In `src/shared/api.ts`:
- Add `import type { DebugCommand, DebugEvent } from './debug'`.
- Extend `MenuCommand` with these values:

```ts
  | 'run.debug'
  | 'run.resume'
  | 'run.suspend'
  | 'run.terminate'
  | 'run.restart'
  | 'run.reload'
  | 'run.stepInto'
  | 'run.stepOver'
  | 'run.stepReturn'
  | 'run.toLine'
```

- Add these methods to `LabsimApi`:

```ts
  /** Starts debugging the project's last successful build (stopping any running session first). */
  debugStart(projectDir: string): Promise<void>
  debugRequest(cmd: DebugCommand): Promise<unknown>
  debugTerminate(): Promise<void>
  onDebugEvent(cb: (event: DebugEvent) => void): () => void
```

In `src/preload/index.ts`:
- Change the type import to `import type { BuildOutputLine, LabsimApi, MenuCommand } from '@shared/api'` plus `import type { DebugEvent } from '@shared/debug'`.
- Add to `api`:

```ts
  debugStart: (projectDir) => ipcRenderer.invoke('debug:start', projectDir),
  debugRequest: (cmd) => ipcRenderer.invoke('debug:request', cmd),
  debugTerminate: () => ipcRenderer.invoke('debug:terminate'),
  onDebugEvent(cb) {
    const handler = (_e: IpcRendererEvent, event: DebugEvent): void => cb(event)
    ipcRenderer.on('debug:event', handler)
    return () => ipcRenderer.removeListener('debug:event', handler)
  }
```

In `src/main/ipc.ts`:
- Add these imports:

```ts
import type { DebugCommand } from '@shared/debug'
import { debugLaunch } from './debug/launch'
import { DebugSession } from './debug/session'
```

- Add at the end of `registerIpc`:

```ts
  let session: DebugSession | null = null
  ipcMain.handle('debug:start', async (_e, projectDir: string) => {
    const dir = assertInside(ctx.getWorkspace(), projectDir)
    const image = ctx.images.get(dir)
    if (!image) throw new Error(`Build ${path.basename(dir)} successfully before debugging it.`)
    const old = session
    session = null
    await old?.terminate()
    const launch = await debugLaunch(dir, image, ctx.getToolchain())
    const s = new DebugSession(launch, (event) => {
      ctx.getWindow()?.webContents.send('debug:event', event)
      if (event.event === 'ended' && session === s) session = null
    })
    session = s
  })
  ipcMain.handle('debug:request', (_e, cmd: DebugCommand) => {
    if (!session) throw new Error('No debug session is running.')
    return session.request(cmd)
  })
  ipcMain.handle('debug:terminate', async () => {
    const s = session
    session = null
    await s?.terminate()
  })
```

In `src/main/menu.ts`:
- Replace `{ label: 'Run', submenu: [{ label: 'Debug', accelerator: 'F11', enabled: false }] },` with:

```ts
    {
      label: 'Run',
      // The renderer handles these keys (Monaco would take F8, the window Ctrl+R); the menu only shows them.
      submenu: [
        { label: 'Debug', accelerator: 'F11', registerAccelerator: false, click: send('run.debug') },
        { type: 'separator' },
        { label: 'Resume', accelerator: 'F8', registerAccelerator: false, click: send('run.resume') },
        { label: 'Suspend', accelerator: 'Alt+F8', registerAccelerator: false, click: send('run.suspend') },
        { label: 'Terminate', accelerator: 'Ctrl+F2', registerAccelerator: false, click: send('run.terminate') },
        { label: 'Restart', click: send('run.restart') },
        { label: 'Reload Program', click: send('run.reload') },
        { type: 'separator' },
        { label: 'Step Into', accelerator: 'F5', registerAccelerator: false, click: send('run.stepInto') },
        { label: 'Step Over', accelerator: 'F6', registerAccelerator: false, click: send('run.stepOver') },
        { label: 'Step Return', accelerator: 'F7', registerAccelerator: false, click: send('run.stepReturn') },
        { label: 'Run to Line', accelerator: 'Ctrl+R', registerAccelerator: false, click: send('run.toLine') }
      ]
    },
```

- Replace `{ role: 'reload' }` with `{ role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' }`.

In `tests/unit/store.test.ts`, add these to the `api` object in `fakeApi()`, after `onBuildOutput`:

```ts
    debugStart: async () => {},
    debugRequest: async () => null,
    debugTerminate: async () => {},
    onDebugEvent: () => () => {},
```

- [ ] **Step 6: Build the app and run the worker test**

Run: `npm run typecheck && npm run build && npx vitest run tests/unit/debug tests/unit/store.test.ts`
Expected:
- no type errors;
- the electron-vite build succeeds and emits the worker chunk into `out/main/`;
- all debug tests pass, including the worker test, which now finds the bundled worker. The program stops at line 4, resumes, prints `k=42`, exits and terminates.

- [ ] **Step 7: Commit**

```bash
git add src/main src/preload src/shared tsconfig.node.json tests/unit/debug tests/unit/store.test.ts
git commit -m "feat(debug): worker-thread debug session with a SharedArrayBuffer command slot, IPC and the Run menu"
```

---
### Task 5: The renderer's debug store

**Files:**
- Create: `src/renderer/src/debugStore.ts`
- Modify: `src/renderer/src/appStore.ts` (create `debugStore` and add `useDebug`)
- Test: `tests/unit/debugStore.test.ts`

**Interfaces:**
- Consumes:
  - the `LabsimApi` debug calls (Task 4) and `@shared/debug` types;
  - `AppStore` actions: `build`, `print`, `clearConsole`, `setActiveConsole`, `setBottomTab`, `setPerspective`, `openAt`, and the `selectedProject` state.
- Produces:
  - `createDebugStore(api, app)` and `type DebugStore`.
  - `DebugState` fields: `status`, `project`, `reason`, `message`, `frames`, `selectedFrame`, `pc`, `variables`, `expressions`, `results`, `children`, `formats`, `breakpoints`, `inputPending`.
  - `DebugState` actions: `start`, `reload`, `restart`, `terminate`, `resume`, `suspend`, `stepInto`, `stepOver`, `stepReturn`, `runToLine`, `toggleBreakpoint`, `setBreakpointEnabled`, `removeBreakpoint`, `removeAllBreakpoints`, `selectFrame`, `toggleExpand`, `addExpression`, `removeExpression`, `editValue`, `setFormat`, `sendInput` and `handleEvent`.
  - `cioConsoleName(dir)`, `CIO_PREFIX`, `samePath(a, b)`, `type SessionStatus` and `type Breakpoint`.
  - `appStore.ts` exports `debugStore` and `useDebug(selector)`.

What the store does:
- **Debug** builds the selected project first. If the build fails, the session does not start, and the build console says why.
- **Loading.** When the worker has loaded the program (`loaded`), the store sends every enabled breakpoint. Each reply moves a breakpoint to its verified line, or marks it unverified.
- **On every stop,** the store refreshes the frames, the selected frame's variables, the expressions and the expanded rows. It also shows the stop line in the editor.
- **Output** goes to the `<project>:CIO` console, one console line per program line, each prefixed `[C674X_0] `. stderr lines show as errors, and LabSim notes as information.
- **Runtime errors.** A halt prints `LabSim: <message> (<file>:<line>)` in red.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/debugStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult, FileNode, LabsimApi, ProjectInfo } from '@shared/api'
import type { DebugCommand, DebugEvent, VarNode } from '@shared/debug'
import { cioConsoleName, createDebugStore, type DebugStore } from '../../src/renderer/src/debugStore'
import { buildConsoleName, createAppStore, type AppStore } from '../../src/renderer/src/store'

const WS = 'C:\\ws'
const P = `${WS}\\exp11`
const MAIN = `${P}\\main.c`
const CIO = cioConsoleName(P)

const node = (name: string, value: string, expandable = false): VarNode => ({ name, expr: name, type: 'int', value, address: '0x80001000', expandable })

function fakeApi() {
  const requests: DebugCommand[] = []
  const api = {
    requests,
    starts: [] as string[],
    terminated: 0,
    nextBuild: { ok: true, diagnostics: [], image: null } as BuildResult,
    getWorkspace: async () => WS,
    switchWorkspace: async () => null,
    listProjects: async (): Promise<ProjectInfo[]> => [{ name: 'exp11', dir: P, isCcsProject: true }],
    readTree: async (): Promise<FileNode[]> => [{ name: 'main.c', path: MAIN, kind: 'file' }],
    readFile: async () => 'int main(void)\n{\n    int i;\n}\n',
    writeFile: async () => {},
    onMenu: () => () => {},
    getToolchain: async () => null,
    chooseCompiler: async () => null,
    build: async () => api.nextBuild,
    onBuildOutput: () => () => {},
    debugStart: async (dir: string) => {
      api.starts.push(dir)
    },
    debugTerminate: async () => {
      api.terminated++
    },
    onDebugEvent: () => () => {},
    debugRequest: async (cmd: DebugCommand): Promise<unknown> => {
      requests.push(cmd)
      switch (cmd.cmd) {
        case 'stackFrames':
          return [{ index: 0, name: 'main', file: MAIN, line: 3 }]
        case 'variables':
          return [node('i', cmd.formats.i === 'hex' ? '0x00000002' : '2')]
        case 'evaluate':
          return node(cmd.expr, '42')
        case 'children':
          return [node('[0]', '7')]
        case 'setBreakpoints':
          return cmd.lines.map((l) => (l === 1 ? 3 : l > 4 ? null : l))
        default:
          return null
      }
    }
  }
  return api
}

let api: ReturnType<typeof fakeApi>
let app: AppStore
let dbg: DebugStore
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const lines = (name: string): string[] => (app.getState().consoles[name] ?? []).map((l) => l.text)
const stopped = (line: number, reason: 'breakpoint' | 'step' | 'entry' = 'step'): DebugEvent => ({ event: 'stopped', reason, file: MAIN, line })

beforeEach(async () => {
  api = fakeApi()
  app = createAppStore(api as unknown as LabsimApi)
  await app.getState().init()
  dbg = createDebugStore(api as unknown as LabsimApi, app)
})

describe('starting', () => {
  it('builds, clears the CIO console, switches to CCS Debug and launches', async () => {
    app.getState().print(CIO, 'old')
    await dbg.getState().start()
    expect(api.starts).toEqual([P])
    expect(dbg.getState()).toMatchObject({ status: 'starting', project: P })
    expect(app.getState()).toMatchObject({ perspective: 'debug', activeConsole: CIO })
    expect(lines(CIO)).toEqual([])
  })

  it('does not launch when the build fails', async () => {
    api.nextBuild = { ok: false, diagnostics: [], image: null }
    await dbg.getState().start()
    expect(api.starts).toEqual([])
    expect(lines(buildConsoleName(P)).at(-1)).toBe("Errors exist in project 'exp11'. Fix them before debugging.")
  })

  it('sends breakpoints once loaded and moves them to verified lines', async () => {
    await dbg.getState().toggleBreakpoint(MAIN, 1)
    await dbg.getState().toggleBreakpoint(MAIN, 9)
    expect(api.requests).toEqual([])
    await dbg.getState().start()
    dbg.getState().handleEvent({ event: 'loaded' })
    await settle()
    expect(api.requests).toEqual([{ cmd: 'setBreakpoints', file: MAIN, lines: [1, 9] }])
    expect(dbg.getState().breakpoints).toEqual([
      { file: MAIN, line: 3, enabled: true, verified: true },
      { file: MAIN, line: 9, enabled: true, verified: false }
    ])
    expect(dbg.getState().status).toBe('running')
  })
})

describe('stopping', () => {
  beforeEach(async () => {
    await dbg.getState().start()
    dbg.getState().handleEvent({ event: 'loaded' })
    await dbg.getState().addExpression('y[3]')
  })

  it('refreshes frames, variables and expressions and shows the line', async () => {
    dbg.getState().handleEvent(stopped(3, 'entry'))
    await settle()
    await settle()
    const s = dbg.getState()
    expect(s).toMatchObject({ status: 'suspended', reason: 'entry', pc: { file: MAIN, line: 3 }, selectedFrame: 0 })
    expect(s.frames.map((f) => f.name)).toEqual(['main'])
    expect(s.variables.map((v) => v.value)).toEqual(['2'])
    expect(s.results['y[3]'].value).toBe('42')
    expect(app.getState().activeTab).toBe(MAIN)
    expect(app.getState().reveal).toMatchObject({ path: MAIN, line: 3 })
  })

  it('sends step commands only while suspended, and suspend only while running', async () => {
    api.requests.length = 0
    await dbg.getState().stepOver()
    await dbg.getState().suspend()
    expect(api.requests.map((r) => r.cmd)).toEqual(['suspend'])
    dbg.getState().handleEvent(stopped(3))
    await settle()
    api.requests.length = 0
    await dbg.getState().stepOver()
    await dbg.getState().runToLine(MAIN, 4)
    expect(api.requests.map((r) => r.cmd)).toEqual(['stepOver', 'runToLine'])
    dbg.getState().handleEvent({ event: 'running' })
    expect(dbg.getState()).toMatchObject({ status: 'running', pc: null })
  })

  it('formats and expands values, and changes them', async () => {
    dbg.getState().handleEvent(stopped(3))
    await settle()
    await dbg.getState().setFormat('i', 'hex')
    expect(dbg.getState().variables[0].value).toBe('0x00000002')
    await dbg.getState().toggleExpand('var', 'y')
    expect(dbg.getState().children['var:y'].map((c) => c.value)).toEqual(['7'])
    await dbg.getState().toggleExpand('var', 'y')
    expect(dbg.getState().children['var:y']).toBeUndefined()
    await dbg.getState().editValue('i', '5')
    expect(api.requests).toContainEqual({ cmd: 'assign', frame: 0, expr: 'i', value: '5' })
  })
})

describe('console', () => {
  beforeEach(async () => {
    await dbg.getState().start()
    dbg.getState().handleEvent({ event: 'loaded' })
  })

  it('prefixes program output with [C674X_0] and shows notes and runtime errors', () => {
    const d = dbg.getState()
    d.handleEvent({ event: 'output', text: 'x=1\ny=2\n', stream: 'stdout' })
    d.handleEvent({ event: 'output', text: 'oops\n', stream: 'stderr' })
    d.handleEvent({ event: 'note', text: "write past end of 'y' (y[8], size 8)" })
    d.handleEvent({ event: 'stopped', reason: 'halt', file: MAIN, line: 4, message: 'Division by zero' })
    expect(app.getState().consoles[CIO].map((l) => `${l.kind}:${l.text}`)).toEqual([
      'out:[C674X_0] x=1',
      'out:[C674X_0] y=2',
      'error:[C674X_0] oops',
      "info:LabSim: write past end of 'y' (y[8], size 8)",
      'error:LabSim: Division by zero (main.c:4)'
    ])
    expect(dbg.getState().status).toBe('halted')
  })

  it('asks for input and sends the typed line', async () => {
    dbg.getState().handleEvent({ event: 'inputRequest' })
    expect(dbg.getState().inputPending).toBe(true)
    await dbg.getState().sendInput('21')
    expect(api.requests).toContainEqual({ cmd: 'input', text: '21' })
    expect(lines(CIO).at(-1)).toBe('21')
    expect(dbg.getState().inputPending).toBe(false)
  })

  it('goes idle when terminated', async () => {
    await dbg.getState().terminate()
    expect(api.terminated).toBe(1)
    expect(dbg.getState()).toMatchObject({ status: 'idle', pc: null, frames: [] })
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/debugStore.test.ts`
Expected: FAIL, because `src/renderer/src/debugStore` does not exist.

- [ ] **Step 3: Implement the store**

```ts path=src/renderer/src/debugStore.ts
import { createStore } from 'zustand/vanilla'
import type { LabsimApi } from '@shared/api'
import type { DebugCommand, DebugEvent, FrameInfo, NumberFormat, StopReason, VarNode } from '@shared/debug'
import { basename } from '@shared/files'
import { buildConsoleName, type AppStore } from './store'

export type SessionStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'exited' | 'halted'

export interface Breakpoint {
  file: string
  line: number
  enabled: boolean
  /** The debugger confirmed a statement at this line (after a session loaded). */
  verified: boolean
}

export const CIO_PREFIX = '[C674X_0] '
export const cioConsoleName = (projectDir: string): string => `${basename(projectDir)}:CIO`
export const samePath = (a: string, b: string): boolean => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

export interface DebugState {
  status: SessionStatus
  project: string | null
  reason: StopReason | null
  message: string | null
  frames: FrameInfo[]
  selectedFrame: number
  /** The line the target is stopped at. */
  pc: { file: string; line: number } | null
  variables: VarNode[]
  expressions: string[]
  results: Record<string, VarNode>
  /** Expanded rows, `var:<expr>` or `expr:<expr>` → their children. */
  children: Record<string, VarNode[]>
  formats: Record<string, NumberFormat>
  breakpoints: Breakpoint[]
  inputPending: boolean

  start(): Promise<void>
  reload(): Promise<void>
  restart(): Promise<void>
  terminate(): Promise<void>
  resume(): Promise<void>
  suspend(): Promise<void>
  stepInto(): Promise<void>
  stepOver(): Promise<void>
  stepReturn(): Promise<void>
  runToLine(file: string, line: number): Promise<void>
  toggleBreakpoint(file: string, line: number): Promise<void>
  setBreakpointEnabled(index: number, enabled: boolean): Promise<void>
  removeBreakpoint(index: number): Promise<void>
  removeAllBreakpoints(): Promise<void>
  selectFrame(index: number): Promise<void>
  toggleExpand(view: 'var' | 'expr', expr: string): Promise<void>
  addExpression(text: string): Promise<void>
  removeExpression(text: string): void
  editValue(expr: string, value: string): Promise<void>
  setFormat(expr: string, format: NumberFormat): Promise<void>
  sendInput(text: string): Promise<void>
  handleEvent(event: DebugEvent): void
}

const ACTIVE: SessionStatus[] = ['running', 'suspended', 'exited', 'halted']

export function createDebugStore(api: LabsimApi, app: AppStore) {
  return createStore<DebugState>()((set, get) => {
    const consoleName = (): string => cioConsoleName(get().project ?? '')
    const active = (): boolean => ACTIVE.includes(get().status)

    /** A request whose failure is shown in the console instead of thrown. */
    const request = async <T>(cmd: DebugCommand): Promise<T | null> => {
      try {
        return (await api.debugRequest(cmd)) as T
      } catch (e) {
        app.getState().print(consoleName(), `LabSim: ${e instanceof Error ? e.message : String(e)}`, 'error')
        return null
      }
    }

    const syncFile = async (file: string): Promise<void> => {
      if (!active()) return
      const mine = get().breakpoints.filter((b) => b.enabled && samePath(b.file, file))
      const verified = await request<(number | null)[]>({ cmd: 'setBreakpoints', file, lines: mine.map((b) => b.line) })
      if (!verified) return
      set((s) => {
        const moved = s.breakpoints.map((b) => {
          const k = mine.indexOf(b)
          if (k < 0) return b
          const v = verified[k]
          return v === null || v === undefined ? { ...b, verified: false } : { ...b, line: v, verified: true }
        })
        return { breakpoints: moved.filter((b, i) => moved.findIndex((o) => samePath(o.file, b.file) && o.line === b.line) === i) }
      })
    }

    const syncAll = async (): Promise<void> => {
      const files: string[] = []
      for (const b of get().breakpoints) if (!files.some((f) => samePath(f, b.file))) files.push(b.file)
      for (const f of files) await syncFile(f)
    }

    const refreshValues = async (): Promise<void> => {
      const { selectedFrame: frame, formats, expressions } = get()
      const variables = (await request<VarNode[]>({ cmd: 'variables', frame, formats })) ?? []
      const results: Record<string, VarNode> = {}
      for (const expr of expressions) {
        const r = await request<VarNode>({ cmd: 'evaluate', frame, expr, format: formats[expr] ?? 'natural' })
        if (r) results[expr] = r
      }
      const children: Record<string, VarNode[]> = {}
      for (const key of Object.keys(get().children)) {
        children[key] = (await request<VarNode[]>({ cmd: 'children', frame, expr: key.slice(key.indexOf(':') + 1), formats })) ?? []
      }
      set({ variables, results, children })
    }

    const refresh = async (): Promise<void> => {
      const frames = (await request<FrameInfo[]>({ cmd: 'stackFrames' })) ?? []
      set({ frames, selectedFrame: 0 })
      await refreshValues()
    }

    const control = async (cmd: DebugCommand): Promise<void> => {
      if (get().status === 'suspended') await request(cmd)
    }

    const launch = async (dir: string): Promise<void> => {
      set({ status: 'starting', project: dir, reason: null, message: null, frames: [], pc: null, variables: [], results: {}, children: {}, inputPending: false })
      const a = app.getState()
      const name = cioConsoleName(dir)
      a.clearConsole(name)
      a.setActiveConsole(name)
      a.setBottomTab('console')
      a.setPerspective('debug')
      try {
        await api.debugStart(dir)
      } catch (e) {
        a.print(name, `LabSim: ${e instanceof Error ? e.message : String(e)}`, 'error')
        set({ status: 'idle' })
      }
    }

    return {
      status: 'idle',
      project: null,
      reason: null,
      message: null,
      frames: [],
      selectedFrame: 0,
      pc: null,
      variables: [],
      expressions: [],
      results: {},
      children: {},
      formats: {},
      breakpoints: [],
      inputPending: false,

      async start() {
        const dir = app.getState().selectedProject
        if (!dir || get().status === 'starting' || app.getState().building) return
        const result = await app.getState().build('build')
        if (!result) return
        if (!result.ok) {
          app.getState().print(buildConsoleName(dir), `Errors exist in project '${basename(dir)}'. Fix them before debugging.`, 'error')
          return
        }
        await launch(dir)
      },

      async reload() {
        await get().start()
      },

      async restart() {
        const dir = get().project
        if (dir && get().status !== 'idle' && get().status !== 'starting') await launch(dir)
      },

      async terminate() {
        if (get().status === 'idle') return
        await api.debugTerminate()
        set({ status: 'idle', pc: null, frames: [], variables: [], inputPending: false })
      },

      resume: () => control({ cmd: 'resume' }),
      stepInto: () => control({ cmd: 'stepInto' }),
      stepOver: () => control({ cmd: 'stepOver' }),
      stepReturn: () => control({ cmd: 'stepReturn' }),
      runToLine: (file, line) => control({ cmd: 'runToLine', file, line }),

      async suspend() {
        if (get().status === 'running') await request({ cmd: 'suspend' })
      },

      async toggleBreakpoint(file, line) {
        const bps = get().breakpoints
        const i = bps.findIndex((b) => samePath(b.file, file) && b.line === line)
        set({ breakpoints: i >= 0 ? bps.filter((_, k) => k !== i) : [...bps, { file, line, enabled: true, verified: false }] })
        await syncFile(file)
      },

      async setBreakpointEnabled(index, enabled) {
        const b = get().breakpoints[index]
        if (!b) return
        set((s) => ({ breakpoints: s.breakpoints.map((x, k) => (k === index ? { ...x, enabled } : x)) }))
        await syncFile(b.file)
      },

      async removeBreakpoint(index) {
        const b = get().breakpoints[index]
        if (!b) return
        set((s) => ({ breakpoints: s.breakpoints.filter((_, k) => k !== index) }))
        await syncFile(b.file)
      },

      async removeAllBreakpoints() {
        const files = get().breakpoints.map((b) => b.file)
        set({ breakpoints: [] })
        for (const f of files.filter((f, i) => files.findIndex((o) => samePath(o, f)) === i)) await syncFile(f)
      },

      async selectFrame(index) {
        set({ selectedFrame: index })
        if (active()) await refreshValues()
      },

      async toggleExpand(view, expr) {
        const key = `${view}:${expr}`
        if (get().children[key]) {
          set((s) => {
            const children = { ...s.children }
            delete children[key]
            return { children }
          })
          return
        }
        const kids = (await request<VarNode[]>({ cmd: 'children', frame: get().selectedFrame, expr, formats: get().formats })) ?? []
        set((s) => ({ children: { ...s.children, [key]: kids } }))
      },

      async addExpression(text) {
        const expr = text.trim()
        if (!expr || get().expressions.includes(expr)) return
        set((s) => ({ expressions: [...s.expressions, expr] }))
        if (!active()) return
        const r = await request<VarNode>({ cmd: 'evaluate', frame: get().selectedFrame, expr, format: get().formats[expr] ?? 'natural' })
        if (r) set((s) => ({ results: { ...s.results, [expr]: r } }))
      },

      removeExpression(text) {
        set((s) => {
          const results = { ...s.results }
          delete results[text]
          return { expressions: s.expressions.filter((e) => e !== text), results }
        })
      },

      async editValue(expr, value) {
        if (!active()) return
        const r = await request<VarNode>({ cmd: 'assign', frame: get().selectedFrame, expr, value })
        if (r?.error) app.getState().print(consoleName(), `LabSim: cannot set ${expr}: ${r.error}`, 'error')
        await refreshValues()
      },

      async setFormat(expr, format) {
        set((s) => ({ formats: { ...s.formats, [expr]: format } }))
        if (active()) await refreshValues()
      },

      async sendInput(text) {
        if (!get().inputPending) return
        set({ inputPending: false })
        app.getState().print(consoleName(), text, 'info')
        await request({ cmd: 'input', text })
      },

      handleEvent(event) {
        const a = app.getState()
        switch (event.event) {
          case 'loaded':
            set({ status: 'running' })
            void syncAll()
            break
          case 'running':
            set({ status: 'running', pc: null, reason: null })
            break
          case 'stopped': {
            const status: SessionStatus = event.reason === 'exit' ? 'exited' : event.reason === 'halt' ? 'halted' : 'suspended'
            const pc = event.file && event.line ? { file: event.file, line: event.line } : null
            set({ status, reason: event.reason, message: event.message ?? null, pc, inputPending: false })
            if (event.reason === 'halt') a.print(consoleName(), `LabSim: ${event.message} (${basename(event.file ?? '')}:${event.line})`, 'error')
            if (pc) void a.openAt(pc.file, pc.line)
            void refresh()
            break
          }
          case 'output': {
            const parts = event.text.split('\n')
            if (parts[parts.length - 1] === '') parts.pop()
            for (const p of parts) a.print(consoleName(), CIO_PREFIX + p, event.stream === 'stderr' ? 'error' : 'out')
            break
          }
          case 'note':
            a.print(consoleName(), `LabSim: ${event.text}`, 'info')
            break
          case 'inputRequest':
            set({ inputPending: true })
            a.setActiveConsole(consoleName())
            a.setBottomTab('console')
            break
          case 'failed':
            a.print(consoleName(), event.messages.join('\n'), 'error')
            set({ status: 'idle', pc: null, frames: [] })
            break
          case 'ended':
            if (get().status !== 'starting') set({ status: 'idle', pc: null, frames: [], variables: [], inputPending: false })
            break
          case 'reply':
            break
        }
      }
    }
  })
}

export type DebugStore = ReturnType<typeof createDebugStore>
```

- [ ] **Step 4: Create the app's debug store**

Replace `src/renderer/src/appStore.ts` with:

```ts path=src/renderer/src/appStore.ts
import { useStore } from 'zustand'
import { createDebugStore, type DebugState } from './debugStore'
import { createAppStore, type AppState } from './store'

export const appStore = createAppStore(window.labsim)
export const debugStore = createDebugStore(window.labsim, appStore)

/** Select a slice of app state. Return primitives or existing references only (zustand 5 re-renders on new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector)
}

/** Select a slice of the debug session state (same rule as useApp). */
export function useDebug<T>(selector: (s: DebugState) => T): T {
  return useStore(debugStore, selector)
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/debugStore.test.ts tests/unit/store.test.ts && npm run typecheck`
Expected: PASS (9 debug-store tests, plus the existing store tests), and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/debugStore.ts src/renderer/src/appStore.ts tests/unit/debugStore.test.ts
git commit -m "feat(ui): debug session store: launch, stops, breakpoints, expressions, CIO console and stdin"
```

---
### Task 6: The debug UI (views, gutter, toolbar, keys, console input)

**Files:**
- Create: `src/renderer/src/components/VariablesTable.tsx`, `src/renderer/src/components/BreakpointsView.tsx`
- Modify:
  - `src/renderer/src/components/DebugViews.tsx` (Debug view tree, Variables and Expressions);
  - `Toolbar.tsx`, `EditorArea.tsx`, `ConsoleView.tsx`, `icons.tsx`;
  - `src/renderer/src/App.tsx` (menu commands, keys, debug events);
  - `src/renderer/src/styles.css`.
- Test: `tests/e2e/debug.spec.ts`, and modify `tests/e2e/shell.spec.ts`.

**Interfaces:**
- Consumes: `debugStore` and `useDebug` (Task 5); `cioConsoleName` and `samePath`; and the `run.*` menu commands (Task 4).
- Produces: `getCursorLine()` from `EditorArea.tsx`, the cursor line Run to Line uses.

Details of the UI:
- **Debug view.** The tree shows the project, then `Texas Instruments XDS100v3 USB Debug Probe_0/C674X_0 (<state>)`, then one row per frame (`square() at main.c:5`).
  - The state is `Loading`, `Running`, `Suspended` or `Suspended - SW Breakpoint`.
  - After `main` returns, the frame row is `C$$EXIT()`.
  - Clicking a frame selects it and shows its line.
- **Variables and Expressions** share one table (Name, Type, Value, Location).
  - A twisty expands arrays, structs and pointers.
  - Double-clicking a scalar value edits it (Enter to apply).
  - Right-click opens Number Format (Natural, Hex, Decimal, Binary, Char), plus Remove on an expression.
  - The Expressions table ends with an "Add new expression" row.
- **Breakpoints** lists `main.c, line 11` with an enable checkbox and a remove button, plus Remove All. Double-clicking a row shows the line.
- **Editor.**
  - Double-clicking the line numbers or the glyph margin toggles a breakpoint: a blue dot in the glyph margin, hollow when disabled.
  - The line the target is stopped at gets a light green band and a green bar.
- **Keys.** F11, F8, Alt+F8, Ctrl+F2, F5, F6, F7 and Ctrl+R are caught on the window before Monaco sees them.
- **Console.** An input line appears under the `<project>:CIO` console while the program waits for input.

- [ ] **Step 1: Write the failing end-to-end test**

```ts path=tests/e2e/debug.spec.ts
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const CMD = join(__dirname, '../fixtures/ccs/C6748.cmd')
let app: ElectronApplication
let page: Page
let ws: string

function addProject(name: string, main: string): void {
  mkdirSync(join(ws, name))
  writeFileSync(join(ws, name, '.project'), `<projectDescription><name>${name}</name></projectDescription>`)
  writeFileSync(join(ws, name, 'main.c'), main.replace(/\n/g, '\r\n'))
  copyFileSync(CMD, join(ws, name, 'C6748.cmd'))
}

const DBG = [
  '#include <stdio.h>', //                  1
  'float y[4];', //                         2
  'int square(int v)', //                   3
  '{', //                                   4
  '    return v * v;', //                   5
  '}', //                                   6
  'int main(void)', //                      7
  '{', //                                   8
  '    int i;', //                          9
  '    for (i = 0; i < 4; i++) {', //       10
  '        y[i] = square(i) * 0.5f;', //    11
  '    }', //                               12
  '    printf("done %d\\n", square(3));', // 13
  '    return 0;', //                       14
  '}' //                                    15
].join('\n') + '\n'

test.beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-dbg-'))
  addProject('dbg', DBG)
  addProject('ask', '#include <stdio.h>\nint main(void)\n{\n    int n = 0;\n    printf("n? ");\n    scanf("%d", &n);\n    printf("twice %d\\n", n * 2);\n    return 0;\n}\n')
  addProject('crash', 'int main(void)\n{\n    int z = 0;\n    return 7 / z;\n}\n')
  const userData = mkdtempSync(join(tmpdir(), 'labsim-ud-'))
  const noCompiler = mkdtempSync(join(tmpdir(), 'labsim-nocgt-'))
  app = await electron.launch({ args: ['.'], env: { ...process.env, LABSIM_WORKSPACE: ws, LABSIM_USERDATA: userData, LABSIM_COMPILER_ROOT: noCompiler } })
  page = await app.firstWindow()
  await expect(page.locator('.tree-row').first()).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
})

const row = (name: string) => page.locator('.tree-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })
const debugTree = () => page.locator('.debug-tree')
const variable = (name: string) => page.locator(`.var-row[data-name="${name}"]`)
const lineNumber = (n: number) => page.locator('.monaco-editor .line-numbers', { hasText: new RegExp(`^${n}$`) })

test('stops at main, breaks, steps, evaluates and runs to C$$EXIT', async () => {
  await row('dbg').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(debugTree()).toContainText('main() at main.c:10')
  await expect(debugTree()).toContainText('XDS100v3 USB Debug Probe_0/C674X_0 (Suspended)')
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('square(i)')
  await lineNumber(11).dblclick()
  await page.getByRole('button', { name: 'Breakpoints' }).click()
  await expect(page.locator('.bp-row')).toContainText('main.c, line 11')
  await page.getByTitle('Resume (F8)').click()
  await expect(debugTree()).toContainText('(Suspended - SW Breakpoint)')
  await expect(debugTree()).toContainText('main() at main.c:11')
  await page.getByRole('button', { name: 'Variables' }).click()
  await expect(variable('i')).toContainText('0')
  await page.getByTitle('Step Into (F5)').click()
  await expect(debugTree()).toContainText('square() at main.c:5')
  await page.getByTitle('Step Return (F7)').click()
  await expect(debugTree()).toContainText('main() at main.c:10')
  await page.getByTitle('Resume (F8)').click()
  await expect(debugTree()).toContainText('main() at main.c:11')
  await expect(variable('i')).toContainText('1')
  await page.getByRole('button', { name: 'Expressions' }).click()
  await page.getByLabel('Add new expression').fill('y[0] + i * 2')
  await page.getByLabel('Add new expression').press('Enter')
  await expect(variable('y[0] + i * 2')).toContainText('2')
  await lineNumber(11).dblclick()
  await page.getByTitle('Resume (F8)').click()
  await expect(debugTree()).toContainText('C$$EXIT()')
  await expect(page.locator('.console')).toContainText('[C674X_0] done 9')
  await page.getByLabel('Add new expression').fill('y[3]')
  await page.getByLabel('Add new expression').press('Enter')
  await expect(variable('y[3]')).toContainText('4.5')
  await page.getByTitle('Terminate (Ctrl+F2)').click()
  await expect(page.getByText('No debug session is running.')).toBeVisible()
})

test('gives a typed console line to scanf', async () => {
  await row('ask').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(debugTree()).toContainText('main() at main.c:4')
  await page.keyboard.press('F8')
  const input = page.getByLabel('Console input')
  await expect(input).toBeVisible()
  await expect(page.locator('.console')).toContainText('[C674X_0] n?')
  await input.fill('21')
  await input.press('Enter')
  await expect(page.locator('.console')).toContainText('[C674X_0] twice 42')
  await expect(debugTree()).toContainText('C$$EXIT()')
})

test('halts at the line of a runtime error', async () => {
  await row('crash').click()
  await page.getByTitle('Debug (F11)').click()
  await expect(debugTree()).toContainText('main() at main.c:3')
  await page.getByTitle('Resume (F8)').click()
  await expect(page.locator('.console')).toContainText('LabSim: Division by zero (main.c:4)')
  await expect(debugTree()).toContainText('main() at main.c:4')
  await expect(page.locator('.monaco-editor .pc-line')).toHaveCount(1)
})
```

In `tests/e2e/shell.spec.ts`, replace the test `'build is enabled; debug stays disabled until the debugger exists'` with:

```ts
test('build and debug are enabled for the active project', async () => {
  await expect(page.getByTitle('Build Project (Ctrl+B)')).toBeEnabled()
  await expect(page.getByTitle('Debug (F11)')).toBeEnabled()
})
```

Run: `npm run test:e2e`
Expected: the three debug tests FAIL, because the Debug button does nothing yet. The others pass.

- [ ] **Step 2: Add the restart icon and the toolbar buttons**

Append to `src/renderer/src/components/icons.tsx`:

```tsx
export const RestartIcon = (): JSX.Element => (
  <svg {...box}><path d="M3 8a5 5 0 1 0 1.6-3.7" stroke="#2e8b3a" strokeWidth="1.8" fill="none" /><path d="M2 1.5v4.5h4.5z" fill="#2e8b3a" /></svg>
)
```

Replace `src/renderer/src/components/Toolbar.tsx` with:

```tsx path=src/renderer/src/components/Toolbar.tsx
import type { JSX, ReactNode } from 'react'
import { appStore, debugStore, useApp, useDebug } from '../appStore'
import { isDirty } from '../store'
import {
  BugIcon, HammerIcon, RestartIcon, ResumeIcon, SaveIcon, StepIntoIcon, StepOverIcon, StepReturnIcon, SuspendIcon, TerminateIcon
} from './icons'

function TbButton(props: { title: string; disabled?: boolean; onClick?: () => void; children: ReactNode }): JSX.Element {
  return (
    <button className="tb-btn" title={props.title} aria-label={props.title} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

const Sep = (): JSX.Element => <span className="tb-sep" />

export function Toolbar(): JSX.Element {
  const perspective = useApp((s) => s.perspective)
  const canSave = useApp((s) => {
    const t = s.tabs.find((x) => x.path === s.activeTab)
    return !!t && isDirty(t)
  })
  const canBuild = useApp((s) => s.selectedProject !== null && !s.building)
  const status = useDebug((s) => s.status)
  const st = appStore.getState()
  const d = debugStore.getState()
  const suspended = status === 'suspended'
  const live = status !== 'idle' && status !== 'starting'
  return (
    <div className="toolbar">
      <TbButton title="Save (Ctrl+S)" disabled={!canSave} onClick={() => void st.saveTab()}><SaveIcon /></TbButton>
      <Sep />
      <TbButton title="Build Project (Ctrl+B)" disabled={!canBuild} onClick={() => void st.build('build')}><HammerIcon /></TbButton>
      <TbButton title="Debug (F11)" disabled={!canBuild || status === 'starting'} onClick={() => void d.start()}><BugIcon /></TbButton>
      {perspective === 'debug' && (
        <>
          <Sep />
          <TbButton title="Resume (F8)" disabled={!suspended} onClick={() => void d.resume()}><ResumeIcon /></TbButton>
          <TbButton title="Suspend (Alt+F8)" disabled={status !== 'running'} onClick={() => void d.suspend()}><SuspendIcon /></TbButton>
          <TbButton title="Terminate (Ctrl+F2)" disabled={status === 'idle'} onClick={() => void d.terminate()}><TerminateIcon /></TbButton>
          <TbButton title="Restart" disabled={!live} onClick={() => void d.restart()}><RestartIcon /></TbButton>
          <Sep />
          <TbButton title="Step Into (F5)" disabled={!suspended} onClick={() => void d.stepInto()}><StepIntoIcon /></TbButton>
          <TbButton title="Step Over (F6)" disabled={!suspended} onClick={() => void d.stepOver()}><StepOverIcon /></TbButton>
          <TbButton title="Step Return (F7)" disabled={!suspended} onClick={() => void d.stepReturn()}><StepReturnIcon /></TbButton>
        </>
      )}
      <span className="tb-spacer" />
      <div className="perspectives">
        <button className={perspective === 'edit' ? 'persp active' : 'persp'} onClick={() => st.setPerspective('edit')}>CCS Edit</button>
        <button className={perspective === 'debug' ? 'persp active' : 'persp'} onClick={() => st.setPerspective('debug')}>CCS Debug</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build the views**

```tsx path=src/renderer/src/components/VariablesTable.tsx
import { useState, type JSX, type MouseEvent } from 'react'
import type { NumberFormat, VarNode } from '@shared/debug'
import { debugStore, useDebug } from '../appStore'

const FORMATS: [NumberFormat, string][] = [
  ['natural', 'Natural'],
  ['hex', 'Hex'],
  ['decimal', 'Decimal'],
  ['binary', 'Binary'],
  ['char', 'Char']
]

type View = 'var' | 'expr'

interface Menu {
  x: number
  y: number
  expr: string
  removable: boolean
}

function Row(props: { node: VarNode; depth: number; view: View; onMenu: (e: MouseEvent, node: VarNode, depth: number) => void }): JSX.Element {
  const { node, depth, view } = props
  const children = useDebug((s) => s.children[`${view}:${node.expr}`])
  const [editing, setEditing] = useState(false)
  const d = debugStore.getState()
  const editable = !node.error && !node.expandable && node.value !== ''
  return (
    <>
      <tr className="var-row" data-name={node.name} onContextMenu={(e) => props.onMenu(e, node, depth)}>
        <td style={{ paddingLeft: 6 + depth * 14 }}>
          <span className="twisty" onClick={() => node.expandable && void d.toggleExpand(view, node.expr)}>
            {node.expandable ? (children ? '▾' : '▸') : ''}
          </span>
          {node.name}
        </td>
        <td>{node.type}</td>
        <td className={node.error ? 'var-error' : 'var-value'} onDoubleClick={() => editable && setEditing(true)}>
          {editing ? (
            <input
              className="var-edit"
              autoFocus
              defaultValue={node.value.replace(/ '.*'$/, '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditing(false)
                  void d.editValue(node.expr, e.currentTarget.value)
                } else if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={() => setEditing(false)}
            />
          ) : (
            (node.error ?? node.value)
          )}
        </td>
        <td>{node.address}</td>
      </tr>
      {children?.map((c) => <Row key={c.expr} node={c} depth={depth + 1} view={view} onMenu={props.onMenu} />)}
    </>
  )
}

/** The Variables and Expressions table: expandable rows, editable values and a Number Format menu. */
export function VariablesTable(props: { nodes: VarNode[]; view: View; footer?: JSX.Element }): JSX.Element {
  const [menu, setMenu] = useState<Menu | null>(null)
  const expressions = useDebug((s) => s.expressions)
  const d = debugStore.getState()
  const open = (e: MouseEvent, node: VarNode, depth: number): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, expr: node.expr, removable: props.view === 'expr' && depth === 0 && expressions.includes(node.expr) })
  }
  return (
    <div className="var-wrap" onClick={() => setMenu(null)}>
      <table className="grid">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Value</th><th>Location</th></tr>
        </thead>
        <tbody>
          {props.nodes.map((n) => <Row key={n.expr} node={n} depth={0} view={props.view} onMenu={open} />)}
          {props.footer}
        </tbody>
      </table>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-title">Number Format</div>
          {FORMATS.map(([f, label]) => (
            <div
              key={f}
              className="ctx-item"
              onClick={() => {
                setMenu(null)
                void d.setFormat(menu.expr, f)
              }}
            >
              {label}
            </div>
          ))}
          {menu.removable && (
            <div
              className="ctx-item"
              onClick={() => {
                setMenu(null)
                d.removeExpression(menu.expr)
              }}
            >
              Remove
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

```tsx path=src/renderer/src/components/BreakpointsView.tsx
import type { JSX } from 'react'
import { basename } from '@shared/files'
import { appStore, debugStore, useDebug } from '../appStore'

export function BreakpointsView(): JSX.Element {
  const bps = useDebug((s) => s.breakpoints)
  const status = useDebug((s) => s.status)
  const d = debugStore.getState()
  if (bps.length === 0) return <div className="empty">No breakpoints.</div>
  const session = status !== 'idle' && status !== 'starting'
  return (
    <div>
      <div className="bp-bar">
        <button className="link-btn" onClick={() => void d.removeAllBreakpoints()}>Remove All</button>
      </div>
      {bps.map((b, i) => (
        <div key={`${b.file}:${b.line}`} className="bp-row" onDoubleClick={() => void appStore.getState().openAt(b.file, b.line)}>
          <input
            type="checkbox"
            aria-label={`Enable ${basename(b.file)}, line ${b.line}`}
            checked={b.enabled}
            onChange={(e) => void d.setBreakpointEnabled(i, e.target.checked)}
          />
          <span className={b.enabled ? 'bp-dot' : 'bp-dot off'} />
          <span>
            {basename(b.file)}, line {b.line}
            {session && !b.verified ? ' (unverified: no code at or after this line)' : ''}
          </span>
          <button className="tab-close" aria-label="Remove breakpoint" onClick={() => void d.removeBreakpoint(i)}>×</button>
        </div>
      ))}
    </div>
  )
}
```

```tsx path=src/renderer/src/components/DebugViews.tsx
import { useState, type JSX } from 'react'
import type { VarNode } from '@shared/debug'
import { basename } from '@shared/files'
import { appStore, debugStore, useDebug } from '../appStore'
import { BreakpointsView } from './BreakpointsView'
import { VariablesTable } from './VariablesTable'
import { ViewHeader } from './ViewHeader'

export function DebugView(): JSX.Element {
  const status = useDebug((s) => s.status)
  const project = useDebug((s) => s.project)
  const frames = useDebug((s) => s.frames)
  const selected = useDebug((s) => s.selectedFrame)
  const reason = useDebug((s) => s.reason)
  const d = debugStore.getState()
  if (status === 'idle' || !project) {
    return (
      <div className="view">
        <ViewHeader title="Debug" />
        <div className="view-body"><div className="empty">No debug session is running.</div></div>
      </div>
    )
  }
  const state =
    status === 'starting' ? 'Loading' : status === 'running' ? 'Running' : reason === 'breakpoint' ? 'Suspended - SW Breakpoint' : 'Suspended'
  return (
    <div className="view">
      <ViewHeader title="Debug" />
      <div className="view-body debug-tree">
        <div className="dt-row dt-0">▾ {basename(project)} [Code Composer Studio - Device Debugging]</div>
        <div className="dt-row dt-1">▾ Texas Instruments XDS100v3 USB Debug Probe_0/C674X_0 ({state})</div>
        {status === 'exited' ? (
          <div className="dt-row dt-2 selected">C$$EXIT()</div>
        ) : (
          frames.map((f) => (
            <div
              key={f.index}
              className={f.index === selected ? 'dt-row dt-2 selected' : 'dt-row dt-2'}
              onClick={() => {
                void d.selectFrame(f.index)
                if (f.file && f.line) void appStore.getState().openAt(f.file, f.line)
              }}
            >
              {f.name}() at {f.file ? basename(f.file) : '?'}:{f.line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function VariablesView(): JSX.Element {
  const vars = useDebug((s) => s.variables)
  return <VariablesTable nodes={vars} view="var" />
}

function ExpressionsView(): JSX.Element {
  const expressions = useDebug((s) => s.expressions)
  const results = useDebug((s) => s.results)
  const [text, setText] = useState('')
  const nodes: VarNode[] = expressions.map((e) => results[e] ?? { name: e, expr: e, type: '', value: '', address: '', expandable: false })
  const footer = (
    <tr className="add-expr">
      <td colSpan={4}>
        <input
          aria-label="Add new expression"
          placeholder="Add new expression"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              void debugStore.getState().addExpression(text)
              setText('')
            }
          }}
        />
      </td>
    </tr>
  )
  return <VariablesTable nodes={nodes} view="expr" footer={footer} />
}

type VarTab = 'Variables' | 'Expressions' | 'Breakpoints'

export function VariablesPanel(): JSX.Element {
  const [tab, setTab] = useState<VarTab>('Variables')
  return (
    <div className="view">
      <div className="view-tabs">
        {(['Variables', 'Expressions', 'Breakpoints'] as const).map((t) => (
          <button key={t} className={tab === t ? 'vtab active' : 'vtab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="view-body">
        {tab === 'Variables' ? <VariablesView /> : tab === 'Expressions' ? <ExpressionsView /> : <BreakpointsView />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Breakpoints and the current line in the editor**

In `src/renderer/src/components/EditorArea.tsx`:
- Change the imports:
  - `import { appStore, useApp } from '../appStore'` becomes `import { appStore, debugStore, useApp, useDebug } from '../appStore'`;
  - add `import { samePath as sameFile } from '../debugStore'`.
- Add, after the `EDITOR_OPTIONS` constant:

```ts
let activeEditor: MonacoEditor.IStandaloneCodeEditor | null = null

/** The cursor line in the editor (Run to Line). */
export function getCursorLine(): number | null {
  return activeEditor?.getPosition()?.lineNumber ?? null
}
```

- Inside `EditorArea`, after `const revealedSeq = useRef(0)`, add:

```ts
  const breakpoints = useDebug((s) => s.breakpoints)
  const pc = useDebug((s) => s.pc)
  const debugDecorations = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)

  const applyDebug = useCallback(() => {
    const ed = editorRef.current
    const path = appStore.getState().activeTab
    const model = ed?.getModel()
    if (!ed || !path || !model || !debugDecorations.current) return
    const d = debugStore.getState()
    const decorations: MonacoEditor.IModelDeltaDecoration[] = []
    for (const b of d.breakpoints) {
      if (!sameFile(b.file, path) || b.line > model.getLineCount()) continue
      decorations.push({
        range: new monaco.Range(b.line, 1, b.line, 1),
        options: { glyphMarginClassName: b.enabled ? 'bp-glyph' : 'bp-glyph off', glyphMarginHoverMessage: { value: `Breakpoint: line ${b.line}` } }
      })
    }
    if (d.pc && sameFile(d.pc.file, path) && d.pc.line <= model.getLineCount()) {
      decorations.push({ range: new monaco.Range(d.pc.line, 1, d.pc.line, 1), options: { isWholeLine: true, className: 'pc-line', linesDecorationsClassName: 'pc-bar' } })
    }
    debugDecorations.current.set(decorations)
  }, [])

  useEffect(applyDebug, [applyDebug, breakpoints, pc, active, tabs])
```

- In `onMount`, after `editorRef.current = editor`, add:

```ts
    activeEditor = editor
    debugDecorations.current = editor.createDecorationsCollection()
    // CCS toggles a breakpoint with a double-click in the left margin.
    editor.onMouseDown((e) => {
      if (e.event.detail !== 2) return
      const t = e.target.type
      if (t !== m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && t !== m.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return
      const line = e.target.position?.lineNumber
      const path = appStore.getState().activeTab
      if (line && path) void debugStore.getState().toggleBreakpoint(path, line)
    })
```

- At the end of `onMount`, after `applyReveal()`, add `applyDebug()`.

- [ ] **Step 5: The console input line**

In `src/renderer/src/components/ConsoleView.tsx`:
- Change the store import to `import { appStore, debugStore, useApp, useDebug } from '../appStore'`, and add `import { cioConsoleName } from '../debugStore'`.
- Inside `ConsoleView`, after `const st = appStore.getState()`, add:

```ts
  const inputPending = useDebug((s) => s.inputPending)
  const project = useDebug((s) => s.project)
  const showInput = inputPending && project !== null && active === cioConsoleName(project)
```

- After the closing `</pre>`, add:

```tsx
      {showInput && (
        <input
          className="console-input"
          aria-label="Console input"
          autoFocus
          placeholder="The program is waiting for input: type a line and press Enter"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const text = e.currentTarget.value
            e.currentTarget.value = ''
            void debugStore.getState().sendInput(text)
          }}
        />
      )}
```

- [ ] **Step 6: Menu commands, keys and debug events in the app**

In `src/renderer/src/App.tsx`:
- Change `import { appStore, useApp } from './appStore'` to `import { appStore, debugStore, useApp } from './appStore'`.
- Add `import { getCursorLine } from './components/EditorArea'` (keep the `EditorArea` import; merge the two into `import { EditorArea, getCursorLine } from './components/EditorArea'`).
- Replace `handleMenu` with:

```ts
function runToCursor(): void {
  const file = appStore.getState().activeTab
  const line = getCursorLine()
  if (file && line) void debugStore.getState().runToLine(file, line)
}

function handleMenu(cmd: MenuCommand): void {
  const s = appStore.getState()
  const d = debugStore.getState()
  switch (cmd) {
    case 'file.save': void s.saveTab(); break
    case 'file.saveAll': void s.saveAll(); break
    case 'file.refresh': void s.refresh(); break
    case 'file.switchWorkspace': void s.switchWorkspace(); break
    case 'project.build': void s.build('build'); break
    case 'project.rebuild': void s.build('rebuild'); break
    case 'project.clean': void s.build('clean'); break
    case 'window.compilerLocation': void s.chooseCompiler(); break
    case 'window.editPerspective': s.setPerspective('edit'); break
    case 'window.debugPerspective': s.setPerspective('debug'); break
    case 'run.debug': void d.start(); break
    case 'run.resume': void d.resume(); break
    case 'run.suspend': void d.suspend(); break
    case 'run.terminate': void d.terminate(); break
    case 'run.restart': void d.restart(); break
    case 'run.reload': void d.reload(); break
    case 'run.stepInto': void d.stepInto(); break
    case 'run.stepOver': void d.stepOver(); break
    case 'run.stepReturn': void d.stepReturn(); break
    case 'run.toLine': runToCursor(); break
  }
}

/** CCS's debug keys; caught before Monaco (which uses F8 itself) and the window see them. */
const KEYS: Record<string, MenuCommand> = {
  F11: 'run.debug',
  F8: 'run.resume',
  'Alt+F8': 'run.suspend',
  'Ctrl+F2': 'run.terminate',
  F5: 'run.stepInto',
  F6: 'run.stepOver',
  F7: 'run.stepReturn',
  'Ctrl+R': 'run.toLine'
}

function onKey(e: KeyboardEvent): void {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const combo = `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${key}`
  const cmd = KEYS[combo]
  if (!cmd) return
  e.preventDefault()
  e.stopPropagation()
  handleMenu(cmd)
}
```

- In the first `useEffect` of `App`, subscribe to debug events and keys:

```ts
  useEffect(() => {
    void appStore.getState().init()
    const offMenu = window.labsim.onMenu(handleMenu)
    const offBuild = window.labsim.onBuildOutput((line) => appStore.getState().appendBuildOutput(line))
    const offDebug = window.labsim.onDebugEvent((event) => debugStore.getState().handleEvent(event))
    window.addEventListener('keydown', onKey, true)
    return () => {
      offMenu()
      offBuild()
      offDebug()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
```

- [ ] **Step 7: Styles**

Append to `src/renderer/src/styles.css`:

```css
.debug-tree { padding: 2px 0; }
.dt-row { height: 20px; line-height: 20px; white-space: nowrap; cursor: default; }
.dt-0 { padding-left: 6px; }
.dt-1 { padding-left: 20px; }
.dt-2 { padding-left: 40px; }
.dt-row.selected { background: #cfe3f7; }
.var-wrap { min-height: 100%; }
.var-row .twisty { margin-right: 2px; }
.var-error { color: #c9302c; }
.var-edit { width: 100%; box-sizing: border-box; font: inherit; }
.add-expr input { width: 100%; border: none; font: inherit; background: transparent; color: var(--muted); outline: none; }
.ctx-menu { position: fixed; z-index: 20; min-width: 130px; padding: 2px 0; background: #fff; border: 1px solid var(--border); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
.ctx-title { padding: 3px 10px; color: var(--muted); font-size: 11px; }
.ctx-item { padding: 3px 16px; cursor: default; }
.ctx-item:hover { background: #cfe3f7; }
.bp-bar { padding: 2px 6px; border-bottom: 1px solid #eee; }
.bp-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px; }
.bp-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #2b6cc4; }
.bp-dot.off { background: #fff; border: 1px solid #2b6cc4; width: 7px; height: 7px; }
.monaco-editor .bp-glyph { background: #2b6cc4; border-radius: 50%; width: 9px !important; height: 9px !important; margin: 5px 0 0 5px; }
.monaco-editor .bp-glyph.off { background: #fff; border: 1px solid #2b6cc4; width: 7px !important; height: 7px !important; }
.monaco-editor .pc-line { background: rgba(120, 200, 90, 0.25); }
.monaco-editor .pc-bar { background: #3a8a2a; width: 4px !important; margin-left: 3px; }
.console-input { border: none; border-top: 1px solid #ddd; padding: 3px 8px; font-family: Consolas, 'Courier New', monospace; font-size: 12px; outline: none; }
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run typecheck`
Expected: every unit test passes, and there are no type errors.

Run: `npm run test:e2e`
Expected: all 14 Playwright tests pass: the 11 existing ones (with the updated shell test) plus the 3 debug tests.

If a debug e2e step fails, open the app with `npm run dev` and repeat the step by hand. The Electron DevTools console shows renderer errors, and the main process logs worker failures in the terminal.

- [ ] **Step 9: Commit**

```bash
git add src/renderer tests/e2e
git commit -m "feat(ui): CCS-style debug perspective: Debug view, Variables/Expressions/Breakpoints, gutter breakpoints, keys and stdin"
```

---
### Task 7: Check against the real workspace, and record the decisions

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`
- No source changes, unless the check finds a bug. A fix then gets its own regression test and commit.

- [ ] **Step 1: Snapshot `~/workspace_v12`**

```bash
SP=$(mktemp -d)
find ~/workspace_v12 -type f -not -path '*/.labsim/*' -printf '%p %T@\n' | sort > "$SP/before.txt"
ls -d ~/workspace_v12/*/.labsim
```

Note which `.labsim` folders already exist (the user's), so that only new ones are removed in Step 3.

- [ ] **Step 2: Debug `exp11` with cl6x in the built app**

Write a scratch Playwright script in the scratchpad (not the repo) that does the following:
1. Launch the app from `~/dsp-labsim` with `LABSIM_WORKSPACE=~/workspace_v12` and a temporary `LABSIM_USERDATA`, with cl6x left available.
2. Select `exp11` and press Debug. Expect the build console to show `Finished building target: "exp11.out"`, and the Debug view `main() at main.c:10`, the first statement with code: `float xr[N]={1,2,3,4,0,0,0,0};`.
3. Double-click line number 63 (`mag[i]=sqrt(...)`) and resume. Expect `(Suspended - SW Breakpoint)`.
4. In the Variables view, expand `xr`. Expect `[0]` to be `10` and `[4]` to be `-2`.
5. Add the expression `mag` and expand it.
6. Remove the breakpoint and resume. Expect `C$$EXIT()`, and the console to show `[C674X_0] 0	10.000000	0.000000	10.000000	0.000000`.
7. Take a screenshot after steps 3, 4 and 6, and look at each one.

Expected: every expectation holds. `exp11` keeps its arrays as locals of `main`, so they are in `.stack`, and their Location column shows `0x800…` addresses.

- [ ] **Step 3: Remove what the check created and confirm nothing else changed**

```bash
rm -rf ~/workspace_v12/exp11/.labsim   # only if it did not exist in Step 1
find ~/workspace_v12 -type f -not -path '*/.labsim/*' -printf '%p %T@\n' | sort > "$SP/after.txt"
diff "$SP/before.txt" "$SP/after.txt" && echo unchanged
rm -rf "$SP"
```

Expected: `unchanged`.

- [ ] **Step 4: Record the decisions in the spec**

In `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, under `## Debug phase`, append:

```markdown
**How it is built.**
- Each session is a Node worker thread in the main process. The worker compiles the project with LabSim's
  front-end and loads it at the addresses of the last successful build. It then runs the executor under a
  `Debugger` (`src/interp/debug`).
- While stopped, the worker waits in `Atomics.wait` on a SharedArrayBuffer command slot and still answers
  requests (frames, variables, expressions, memory).
- While running, the debugger checks the slot every 20 000 statements, or every statement when a step,
  breakpoint or Run to Line is armed. So Suspend, breakpoint changes and memory reads (Step 6's continuous
  refresh) work without stopping the program.

**Details that differ from CCS or that CCS leaves open.**
- A build with errors does not launch: the build console says "Errors exist in project 'X'. Fix them before
  debugging." There is no stale `.out` to fall back on, because LabSim runs the sources.
- The entry stop is the first statement of `main` that has code.
- Step Over and Step Into work line by line, so a loop written on one line runs to its end in one step.
- The Expressions view does not call functions.
- Values follow CCS's layout:
  - floats show their shortest round-trip digits;
  - chars show their character;
  - pointers, arrays and structs show their address, and char arrays add their string.
- Restart reloads the same build (static initialisers run again). Reload Program builds first.
```

- [ ] **Step 5: Run everything and commit**

Run: `npm test && npm run typecheck && npm run test:e2e`
Expected: all unit tests, the typecheck and all 14 end-to-end tests pass.

```bash
git add docs/superpowers/specs/2026-09-23-dsp-labsim-design.md
git commit -m "docs: record how the debug session is built and where it differs from CCS"
```
