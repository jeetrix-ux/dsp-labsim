# Step 4: Executor and Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run lab programs headlessly. The typed AST from Step 3 executes over a simulated C6748 memory, with a runtime library that behaves like TI's RTS. A `labsim run` CLI and golden corpus tests prove the output matches what the board prints.

**Architecture:**
- **Memory.** `src/interp/exec/` lays the program out at the addresses the linker assigned (`ProgramImage`). Memory is sparse 64 KB pages inside the MEMORY regions, plus one LabSim region at 0x70000000 for string literals and runtime objects. Locals live on a simulated `.stack`, and `malloc` works in `.sysmem`.
- **Execution.** Every function is compiled once into JavaScript closures. Statements return a completion code (normal/break/continue/return/goto), and each one ticks a counter for step limits, TSCL and, in Step 5, the debugger.
- **Runtime.** `src/interp/runtime/` holds the C library. Where the board's output depends on the implementation, it ports TI's own code from `ti-cgt-c6000_8.3.12/lib/src`:
  - `printf` digit generation (`_printfi.c`);
  - the heap (`memory.c`) and `stdout` buffering (`setvbuf.c`, `_io_perm.c`);
  - `rand` (`rand.c`), `qsort`/`bsearch`, and `strcmp`/`memcmp` return values;
  - the edge cases of the math functions (`sqrtf_i.h`, `logf_i.h`, `powf_i.h`, …).

**Tech Stack:** TypeScript 5.9 (strict), vitest 4.1, Node 24 (`fs` for CIO host files), Vite 7 (CLI bundle). There are no new dependencies.

## Global Constraints

- The interpreter (`src/interp/**`) has **no Electron dependency** and does not import `src/main/**`. Only tests and `src/cli/**` may combine the two.
- Target model (C6000 EABI, little-endian): char 8, short 16, int 32, **long 32**, long long 64, `__int40_t` 40 bits in 8 bytes, float 32, double 64, pointers 32.
  - Integer arithmetic wraps at the declared width.
  - `float` arithmetic is done in single precision (`Math.fround`).
- Memory:
  - Globals and statics live at their ELF (or fallback-layout) addresses. Locals are inside `.stack`, and `malloc` works inside `.sysmem`.
  - An access outside every mapped region halts with `Illegal memory access at 0xXXXXXXXX`.
  - Indexing a named array out of range adds a one-time note: `write past end of 'y' (y[8], size 8)`.
- Overflowing `.stack` halts with an explanation. Running out of `.sysmem` makes `malloc` return NULL, and a `printf` whose 257-byte stdout buffer cannot be allocated prints nothing, as on the LCDK.
- `TSCL`/`TSCH` return an **estimated** cycle count (4 cycles per C statement executed). The console says so once, the first time either is read.
- Target speed: at least 20 M simple statements/s. The corpus goldens must all run in under a minute in total.
- A construct the executor cannot run is a **load error**: `LabSim: unsupported construct <x>`, with a file and line.
- Never write to `~/workspace_v12` or `~/dsp_ccs_lab`. Corpus tests read them; they compile in memory and write nothing.
- When executing this plan: write files that contain backslashes with the Write/Edit tools, or with a node script using `String.raw`. Never use Git Bash heredocs, `sed` replacements or Python strings for them, because all three mangle `\n`.

## File map

| File | Responsibility |
|---|---|
| `src/interp/exec/memory.ts` | `Memory`: paged sparse address space, typed little-endian loads/stores, `Trap` |
| `src/interp/exec/scalar.ts` | `Kind` of a C type, loaders/storers per kind, conversions (wrap, saturate, fround) |
| `src/interp/exec/machine.ts` | `Machine`: registers (sp/fp/va), frames, step counter, notes, exit; `RunIO`, `Callable`, `LoadError`, `ExitSignal` |
| `src/interp/exec/placement.ts` | Addresses of objects, functions and string literals; the LabSim region; static initialisation (`.cinit`) |
| `src/interp/exec/expr.ts` | Expression → closure compiler (loads, stores, arithmetic, calls, varargs, bounds notes) |
| `src/interp/exec/stmt.ts` | Statement → closure compiler, frame layout, `FunctionCode` (a compiled function) |
| `src/interp/run.ts` | `loadProgram`, `runProgram`, `captureIO`: the interpreter's public API |
| `src/interp/runtime/types.ts` | `LibFunction`, `fn`/`vfn` helpers, `state()` per-machine module state |
| `src/interp/runtime/index.ts` | `LIBRARY` registry and `UNSUPPORTED` names |
| `src/interp/runtime/cregs.ts` | C674x control registers (`CSR`, `TSCL`/`TSCH` estimate, the rest as plain storage) |
| `src/interp/runtime/errno.ts` | `errno` values and `setErrno` |
| `src/interp/runtime/heap.ts` | Port of TI's `memory.c` heap on simulated memory |
| `src/interp/runtime/stdlib.ts` | `stdlib.h` and `assert.h` |
| `src/interp/runtime/string.ts` | `string.h` and `ctype.h` |
| `src/interp/runtime/printf.ts` | Port of TI's `_printfi.c` formatting engine |
| `src/interp/runtime/scanf.ts` | `scanf` conversion engine |
| `src/interp/runtime/stdio.ts` | FILE table, stdout line buffering, stdin, CIO host files, the stdio functions |
| `src/interp/runtime/hostfs.ts` | `nodeHostFiles(dir)`: CIO host file access via Node `fs` |
| `src/interp/runtime/math.ts` | `math.h`, with JS `Math` plus TI's edge cases |
| `src/interp/runtime/time.ts` | `time.h` (clock is the cycle estimate; time_t counts from 1900 like TI's RTS) |
| `src/interp/runtime/c6x.ts` | C6000 intrinsics |
| `src/cli/prepare.ts`, `src/cli/defaultCmd.ts` | Build a project or single file in memory (fallback layout; CCS's C6748.cmd when there is no `.cmd`) |
| `src/cli/labsim.ts`, `vite.cli.config.ts` | `npm run labsim -- run <project or file.c>` |
| `tests/unit/interp/exec/harness.ts` | `runC(source)` helper for executor tests |
| `tests/unit/interp/run-corpus.test.ts`, `tests/fixtures/golden/*.txt` | Golden console output for every corpus program, and address equality with the real cl6x link |
| `scripts/golden-check/*.py` | Python transcriptions of four corpus programs and a tolerant comparator |

---
### Task 1: Simulated memory

**Files:**
- Create: `src/interp/exec/memory.ts`
- Test: `tests/unit/interp/exec/memory.test.ts`

**Interfaces:**
- Consumes: `MemoryRegion` from `@shared/program`.
- Produces:
  - `class Trap extends Error`
  - `hex(n): string` gives 8 upper-case hex digits.
  - `class Memory(regions)` with:
    - `isMapped(addr, size?)`;
    - loads `i8 u8 i16 u16 i32 u32 f32 f64` (number) and `i64 u64` (bigint);
    - stores `set8 set16 set32 setF32 setF64 set64`;
    - bulk helpers `read write copy fill cstring peek`.

The C674x's LDH/LDW/LDDW ignore the address bits that alignment requires (1, 2 or 3 LSBs). The memory does the same, so an aligned access never crosses a 64 KB page. Unaligned intrinsics (`_mem4`) use `read`/`write`.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/exec/memory.test.ts
import { describe, expect, it } from 'vitest'
import { Memory, Trap, hex } from '../../../../src/interp/exec/memory'

const SHRAM = { name: 'SHRAM', origin: 0x80000000, length: 0x20000, attr: 'RWIX' }
const L1D = { name: 'L1D', origin: 0x00f00000, length: 0x8000, attr: 'RWIX' }

describe('Memory', () => {
  it('stores and loads every scalar width little-endian', () => {
    const m = new Memory([SHRAM])
    m.set32(0x80000000, 0x11223344)
    expect([m.u8(0x80000000), m.u8(0x80000003)]).toEqual([0x44, 0x11])
    expect(m.u16(0x80000002)).toBe(0x1122)
    m.set32(0x80000004, -2)
    expect([m.i32(0x80000004), m.u32(0x80000004)]).toEqual([-2, 0xfffffffe])
    m.setF32(0x80000008, 0.1)
    expect(m.f32(0x80000008)).toBe(Math.fround(0.1))
    m.setF64(0x80000010, Math.PI)
    expect(m.f64(0x80000010)).toBe(Math.PI)
    m.set64(0x80000018, -5n)
    expect([m.i64(0x80000018), m.u64(0x80000018)]).toEqual([-5n, (1n << 64n) - 5n])
    m.set8(0x80000020, 200)
    expect([m.i8(0x80000020), m.u8(0x80000020)]).toEqual([-56, 200])
    m.set16(0x80000022, 0x8001)
    expect([m.i16(0x80000022), m.u16(0x80000022)]).toEqual([-32767, 0x8001])
  })

  it('ignores the low address bits like LDH/LDW/LDDW', () => {
    const m = new Memory([SHRAM])
    m.set32(0x80000100, 0xcafebabe)
    expect(m.u32(0x80000102)).toBe(0xcafebabe)
    expect(m.u16(0x80000101)).toBe(0xbabe)
    m.setF64(0x80000207, 2.5)
    expect(m.f64(0x80000200)).toBe(2.5)
  })

  it('traps outside the mapped regions, also inside a partly mapped page', () => {
    const m = new Memory([SHRAM, L1D])
    expect(() => m.u32(0)).toThrow(Trap)
    expect(() => m.u32(0)).toThrow('Illegal memory access at 0x00000000')
    expect(() => m.set8(0x80020000, 1)).toThrow('Illegal memory access at 0x80020000')
    m.set8(0x00f07fff, 1)
    expect(() => m.u8(0x00f08000)).toThrow(Trap)
    expect(m.isMapped(0x00f07ffc, 4)).toBe(true)
    expect(m.isMapped(0x00f07ffe, 4)).toBe(false)
  })

  it('copies, fills and reads C strings; peek never traps', () => {
    const m = new Memory([SHRAM])
    m.write(0x80000000, [104, 105, 0, 33])
    expect(m.cstring(0x80000000)).toBe('hi')
    m.copy(0x80000001, 0x80000000, 3)
    expect([...m.read(0x80000000, 4)]).toEqual([104, 104, 105, 0])
    m.fill(0x80000000, 0x7f, 2)
    expect([...m.read(0x80000000, 3)]).toEqual([0x7f, 0x7f, 105])
    expect(m.peek(0x8001fffe, 4)).toBeNull()
    expect([...(m.peek(0x80000000, 2) as Uint8Array)]).toEqual([0x7f, 0x7f])
  })

  it('formats addresses like CCS', () => {
    expect(hex(0x80001234)).toBe('80001234')
    expect(hex(-1)).toBe('FFFFFFFF')
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/exec/memory.test.ts`
Expected: FAIL, because `src/interp/exec/memory` does not exist.

- [ ] **Step 3: Implement the memory**

```ts path=src/interp/exec/memory.ts
import type { MemoryRegion } from '@shared/program'

/** Why the simulated target stopped: an illegal access, a division by zero, a stack overflow… */
export class Trap extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Trap'
  }
}

/** An address as CCS shows it: eight upper-case hex digits. */
export const hex = (n: number): string => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')

const PAGE_BITS = 16
const PAGE_SIZE = 1 << PAGE_BITS
const OFFSET = PAGE_SIZE - 1

interface Page {
  view: DataView
  bytes: Uint8Array
  /** Mapped byte range inside the page (a region may cover only part of it). */
  lo: number
  hi: number
}

/**
 * The simulated 32-bit address space: the MEMORY regions of the linker command file, backed by 64 KB pages that are
 * allocated on first touch. Accesses are little-endian and, like the C674x's LDH/LDW/LDDW, ignore the address bits
 * that alignment requires, so an aligned access never straddles a page.
 */
export class Memory {
  readonly regions: readonly MemoryRegion[]
  private readonly table: (Page | undefined)[] = new Array(1 << (32 - PAGE_BITS))

  constructor(regions: readonly MemoryRegion[]) {
    this.regions = [...regions].sort((a, b) => a.origin - b.origin)
  }

  /** True when every byte of [addr, addr + size) lies in one region. */
  isMapped(addr: number, size = 1): boolean {
    const a = addr >>> 0
    return this.regions.some((r) => a >= r.origin && a + size <= r.origin + r.length)
  }

  illegal(addr: number): Trap {
    return new Trap(`Illegal memory access at 0x${hex(addr)}`)
  }

  private page(a: number): Page {
    const k = a >>> PAGE_BITS
    const base = k * PAGE_SIZE
    let lo = PAGE_SIZE
    let hi = 0
    for (const r of this.regions) {
      const s = Math.max(r.origin, base)
      const e = Math.min(r.origin + r.length, base + PAGE_SIZE)
      if (s < e) {
        lo = Math.min(lo, s - base)
        hi = Math.max(hi, e - base)
      }
    }
    if (hi <= lo) throw this.illegal(a)
    const buf = new ArrayBuffer(PAGE_SIZE)
    const p: Page = { view: new DataView(buf), bytes: new Uint8Array(buf), lo, hi }
    this.table[k] = p
    return p
  }

  private at(a: number, size: number): DataView {
    const p = this.table[a >>> PAGE_BITS] ?? this.page(a)
    const off = a & OFFSET
    if (off < p.lo || off + size > p.hi) throw this.illegal(a)
    return p.view
  }

  i8(a: number): number {
    return this.at(a, 1).getInt8(a & OFFSET)
  }
  u8(a: number): number {
    return this.at(a, 1).getUint8(a & OFFSET)
  }
  i16(a: number): number {
    a &= ~1
    return this.at(a, 2).getInt16(a & OFFSET, true)
  }
  u16(a: number): number {
    a &= ~1
    return this.at(a, 2).getUint16(a & OFFSET, true)
  }
  i32(a: number): number {
    a &= ~3
    return this.at(a, 4).getInt32(a & OFFSET, true)
  }
  u32(a: number): number {
    a &= ~3
    return this.at(a, 4).getUint32(a & OFFSET, true)
  }
  f32(a: number): number {
    a &= ~3
    return this.at(a, 4).getFloat32(a & OFFSET, true)
  }
  f64(a: number): number {
    a &= ~7
    return this.at(a, 8).getFloat64(a & OFFSET, true)
  }
  i64(a: number): bigint {
    a &= ~7
    return this.at(a, 8).getBigInt64(a & OFFSET, true)
  }
  u64(a: number): bigint {
    a &= ~7
    return this.at(a, 8).getBigUint64(a & OFFSET, true)
  }

  set8(a: number, v: number): void {
    this.at(a, 1).setInt8(a & OFFSET, v)
  }
  set16(a: number, v: number): void {
    a &= ~1
    this.at(a, 2).setInt16(a & OFFSET, v, true)
  }
  set32(a: number, v: number): void {
    a &= ~3
    this.at(a, 4).setInt32(a & OFFSET, v, true)
  }
  setF32(a: number, v: number): void {
    a &= ~3
    this.at(a, 4).setFloat32(a & OFFSET, v, true)
  }
  setF64(a: number, v: number): void {
    a &= ~7
    this.at(a, 8).setFloat64(a & OFFSET, v, true)
  }
  set64(a: number, v: bigint): void {
    a &= ~7
    this.at(a, 8).setBigInt64(a & OFFSET, v, true)
  }

  read(a: number, n: number): Uint8Array {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = this.u8(a + i)
    return out
  }

  write(a: number, bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.set8(a + i, bytes[i])
  }

  /** memmove semantics: overlapping ranges copy correctly. */
  copy(dst: number, src: number, n: number): void {
    if (n > 0) this.write(dst, this.read(src, n))
  }

  fill(a: number, byte: number, n: number): void {
    for (let i = 0; i < n; i++) this.set8(a + i, byte)
  }

  /** The NUL-terminated string at a, one character per byte. */
  cstring(a: number, max = 0x100000): string {
    let s = ''
    for (let i = 0; i < max; i++) {
      const c = this.u8(a + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }

  /** Reads without trapping, for graphs and the Memory view: null when any byte is unmapped. */
  peek(a: number, n: number): Uint8Array | null {
    for (let i = 0; i < n; i++) if (!this.isMapped(a + i)) return null
    return this.read(a, n)
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/exec/memory.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interp/exec/memory.ts tests/unit/interp/exec/memory.test.ts
git commit -m "feat(interp): paged simulated memory with C674x aligned access"
```

---
### Task 2: Scalar kinds, loads, stores and conversions

**Files:**
- Create: `src/interp/exec/scalar.ts`
- Test: `tests/unit/interp/exec/scalar.test.ts`

**Interfaces:**
- Consumes:
  - `Memory` (Task 1);
  - `Type` and the type constructors (`T`, `pointerTo`, `arrayOf`) from `src/interp/frontend/types`.
- Produces:
  - `type Kind = 'bool'|'i8'|'u8'|'i16'|'u16'|'i32'|'u32'|'i40'|'u40'|'i64'|'u64'|'f32'|'f64'|'ptr'|'agg'|'void'`
  - `kindOf(type)`, `kindSize(kind)`, `isBig(kind)`, `isFloatKind(kind)`, `zeroOf(kind)`
  - `loader(mem, kind)`, `storer(mem, kind)`
  - `converter(from, to)`, which returns null for identity.
  - `f2i`, `f2u`, `f2big` and `wrapper(kind)`.

How values are represented:
- Integers up to 32 bits, `_Bool`, pointers and floats are JS numbers. Integers are kept normalised: `i32` values are int32, `u32`/`ptr` values are uint32.
- 40- and 64-bit integers are bigints.
- For aggregates (`agg`: struct, union, array, function), the value is their address.

Float→integer conversions follow the C674x:
- to signed: `SPTRUNC`/`DPTRUNC` truncate and saturate, and NaN gives 0x80000000;
- to unsigned: TI's `_fixfu`/`_fixdu` saturate at UINT_MAX and wrap negative values.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/exec/scalar.test.ts
import { describe, expect, it } from 'vitest'
import { Memory } from '../../../../src/interp/exec/memory'
import { converter, f2i, f2u, kindOf, loader, storer, zeroOf, type Kind } from '../../../../src/interp/exec/scalar'
import { T, arrayOf, pointerTo } from '../../../../src/interp/frontend/types'

const conv = (from: Kind, to: Kind, v: number | bigint): number | bigint => {
  const c = converter(from, to)
  return c ? c(v) : v
}

describe('kindOf', () => {
  it('maps C6000 EABI types to value kinds', () => {
    expect([T.bool, T.char, T.uchar, T.short, T.ushort, T.int, T.uint, T.long, T.ulong].map(kindOf)).toEqual([
      'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i32', 'u32'
    ])
    expect([T.int40, T.uint40, T.llong, T.ullong, T.float, T.double, T.ldouble].map(kindOf)).toEqual([
      'i40', 'u40', 'i64', 'u64', 'f32', 'f64', 'f64'
    ])
    expect([pointerTo(T.int), arrayOf(T.int, 4), T.void].map(kindOf)).toEqual(['ptr', 'agg', 'void'])
  })
})

describe('integer conversions wrap at the declared width', () => {
  it('narrows and sign-extends', () => {
    expect(conv('i32', 'i8', 200)).toBe(-56)
    expect(conv('i32', 'u8', -1)).toBe(255)
    expect(conv('i32', 'i16', 40000)).toBe(-25536)
    expect(conv('i32', 'u32', -1)).toBe(4294967295)
    expect(conv('u32', 'i32', 4294967295)).toBe(-1)
    expect(conv('i8', 'i32', -5)).toBe(-5)
    expect(converter('u8', 'i32')).toBeNull()
  })
  it('converts to and from 40- and 64-bit integers', () => {
    expect(conv('i32', 'u64', -1)).toBe((1n << 64n) - 1n)
    expect(conv('i64', 'i32', (1n << 32n) + 7n)).toBe(7)
    expect(conv('i64', 'i40', 1n << 39n)).toBe(-(1n << 39n))
    expect(conv('u32', 'i64', 4294967295)).toBe(4294967295n)
  })
  it('treats any non-zero value as true for _Bool', () => {
    expect(conv('i32', 'bool', 256)).toBe(1)
    expect(conv('f64', 'bool', 0.25)).toBe(1)
    expect(conv('f64', 'bool', NaN)).toBe(1)
    expect(conv('i64', 'bool', 0n)).toBe(0)
  })
})

describe('floating-point conversions', () => {
  it('rounds to single precision', () => {
    expect(conv('f64', 'f32', 0.1)).toBe(Math.fround(0.1))
    expect(conv('i32', 'f32', 16777217)).toBe(16777216)
    expect(converter('f32', 'f64')).toBeNull()
  })
  it('truncates and saturates like SPTRUNC/DPTRUNC', () => {
    expect([f2i(2.9), f2i(-2.9), f2i(1e10), f2i(-1e10), f2i(NaN)]).toEqual([2, -2, 2147483647, -2147483648, -2147483648])
    expect(conv('f64', 'i16', 40000.5)).toBe(-25536)
  })
  it('converts to unsigned like _fixdu (saturating, wrapping negatives)', () => {
    expect([f2u(3.7), f2u(5e9), f2u(-1)]).toEqual([3, 4294967295, 4294967295])
    expect(conv('f64', 'u64', 1e30)).toBe((1n << 64n) - 1n)
    expect(conv('f64', 'i64', -1e30)).toBe(-(1n << 63n))
  })
})

describe('loader and storer', () => {
  it('round-trip every kind through memory', () => {
    const mem = new Memory([{ name: 'M', origin: 0x1000, length: 0x100, attr: 'RWIX' }])
    const cases: [Kind, number | bigint][] = [
      ['bool', 1], ['i8', -3], ['u8', 250], ['i16', -300], ['u16', 60000], ['i32', -70000], ['u32', 4000000000],
      ['i40', -(1n << 38n)], ['u40', (1n << 40n) - 1n], ['i64', -9n], ['u64', 1n << 63n], ['f32', Math.fround(1.5)], ['f64', 1e-300], ['ptr', 0x80000000]
    ]
    for (const [k, v] of cases) {
      storer(mem, k)(0x1008, v)
      expect(loader(mem, k)(0x1008)).toBe(v)
    }
    expect(loader(mem, 'agg')(0x1010)).toBe(0x1010)
    expect([zeroOf('i64'), zeroOf('f32')]).toEqual([0n, 0])
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/exec/scalar.test.ts`
Expected: FAIL, because `src/interp/exec/scalar` does not exist.

- [ ] **Step 3: Implement the kinds**

```ts path=src/interp/exec/scalar.ts
import type { Type } from '../frontend/types'
import type { Memory } from './memory'

/** How a C value is held in JavaScript. Aggregates (and functions) are represented by their address. */
export type Kind =
  | 'bool' | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i40' | 'u40' | 'i64' | 'u64' | 'f32' | 'f64' | 'ptr' | 'agg' | 'void'

export function kindOf(t: Type): Kind {
  switch (t.kind) {
    case 'int':
      if (t.name === '_Bool') return 'bool'
      if (t.bits === 8) return t.signed ? 'i8' : 'u8'
      if (t.bits === 16) return t.signed ? 'i16' : 'u16'
      if (t.bits === 32) return t.signed ? 'i32' : 'u32'
      if (t.bits === 40) return t.signed ? 'i40' : 'u40'
      return t.signed ? 'i64' : 'u64'
    case 'float':
      return t.name === 'float' ? 'f32' : 'f64'
    case 'pointer':
      return 'ptr'
    case 'struct':
    case 'union':
    case 'array':
    case 'function':
      return 'agg'
    default:
      return 'void'
  }
}

export const isBig = (k: Kind): boolean => k === 'i40' || k === 'u40' || k === 'i64' || k === 'u64'
export const isFloatKind = (k: Kind): boolean => k === 'f32' || k === 'f64'
export const zeroOf = (k: Kind): number | bigint => (isBig(k) ? 0n : 0)

/** Bytes a scalar of this kind occupies. */
export function kindSize(k: Kind): number {
  switch (k) {
    case 'bool':
    case 'i8':
    case 'u8':
      return 1
    case 'i16':
    case 'u16':
      return 2
    case 'i40':
    case 'u40':
    case 'i64':
    case 'u64':
    case 'f64':
      return 8
    default:
      return 4
  }
}

export type Load = (addr: number) => any
export type Store = (addr: number, v: any) => void

export function loader(mem: Memory, k: Kind): Load {
  switch (k) {
    case 'bool':
    case 'u8':
      return (a) => mem.u8(a)
    case 'i8':
      return (a) => mem.i8(a)
    case 'i16':
      return (a) => mem.i16(a)
    case 'u16':
      return (a) => mem.u16(a)
    case 'i32':
      return (a) => mem.i32(a)
    case 'u32':
    case 'ptr':
      return (a) => mem.u32(a)
    case 'i40':
      return (a) => BigInt.asIntN(40, mem.i64(a))
    case 'u40':
      return (a) => BigInt.asUintN(40, mem.u64(a))
    case 'i64':
      return (a) => mem.i64(a)
    case 'u64':
      return (a) => mem.u64(a)
    case 'f32':
      return (a) => mem.f32(a)
    case 'f64':
      return (a) => mem.f64(a)
    default:
      return (a) => a
  }
}

export function storer(mem: Memory, k: Kind): Store {
  switch (k) {
    case 'bool':
    case 'i8':
    case 'u8':
      return (a, v) => mem.set8(a, v)
    case 'i16':
    case 'u16':
      return (a, v) => mem.set16(a, v)
    case 'i32':
    case 'u32':
    case 'ptr':
      return (a, v) => mem.set32(a, v)
    case 'i40':
    case 'u40':
    case 'i64':
    case 'u64':
      return (a, v) => mem.set64(a, v)
    case 'f32':
      return (a, v) => mem.setF32(a, v)
    case 'f64':
      return (a, v) => mem.setF64(a, v)
    default:
      throw new Error(`no scalar store for kind ${k}`)
  }
}

const I32_MIN = -2147483648
const I32_MAX = 2147483647
const U32_MAX = 4294967295

/** Float to int as the C674x SPTRUNC/DPTRUNC do: truncate toward zero, saturate, NaN gives 0x80000000. */
export function f2i(v: number): number {
  if (v !== v) return I32_MIN
  if (v >= I32_MAX) return I32_MAX
  if (v <= I32_MIN) return I32_MIN
  return Math.trunc(v) | 0
}

/** Float to unsigned as TI's _fixfu/_fixdu: truncate, saturate at UINT_MAX, wrap negative values around. */
export function f2u(v: number): number {
  if (v >= U32_MAX) return U32_MAX
  if (v >= 0) return Math.trunc(v)
  return f2i(v) >>> 0
}

/** Float to a 40- or 64-bit integer: truncate and saturate (negative values wrap for unsigned targets). */
export function f2big(v: number, bits: number, signed: boolean): bigint {
  const b = BigInt(bits)
  if (!signed) {
    if (v !== v) return 0n
    if (v < 0) return BigInt.asUintN(bits, f2big(v, bits, true))
    const max = (1n << b) - 1n
    return v >= Number(max) ? max : BigInt(Math.trunc(v))
  }
  const max = (1n << (b - 1n)) - 1n
  const min = -(1n << (b - 1n))
  if (v !== v) return min
  if (v >= Number(max)) return max
  if (v <= Number(min)) return min
  return BigInt(Math.trunc(v))
}

/** Reduces a bigint to the width of a 40- or 64-bit kind. */
export function wrapper(k: Kind): (v: bigint) => bigint {
  const bits = k === 'i40' || k === 'u40' ? 40 : 64
  return k[0] === 'i' ? (v) => BigInt.asIntN(bits, v) : (v) => BigInt.asUintN(bits, v)
}

const RANGE: Partial<Record<Kind, [number, number]>> = {
  bool: [0, 1],
  i8: [-128, 127],
  u8: [0, 255],
  i16: [-32768, 32767],
  u16: [0, 65535],
  i32: [I32_MIN, I32_MAX],
  u32: [0, U32_MAX],
  ptr: [0, U32_MAX]
}

/** The C conversion from one kind to another, or null when the value needs no change. */
export function converter(from: Kind, to: Kind): ((v: any) => any) | null {
  if (from === to || to === 'void' || to === 'agg' || from === 'agg' || from === 'void') return null
  const fromBig = isBig(from)
  const fromFloat = isFloatKind(from)
  switch (to) {
    case 'f64':
      return fromBig ? (v) => Number(v) : null
    case 'f32':
      return fromBig ? (v) => Math.fround(Number(v)) : (v) => Math.fround(v)
    case 'bool':
      return fromBig ? (v) => (v !== 0n ? 1 : 0) : (v) => (v !== 0 ? 1 : 0)
    case 'i40':
    case 'u40':
    case 'i64':
    case 'u64': {
      const bits = to === 'i40' || to === 'u40' ? 40 : 64
      const signed = to[0] === 'i'
      const wrap = wrapper(to)
      if (fromFloat) return (v) => f2big(v, bits, signed)
      if (fromBig) return wrap
      return (v) => wrap(BigInt(v))
    }
  }
  const src = RANGE[from]
  const dst = RANGE[to] as [number, number]
  if (src && src[0] >= dst[0] && src[1] <= dst[1]) return null
  const toInt: (v: any) => number = fromBig
    ? (v) => Number(BigInt.asIntN(32, v))
    : fromFloat
      ? to === 'u32' || to === 'ptr' ? f2u : f2i
      : (v) => v
  switch (to) {
    case 'i8':
      return (v) => (toInt(v) << 24) >> 24
    case 'u8':
      return (v) => toInt(v) & 0xff
    case 'i16':
      return (v) => (toInt(v) << 16) >> 16
    case 'u16':
      return (v) => toInt(v) & 0xffff
    case 'i32':
      return (v) => toInt(v) | 0
    default:
      return (v) => toInt(v) >>> 0
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/exec/scalar.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interp/exec/scalar.ts tests/unit/interp/exec/scalar.test.ts
git commit -m "feat(interp): value kinds with C6000 wrap, saturate and single-precision conversions"
```

---
### Task 3: Front-end facts the executor needs

**Files:**
- Modify: `src/interp/frontend/ast.ts`, which gains the `unaligned` flag on `deref`.
- Modify: `src/interp/frontend/sema.ts`, where `memAccess` sets that flag.
- Modify: `src/interp/frontend/program.ts`, where `library()` also returns `prototypes`.
- Test: `tests/unit/interp/sema.test.ts`, `tests/unit/interp/program.test.ts`

**Interfaces:**
- Produces:
  - `Expr` `deref` gains `unaligned?: boolean`. It is true for `_mem2/_mem4/_mem8/_memd8` and their `_const` forms. Those intrinsics load and store at any byte address, while `_amemN` and ordinary dereferences keep the hardware's alignment rules.
  - `library()` returns `{ functions, objects, prototypes: Map<string, FunctionType> }`. The executor uses these real library signatures when a program calls a library function through an implicit declaration or a prototype of its own.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/interp/sema.test.ts`:

```ts
describe('memory intrinsics', () => {
  it('marks _memN accesses unaligned and _amemN accesses aligned', () => {
    const { s } = sema()
    const p = s.varRef(v('p', pointerTo(T.char)), L)
    expect(s.memAccess('_mem4', p, L)).toMatchObject({ k: 'deref', type: T.uint, unaligned: true })
    expect(s.memAccess('_memd8_const', p, L)).toMatchObject({ k: 'deref', unaligned: true })
    expect(s.memAccess('_amem4', p, L)).toMatchObject({ k: 'deref', unaligned: false })
  })
})
```

Append to `tests/unit/interp/program.test.ts`, inside `describe('library')`:

```ts
  it('gives the real prototype of every library function', () => {
    const { prototypes } = library()
    expect(typeToString(prototypes.get('sqrt')!)).toBe('double (double)')
    expect(typeToString(prototypes.get('printf')!)).toBe('int (const char *, ...)')
    expect(typeToString(prototypes.get('_dotp2')!)).toBe('int (int, int)')
    expect(prototypes.size).toBe(library().functions.size)
  })
```

Then add `import { typeToString } from '../../../src/interp/frontend/types'` to the imports of `program.test.ts`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/sema.test.ts tests/unit/interp/program.test.ts`
Expected: FAIL. `unaligned` is undefined, and `prototypes` is undefined.

- [ ] **Step 3: Implement**

In `src/interp/frontend/ast.ts`, replace the `deref` line of `Expr` with:

```ts
  /** `unaligned`: TI's `_memN` intrinsics, which may use any byte address (LDNW/LDNDW). */
  | (E & { k: 'deref'; arg: Expr; unaligned?: boolean })
```

In `src/interp/frontend/sema.ts`, replace the `return` of `memAccess` with:

```ts
    const deref: Expr = { k: 'deref', loc: at, type: t, arg: { k: 'cast', loc: at, type: pointerTo(t), arg: r, implicit: false } }
    return { ...deref, unaligned: !name.startsWith('_a') }
```

In `src/interp/frontend/program.ts`:
- Change the import from `./ast` to `import type { FunctionDef, TranslationUnit, VarSym } from './ast'` (unchanged), and add `import type { FunctionType } from './types'`.
- Replace everything from `let libraryCache` to the end of the file with:

```ts
export interface Library {
  functions: Set<string>
  objects: Set<string>
  /** The declared type of every library function, from LabSim's built-in headers. */
  prototypes: Map<string, FunctionType>
}

let libraryCache: Library | null = null

/** What the LabSim runtime provides: every function and object its built-in headers declare. */
export function library(): Library {
  if (libraryCache) return libraryCache
  const headers = Object.keys(BUILTIN_HEADERS).filter((h) => h !== PRELUDE && !BUILTIN_HEADERS[h].includes('#error'))
  const file = '<builtin>/__labsim_library.c'
  const source = headers.map((h) => `#include <${h}>`).join('\n') + '\n'
  const r = compileUnit(file, { readFile: (f) => (f === file ? source : null), includePaths: [], defines: [], dialect: 'c99', diagWarnings: [] })
  if (!r.unit) throw new Error(`LabSim's built-in headers do not compile: ${r.diagnostics[0]?.message}`)
  libraryCache = {
    functions: new Set(r.unit.funcs.map((f) => f.name)),
    objects: new Set(r.unit.objects.map((o) => o.name)),
    prototypes: new Map(r.unit.funcs.map((f) => [f.name, f.type]))
  }
  return libraryCache
}
```

(The `+ '\n'` keeps the built-in source free of the #1-D "no newline" warning.)

- [ ] **Step 4: Run the interpreter tests and the typecheck**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: every interp test passes, including the corpus tests, and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/interp/frontend tests/unit/interp/sema.test.ts tests/unit/interp/program.test.ts
git commit -m "feat(interp): mark unaligned _memN accesses and expose library prototypes"
```

---
### Task 4: Machine, placement and static initialisation

**Files:**
- Create: `src/interp/exec/machine.ts`, `src/interp/exec/placement.ts`
- Create: `src/interp/runtime/types.ts`, `src/interp/runtime/index.ts`, `src/interp/runtime/cregs.ts`
- Create: `tests/unit/interp/exec/harness.ts`
- Test: `tests/unit/interp/exec/machine.test.ts`

**Interfaces:**
- Consumes:
  - `Memory`, `Trap` and `hex` (Task 1);
  - scalar helpers (Task 2);
  - `Program`, `evalConst`, `isBuiltinFile`, `sizeOf` and `alignOf` from the front-end;
  - `ProgramImage` from `@shared/program`.
  - The harness also uses `layoutProgram` (`src/main/build/fallbackImage`) and `parseLinkerCommandFile` (`src/main/build/linkerCmd`).
- Produces:
  - `machine.ts`:
    - `RunIO {write(text, stream), note(text), readLine(), files}` and `HostFiles {readAll, writeAll, remove, rename}`
    - `Callable {name, fixed, variadic, type, invoke(args, va, retBuf)}` and `Frame {fn, fp, callSite}`
    - `ExitSignal(code)`, `LoadError(message, loc)`, `LABSIM_REGION`, `CYCLES_PER_STATEMENT = 4`
    - `class Machine(program, image, io)`. Fields: `mem`, `sp`, `fp`, `va`, `retBuf`, `ret`, `stackLow`, `stackTop`, `ops`, `limit`, `loc`, `gotoLabel`, `frames`, `functions`, `atexit`, `cleanups`, `placement`, `resolve`. Methods: `trap(msg)`, `note(key, text)`, `poll()`, `onLimit`, `callAddress(addr, args)`, `exit(code)`, and the getter `cycles`.
  - `placement.ts`:
    - `CODE_BASE` and `LIBRARY_OBJECTS`
    - `class Placement(m)` with `objectAddress(v)`, `functionAddress(f)`, `stringAddress(s)`, `constString(text)`, `libraryObject(name)`, `alloc(size, align)`, `initialize()`, `writeInit(addr, type, init)` and `unplaced: string[]`.
  - `runtime/types.ts`: `LibFunction {fixed, variadic, call(m, args, va, ret)}`, plus `fn`, `vfn` and `state(create)`.
  - `runtime/index.ts`: `LIBRARY` (empty for now) and `UNSUPPORTED` (empty for now).
  - `runtime/cregs.ts`: `controlRegister(m, name): {read(), write(v)}` and `CSR_RESET`.
  - harness: `build(source, others?, opts?) → {program, image}`, `MAIN`, `NO_IO`.

- [ ] **Step 1: Write the test harness and the failing test**

```ts path=tests/unit/interp/exec/harness.ts
import { readFileSync } from 'fs'
import * as path from 'path'
import { expect } from 'vitest'
import type { ProgramImage } from '@shared/program'
import type { RunIO } from '../../../../src/interp/exec/machine'
import { compileUnit, linkProgram, type Program } from '../../../../src/interp/frontend/program'
import { layoutProgram } from '../../../../src/main/build/fallbackImage'
import { parseLinkerCommandFile } from '../../../../src/main/build/linkerCmd'

export const MAIN = path.resolve('/proj/main.c')
const CMD = parseLinkerCommandFile(readFileSync(path.join(__dirname, '../../../fixtures/ccs/C6748.cmd'), 'utf8'))

export const NO_IO: RunIO = { write: () => {}, note: () => {}, readLine: () => null, files: null }

export interface BuildOptions {
  dialect?: 'c89' | 'c99'
  heap?: number
  stack?: number
}

/** Compiles and links main.c (plus other files by name) and lays the program out like the fallback linker. */
export function build(source: string, others: Record<string, string> = {}, opts: BuildOptions = {}): { program: Program; image: ProgramImage } {
  const files: Record<string, string> = { [MAIN]: source }
  for (const [name, text] of Object.entries(others)) files[path.resolve('/proj', name)] = text
  const read = (f: string): string | null => (f in files ? files[f] + '\n' : null)
  const units = Object.keys(files)
    .filter((f) => f.endsWith('.c'))
    .map((f) => {
      const r = compileUnit(f, { readFile: read, includePaths: [path.resolve('/proj')], defines: ['c6748'], dialect: opts.dialect ?? 'c89', diagWarnings: ['225'] })
      expect(r.diagnostics.filter((d) => d.severity === 'error'), f).toEqual([])
      return r.unit!
    })
  const link = linkProgram(units)
  expect(link.problems).toEqual([])
  const layout = layoutProgram(link.program!, CMD, { heapSize: opts.heap ?? 0x800, stackSize: opts.stack ?? 0x800, outFile: 'main.out' })
  expect(layout.error).toBeNull()
  return { program: link.program!, image: layout.image! }
}
```

```ts path=tests/unit/interp/exec/machine.test.ts
import { describe, expect, it } from 'vitest'
import { ExitSignal, LABSIM_REGION, Machine } from '../../../../src/interp/exec/machine'
import { CODE_BASE, Placement } from '../../../../src/interp/exec/placement'
import { controlRegister, CSR_RESET } from '../../../../src/interp/runtime/cregs'
import { build, MAIN, NO_IO } from './harness'

function load(source: string): { m: Machine; pl: Placement; addr: (name: string) => number; statics: Record<string, { addr: number }> } {
  const { program, image } = build(source)
  const m = new Machine(program, image, NO_IO)
  const pl = new Placement(m)
  m.placement = pl
  pl.initialize()
  return { m, pl, addr: (name) => image.globals[name].addr, statics: image.statics[MAIN] }
}

const inLabsim = (a: number): boolean => a >= LABSIM_REGION.origin && a < LABSIM_REGION.origin + LABSIM_REGION.length

describe('Placement', () => {
  it('places objects at the image addresses and writes their initialisers like .cinit', () => {
    const { m, pl, addr, statics } = load([
      'int n = 5;',
      'float h[3] = { 1, 2.5f, -1 };',
      'const char *msg = "hi";',
      'int *p = &n;',
      'static short s = -2;',
      'char name[8] = "ab";',
      'struct pt { char c; double d; } pts[2] = { { 1, 0.5 }, { 2, 1e300 } };',
      'long long big = -3;',
      'unsigned u = 0xFFFFFFFF;',
      'int zero[4];',
      'int main(void) { static int calls = 7; return calls + s; }'
    ].join('\n'))
    expect(m.mem.i32(addr('n'))).toBe(5)
    expect([0, 1, 2].map((i) => m.mem.f32(addr('h') + 4 * i))).toEqual([1, 2.5, -1])
    const msg = m.mem.u32(addr('msg'))
    expect(inLabsim(msg)).toBe(true)
    expect(m.mem.cstring(msg)).toBe('hi')
    expect(m.mem.u32(addr('p'))).toBe(addr('n'))
    expect(m.mem.i16(statics.s.addr)).toBe(-2)
    expect(m.mem.cstring(addr('name'))).toBe('ab')
    expect(m.mem.i8(addr('pts') + 16)).toBe(2)
    expect(m.mem.f64(addr('pts') + 24)).toBe(1e300)
    expect(m.mem.i64(addr('big'))).toBe(-3n)
    expect(m.mem.u32(addr('u'))).toBe(0xffffffff)
    expect(m.mem.i32(addr('zero') + 12)).toBe(0)
    expect(m.mem.i32(statics['calls$1'].addr)).toBe(7)
    expect(pl.unplaced).toEqual([])
  })

  it('gives functions their image address and static functions a LabSim code address', () => {
    const { m, pl, addr } = load('static int helper(void) { return 1; }\nint main(void) { return helper(); }')
    expect(pl.functionAddress(m.program.main.sym)).toBe(addr('main'))
    const helper = m.program.units[0].functions[0].sym
    expect(pl.functionAddress(helper)).toBeGreaterThanOrEqual(CODE_BASE)
    expect(pl.functionAddress(helper)).toBe(pl.functionAddress(helper))
  })

  it("places the runtime's own objects (errno, _ftable) in the LabSim region", () => {
    const { m, pl } = load('#include <stdio.h>\n#include <errno.h>\nFILE *f;\nint main(void) { f = stdout; errno = 0; return 0; }')
    const ftable = m.program.units[0].objects.find((o) => o.name === '_ftable')!
    expect(pl.objectAddress(ftable)).toBe(pl.libraryObject('_ftable'))
    expect(inLabsim(pl.libraryObject('errno'))).toBe(true)
    expect(pl.libraryObject('errno')).not.toBe(pl.libraryObject('_ftable'))
  })
})

describe('Machine', () => {
  it('starts with the stack pointer at the top of .stack', () => {
    const { m } = load('int main(void) { return 0; }')
    expect(m.stackTop).toBe(m.image.stack.start + m.image.stack.size)
    expect(m.sp).toBe(m.stackTop)
  })

  it('shows a note once per key', () => {
    const notes: string[] = []
    const { program, image } = build('int main(void) { return 0; }')
    const m = new Machine(program, image, { ...NO_IO, note: (t) => notes.push(t) })
    m.note('k', 'first')
    m.note('k', 'again')
    m.note('j', 'other')
    expect(notes).toEqual(['first', 'other'])
  })

  it('runs the cleanups on exit() but not on abort()', () => {
    const { m } = load('int main(void) { return 0; }')
    let flushed = 0
    m.cleanups.push(() => flushed++)
    const code = (f: () => void): number | null | undefined => {
      try {
        f()
      } catch (e) {
        if (e instanceof ExitSignal) return e.code
        throw e
      }
      return undefined
    }
    expect(code(() => m.exit(3))).toBe(3)
    expect(code(() => m.exit(null))).toBeNull()
    expect(flushed).toBe(1)
  })
})

describe('control registers', () => {
  it('reads CSR as a C674x and counts an estimated TSC after the first TSCL write', () => {
    const notes: string[] = []
    const { program, image } = build('int main(void) { return 0; }')
    const m = new Machine(program, image, { ...NO_IO, note: (t) => notes.push(t) })
    expect(controlRegister(m, 'CSR').read()).toBe(CSR_RESET)
    const tscl = controlRegister(m, 'TSCL')
    m.ops = 100
    expect(tscl.read()).toBe(0)
    tscl.write(12345)
    m.ops = 110
    expect(tscl.read()).toBe(40)
    expect(controlRegister(m, 'TSCH').read()).toBe(0)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('estimate')
    const amr = controlRegister(m, 'AMR')
    amr.write(5)
    expect(amr.read()).toBe(5)
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/exec/machine.test.ts`
Expected: FAIL, because the machine, placement and cregs modules do not exist.

- [ ] **Step 3: Implement the machine**

```ts path=src/interp/exec/machine.ts
import type { ProgramImage } from '@shared/program'
import type { FuncSym, FunctionDef } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import type { Program } from '../frontend/program'
import type { FunctionType } from '../frontend/types'
import { Memory, Trap, hex } from './memory'
import type { Placement } from './placement'

/** CIO host file access. Paths are as the program wrote them; the implementation resolves them. */
export interface HostFiles {
  /** The whole file, or null when it cannot be read. */
  readAll(path: string): Uint8Array | null
  /** Replaces the file's contents; false when it cannot be written. */
  writeAll(path: string, data: Uint8Array): boolean
  remove(path: string): boolean
  rename(from: string, to: string): boolean
}

export interface RunIO {
  /** Program output as the CIO layer delivers it. */
  write(text: string, stream: 'stdout' | 'stderr'): void
  /** LabSim's own notes (bounds warnings, estimates): shown in the console but not program output. */
  note(text: string): void
  /** The next line typed into the console, without its newline; null at end of input. */
  readLine(): string | null
  /** Host files for fopen and friends; null when the program has no project folder. */
  files: HostFiles | null
}

/** Something a call can invoke: a compiled user function or a runtime library function. */
export interface Callable {
  readonly name: string
  /** Named parameters. A variadic callee finds the remaining arguments in memory at `va`. */
  readonly fixed: number
  readonly variadic: boolean
  /** The callee's own type, when known (calls through implicit declarations convert to it). */
  readonly type: FunctionType | null
  invoke(args: any[], va: number, retBuf: number): any
}

export interface Frame {
  fn: FunctionDef
  fp: number
  /** The statement that made the call. */
  callSite: Loc
}

/** Thrown by exit() and abort(): the program reached C$$EXIT. `code` is null after abort(). */
export class ExitSignal {
  constructor(readonly code: number | null) {}
}

/** The program cannot be loaded: an unsupported construct, or a symbol with no address. */
export class LoadError extends Error {
  constructor(
    message: string,
    readonly loc: Loc | null
  ) {
    super(message)
    this.name = 'LoadError'
  }
}

/** LabSim's own memory: string literals, runtime objects, objects the image does not place. Unused on the C6748. */
export const LABSIM_REGION = { name: 'LABSIM', origin: 0x70000000, length: 0x01000000, attr: 'RWIX' }

/** TSCL/TSCH and clock() report this many cycles per C statement executed (an estimate, not C674x timing). */
export const CYCLES_PER_STATEMENT = 4

export class Machine {
  readonly mem: Memory
  /** Stack pointer (B15) and the current frame's base. */
  sp: number
  fp: number
  /** The current frame's first variadic argument, and where it returns a struct. */
  va = 0
  retBuf = 0
  /** Value of the last `return`. */
  ret: any = undefined
  readonly stackLow: number
  readonly stackTop: number
  /** Statements executed; `poll()` runs whenever `ops` reaches `limit`. */
  ops = 0
  limit = Infinity
  /** The statement being executed. */
  loc: Loc
  gotoLabel = ''
  readonly frames: Frame[] = []
  /** Every function that has an address: compiled user functions and the library functions in use. */
  readonly functions = new Map<number, Callable>()
  /** Functions registered with atexit(), in order. */
  readonly atexit: number[] = []
  /** Run by exit() after the atexit functions: the RTS cleanup that flushes open streams. */
  readonly cleanups: (() => void)[] = []
  placement!: Placement
  resolve!: (f: FuncSym, at: Loc) => Callable
  private readonly noted = new Set<string>()

  constructor(
    readonly program: Program,
    readonly image: ProgramImage,
    readonly io: RunIO
  ) {
    if (image.stack.size <= 0) throw new LoadError('LabSim: the program has no .stack section', null)
    this.mem = new Memory([...image.memory, LABSIM_REGION])
    this.stackLow = image.stack.start >>> 0
    const top = image.stack.start + image.stack.size
    this.stackTop = (top - (top % 8)) >>> 0
    this.sp = this.fp = this.stackTop
    this.loc = program.main.loc
  }

  /** Halts the target; the console shows the message with the current line. */
  trap(message: string): never {
    throw new Trap(message)
  }

  /** A LabSim note, shown once per key. */
  note(key: string, text: string): void {
    if (this.noted.has(key)) return
    this.noted.add(key)
    this.io.note(text)
  }

  /** Runs when `ops` reaches `limit`. Headless runs stop there; the debugger (Step 5) replaces `onLimit`. */
  poll(): void {
    this.onLimit()
  }

  onLimit: () => void = () => this.trap(`LabSim stopped the program after ${this.ops} statements (is it in an endless loop?)`)

  /** Calls the function at a code address (qsort comparators, atexit functions). */
  callAddress(addr: number, args: any[]): any {
    const c = this.functions.get(addr >>> 0)
    if (!c) this.trap(`Call through an invalid function pointer (0x${hex(addr)})`)
    return c.invoke(args, 0, 0)
  }

  /** exit(): the atexit functions in reverse order, then the RTS cleanup, then C$$EXIT. abort() passes null and skips both. */
  exit(code: number | null): never {
    if (code !== null) {
      for (let f = this.atexit.pop(); f !== undefined; f = this.atexit.pop()) this.callAddress(f, [])
      for (const c of this.cleanups) c()
    }
    throw new ExitSignal(code)
  }

  /** Estimated cycles since reset. */
  get cycles(): number {
    return this.ops * CYCLES_PER_STATEMENT
  }
}
```

- [ ] **Step 4: Implement placement and static initialisation**

```ts path=src/interp/exec/placement.ts
import type { Expr, FuncSym, Init, InitItem, VarSym } from '../frontend/ast'
import { evalConst, type ConstValue } from '../frontend/consteval'
import { isBuiltinFile } from '../frontend/preprocessor'
import { alignOf, sizeOf, type Type } from '../frontend/types'
import { LABSIM_REGION, LoadError, type Machine } from './machine'
import { f2big, isBig, isFloatKind, kindOf, storer, type Kind } from './scalar'

type StringExpr = Extract<Expr, { k: 'string' }>

/** Code addresses for functions the linked image has no symbol for (static and unused library functions). Unmapped. */
export const CODE_BASE = 0x71000000

/** Objects LabSim's runtime defines; its built-in headers declare them extern. */
export const LIBRARY_OBJECTS: Readonly<Record<string, { size: number; align: number }>> = {
  errno: { size: 4, align: 4 },
  _ftable: { size: 20 * 24, align: 4 }
}

/** Where everything lives: objects at the addresses the linker chose, the rest in the LabSim region. */
export class Placement {
  private next = LABSIM_REGION.origin
  private nextCode = CODE_BASE
  private readonly objects = new Map<VarSym, number>()
  private readonly globals = new Map<string, number>()
  private readonly functions = new Map<string, number>()
  private readonly staticFunctions = new Map<FuncSym, number>()
  private readonly strings = new Map<StringExpr, number>()
  private readonly constStrings = new Map<string, number>()
  /** Objects the linked image has no symbol for; LabSim placed them in its own region. */
  readonly unplaced: string[] = []

  constructor(private readonly m: Machine) {
    const { program, image } = m
    for (const u of program.units) {
      for (const v of u.objects) {
        if (v.cregister || isBuiltinFile(v.loc.file)) continue
        if (v.external) {
          const def = program.globals.get(v.name)
          if (def) this.objects.set(v, this.global(def))
          else if (LIBRARY_OBJECTS[v.name]) this.objects.set(v, this.libraryObject(v.name))
        } else {
          const sym = image.statics[v.file]?.[v.linkName]
          this.objects.set(v, sym ? sym.addr >>> 0 : this.unplacedObject(v))
        }
      }
    }
  }

  private global(def: VarSym): number {
    let a = this.globals.get(def.name)
    if (a === undefined) {
      const sym = this.m.image.globals[def.name]
      a = sym && sym.kind === 'object' ? sym.addr >>> 0 : this.unplacedObject(def)
      this.globals.set(def.name, a)
    }
    return a
  }

  private unplacedObject(v: VarSym): number {
    if (!v.hidden) this.unplaced.push(v.linkName)
    return this.alloc(Math.max(sizeOf(v.type), 1), alignOf(v.type))
  }

  /** Reserves bytes in the LabSim region. */
  alloc(size: number, align = 4): number {
    const a = Math.ceil(this.next / align) * align
    if (a + size > LABSIM_REGION.origin + LABSIM_REGION.length) throw new LoadError("LabSim: LabSim's own memory region is full", null)
    this.next = a + size
    return a
  }

  /** errno, _ftable: the runtime's own objects. */
  libraryObject(name: string): number {
    let a = this.globals.get(name)
    if (a === undefined) {
      const o = LIBRARY_OBJECTS[name]
      if (!o) throw new LoadError(`LabSim: the runtime has no object named '${name}'`, null)
      a = this.alloc(o.size, o.align)
      this.globals.set(name, a)
    }
    return a
  }

  /** Address of an object with static storage (global, file or function static, extern, static compound literal). */
  objectAddress(v: VarSym): number {
    const a = this.objects.get(v)
    if (a !== undefined) return a
    if (v.external) {
      const def = this.m.program.globals.get(v.name)
      if (def) return this.global(def)
      if (LIBRARY_OBJECTS[v.name]) return this.libraryObject(v.name)
    }
    throw new LoadError(`LabSim: no address for '${v.name}'`, v.loc)
  }

  functionAddress(f: FuncSym): number {
    if (!f.external) {
      let a = this.staticFunctions.get(f)
      if (a === undefined) {
        a = this.codeSlot()
        this.staticFunctions.set(f, a)
      }
      return a
    }
    let a = this.functions.get(f.name)
    if (a === undefined) {
      const sym = this.m.image.globals[f.name]
      a = sym && sym.kind === 'func' ? sym.addr >>> 0 : this.codeSlot()
      this.functions.set(f.name, a)
    }
    return a
  }

  private codeSlot(): number {
    const a = this.nextCode
    this.nextCode += 0x20
    return a
  }

  stringAddress(s: StringExpr): number {
    let a = this.strings.get(s)
    if (a === undefined) {
      a = this.alloc(s.bytes.length, 1)
      this.m.mem.write(a, s.bytes)
      this.strings.set(s, a)
    }
    return a
  }

  /** A constant C string owned by the runtime, such as a strerror() message. */
  constString(text: string): number {
    let a = this.constStrings.get(text)
    if (a === undefined) {
      const bytes = [...text].map((c) => c.charCodeAt(0) & 0xff)
      bytes.push(0)
      a = this.alloc(bytes.length, 1)
      this.m.mem.write(a, bytes)
      this.constStrings.set(text, a)
    }
    return a
  }

  /** Writes every static initialiser, as the RTS does from .cinit before main. Uninitialised objects stay zero. */
  initialize(): void {
    for (const u of this.m.program.units) {
      for (const v of u.objects) {
        if (!v.init || v.cregister || isBuiltinFile(v.loc.file)) continue
        this.writeInit(this.objectAddress(v), v.type, v.init)
      }
    }
  }

  writeInit(addr: number, type: Type, init: Init): void {
    if (init.k === 'expr') {
      this.writeConst(addr, type, init.expr)
      return
    }
    this.m.mem.fill(addr, 0, sizeOf(type))
    for (const it of init.items) this.writeItem(addr + it.offset, it)
  }

  private writeItem(addr: number, it: InitItem): void {
    if (it.expr.k === 'string' && it.type.kind === 'array') {
      this.m.mem.write(addr, it.expr.bytes.slice(0, sizeOf(it.type)))
      return
    }
    this.writeConst(addr, it.type, it.expr)
  }

  private writeConst(addr: number, type: Type, e: Expr): void {
    const k = kindOf(type)
    if (k === 'agg') throw new LoadError('LabSim: unsupported construct struct copy in a static initializer', e.loc)
    const v = evalConst(e)
    if (!v) throw new LoadError('LabSim: unsupported construct non-constant static initializer', e.loc)
    storer(this.m.mem, k)(addr, this.constValue(v, k))
  }

  private constValue(v: ConstValue, k: Kind): number | bigint {
    if (v.k === 'addr') {
      const b = v.base
      const base = b === null ? 0 : 'kind' in b ? (b.kind === 'var' ? this.objectAddress(b) : this.functionAddress(b)) : this.stringAddress(b)
      const a = (base + v.offset) >>> 0
      return isBig(k) ? BigInt(a) : a
    }
    if (v.k === 'float') return isBig(k) ? f2big(v.value, k === 'i40' || k === 'u40' ? 40 : 64, k[0] === 'i') : v.value
    if (isBig(k)) return v.value
    if (isFloatKind(k)) return Number(BigInt.asIntN(64, v.value))
    return Number(BigInt.asIntN(32, v.value))
  }
}
```

- [ ] **Step 5: Implement the runtime registry and the control registers**

```ts path=src/interp/runtime/types.ts
import type { Machine } from '../exec/machine'

/** A runtime library function. `args` hold the named parameters (converted to their types); the rest of a variadic
 * call is in simulated memory at `va`; `ret` is where a function returning a struct writes it. */
export interface LibFunction {
  fixed: number
  variadic: boolean
  call(m: Machine, args: any[], va: number, ret: number): any
}

export const fn = (fixed: number, call: LibFunction['call']): LibFunction => ({ fixed, variadic: false, call })
export const vfn = (fixed: number, call: LibFunction['call']): LibFunction => ({ fixed, variadic: true, call })

/** Per-machine state of a runtime module, created on first use. */
export function state<T>(create: (m: Machine) => T): (m: Machine) => T {
  const all = new WeakMap<Machine, T>()
  return (m) => {
    let s = all.get(m)
    if (s === undefined) {
      s = create(m)
      all.set(m, s)
    }
    return s
  }
}
```

```ts path=src/interp/runtime/index.ts
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = {}

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = new Set<string>()
```

```ts path=src/interp/runtime/cregs.ts
import type { Machine } from '../exec/machine'
import { CYCLES_PER_STATEMENT } from '../exec/machine'
import { state } from './types'

export interface ControlRegister {
  read(): number
  write(v: number): void
}

/** CSR after reset on a C674x: CPU ID 0x14 (C674x), revision 0, EN = 1 (little-endian). */
export const CSR_RESET = 0x14000100
/** CSR bits a program can change: GIE, PGIE, SAT and PWRD. */
const CSR_WRITABLE = 0x0000fe03

const DEFAULTS: Record<string, number> = { CSR: CSR_RESET, GFPGFR: 0x0700001d }

class Registers {
  readonly values = new Map<string, number>(Object.entries(DEFAULTS))
  /** Cycle estimate when the time-stamp counter started (the first write to TSCL); null until then. */
  tscStart: number | null = null
  /** TSCH as latched by the last read of TSCL. */
  tsch = 0
}

const registers = state(() => new Registers())

const TWO_32 = 2 ** 32

/** A C674x control register (`extern __cregister volatile unsigned int X;` in c6x.h). */
export function controlRegister(m: Machine, name: string): ControlRegister {
  const r = registers(m)
  const estimate = (): number => {
    m.note('tsc', `TSCL/TSCH give an estimated cycle count (${CYCLES_PER_STATEMENT} cycles per C statement), not the C674x's real timing.`)
    return r.tscStart === null ? 0 : m.cycles - r.tscStart
  }
  switch (name) {
    case 'TSCL':
      return {
        read: () => {
          const t = estimate()
          r.tsch = Math.floor(t / TWO_32) >>> 0
          return t % TWO_32 >>> 0
        },
        write: () => {
          if (r.tscStart === null) r.tscStart = m.cycles
        }
      }
    case 'TSCH':
      return {
        read: () => {
          estimate()
          return r.tsch
        },
        write: () => {}
      }
    case 'CSR':
      return {
        read: () => r.values.get('CSR') as number,
        write: (v) => r.values.set('CSR', ((v & CSR_WRITABLE) | ((r.values.get('CSR') as number) & ~CSR_WRITABLE)) >>> 0)
      }
    default:
      return {
        read: () => r.values.get(name) ?? 0,
        write: (v) => r.values.set(name, v >>> 0)
      }
  }
}
```

- [ ] **Step 6: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/exec/machine.test.ts && npm run typecheck`
Expected: PASS (7 tests), and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/interp/exec/machine.ts src/interp/exec/placement.ts src/interp/runtime tests/unit/interp/exec
git commit -m "feat(interp): machine state, placement at linker addresses and static initialisation"
```

---
### Task 5: The executor (closure compiler) and the run API

**Files:**
- Create: `src/interp/exec/expr.ts`, `src/interp/exec/stmt.ts`, `src/interp/run.ts`
- Modify: `tests/unit/interp/exec/harness.ts` (add `runC`)
- Test: `tests/unit/interp/exec/exec.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `expr.ts`:
    - `type Ev = () => any` and `FrameScope {offset(v), temp(size, align)}`
    - `class ExprCompiler(m, scope)` with `value(e)`, `truth(e)`, `address(e, access)` and `initializer(type, init)`.
  - `stmt.ts`:
    - the completion codes `NORMAL BREAK CONTINUE RETURN GOTO`
    - `class FunctionCode(m, def) implements Callable`, with `compile()`, `invoke(args, va, retBuf)` and `def`.
  - `run.ts`:
    - `loadProgram(program, image, io, {maxSteps?}) → Machine`, which throws `LoadError`
    - `runProgram(m) → RunResult`, where `RunResult` is `{status:'exited', code, steps} | {status:'halted', message, loc, steps}`
    - `captureIO(input?, files?)`
    - re-exports `LoadError`, `RunIO` and `HostFiles`.
  - harness: `runC(source, opts?) → {result, stdout, stderr, notes, m, image, g(name)}`.

How execution works:
- Every expression becomes a closure returning its value: a number, a bigint, or an address for aggregates.
- Every statement becomes a closure returning a completion code.
- Each statement sets `m.loc` and increments `m.ops`. `m.poll()` runs when `ops` reaches `limit`: headless runs stop there, and the Step 5 debugger will replace it.
- Each function has a frame layout with a slot for every parameter, local and compound literal. `invoke` moves `sp` down by the frame size and halts on stack overflow.
- Variadic arguments are written below `sp` in EABI order. Each is aligned to its size (minimum 4), and `va_arg` reads them back, so mismatched `printf` arguments misbehave the way they do on the board.
- `goto` works when its label is a statement of an enclosing block. Jumping into a nested block, or a `case` label that is not a statement of its switch body, is a load error.

- [ ] **Step 1: Add `runC` to the harness**

Append to `tests/unit/interp/exec/harness.ts`:

```ts
export interface Ran {
  result: RunResult
  stdout: string
  stderr: string
  notes: string[]
  m: Machine
  image: ProgramImage
  /** Address of a global in the image. */
  g(name: string): number
}

/** Builds and runs a program; `input` lines feed stdin. */
export function runC(source: string, opts: BuildOptions & { others?: Record<string, string>; input?: string[]; maxSteps?: number } = {}): Ran {
  const { program, image } = build(source, opts.others ?? {}, opts)
  const cap = captureIO(opts.input ?? [])
  const m = loadProgram(program, image, cap.io, { maxSteps: opts.maxSteps ?? 50_000_000 })
  const result = runProgram(m)
  return { result, stdout: cap.stdout(), stderr: cap.stderr(), notes: cap.notes, m, image, g: (name) => image.globals[name].addr }
}
```

Then add to its imports:

```ts
import type { Machine } from '../../../../src/interp/exec/machine'
import { captureIO, loadProgram, runProgram, type RunResult } from '../../../../src/interp/run'
```

- [ ] **Step 2: Write the failing test**

```ts path=tests/unit/interp/exec/exec.test.ts
import { describe, expect, it } from 'vitest'
import { build, NO_IO, runC } from './harness'
import { loadProgram } from '../../../../src/interp/run'

const ints = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.i32(r.g(name) + 4 * i))

describe('expressions', () => {
  it('wraps integer arithmetic at the declared width', () => {
    const r = runC(`
int r[12];
unsigned u[3];
long long ll[4];
int main(void)
{
    int a = 2147483647, b = -7;
    unsigned x = 0;
    short s = 32767;
    char c = 127;
    r[0] = a + 1;
    r[1] = b / 2;
    r[2] = b % 3;
    r[3] = b >> 1;
    r[4] = (unsigned)b >> 28;
    s++;
    r[5] = s;
    c += 1;
    r[6] = c;
    r[7] = 5 > 3 && 2 < 1;
    r[8] = !0.5;
    r[9] = (int)-2.7;
    r[10] = 7 / 2 * 2;
    r[11] = sizeof(long);
    u[0] = x - 1;
    u[1] = 3000000000u + 3000000000u;
    u[2] = (unsigned)-1 / 3;
    ll[0] = 2147483647LL * 3;
    ll[1] = -1LL << 40;
    ll[2] = (long long)1e18 + 1;
    ll[3] = 07 + 0x10;
    return 0;
}`)
    expect(r.result).toMatchObject({ status: 'exited', code: 0 })
    expect(ints(r, 'r', 12)).toEqual([-2147483648, -3, -1, -4, 15, -32768, -128, 0, 0, -2, 6, 4])
    expect([0, 1, 2].map((i) => r.m.mem.u32(r.g('u') + 4 * i))).toEqual([4294967295, 1705032704, 1431655765])
    expect([0, 1, 2, 3].map((i) => r.m.mem.i64(r.g('ll') + 8 * i))).toEqual([6442450941n, -1099511627776n, 1000000000000000001n, 23n])
  })

  it('does float arithmetic in single precision and double in double', () => {
    const r = runC(`
float f[4];
double d[2];
int main(void)
{
    float a = 0.1f, b = 0.2f;
    f[0] = a + b;
    f[1] = 16777216.0f + 1.0f;
    f[2] = a * 3;
    f[3] = 1.0f / 3.0f;
    d[0] = a + b;
    d[1] = 0.1 + 0.2;
    return 0;
}`)
    const fr = Math.fround
    expect([0, 1, 2, 3].map((i) => r.m.mem.f32(r.g('f') + 4 * i))).toEqual([fr(fr(0.1) + fr(0.2)), 16777216, fr(fr(0.1) * 3), fr(1 / 3)])
    expect([r.m.mem.f64(r.g('d')), r.m.mem.f64(r.g('d') + 8)]).toEqual([fr(fr(0.1) + fr(0.2)), 0.1 + 0.2])
  })

  it('handles pointers, arrays, structs by value and struct returns', () => {
    const r = runC(`
struct pt { int x; double y; };
struct pt pts[3];
int out[9];
struct pt make(int x, double y) { struct pt p; p.x = x; p.y = y; return p; }
void fill(int *p, int n) { int i; for (i = 0; i < n; i++) *p++ = i * i; }
int sum(const int *a, int n) { int s = 0; while (n--) s += a[n]; return s; }
int main(void)
{
    int local[5];
    int *q;
    struct pt t;
    fill(local, 5);
    out[0] = sum(local, 5);
    q = &local[4];
    out[1] = q - local;
    out[2] = *(q - 1);
    pts[1] = make(7, 2.5);
    t = pts[1];
    out[3] = t.x;
    out[4] = (int)(t.y * 2);
    out[5] = sizeof(struct pt);
    {
        struct pt *pp = &pts[1];
        pp->x += 3;
        out[6] = pts[1].x;
    }
    out[7] = (int)((char *)&pts[2] - (char *)&pts[0]);
    out[8] = make(4, 1.0).x;
    return 0;
}`)
    expect(r.result.status).toBe('exited')
    expect(ints(r, 'out', 9)).toEqual([30, 4, 9, 7, 5, 16, 10, 32, 4])
  })

  it('passes variadic arguments in memory, as the EABI does', () => {
    const r = runC(`
#include <stdarg.h>
double total(int n, ...)
{
    va_list ap;
    double s = 0;
    int i;
    va_start(ap, n);
    for (i = 0; i < n; i++) s += va_arg(ap, double);
    va_end(ap);
    return s;
}
long long mix(int n, ...)
{
    va_list ap;
    long long v;
    int a;
    va_start(ap, n);
    a = va_arg(ap, int);
    v = va_arg(ap, long long);
    va_end(ap);
    return v + a;
}
double t;
long long m2;
int main(void) { t = total(3, 1.5, 2.0, 0.25f); m2 = mix(2, 5, 1LL << 40); return 0; }`)
    expect(r.m.mem.f64(r.g('t'))).toBe(3.75)
    expect(r.m.mem.i64(r.g('m2'))).toBe((1n << 40n) + 5n)
  })

  it('calls through function pointers and returns main as the exit code', () => {
    const r = runC(`
int twice(int x) { return 2 * x; }
int apply(int (*f)(int), int v) { return f(v); }
int main(void) { int (*g)(int) = twice; return apply(g, 21) + (g == twice); }`)
    expect(r.result).toMatchObject({ status: 'exited', code: 43 })
  })

  it('reads and writes with _mem4 at any byte, while *(unsigned *) keeps LDW alignment', () => {
    const r = runC(`
#include <c6x.h>
unsigned char buf[8] = { 1, 2, 3, 4, 5, 6, 7, 8 };
unsigned r[2];
int main(void) { r[0] = _mem4(&buf[1]); r[1] = *(unsigned *)&buf[1]; _mem4(&buf[3]) = 0xAABBCCDD; return 0; }`)
    expect([r.m.mem.u32(r.g('r')), r.m.mem.u32(r.g('r') + 4)]).toEqual([0x05040302, 0x04030201])
    expect([...r.m.mem.read(r.g('buf'), 8)]).toEqual([1, 2, 3, 0xdd, 0xcc, 0xbb, 0xaa, 8])
  })
})

describe('statements', () => {
  it('runs loops, switch fall-through, goto and recursion', () => {
    const r = runC(`
int out[5];
int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int classify(int v)
{
    switch (v) {
    case 0: return 10;
    case 1:
    case 2: v += 100;
    case 3: return v;
    default: break;
    }
    return -1;
}
int main(void)
{
    int i, n = 0;
    for (i = 0; i < 10; i++) { if (i == 2) continue; if (i == 6) break; n += i; }
    out[0] = n;
    out[1] = fact(10);
    out[2] = classify(0) + classify(2) * 1000 + classify(9) * 100000;
    i = 0;
    do { i += 3; } while (i < 10);
    out[3] = i;
    n = 0;
again:
    n++;
    if (n < 5) goto again;
    out[4] = n;
    return 0;
}`)
    expect(ints(r, 'out', 5)).toEqual([13, 3628800, 2010, 12, 5])
  })

  it('supports VLAs, compound literals, static locals and implicit declarations', () => {
    const r = runC(`
int counter(void) { static int n = 0; return ++n; }
int out[4];
int main(void)
{
    int k = 4;
    int v[k];
    int i;
    for (i = 0; i < k; i++) v[i] = i * 10;
    out[0] = v[3] + (int)sizeof v;
    counter();
    counter();
    out[1] = counter();
    out[2] = ((int[]){ 5, 6, 7 })[2];
    out[3] = later(20);
    return 0;
}
int later(int x) { return x + 1; }`)
    expect(ints(r, 'out', 4)).toEqual([46, 3, 7, 21])
  })
})

describe('halts', () => {
  it('halts on division by zero at the line', () => {
    const r = runC('int main(void)\n{\n    int z = 0;\n    return 5 / z;\n}')
    expect(r.result).toMatchObject({ status: 'halted', message: 'Division by zero', loc: { line: 4 } })
  })
  it('halts on an illegal memory access', () => {
    const r = runC('int main(void) { int *p = (int *)0; return *p; }')
    expect(r.result).toMatchObject({ status: 'halted', message: 'Illegal memory access at 0x00000000' })
  })
  it('halts on a stack overflow with an explanation', () => {
    const r = runC('int f(int n) { int big[64]; big[0] = n; return f(n + 1) + big[0]; }\nint main(void) { return f(0); }')
    expect(r.result.status).toBe('halted')
    expect(r.result.status === 'halted' && r.result.message).toMatch(/^Stack overflow in f\(\): \.stack \(0x800 bytes\) is full/)
  })
  it('stops an endless loop at the step limit', () => {
    const r = runC('int main(void) { for (;;) {} return 0; }', { maxSteps: 1000 })
    expect(r.result).toMatchObject({ status: 'halted', steps: 1000 })
  })
  it('notes writes and reads outside a named array once, and carries on like the hardware', () => {
    const r = runC(`
float y[8];
float z;
int main(void)
{
    int i;
    for (i = 0; i <= 8; i++) y[i] = 1;
    z = y[-1] + y[8];
    return 0;
}`)
    expect(r.result.status).toBe('exited')
    expect(r.notes).toEqual(["write past end of 'y' (y[8], size 8)", "read before start of 'y' (y[-1], size 8)", "read past end of 'y' (y[8], size 8)"])
  })
  it('refuses to load a goto into a nested block', () => {
    const { program, image } = build('int main(void)\n{\n    goto inside;\n    {\n    inside:\n        return 1;\n    }\n}')
    expect(() => loadProgram(program, image, NO_IO)).toThrow('LabSim: unsupported construct goto into a nested block')
  })
})

describe('speed', () => {
  it('runs a simple loop at millions of statements per second', () => {
    const t0 = performance.now()
    const r = runC('int main(void) { int i, s = 0; for (i = 0; i < 3000000; i++) s += i & 7; return s & 0xff; }')
    const seconds = (performance.now() - t0) / 1000
    expect(r.result).toMatchObject({ status: 'exited', code: (3000000 / 8) * 28 & 0xff })
    console.log(`${(r.result.steps / seconds / 1e6).toFixed(1)} M statements/s`)
    expect(r.result.steps / seconds).toBeGreaterThan(5e6)
  })
})
```

- [ ] **Step 3: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/exec/exec.test.ts`
Expected: FAIL, because `src/interp/run` does not exist.

- [ ] **Step 4: Implement the expression compiler**

```ts path=src/interp/exec/expr.ts
import type { BinOp, Expr, FuncSym, Init, VarSym } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import { alignOf, alignUp, compatible, sizeOf, type FunctionType, type PointerType, type Type } from '../frontend/types'
import { controlRegister } from '../runtime/cregs'
import { LoadError, type Callable, type Machine } from './machine'
import { hex } from './memory'
import { converter, isBig, isFloatKind, kindOf, kindSize, loader, storer, wrapper, zeroOf, type Kind, type Load, type Store } from './scalar'

/** A compiled expression: returns the value (number, bigint, an address for aggregates, undefined for void). */
export type Ev = () => any

/** Where the current function keeps its automatic objects, relative to the frame pointer. */
export interface FrameScope {
  offset(v: VarSym): number
  temp(size: number, align: number): number
}

type Access = 'read' | 'write' | 'none'
type Deref = Extract<Expr, { k: 'deref' }>
type PtrAdd = Extract<Expr, { k: 'ptradd' }>

const isAuto = (v: VarSym): boolean => v.storage === 'auto' || v.storage === 'param'
const isVla = (t: Type): boolean => t.kind === 'array' && !!t.vla

/** How a bounds note names an array: `y`, `s.buf`, `p->buf`; null for arrays without a simple name. */
function describe(e: Expr): string | null {
  if (e.k === 'var') return e.sym.hidden ? null : e.sym.name
  if (e.k === 'member') {
    const b = e.base
    if (b.k === 'deref' && b.arg.k === 'var') return `${b.arg.sym.name}->${e.member.name}`
    const inner = describe(b)
    return inner === null ? null : `${inner}.${e.member.name}`
  }
  return null
}

function keyOf(e: Expr): string {
  if (e.k === 'var') return `${e.sym.file}#${e.sym.id}`
  if (e.k === 'member') return `${keyOf(e.base)}.${e.member.name}`
  if (e.k === 'deref') return `*${keyOf(e.arg)}`
  return '?'
}

/** Binary arithmetic in the kind of the (converted) operands. Integer division by zero halts the target. */
export function arith(m: Machine, op: BinOp, k: Kind): (x: any, y: any) => any {
  const div0 = (): never => m.trap('Division by zero')
  if (isBig(k)) {
    const w = wrapper(k)
    const count = (y: any): bigint => BigInt(typeof y === 'bigint' ? Number(y & 63n) : y & 63)
    switch (op) {
      case '+': return (x, y) => w(x + y)
      case '-': return (x, y) => w(x - y)
      case '*': return (x, y) => w(x * y)
      case '/': return (x, y) => (y === 0n ? div0() : w(x / y))
      case '%': return (x, y) => (y === 0n ? div0() : w(x % y))
      case '<<': return (x, y) => w(x << count(y))
      case '>>': return (x, y) => w(x >> count(y))
      case '&': return (x, y) => w(x & y)
      case '|': return (x, y) => w(x | y)
      case '^': return (x, y) => w(x ^ y)
    }
  }
  if (k === 'f32') {
    switch (op) {
      case '+': return (x, y) => Math.fround(x + y)
      case '-': return (x, y) => Math.fround(x - y)
      case '*': return (x, y) => Math.fround(x * y)
      case '/': return (x, y) => Math.fround(x / y)
    }
  }
  if (k === 'f64') {
    switch (op) {
      case '+': return (x, y) => x + y
      case '-': return (x, y) => x - y
      case '*': return (x, y) => x * y
      case '/': return (x, y) => x / y
    }
  }
  if (k === 'u32' || k === 'ptr') {
    switch (op) {
      case '+': return (x, y) => (x + y) >>> 0
      case '-': return (x, y) => (x - y) >>> 0
      case '*': return (x, y) => Math.imul(x, y) >>> 0
      case '/': return (x, y) => (y === 0 ? div0() : Math.trunc(x / y))
      case '%': return (x, y) => (y === 0 ? div0() : x % y)
      case '<<': return (x, y) => (x << y) >>> 0
      case '>>': return (x, y) => x >>> y
      case '&': return (x, y) => (x & y) >>> 0
      case '|': return (x, y) => (x | y) >>> 0
      case '^': return (x, y) => (x ^ y) >>> 0
    }
  }
  switch (op) {
    case '+': return (x, y) => (x + y) | 0
    case '-': return (x, y) => (x - y) | 0
    case '*': return (x, y) => Math.imul(x, y)
    case '/': return (x, y) => (y === 0 ? div0() : (x / y) | 0)
    case '%': return (x, y) => (y === 0 ? div0() : (x % y) | 0)
    case '<<': return (x, y) => x << y
    case '>>': return (x, y) => x >> y
    case '&': return (x, y) => x & y
    case '|': return (x, y) => x | y
    case '^': return (x, y) => x ^ y
  }
  throw new Error(`no operator ${op} for ${k}`)
}

function unalignedLoader(m: Machine, k: Kind): Load {
  const size = kindSize(k)
  return (a) => {
    const dv = new DataView(m.mem.read(a, size).buffer)
    switch (k) {
      case 'i16': return dv.getInt16(0, true)
      case 'u16': return dv.getUint16(0, true)
      case 'i32': return dv.getInt32(0, true)
      case 'f32': return dv.getFloat32(0, true)
      case 'f64': return dv.getFloat64(0, true)
      case 'i64': return dv.getBigInt64(0, true)
      case 'u64': return dv.getBigUint64(0, true)
      case 'i8': return dv.getInt8(0)
      case 'u8':
      case 'bool': return dv.getUint8(0)
      default: return dv.getUint32(0, true)
    }
  }
}

function unalignedStorer(m: Machine, k: Kind): Store {
  const size = kindSize(k)
  return (a, v) => {
    const bytes = new Uint8Array(size)
    const dv = new DataView(bytes.buffer)
    switch (k) {
      case 'i16':
      case 'u16': dv.setInt16(0, v, true); break
      case 'f32': dv.setFloat32(0, v, true); break
      case 'f64': dv.setFloat64(0, v, true); break
      case 'i64':
      case 'u64': dv.setBigInt64(0, v, true); break
      case 'i8':
      case 'u8':
      case 'bool': dv.setInt8(0, v); break
      default: dv.setInt32(0, v, true)
    }
    m.mem.write(a, bytes)
  }
}

interface VaSlot {
  off: number
  size: number
  align: number
  value: Ev
  store: Store
}

/** Compiles expressions of one function into closures. */
export class ExprCompiler {
  constructor(
    private readonly m: Machine,
    private readonly scope: FrameScope
  ) {}

  value(e: Expr): Ev {
    switch (e.k) {
      case 'int': {
        const c = converter('i64', kindOf(e.type))
        const raw = BigInt.asIntN(64, e.value)
        const v = c ? c(raw) : raw
        return () => v
      }
      case 'float': {
        const v = kindOf(e.type) === 'f32' ? Math.fround(e.value) : e.value
        return () => v
      }
      case 'string': {
        const a = this.m.placement.stringAddress(e)
        return () => a
      }
      case 'var':
        return this.variable(e.sym)
      case 'func':
        return this.functionValue(e.sym, e.loc)
      case 'unary':
        return this.unary(e)
      case 'deref':
        return this.deref(e)
      case 'addr':
        return e.arg.k === 'func' ? this.functionValue(e.arg.sym, e.loc) : this.address(e.arg, 'none')
      case 'binary':
        return this.binary(e)
      case 'ptradd': {
        const p = this.value(e.ptr)
        const i = this.index(e.index)
        const s = e.scale
        return e.sub ? () => (p() - i() * s) >>> 0 : () => (p() + i() * s) >>> 0
      }
      case 'ptrdiff': {
        const a = this.value(e.left)
        const b = this.value(e.right)
        const s = e.scale
        return () => Math.trunc(((a() - b()) | 0) / s) | 0
      }
      case 'logical': {
        const a = this.truth(e.left)
        const b = this.truth(e.right)
        return e.op === '&&' ? () => (a() && b() ? 1 : 0) : () => (a() || b() ? 1 : 0)
      }
      case 'assign':
        return this.assign(e)
      case 'compound':
        return this.compound(e)
      case 'incdec':
        return this.incdec(e)
      case 'cond': {
        const t = this.truth(e.test)
        const a = this.value(e.then)
        const b = this.value(e.else)
        return () => (t() ? a() : b())
      }
      case 'comma': {
        const a = this.value(e.left)
        const b = this.value(e.right)
        return () => {
          a()
          return b()
        }
      }
      case 'call':
        return this.call(e)
      case 'member':
        return this.member(e)
      case 'cast':
        return this.cast(e)
      case 'decay':
        return this.address(e.arg, 'none')
      case 'compoundLit':
        return this.compoundLiteral(e)
      case 'vaStart': {
        const ap = this.address(e.ap, 'write')
        const m = this.m
        return () => {
          m.mem.set32(ap(), m.va)
          return undefined
        }
      }
      case 'vaArg':
        return this.vaArg(e)
      case 'error':
        throw new LoadError('LabSim: the program has an expression with errors', e.loc)
    }
  }

  /** A controlling expression: true when the scalar is non-zero (NaN counts as non-zero, as in C). */
  truth(e: Expr): () => boolean {
    const v = this.value(e)
    return isBig(kindOf(e.type)) ? () => v() !== 0n : () => v() !== 0
  }

  /** The address of an lvalue, or of an aggregate value. `access` decides which bounds note an array index gives. */
  address(e: Expr, access: Access): Ev {
    switch (e.k) {
      case 'var':
        return this.varAddress(e.sym)
      case 'deref':
        return this.derefAddress(e, access)
      case 'member': {
        const base = this.address(e.base, access)
        const off = e.member.offset
        return off === 0 ? base : () => base() + off
      }
      case 'string': {
        const a = this.m.placement.stringAddress(e)
        return () => a
      }
      case 'compoundLit':
        return this.compoundLiteral(e)
      case 'func':
        return this.functionValue(e.sym, e.loc)
      default:
        if (kindOf(e.type) === 'agg') return this.value(e)
        throw new LoadError('LabSim: unsupported construct address of a value', e.loc)
    }
  }

  /** Stores an initialiser at a runtime address: `list` zeroes the object first, as C requires. */
  initializer(type: Type, init: Init): (addr: number) => void {
    if (init.k === 'expr') return this.initItem(type, 0, init.expr)
    const n = sizeOf(type)
    const items = init.items.map((it) => this.initItem(it.type, it.offset, it.expr))
    const mem = this.m.mem
    return (a) => {
      mem.fill(a, 0, n)
      for (let i = 0; i < items.length; i++) items[i](a)
    }
  }

  private initItem(type: Type, off: number, e: Expr): (addr: number) => void {
    const mem = this.m.mem
    if (e.k === 'string' && type.kind === 'array') {
      const bytes = e.bytes.slice(0, sizeOf(type))
      return (a) => mem.write(a + off, bytes)
    }
    const k = kindOf(type)
    const v = this.value(e)
    if (k === 'agg') {
      const n = sizeOf(type)
      return (a) => mem.copy(a + off, v(), n)
    }
    const st = storer(mem, k)
    return (a) => st(a + off, v())
  }

  private index(e: Expr): () => number {
    const v = this.value(e)
    return isBig(kindOf(e.type)) ? () => Number(BigInt.asIntN(32, v())) : v
  }

  private varAddress(v: VarSym): Ev {
    const m = this.m
    if (v.cregister) throw new LoadError(`LabSim: unsupported construct address of control register ${v.name}`, v.loc)
    if (isAuto(v)) {
      const off = this.scope.offset(v)
      if (isVla(v.type)) return () => m.mem.u32(m.fp + off)
      return () => m.fp + off
    }
    const a = m.placement.objectAddress(v)
    return () => a
  }

  private variable(v: VarSym): Ev {
    const m = this.m
    if (v.cregister) {
      const r = controlRegister(m, v.name)
      return () => r.read()
    }
    const k = kindOf(v.type)
    if (k === 'agg') return this.varAddress(v)
    const ld = loader(m.mem, k)
    if (isAuto(v)) {
      const off = this.scope.offset(v)
      return () => ld(m.fp + off)
    }
    const a = m.placement.objectAddress(v)
    return () => ld(a)
  }

  private functionValue(f: FuncSym, at: Loc): Ev {
    this.m.resolve(f, at)
    const a = this.m.placement.functionAddress(f)
    return () => a
  }

  private unary(e: Extract<Expr, { k: 'unary' }>): Ev {
    if (e.op === '!') {
      const t = this.truth(e.arg)
      return () => (t() ? 0 : 1)
    }
    const a = this.value(e.arg)
    if (e.op === '+') return a
    const k = kindOf(e.type)
    if (isBig(k)) {
      const w = wrapper(k)
      return e.op === '-' ? () => w(-a()) : () => w(~a())
    }
    if (e.op === '-') {
      if (isFloatKind(k)) return () => -a()
      return k === 'u32' ? () => -a() >>> 0 : () => -a() | 0
    }
    return k === 'u32' ? () => ~a() >>> 0 : () => ~a()
  }

  private deref(e: Deref): Ev {
    const k = kindOf(e.type)
    if (k === 'agg' || k === 'void') return this.derefAddress(e, 'none')
    const ld = e.unaligned ? unalignedLoader(this.m, k) : loader(this.m.mem, k)
    const a = this.derefAddress(e, 'read')
    return () => ld(a())
  }

  private derefAddress(e: Deref, access: Access): Ev {
    const arg = e.arg
    if (access !== 'none' && arg.k === 'ptradd' && arg.ptr.k === 'decay') {
      const arr = arg.ptr.arg
      const name = describe(arr)
      if (name !== null && arr.type.kind === 'array' && arr.type.length !== null && !arr.type.vla) {
        return this.checkedElement(arr, name, arr.type.length, arg, access)
      }
    }
    return this.value(arg)
  }

  /** `a[i]` on a named array: a one-time note when i is outside it; the access still happens, as on the hardware. */
  private checkedElement(arr: Expr, name: string, length: number, add: PtrAdd, access: 'read' | 'write'): Ev {
    const base = this.address(arr, 'none')
    const idx = this.index(add.index)
    const scale = add.scale
    const sign = add.sub ? -1 : 1
    const m = this.m
    const key = `${keyOf(arr)}:${access}`
    return () => {
      const i = sign * idx()
      if (i < 0 || i >= length) {
        m.note(`${key}:${i < 0}`, `${access} ${i < 0 ? 'before start' : 'past end'} of '${name}' (${name}[${i}], size ${length})`)
      }
      return (base() + i * scale) >>> 0
    }
  }

  private member(e: Extract<Expr, { k: 'member' }>): Ev {
    const k = kindOf(e.type)
    if (k === 'agg') return this.address(e, 'none')
    const a = this.address(e, 'read')
    const ld = loader(this.m.mem, k)
    return () => ld(a())
  }

  private binary(e: Extract<Expr, { k: 'binary' }>): Ev {
    const a = this.value(e.left)
    let b = this.value(e.right)
    const op = e.op
    switch (op) {
      case '<': return () => (a() < b() ? 1 : 0)
      case '>': return () => (a() > b() ? 1 : 0)
      case '<=': return () => (a() <= b() ? 1 : 0)
      case '>=': return () => (a() >= b() ? 1 : 0)
      case '==': return () => (a() === b() ? 1 : 0)
      case '!=': return () => (a() !== b() ? 1 : 0)
    }
    const k = kindOf(e.type)
    if (k === 'i32') {
      if (op === '+') return () => (a() + b()) | 0
      if (op === '-') return () => (a() - b()) | 0
      if (op === '*') return () => Math.imul(a(), b())
    } else if (k === 'f64') {
      if (op === '+') return () => a() + b()
      if (op === '-') return () => a() - b()
      if (op === '*') return () => a() * b()
      if (op === '/') return () => a() / b()
    } else if (k === 'f32') {
      if (op === '+') return () => Math.fround(a() + b())
      if (op === '-') return () => Math.fround(a() - b())
      if (op === '*') return () => Math.fround(a() * b())
      if (op === '/') return () => Math.fround(a() / b())
    }
    if ((op === '<<' || op === '>>') && !isBig(k) && isBig(kindOf(e.right.type))) {
      const r = b
      b = () => Number(BigInt.asUintN(6, r()))
    }
    const f = arith(this.m, op, k)
    return () => f(a(), b())
  }

  private cast(e: Extract<Expr, { k: 'cast' }>): Ev {
    const a = this.value(e.arg)
    if (e.type.kind === 'void') {
      return () => {
        a()
        return undefined
      }
    }
    const c = converter(kindOf(e.arg.type), kindOf(e.type))
    return c ? () => c(a()) : a
  }

  private assign(e: Extract<Expr, { k: 'assign' }>): Ev {
    const m = this.m
    const t = e.target
    const v = this.value(e.value)
    if (t.k === 'var' && t.sym.cregister) {
      const r = controlRegister(m, t.sym.name)
      return () => {
        const x = v()
        r.write(x)
        return x
      }
    }
    const k = kindOf(e.type)
    if (k === 'agg') {
      const dst = this.address(t, 'write')
      const n = sizeOf(e.type)
      return () => {
        const d = dst()
        m.mem.copy(d, v(), n)
        return d
      }
    }
    const st = t.k === 'deref' && t.unaligned ? unalignedStorer(m, k) : storer(m.mem, k)
    if (t.k === 'var' && isAuto(t.sym)) {
      const off = this.scope.offset(t.sym)
      return () => {
        const x = v()
        st(m.fp + off, x)
        return x
      }
    }
    const a = this.address(t, 'write')
    return () => {
      const addr = a()
      const x = v()
      st(addr, x)
      return x
    }
  }

  /** Read-modify-write access to an lvalue, for compound assignment and ++/--. */
  private cell(t: Expr): { at: () => number; get: Load; set: Store } {
    if (t.k === 'var' && t.sym.cregister) {
      const r = controlRegister(this.m, t.sym.name)
      return { at: () => 0, get: () => r.read(), set: (_a, v) => r.write(v) }
    }
    const k = kindOf(t.type)
    const unaligned = t.k === 'deref' && !!t.unaligned
    return {
      at: this.address(t, 'write'),
      get: unaligned ? unalignedLoader(this.m, k) : loader(this.m.mem, k),
      set: unaligned ? unalignedStorer(this.m, k) : storer(this.m.mem, k)
    }
  }

  private compound(e: Extract<Expr, { k: 'compound' }>): Ev {
    const c = this.cell(e.target)
    const tk = kindOf(e.type)
    const base = e.op.slice(0, -1) as BinOp
    if (e.scale > 0 && tk === 'ptr') {
      const i = this.index(e.value)
      const s = base === '-' ? -e.scale : e.scale
      return () => {
        const a = c.at()
        const r = (c.get(a) + i() * s) >>> 0
        c.set(a, r)
        return r
      }
    }
    let v = this.value(e.value)
    const ok = kindOf(e.opType)
    if ((base === '<<' || base === '>>') && !isBig(ok) && isBig(kindOf(e.value.type))) {
      const r = v
      v = () => Number(BigInt.asUintN(6, r()))
    }
    const toOp = converter(tk, ok)
    const back = converter(ok, tk)
    const f = arith(this.m, base, ok)
    return () => {
      const a = c.at()
      let x = c.get(a)
      if (toOp) x = toOp(x)
      let r = f(x, v())
      if (back) r = back(r)
      c.set(a, r)
      return r
    }
  }

  private incdec(e: Extract<Expr, { k: 'incdec' }>): Ev {
    const m = this.m
    const k = kindOf(e.type)
    const d = e.op === '++' ? 1 : -1
    const t = e.target
    if (k === 'i32' && t.k === 'var' && isAuto(t.sym)) {
      const off = this.scope.offset(t.sym)
      return e.prefix
        ? () => {
            const a = m.fp + off
            const n = (m.mem.i32(a) + d) | 0
            m.mem.set32(a, n)
            return n
          }
        : () => {
            const a = m.fp + off
            const o = m.mem.i32(a)
            m.mem.set32(a, (o + d) | 0)
            return o
          }
    }
    let step: (x: any) => any
    if (k === 'ptr') {
      const s = d * e.scale
      step = (x) => (x + s) >>> 0
    } else if (isBig(k)) {
      const w = wrapper(k)
      const b = BigInt(d)
      step = (x) => w(x + b)
    } else if (k === 'f32') step = (x) => Math.fround(x + d)
    else if (k === 'f64') step = (x) => x + d
    else if (k === 'i32') step = (x) => (x + d) | 0
    else if (k === 'u32') step = (x) => (x + d) >>> 0
    else {
      const back = converter('i32', k) as (v: any) => any
      step = (x) => back((x + d) | 0)
    }
    const c = this.cell(t)
    return e.prefix
      ? () => {
          const a = c.at()
          const n = step(c.get(a))
          c.set(a, n)
          return n
        }
      : () => {
          const a = c.at()
          const o = c.get(a)
          c.set(a, step(o))
          return o
        }
  }

  private call(e: Extract<Expr, { k: 'call' }>): Ev {
    const m = this.m
    const direct = e.callee.k === 'addr' && e.callee.arg.k === 'func' ? e.callee.arg.sym : null
    const site = (e.callee.type as PointerType).to as FunctionType
    const target = direct ? m.resolve(direct, e.loc) : null
    // A call through an implicit declaration (or a prototype of its own) converts to the callee's real types.
    const real = target?.type && !compatible(target.type, site) ? target.type : null
    const fixed = target ? target.fixed : site.variadic ? site.params.length : e.args.length
    const named: Ev[] = e.args.slice(0, fixed).map((a, i) => {
      const v = this.value(a)
      const to = real?.params[i]?.type
      const c = to ? converter(kindOf(a.type), kindOf(to)) : null
      return c ? () => c(v()) : v
    })
    const extras = e.args.slice(fixed).map((a) => this.vaSlot(a))
    let vaSize = 0
    for (const s of extras) {
      vaSize = alignUp(vaSize, s.align)
      s.off = vaSize
      vaSize += alignUp(s.size, 4)
    }
    vaSize = alignUp(vaSize, 8)
    const retKind = kindOf(e.type)
    const retOff = retKind === 'agg' ? this.scope.temp(sizeOf(e.type), Math.max(alignOf(e.type), 4)) : -1
    const back = real ? converter(kindOf(real.ret), retKind) : null
    const zero = zeroOf(retKind)
    const callee = target ? (): Callable => target : this.pointerCallee(e.callee)
    const n = named.length
    const invoke = (): any => {
      const c = callee()
      const args = new Array(n)
      for (let i = 0; i < n; i++) args[i] = named[i]()
      const retBuf = retOff >= 0 ? m.fp + retOff : 0
      if (extras.length === 0) return c.invoke(args, 0, retBuf)
      const values = extras.map((s) => s.value())
      const sp = m.sp
      const va = sp - vaSize
      if (va < m.stackLow) m.trap(`Stack overflow passing arguments to ${c.name}()`)
      m.sp = va
      for (let i = 0; i < extras.length; i++) extras[i].store(va + extras[i].off, values[i])
      const r = c.invoke(args, va, retBuf)
      m.sp = sp
      return r
    }
    if (retKind === 'void') return invoke
    if (retKind === 'agg') {
      return () => {
        invoke()
        return m.fp + retOff
      }
    }
    return () => {
      let r = invoke()
      if (r === undefined) r = zero
      return back ? back(r) : r
    }
  }

  private pointerCallee(e: Expr): () => Callable {
    const f = this.value(e)
    const m = this.m
    return () => {
      const a = f()
      const c = m.functions.get(a)
      if (!c) m.trap(`Call through an invalid function pointer (0x${hex(a)})`)
      return c
    }
  }

  /** A variadic argument: in memory below sp, aligned to its size (at least 4), as the C6000 EABI passes them. */
  private vaSlot(a: Expr): VaSlot {
    const k = kindOf(a.type)
    const value = this.value(a)
    if (k === 'agg') {
      const n = sizeOf(a.type)
      const mem = this.m.mem
      return { off: 0, size: n, align: Math.max(4, alignOf(a.type)), value, store: (addr, v) => mem.copy(addr, v, n) }
    }
    const size = kindSize(k)
    return { off: 0, size, align: Math.max(4, size), value, store: storer(this.m.mem, k) }
  }

  private vaArg(e: Extract<Expr, { k: 'vaArg' }>): Ev {
    const k = kindOf(e.type)
    const size = k === 'agg' ? sizeOf(e.type) : kindSize(k)
    const align = Math.max(4, k === 'agg' ? alignOf(e.type) : size)
    const ap = this.address(e.ap, 'write')
    const ld = loader(this.m.mem, k)
    const mem = this.m.mem
    return () => {
      const cell = ap()
      const p = alignUp(mem.u32(cell), align)
      mem.set32(cell, p + alignUp(size, 4))
      return ld(p)
    }
  }

  private compoundLiteral(e: Extract<Expr, { k: 'compoundLit' }>): Ev {
    const v = e.obj
    if (!isAuto(v)) {
      const a = this.m.placement.objectAddress(v)
      return () => a
    }
    const off = this.scope.offset(v)
    const init = this.initializer(v.type, e.init)
    const m = this.m
    return () => {
      const a = m.fp + off
      init(a)
      return a
    }
  }
}
```

- [ ] **Step 5: Implement statements and functions**

```ts path=src/interp/exec/stmt.ts
import type { Block, FunctionDef, Stmt, VarSym } from '../frontend/ast'
import type { Loc } from '../frontend/diag'
import { alignOf, alignUp, sizeOf, type ArrayType, type FunctionType } from '../frontend/types'
import { ExprCompiler, type FrameScope } from './expr'
import { LoadError, type Callable, type Machine } from './machine'
import { converter, isBig, kindOf, storer, zeroOf, type Store } from './scalar'

/** How a statement completed. */
export const NORMAL = 0
export const BREAK = 1
export const CONTINUE = 2
export const RETURN = 3
export const GOTO = 4

type Exec = () => number

const isVlaVar = (v: VarSym): boolean => v.type.kind === 'array' && !!v.type.vla

function stackOverflow(m: Machine, fn: string): string {
  const size = (m.stackTop - m.stackLow).toString(16)
  return `Stack overflow in ${fn}(): .stack (0x${size} bytes) is full. Make big local arrays global or static, or raise the stack size.`
}

/** One function's frame: a slot for every parameter, automatic variable and compound literal, plus temporaries. */
class FrameLayout implements FrameScope {
  size = 0
  private readonly offsets = new Map<VarSym, number>()

  constructor(def: FunctionDef) {
    for (const v of [...def.params, ...def.locals]) {
      const vla = isVlaVar(v)
      this.offsets.set(v, this.temp(vla ? 4 : Math.max(sizeOf(v.type), 1), vla ? 4 : alignOf(v.type)))
    }
  }

  offset(v: VarSym): number {
    const o = this.offsets.get(v)
    if (o === undefined) throw new LoadError(`LabSim: no stack slot for '${v.name}'`, v.loc)
    return o
  }

  temp(size: number, align: number): number {
    this.size = alignUp(this.size, align)
    const o = this.size
    this.size += size
    return o
  }
}

/** Labels that are statements of this list, directly or behind case/default/label prefixes: name → index. */
function directLabels(list: Stmt[]): Map<string, number> {
  const out = new Map<string, number>()
  list.forEach((s, i) => {
    let x: Stmt = s
    while (x.k === 'label' || x.k === 'case' || x.k === 'default') {
      if (x.k === 'label') out.set(x.name, i)
      x = x.body
    }
  })
  return out
}

function runFrom(m: Machine, list: Exec[], labels: Map<string, number>, start: number): number {
  for (let i = start; i < list.length; i++) {
    const c = list[i]()
    if (c === NORMAL) continue
    if (c === GOTO) {
      const j = labels.get(m.gotoLabel)
      if (j !== undefined) {
        i = j - 1
        continue
      }
    }
    return c
  }
  return NORMAL
}

class StmtCompiler {
  /** Labels of the enclosing blocks: where a goto compiled now may jump. */
  private readonly scopes: Set<string>[] = []

  constructor(
    private readonly m: Machine,
    private readonly ex: ExprCompiler,
    private readonly frame: FrameLayout
  ) {}

  stmt(s: Stmt): Exec {
    const m = this.m
    const loc = s.loc
    switch (s.k) {
      case 'expr': {
        const e = this.ex.value(s.expr)
        return () => {
          m.loc = loc
          if (++m.ops >= m.limit) m.poll()
          e()
          return NORMAL
        }
      }
      case 'decl':
        return this.decl(s.vars, loc)
      case 'block':
        return this.block(s)
      case 'if': {
        const t = this.ex.truth(s.test)
        const a = this.stmt(s.then)
        const b = s.else ? this.stmt(s.else) : null
        return () => {
          m.loc = loc
          if (++m.ops >= m.limit) m.poll()
          return t() ? a() : b ? b() : NORMAL
        }
      }
      case 'while': {
        const t = this.ex.truth(s.test)
        const body = this.stmt(s.body)
        return () => {
          for (;;) {
            m.loc = loc
            if (++m.ops >= m.limit) m.poll()
            if (!t()) return NORMAL
            const c = body()
            if (c === BREAK) return NORMAL
            if (c !== NORMAL && c !== CONTINUE) return c
          }
        }
      }
      case 'do': {
        const t = this.ex.truth(s.test)
        const body = this.stmt(s.body)
        const at = s.test.loc
        return () => {
          for (;;) {
            const c = body()
            if (c === BREAK) return NORMAL
            if (c !== NORMAL && c !== CONTINUE) return c
            m.loc = at
            if (++m.ops >= m.limit) m.poll()
            if (!t()) return NORMAL
          }
        }
      }
      case 'for':
        return this.forLoop(s)
      case 'switch':
        return this.switchStmt(s)
      case 'case':
      case 'default':
      case 'label':
        return this.stmt(s.body)
      case 'break':
        return this.jump(loc, BREAK)
      case 'continue':
        return this.jump(loc, CONTINUE)
      case 'return':
        return this.returnStmt(s)
      case 'goto': {
        const label = s.label
        if (!this.scopes.some((sc) => sc.has(label))) throw new LoadError('LabSim: unsupported construct goto into a nested block', loc)
        return () => {
          m.loc = loc
          if (++m.ops >= m.limit) m.poll()
          m.gotoLabel = label
          return GOTO
        }
      }
      case 'empty':
        return () => NORMAL
    }
  }

  private jump(loc: Loc, code: number): Exec {
    const m = this.m
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      return code
    }
  }

  private block(s: Block): Exec {
    const m = this.m
    const labels = directLabels(s.body)
    this.scopes.push(new Set(labels.keys()))
    const list = s.body.map((x) => this.stmt(x))
    this.scopes.pop()
    const n = list.length
    const run: Exec =
      labels.size === 0
        ? () => {
            for (let i = 0; i < n; i++) {
              const c = list[i]()
              if (c !== NORMAL) return c
            }
            return NORMAL
          }
        : () => runFrom(m, list, labels, 0)
    // A variable-length array lives until the end of its block.
    if (!s.body.some((x) => x.k === 'decl' && x.vars.some(isVlaVar))) return run
    return () => {
      const sp = m.sp
      const c = run()
      m.sp = sp
      return c
    }
  }

  private decl(vars: VarSym[], loc: Loc): Exec {
    const m = this.m
    const steps = vars.map((v) => this.declStep(v)).filter((f): f is () => void => f !== null)
    if (steps.length === 0) return () => NORMAL
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      for (let i = 0; i < steps.length; i++) steps[i]()
      return NORMAL
    }
  }

  private declStep(v: VarSym): (() => void) | null {
    const m = this.m
    const off = this.frame.offset(v)
    if (isVlaVar(v)) {
      const t = v.type as ArrayType
      const len = t.vla?.len
      const elem = sizeOf(t.of)
      if (!len || elem === 0) throw new LoadError('LabSim: unsupported construct multi-dimensional variable-length array', v.loc)
      const lenOff = this.frame.offset(len)
      return () => {
        const bytes = alignUp(m.mem.u32(m.fp + lenOff) * elem, 8)
        const p = m.sp - bytes
        if (p < m.stackLow) m.trap(stackOverflow(m, m.frames.at(-1)?.fn.sym.name ?? '?'))
        m.sp = p
        m.mem.set32(m.fp + off, p)
      }
    }
    if (!v.init) return null
    const init = this.ex.initializer(v.type, v.init)
    return () => init(m.fp + off)
  }

  private forLoop(s: Extract<Stmt, { k: 'for' }>): Exec {
    const m = this.m
    const loc = s.loc
    const init = s.init ? this.stmt(s.init) : null
    const t = s.test ? this.ex.truth(s.test) : null
    const step = s.step ? this.ex.value(s.step) : null
    const body = this.stmt(s.body)
    return () => {
      if (init) {
        const c = init()
        if (c !== NORMAL) return c
      }
      for (;;) {
        m.loc = loc
        if (++m.ops >= m.limit) m.poll()
        if (t && !t()) return NORMAL
        const c = body()
        if (c === BREAK) return NORMAL
        if (c !== NORMAL && c !== CONTINUE) return c
        if (step) step()
      }
    }
  }

  private switchStmt(s: Extract<Stmt, { k: 'switch' }>): Exec {
    const m = this.m
    const loc = s.loc
    const test = this.ex.value(s.test)
    const kind = kindOf(s.test.type)
    const key = converter('i64', kind)
    const list = s.body.k === 'block' ? s.body.body : [s.body]
    const entries = new Map<number | bigint, number>()
    let dflt = -1
    list.forEach((st, i) => {
      let x: Stmt = st
      while (x.k === 'label' || x.k === 'case' || x.k === 'default') {
        if (x.k === 'case') {
          const raw = BigInt.asIntN(64, x.value)
          entries.set(key ? key(raw) : raw, i)
        }
        if (x.k === 'default') dflt = i
        x = x.body
      }
    })
    if (entries.size !== s.cases.length || (s.default !== null && dflt < 0)) {
      throw new LoadError('LabSim: unsupported construct case label inside a nested statement', loc)
    }
    const labels = directLabels(list)
    this.scopes.push(new Set(labels.keys()))
    const code = list.map((x) => this.stmt(x))
    this.scopes.pop()
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      const start = entries.get(test()) ?? dflt
      if (start < 0) return NORMAL
      const c = runFrom(m, code, labels, start)
      return c === BREAK ? NORMAL : c
    }
  }

  private returnStmt(s: Extract<Stmt, { k: 'return' }>): Exec {
    const m = this.m
    const loc = s.loc
    const e = s.value
    if (!e) return this.jump(loc, RETURN)
    const v = this.ex.value(e)
    if (kindOf(e.type) === 'agg') {
      const n = sizeOf(e.type)
      return () => {
        m.loc = loc
        if (++m.ops >= m.limit) m.poll()
        const src = v()
        if (m.retBuf) m.mem.copy(m.retBuf, src, n)
        m.ret = m.retBuf
        return RETURN
      }
    }
    return () => {
      m.loc = loc
      if (++m.ops >= m.limit) m.poll()
      m.ret = v()
      return RETURN
    }
  }
}

interface ParamSlot {
  off: number
  store: Store
}

/** A user function compiled to closures. `invoke` builds its frame on the simulated stack. */
export class FunctionCode implements Callable {
  readonly name: string
  readonly fixed: number
  readonly variadic: boolean
  readonly type: FunctionType
  private body: Exec
  private frameSize = 0
  private params: (ParamSlot | null)[] = []
  private zeros: (number | bigint)[] = []
  /** A 40/64-bit return type: a `return 0;` compiled as an int constant still returns a bigint. */
  private retBig = false

  constructor(
    private readonly m: Machine,
    readonly def: FunctionDef
  ) {
    this.name = def.sym.name
    this.type = def.sym.type
    this.fixed = this.type.params.length
    this.variadic = this.type.variadic
    this.body = () => {
      throw new Error(`${this.name} was called before it was compiled`)
    }
  }

  compile(): void {
    const m = this.m
    const def = this.def
    const frame = new FrameLayout(def)
    const block = new StmtCompiler(m, new ExprCompiler(m, frame), frame).stmt(def.body)
    const end = def.end
    this.body = () => {
      const c = block()
      if (c !== RETURN) {
        // Falling off the end stops at the closing brace, as CCS shows it.
        m.loc = end
        if (++m.ops >= m.limit) m.poll()
      }
      return c
    }
    let named = 0
    this.params = this.type.params.map((p): ParamSlot | null => {
      if (p.name === null) return null
      const v = def.params[named++]
      const k = kindOf(v.type)
      const off = frame.offset(v)
      if (k === 'agg') {
        const n = sizeOf(v.type)
        return { off, store: (a, x) => m.mem.copy(a, x, n) }
      }
      return { off, store: storer(m.mem, k) }
    })
    this.zeros = this.type.params.map((p) => zeroOf(kindOf(p.type)))
    this.retBig = isBig(kindOf(this.type.ret))
    this.frameSize = alignUp(frame.size, 8)
  }

  invoke(args: any[], va: number, retBuf: number): any {
    const m = this.m
    const callSite = m.loc
    const oldFp = m.fp
    const oldSp = m.sp
    const oldVa = m.va
    const oldRet = m.retBuf
    const fp = oldSp - this.frameSize
    if (fp < m.stackLow) m.trap(stackOverflow(m, this.name))
    m.fp = fp
    m.sp = fp
    m.va = va
    m.retBuf = retBuf
    m.frames.push({ fn: this.def, fp, callSite })
    const ps = this.params
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      if (p) p.store(fp + p.off, i < args.length ? args[i] : this.zeros[i])
    }
    m.ret = undefined
    this.body()
    const r = m.ret
    m.frames.pop()
    m.fp = oldFp
    m.sp = oldSp
    m.va = oldVa
    m.retBuf = oldRet
    m.loc = callSite
    return this.retBig && typeof r === 'number' ? BigInt(r) : r
  }
}
```

- [ ] **Step 6: Implement the run API**

```ts path=src/interp/run.ts
import type { ProgramImage } from '@shared/program'
import type { FuncSym } from './frontend/ast'
import type { Loc } from './frontend/diag'
import { library, type Program } from './frontend/program'
import { ExitSignal, LoadError, Machine, type Callable, type HostFiles, type RunIO } from './exec/machine'
import { Trap } from './exec/memory'
import { Placement } from './exec/placement'
import { FunctionCode } from './exec/stmt'
import { LIBRARY, UNSUPPORTED } from './runtime/index'

export { LoadError, Machine } from './exec/machine'
export type { HostFiles, RunIO } from './exec/machine'

export type RunResult =
  | { status: 'exited'; code: number | null; steps: number }
  | { status: 'halted'; message: string; loc: Loc; steps: number }

export interface LoadOptions {
  /** Stop after this many statements: a guard against endless loops in headless runs. */
  maxSteps?: number
}

/**
 * Loads a linked program: lays it out at the image's addresses, runs its static initialisers (what .cinit does on
 * the board) and compiles every function. Throws LoadError for constructs LabSim cannot run.
 */
export function loadProgram(program: Program, image: ProgramImage, io: RunIO, opts: LoadOptions = {}): Machine {
  const m = new Machine(program, image, io)
  if (opts.maxSteps !== undefined) m.limit = opts.maxSteps
  const placement = new Placement(m)
  m.placement = placement

  const byName = new Map<string, FunctionCode>()
  const statics = new Map<FuncSym, FunctionCode>()
  const compiled: FunctionCode[] = []
  for (const u of program.units) {
    for (const def of u.functions) {
      const c = new FunctionCode(m, def)
      compiled.push(c)
      if (def.sym.external) byName.set(def.sym.name, c)
      else statics.set(def.sym, c)
      m.functions.set(placement.functionAddress(def.sym), c)
    }
  }

  const libs = new Map<string, Callable>()
  const prototypes = library().prototypes
  m.resolve = (f, at) => {
    const own = f.external ? byName.get(f.name) : statics.get(f)
    if (own) return own
    const known = libs.get(f.name)
    if (known) return known
    const lib = LIBRARY[f.name]
    if (!lib || UNSUPPORTED.has(f.name)) {
      throw new LoadError(`LabSim: unsupported construct ${f.name}() (not in LabSim's runtime library yet)`, at)
    }
    const c: Callable = {
      name: f.name,
      fixed: lib.fixed,
      variadic: lib.variadic,
      type: prototypes.get(f.name) ?? null,
      invoke: (args, va, ret) => lib.call(m, args, va, ret)
    }
    libs.set(f.name, c)
    m.functions.set(placement.functionAddress(f), c)
    return c
  }

  placement.initialize()
  for (const c of compiled) c.compile()
  return m
}

/** Runs main to C$$EXIT, or until the target halts. */
export function runProgram(m: Machine): RunResult {
  try {
    const main = m.resolve(m.program.main.sym, m.program.main.loc)
    const r = main.invoke([], 0, 0)
    m.exit(typeof r === 'number' ? r | 0 : typeof r === 'bigint' ? Number(BigInt.asIntN(32, r)) : 0)
  } catch (e) {
    if (e instanceof ExitSignal) return { status: 'exited', code: e.code, steps: m.ops }
    if (e instanceof Trap) return { status: 'halted', message: e.message, loc: m.loc, steps: m.ops }
    throw e
  }
}

/** RunIO that keeps the output in memory: for tests, goldens and the CLI. */
export function captureIO(
  input: string[] = [],
  files: HostFiles | null = null
): { io: RunIO; stdout: () => string; stderr: () => string; notes: string[] } {
  let out = ''
  let err = ''
  const notes: string[] = []
  const lines = [...input]
  return {
    io: {
      write: (text, stream) => {
        if (stream === 'stdout') out += text
        else err += text
      },
      note: (text) => notes.push(text),
      readLine: () => lines.shift() ?? null,
      files
    },
    stdout: () => out,
    stderr: () => err,
    notes
  }
}
```

- [ ] **Step 7: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/exec && npm run typecheck`
Expected: every test in `tests/unit/interp/exec` passes. The speed test prints its rate, which should be well above 5 M statements/s; the target is 20 M. There are no type errors.

If the speed is below the target, profile before restructuring. The loop test's hot path is the `for` tick, `i < 3000000`, `s += i & 7` and `i++`. `m.ops` and `m.limit` are plain fields, and the `i++` fast path avoids the generic cell.

- [ ] **Step 8: Commit**

```bash
git add src/interp/exec src/interp/run.ts tests/unit/interp/exec
git commit -m "feat(interp): closure compiler for expressions, statements and calls, with the run API"
```

---
### Task 6: Heap, stdlib, string and ctype

**Files:**
- Create: `src/interp/runtime/errno.ts`, `src/interp/runtime/heap.ts`, `src/interp/runtime/stdlib.ts`, `src/interp/runtime/string.ts`
- Modify: `src/interp/runtime/index.ts`
- Test: `tests/unit/interp/runtime/stdlib.test.ts`

**Interfaces:**
- Consumes:
  - `Machine`: `mem`, `placement.libraryObject`, `placement.constString`, `callAddress`, `exit`, `atexit`, `io`, `image.heap`;
  - `fn` and `state` (Task 4).
- Produces:
  - `errno.ts`: `EDOM ERANGE ENOENT EFPOS EILSEQ` and `setErrno(m, v)`.
  - `heap.ts`: `class Heap` with `malloc`, `calloc`, `realloc`, `release` (free) and `memalign`, plus `heap(m)`.
  - `stdlib.ts`: `STDLIB` and `strtod(m, s, endp)` (scanf uses it).
  - `string.ts`: `STRING` (string.h and ctype.h), `ctype(c)`, `isSpace(c)` and `strlen(m, s)`.

Behaviour copied from TI's sources in `ti-cgt-c6000_8.3.12/lib/src`:
- The heap is `memory.c`: an 8-byte packet header, and a free list ordered by size. `free` coalesces with both neighbours.
- `rand` is `rand.c`: `next = next * 1103515245 + 12345`, returning `(next / 65536) % 32768`.
- `qsort` and `bsearch` are the algorithms in `qsort.c` and `bsearch.c`. The algorithm fixes the order of equal elements, and the comparator call sequence is the same as the board's.
- `strcmp`, `strncmp` and `memcmp` return byte differences (`string.h` inline versions).
- `ctype` functions return the masked `_ctypes_` bits (for example `isalpha('a') == 2`), not 1.
- `strerror` returns TI's texts (`strerror.c`).
- `abort()` halts at C$$EXIT without flushing, and `exit()` flushes (`exit.c`).

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/runtime/stdlib.test.ts
import { describe, expect, it } from 'vitest'
import { runC } from '../exec/harness'

const ints = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.i32(r.g(name) + 4 * i))

describe('stdlib', () => {
  it("reproduces TI's rand() sequence", () => {
    const r = runC(`
#include <stdlib.h>
int v[7];
int main(void)
{
    int i;
    for (i = 0; i < 5; i++) v[i] = rand();
    srand(1);
    v[5] = rand();
    v[6] = RAND_MAX;
    return 0;
}`)
    expect(ints(r, 'v', 7)).toEqual([16838, 5758, 10113, 17515, 31051, 16838, 32767])
  })

  it("allocates with TI's heap algorithm inside .sysmem", () => {
    const r = runC(`
#include <stdlib.h>
#include <string.h>
unsigned a[8];
int main(void)
{
    char *p = malloc(100), *q = malloc(10), *s;
    a[0] = (unsigned)p;
    a[1] = (unsigned)q;
    free(p);
    a[2] = (unsigned)malloc(40);
    a[3] = (unsigned)malloc(5000);
    s = calloc(4, 4);
    a[4] = s[15];
    q = realloc(q, 24);
    a[5] = (unsigned)q;
    strcpy(q, "kept");
    q = realloc(q, 400);
    a[6] = strcmp(q, "kept");
    a[7] = (unsigned)memalign(64, 8) % 64;
    return 0;
}`)
    const start = r.image.heap.start
    const a = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => r.m.mem.u32(r.g('a') + 4 * i))
    expect(a[0]).toBe(start + 8)
    expect(a[1]).toBe(start + 8 + 104 + 8)
    expect(a[2]).toBe(start + 8)
    expect(a[3]).toBe(0)
    expect(a[4]).toBe(0)
    expect(a[5]).toBe(a[1])
    expect(a[6]).toBe(0)
    expect(a[7]).toBe(0)
  })

  it('converts strings to numbers like the C library', () => {
    const r = runC(`
#include <stdlib.h>
long v[8];
double d[3];
int main(void)
{
    char *end;
    v[0] = atoi("  -42xyz");
    v[1] = strtol("0x1F", &end, 0);
    v[2] = *end;
    v[3] = strtol("777", 0, 8);
    v[4] = strtol("99999999999", &end, 10);
    v[5] = (long)strtoul("-1", 0, 10);
    v[6] = atol("12abc");
    v[7] = strtol("zz", &end, 36);
    d[0] = atof(" 3.25e2");
    d[1] = strtod("1e400", &end);
    d[2] = strtod("abc", &end);
    return 0;
}`)
    expect(ints(r, 'v', 8)).toEqual([-42, 31, 0, 511, 2147483647, -1, 12, 1295])
    expect([0, 1, 2].map((i) => r.m.mem.f64(r.g('d') + 8 * i))).toEqual([325, Infinity, 0])
  })

  it('sorts and searches with the program comparator, and returns div_t by value', () => {
    const r = runC(`
#include <stdlib.h>
int v[6] = { 5, 3, 9, 1, 7, 3 };
int found[3];
int cmp(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
int main(void)
{
    int key = 7, missing = 4;
    div_t q = div(-7, 2);
    qsort(v, 6, sizeof(int), cmp);
    found[0] = (int *)bsearch(&key, v, 6, sizeof(int), cmp) - v;
    found[1] = bsearch(&missing, v, 6, sizeof(int), cmp) == 0;
    found[2] = q.quot * 10 + q.rem;
    return abs(-3) + (int)labs(-4);
}`)
    expect(ints(r, 'v', 6)).toEqual([1, 3, 3, 5, 7, 9])
    expect(ints(r, 'found', 3)).toEqual([4, 1, -31])
    expect(r.result).toMatchObject({ status: 'exited', code: 7 })
  })

  it('runs atexit functions in reverse order on exit, but not on abort', () => {
    const src = (end: string): string => `
#include <stdlib.h>
int order[2], n;
void first(void) { order[n++] = 1; }
void second(void) { order[n++] = 2; }
int main(void) { atexit(first); atexit(second); ${end}; return 9; }`
    const e = runC(src('exit(5)'))
    expect(e.result).toMatchObject({ status: 'exited', code: 5 })
    expect(ints(e, 'order', 2)).toEqual([2, 1])
    const a = runC(src('abort()'))
    expect(a.result).toMatchObject({ status: 'exited', code: null })
    expect(ints(a, 'order', 2)).toEqual([0, 0])
  })

  it('prints a failed assert on stderr and aborts', () => {
    const r = runC('#include <assert.h>\nint main(void)\n{\n    int x = 1;\n    assert(x == 2);\n    return 0;\n}')
    expect(r.stderr).toMatch(/^Assertion failed, \(x == 2\), file .*main\.c, line 5\n$/)
    expect(r.result).toMatchObject({ status: 'exited', code: null })
  })
})

describe('string.h and ctype.h', () => {
  it('matches TI return values', () => {
    const r = runC(`
#include <string.h>
#include <ctype.h>
int v[20];
char buf[32];
int main(void)
{
    char text[] = "a,b,,c";
    char *t;
    int n = 0;
    v[0] = strcmp("abc", "abd");
    v[1] = strcmp("b", "a");
    v[2] = strncmp("abcx", "abcy", 3);
    v[3] = memcmp("ab", "aZ", 2);
    v[4] = strlen("hello");
    strcpy(buf, "DSP");
    strcat(buf, "-lab");
    v[5] = strlen(buf);
    v[6] = strchr(buf, '-') - buf;
    v[7] = strstr(buf, "lab") - buf;
    for (t = strtok(text, ","); t; t = strtok(0, ",")) n++;
    v[8] = n;
    v[9] = isalpha('a');
    v[10] = isupper('A');
    v[11] = isdigit('5');
    v[12] = isspace(' ');
    v[13] = isprint(' ');
    v[14] = toupper('q');
    v[15] = ispunct('!');
    v[16] = isxdigit('F');
    v[17] = strcspn("hello", "lo");
    v[18] = strncmp(buf, "DSQ", 3);
    v[19] = strrchr("a/b/c", '/')[1] == 'c';
    return 0;
}`)
    expect(ints(r, 'v', 20)).toEqual([-1, 1, 0, 8, 5, 7, 3, 4, 3, 2, 1, 4, 8, 0x80, 81, 0x10, 0x40, 2, -1, 1])
    expect(r.m.mem.cstring(r.g('buf'))).toBe('DSP-lab')
  })

  it("returns TI's strerror texts", () => {
    const r = runC('#include <string.h>\n#include <errno.h>\nchar *s[3];\nint main(void) { s[0] = strerror(0); s[1] = strerror(EDOM); s[2] = strerror(99); return 0; }')
    expect([0, 1, 2].map((i) => r.m.mem.cstring(r.m.mem.u32(r.g('s') + 4 * i)))).toEqual(['No error', 'Domain error', 'Unknown error'])
  })
})
```

The assert test matches the file name with a regular expression, because `__FILE__` is the absolute path, and on Windows that path is `C:\proj\main.c`.

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/runtime/stdlib.test.ts`
Expected: FAIL with `LabSim: unsupported construct rand() (not in LabSim's runtime library yet)`.

- [ ] **Step 3: Implement errno and the heap**

```ts path=src/interp/runtime/errno.ts
import type { Machine } from '../exec/machine'

/** errno values of TI's C6000 EABI run-time library (errno.h). */
export const EDOM = 0x21
export const ERANGE = 0x22
export const ENOENT = 0x02
export const EFPOS = 0x98
export const EILSEQ = 0x58

export function setErrno(m: Machine, value: number): void {
  m.mem.set32(m.placement.libraryObject('errno'), value)
}
```

```ts path=src/interp/runtime/heap.ts
import type { Machine } from '../exec/machine'
import { state } from './types'

/** BLOCK_OVERHEAD and MIN_BLOCK: sizeof(long double). */
const OVERHEAD = 8
const MIN_BLOCK = 8
const USED = 1
const MASK = 7
const MAX_REQUEST = 0xffffffff - OVERHEAD - MASK - 1

/**
 * TI's RTS heap (lib/src/memory.c) running on simulated memory: each packet starts with an 8-byte header (size,
 * next-free link) inside .sysmem, and the free list is ordered by size. Addresses, fragmentation and exhaustion
 * therefore match the board.
 */
export class Heap {
  private free = 0
  private needInit = true
  private readonly start: number
  /** heap_size(): __TI_SYSMEM_SIZE - BLOCK_OVERHEAD. */
  private readonly size: number

  constructor(private readonly m: Machine) {
    this.start = m.image.heap.start >>> 0
    this.size = m.image.heap.size - OVERHEAD
  }

  private psize(p: number): number {
    return this.m.mem.u32(p)
  }
  private setPsize(p: number, v: number): void {
    this.m.mem.set32(p, v)
  }
  private link(p: number): number {
    return this.m.mem.u32(p + 4)
  }
  private setLink(p: number, v: number): void {
    this.m.mem.set32(p + 4, v)
  }

  private init(): void {
    this.free = this.start
    this.setPsize(this.start, this.size)
    this.setLink(this.start, 0)
    this.needInit = false
  }

  private minsert(ptr: number): void {
    let current = this.free
    let last = 0
    if (current === 0) {
      this.free = ptr
      this.setLink(ptr, 0)
      return
    }
    const size = this.psize(ptr)
    while (current !== 0 && this.psize(current) < size) {
      last = current
      current = this.link(current)
    }
    if (current === 0) {
      this.setLink(last, ptr)
      this.setLink(ptr, 0)
    } else if (last === 0) {
      this.setLink(ptr, this.free)
      this.free = ptr
    } else {
      this.setLink(ptr, current)
      this.setLink(last, ptr)
    }
  }

  private mremove(ptr: number): void {
    let current = this.free
    let last = 0
    while (current !== 0 && current !== ptr) {
      last = current
      current = this.link(current)
    }
    if (current === 0) this.free = 0
    else if (last === 0) this.free = this.link(ptr)
    else this.setLink(last, this.link(ptr))
  }

  malloc(request: number): number {
    const size = request >>> 0
    if (size === 0 || size > MAX_REQUEST || this.size < MIN_BLOCK) return 0
    const newsize = ((size + MASK) & ~MASK) >>> 0
    if (this.needInit) this.init()
    let current = this.free
    while (current !== 0 && this.psize(current) < newsize) current = this.link(current)
    if (current === 0) return 0
    const oldsize = this.psize(current)
    this.mremove(current)
    if (oldsize - newsize >= MIN_BLOCK + OVERHEAD) {
      const next = current + OVERHEAD + newsize
      this.setPsize(next, oldsize - newsize - OVERHEAD)
      this.minsert(next)
      this.setPsize(current, newsize)
    }
    this.setPsize(current, (this.psize(current) | USED) >>> 0)
    return current + OVERHEAD
  }

  calloc(num: number, size: number): number {
    const bytes = Math.imul(num, size) >>> 0
    const p = this.malloc(bytes)
    if (p !== 0) this.m.mem.fill(p, 0, bytes)
    return p
  }

  realloc(packet: number, request: number): number {
    const size = request >>> 0
    if (size > MAX_REQUEST) return 0
    const newsize = ((size + MASK) & ~MASK) >>> 0
    if (packet === 0) return this.malloc(size)
    if (size === 0) {
      this.release(packet)
      return 0
    }
    let pptr = packet - OVERHEAD
    let oldsize = this.psize(pptr)
    if (!(oldsize & USED)) return 0
    oldsize -= 1
    if (newsize === oldsize) return packet
    if (newsize < oldsize) {
      if (oldsize - newsize >= MIN_BLOCK + OVERHEAD) {
        this.setPsize(pptr, (newsize | USED) >>> 0)
        oldsize -= newsize + OVERHEAD
        pptr += newsize + OVERHEAD
        this.setPsize(pptr, (oldsize | USED) >>> 0)
        this.release(pptr + OVERHEAD)
      }
      return packet
    }
    const next = pptr + oldsize + OVERHEAD
    if (next < this.start + this.size && !(this.psize(next) & USED)) {
      const temp = (oldsize + this.psize(next) + OVERHEAD - newsize) | 0
      if (temp >= 0) {
        this.mremove(next)
        if (temp < MIN_BLOCK + OVERHEAD) {
          this.setPsize(pptr, ((newsize + temp) | USED) >>> 0)
          return packet
        }
        this.setPsize(pptr, (newsize | USED) >>> 0)
        pptr += newsize + OVERHEAD
        this.setPsize(pptr, temp - OVERHEAD)
        this.minsert(pptr)
        return packet
      }
    }
    const fresh = this.malloc(size)
    if (fresh !== 0) {
      this.m.mem.copy(fresh, packet, oldsize)
      this.release(packet)
    }
    return fresh
  }

  /** free() */
  release(packet: number): void {
    if (packet === 0) return
    const ptr = packet - OVERHEAD
    let last = 0
    let current = this.start
    while (current < ptr) {
      last = current
      current = current + (this.psize(current) & ~USED) + OVERHEAD
    }
    if (current !== ptr || !(this.psize(current) & USED)) return
    this.setPsize(current, this.psize(current) & ~USED)
    let next = current + OVERHEAD + this.psize(current)
    if (next > this.start + this.size) next = 0
    if (last !== 0 && this.psize(last) & USED) last = 0
    if (next !== 0 && this.psize(next) & USED) next = 0
    if (last !== 0 && next !== 0) {
      this.mremove(last)
      this.mremove(next)
      this.setPsize(last, this.psize(last) + this.psize(current) + this.psize(next) + 2 * OVERHEAD)
      this.minsert(last)
      return
    }
    if (last !== 0) {
      this.mremove(last)
      this.setPsize(last, this.psize(last) + this.psize(current) + OVERHEAD)
      this.minsert(last)
      return
    }
    if (next !== 0) {
      this.mremove(next)
      this.setPsize(current, this.psize(current) + this.psize(next) + OVERHEAD)
      this.minsert(current)
      return
    }
    this.minsert(current)
  }

  memalign(alignmentArg: number, request: number): number {
    const size = request >>> 0
    const alignment = alignmentArg >>> 0
    if (size === 0 || size > MAX_REQUEST) return 0
    const newsize = ((size + MASK) & ~MASK) >>> 0
    if (this.needInit) this.init()
    if (alignment <= OVERHEAD || (alignment & (alignment - 1)) !== 0) return this.malloc(size)
    let current = this.free
    let aligned = 0
    let unaligned = 0
    let leftover = 0
    for (; current !== 0; current = this.link(current)) {
      unaligned = current + OVERHEAD
      aligned = Math.ceil(unaligned / alignment) * alignment
      if (unaligned !== aligned) while (current + 8 > aligned - OVERHEAD) aligned += alignment
      const nextStart = unaligned + this.psize(current)
      const end = aligned + newsize
      if (nextStart >= end) {
        leftover = nextStart - end
        break
      }
    }
    if (current === 0) return 0
    this.mremove(current)
    const packet = aligned - OVERHEAD
    this.setPsize(packet, (newsize | USED) >>> 0)
    if (aligned !== unaligned) {
      this.setPsize(current, packet - unaligned)
      this.minsert(current)
    }
    if (leftover >= OVERHEAD + MIN_BLOCK) {
      const next = aligned + newsize
      this.setPsize(next, leftover - OVERHEAD)
      this.minsert(next)
    } else this.setPsize(packet, (this.psize(packet) + leftover) >>> 0)
    return aligned
  }
}

export const heap = state((m) => new Heap(m))
```

- [ ] **Step 4: Implement string.h and ctype.h**

```ts path=src/interp/runtime/string.ts
import type { Machine } from '../exec/machine'
import { EDOM, EFPOS, ENOENT, ERANGE } from './errno'
import { fn, state, type LibFunction } from './types'

const U = 0x01
const L = 0x02
const N = 0x04
const S = 0x08
const P = 0x10
const C = 0x20
const H = 0x40
const B = 0x80

/** TI's _ctypes_ table (lib/src/ctype.c) for 0..255; bytes above 0x7F belong to no class. */
const CTYPE = new Uint8Array(256)
for (let c = 0; c < 128; c++) {
  let f = 0
  if (c < 32 || c === 127) f |= C
  if (c >= 9 && c <= 13) f |= S
  if (c === 32) f |= S | B
  if (c >= 48 && c <= 57) f |= N | H
  if (c >= 65 && c <= 90) f |= U | (c <= 70 ? H : 0)
  if (c >= 97 && c <= 122) f |= L | (c <= 102 ? H : 0)
  if (c > 32 && c < 127 && !(f & (U | L | N))) f |= P
  CTYPE[c] = f
}

export const ctype = (c: number): number => (c >= 0 && c < 256 ? CTYPE[c] : 0)
export const isSpace = (c: number): boolean => (ctype(c) & S) !== 0

export function strlen(m: Machine, s: number): number {
  let n = 0
  while (m.mem.u8(s + n) !== 0) n++
  return n
}

const tokens = state(() => ({ next: 0 }))

const ERRORS: Record<number, string> = { 0: 'No error', [EDOM]: 'Domain error', [ERANGE]: 'Range error', [ENOENT]: 'No such file or directory', [EFPOS]: 'File positioning error' }

const inSet = (m: Machine, set: number, c: number): boolean => {
  for (let p = set; ; p++) {
    const x = m.mem.u8(p)
    if (x === 0) return false
    if (x === c) return true
  }
}

const cls = (mask: number): LibFunction => fn(1, (_m, [c]) => ctype(c) & mask)

export const STRING: Record<string, LibFunction> = {
  memcpy: fn(3, (m, [d, s, n]) => {
    m.mem.copy(d, s, n >>> 0)
    return d
  }),
  memmove: fn(3, (m, [d, s, n]) => {
    m.mem.copy(d, s, n >>> 0)
    return d
  }),
  memset: fn(3, (m, [d, c, n]) => {
    m.mem.fill(d, c & 0xff, n >>> 0)
    return d
  }),
  memcmp: fn(3, (m, [a, b, n]) => {
    for (let i = 0; i < n >>> 0; i++) {
      const x = m.mem.u8(a + i)
      const y = m.mem.u8(b + i)
      if (x !== y) return x - y
    }
    return 0
  }),
  memchr: fn(3, (m, [s, c, n]) => {
    for (let i = 0; i < n >>> 0; i++) if (m.mem.u8(s + i) === (c & 0xff)) return (s + i) >>> 0
    return 0
  }),
  strcpy: fn(2, (m, [d, s]) => {
    m.mem.copy(d, s, strlen(m, s) + 1)
    return d
  }),
  strncpy: fn(3, (m, [d, s, n]) => {
    let i = 0
    for (; i < n >>> 0; i++) {
      const c = m.mem.u8(s + i)
      m.mem.set8(d + i, c)
      if (c === 0) break
    }
    for (; i < n >>> 0; i++) m.mem.set8(d + i, 0)
    return d
  }),
  strcat: fn(2, (m, [d, s]) => {
    m.mem.copy(d + strlen(m, d), s, strlen(m, s) + 1)
    return d
  }),
  strncat: fn(3, (m, [d, s, n]) => {
    const end = d + strlen(m, d)
    let i = 0
    for (; i < n >>> 0; i++) {
      const c = m.mem.u8(s + i)
      if (c === 0) break
      m.mem.set8(end + i, c)
    }
    m.mem.set8(end + i, 0)
    return d
  }),
  strcmp: fn(2, (m, [a, b]) => {
    for (let i = 0; ; i++) {
      const c1 = m.mem.u8(a + i)
      const res = c1 - m.mem.u8(b + i)
      if (c1 === 0 || res !== 0) return res
    }
  }),
  strncmp: fn(3, (m, [a, b, n]) => {
    for (let i = 0; i < n >>> 0; i++) {
      const cp = m.mem.u8(b + i)
      const res = m.mem.u8(a + i) - cp
      if (res !== 0) return res
      if (cp === 0) return 0
    }
    return 0
  }),
  strcoll: fn(2, (m, args) => STRING.strcmp.call(m, args, 0, 0)),
  strxfrm: fn(3, (m, [d, s, n]) => {
    const len = strlen(m, s)
    if (len < n >>> 0) m.mem.copy(d, s, len + 1)
    return len
  }),
  strchr: fn(2, (m, [s, c]) => {
    const ch = c & 0xff
    for (let p = s; ; p++) {
      const x = m.mem.u8(p)
      if (x === ch) return p >>> 0
      if (x === 0) return 0
    }
  }),
  strrchr: fn(2, (m, [s, c]) => {
    const ch = c & 0xff
    let found = 0
    for (let p = s; ; p++) {
      const x = m.mem.u8(p)
      if (x === ch) found = p >>> 0
      if (x === 0) return found
    }
  }),
  strstr: fn(2, (m, [s, t]) => {
    const hay = m.mem.cstring(s)
    const i = hay.indexOf(m.mem.cstring(t))
    return i < 0 ? 0 : (s + i) >>> 0
  }),
  strpbrk: fn(2, (m, [s, set]) => {
    for (let p = s; ; p++) {
      const x = m.mem.u8(p)
      if (x === 0) return 0
      if (inSet(m, set, x)) return p >>> 0
    }
  }),
  strspn: fn(2, (m, [s, set]) => {
    let n = 0
    while (m.mem.u8(s + n) !== 0 && inSet(m, set, m.mem.u8(s + n))) n++
    return n
  }),
  strcspn: fn(2, (m, [s, set]) => {
    let n = 0
    while (m.mem.u8(s + n) !== 0 && !inSet(m, set, m.mem.u8(s + n))) n++
    return n
  }),
  strtok: fn(2, (m, [s, delim]) => {
    const t = tokens(m)
    let p = s !== 0 ? s : t.next
    if (p === 0) return 0
    while (m.mem.u8(p) !== 0 && inSet(m, delim, m.mem.u8(p))) p++
    if (m.mem.u8(p) === 0) {
      t.next = 0
      return 0
    }
    const start = p
    while (m.mem.u8(p) !== 0 && !inSet(m, delim, m.mem.u8(p))) p++
    if (m.mem.u8(p) === 0) t.next = 0
    else {
      m.mem.set8(p, 0)
      t.next = p + 1
    }
    return start >>> 0
  }),
  strlen: fn(1, (m, [s]) => strlen(m, s)),
  strerror: fn(1, (m, [e]) => m.placement.constString(ERRORS[e] ?? 'Unknown error')),

  isalnum: cls(U | L | N),
  isalpha: cls(U | L),
  iscntrl: cls(C),
  isdigit: cls(N),
  isgraph: cls(U | L | N | P),
  islower: cls(L),
  isprint: cls(B | U | L | N | P),
  ispunct: cls(P),
  isspace: cls(S),
  isupper: cls(U),
  isxdigit: cls(H),
  isblank: fn(1, (_m, [c]) => (c === 32 || c === 9 ? 1 : 0)),
  isascii: fn(1, (_m, [c]) => ((c >>> 0) & ~0x7f ? 0 : 1)),
  toascii: fn(1, (_m, [c]) => (c >>> 0) & 0x7f),
  tolower: fn(1, (_m, [c]) => (ctype(c) & U ? c + 32 : c)),
  toupper: fn(1, (_m, [c]) => (ctype(c) & L ? c - 32 : c))
}
```

- [ ] **Step 5: Implement stdlib.h and assert.h**

```ts path=src/interp/runtime/stdlib.ts
import type { Machine } from '../exec/machine'
import { ERANGE, setErrno } from './errno'
import { heap } from './heap'
import { isSpace } from './string'
import { fn, state, type LibFunction } from './types'

const rng = state(() => ({ next: 1 }))

function digit(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 122) return c - 87
  if (c >= 65 && c <= 90) return c - 55
  return 99
}

/** strtol and friends: C semantics, saturating with ERANGE; `endp` receives the end of the number. */
function strtoint(m: Machine, s: number, endp: number, baseArg: number, bits: number, signed: boolean): bigint {
  const mem = m.mem
  let base = baseArg
  let p = s
  while (isSpace(mem.u8(p))) p++
  let neg = false
  const sign = mem.u8(p)
  if (sign === 45 || sign === 43) {
    neg = sign === 45
    p++
  }
  if ((base === 0 || base === 16) && mem.u8(p) === 48 && (mem.u8(p + 1) | 32) === 120 && digit(mem.u8(p + 2)) < 16) {
    p += 2
    base = 16
  } else if (base === 0) base = mem.u8(p) === 48 ? 8 : 10
  const b = BigInt(bits)
  const max = signed ? (neg ? 1n << (b - 1n) : (1n << (b - 1n)) - 1n) : (1n << b) - 1n
  let v = 0n
  let any = false
  let over = false
  for (;;) {
    const d = digit(mem.u8(p))
    if (d >= base) break
    any = true
    if (!over) {
      v = v * BigInt(base) + BigInt(d)
      if (v > max) over = true
    }
    p++
  }
  if (endp !== 0) mem.set32(endp, any ? p : s)
  if (over) {
    setErrno(m, ERANGE)
    return signed ? (neg ? -max : max) : max
  }
  return signed ? (neg ? -v : v) : BigInt.asUintN(bits, neg ? -v : v)
}

const FLOAT = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)/i

/** strtod: decimal floating constants, inf and nan; ERANGE on overflow. */
export function strtod(m: Machine, s: number, endp: number): number {
  let p = s
  while (isSpace(m.mem.u8(p))) p++
  const text = m.mem.cstring(p, 512)
  const match = FLOAT.exec(text)
  if (!match) {
    if (endp !== 0) m.mem.set32(endp, s)
    return 0
  }
  const t = match[0]
  if (endp !== 0) m.mem.set32(endp, p + t.length)
  const body = t.replace(/^[+-]/, '').toLowerCase()
  const neg = t[0] === '-'
  if (body.startsWith('inf')) return neg ? -Infinity : Infinity
  if (body === 'nan') return NaN
  const v = Number(t)
  if (!Number.isFinite(v)) setErrno(m, ERANGE)
  return v
}

/** TI's atoi/atol: no overflow check, the value simply wraps. */
function atoiWrap(m: Machine, s: number): number {
  let p = s
  while (isSpace(m.mem.u8(p))) p++
  const neg = m.mem.u8(p) === 45
  if (neg || m.mem.u8(p) === 43) p++
  let r = 0
  for (let c = m.mem.u8(p); c >= 48 && c <= 57; c = m.mem.u8(++p)) r = (Math.imul(r, 10) + c - 48) | 0
  return neg ? -r | 0 : r
}

function qsort(m: Machine, base: number, nmemb: number, size: number, cmp: number): void {
  if (nmemb <= 1) return
  const compare = (a: number, b: number): number => m.callAddress(cmp, [a >>> 0, b >>> 0]) | 0
  const swap = (a: number, b: number): void => {
    const x = m.mem.read(a, size)
    m.mem.copy(a, b, size)
    m.mem.write(b, x)
  }
  let i = 0
  let j = nmemb - 1
  let pivot = Math.floor(nmemb / 2)
  let pivp = base + pivot * size
  while (i < j) {
    while (compare(base + i * size, pivp) < 0) ++i
    while (compare(base + j * size, pivp) > 0) --j
    if (i < j) {
      swap(base + i * size, base + j * size)
      if (pivot === i) {
        pivot = j
        pivp = base + pivot * size
      } else if (pivot === j) {
        pivot = i
        pivp = base + pivot * size
      }
      ++i
      --j
    } else if (i === j) {
      ++i
      --j
      break
    }
  }
  if (j > 0) qsort(m, base, j + 1, size, cmp)
  if (i < nmemb - 1) qsort(m, base + i * size, nmemb - i, size, cmp)
}

function writeDiv(m: Machine, ret: number, quot: number | bigint, rem: number | bigint, wide: boolean): number {
  if (ret === 0) return 0
  if (wide) {
    m.mem.set64(ret, quot as bigint)
    m.mem.set64(ret + 8, rem as bigint)
  } else {
    m.mem.set32(ret, quot as number)
    m.mem.set32(ret + 4, rem as number)
  }
  return ret
}

export const STDLIB: Record<string, LibFunction> = {
  abs: fn(1, (_m, [x]) => (x < 0 ? -x | 0 : x)),
  labs: fn(1, (_m, [x]) => (x < 0 ? -x | 0 : x)),
  llabs: fn(1, (_m, [x]) => BigInt.asIntN(64, x < 0n ? -x : x)),
  div: fn(2, (m, [a, b], _va, ret) => {
    if (b === 0) m.trap('Division by zero')
    return writeDiv(m, ret, (a / b) | 0, (a % b) | 0, false)
  }),
  ldiv: fn(2, (m, args, va, ret) => STDLIB.div.call(m, args, va, ret)),
  lldiv: fn(2, (m, [a, b], _va, ret) => {
    if (b === 0n) m.trap('Division by zero')
    return writeDiv(m, ret, BigInt.asIntN(64, a / b), BigInt.asIntN(64, a % b), true)
  }),
  atoi: fn(1, (m, [s]) => atoiWrap(m, s)),
  atol: fn(1, (m, [s]) => atoiWrap(m, s)),
  atoll: fn(1, (m, [s]) => strtoint(m, s, 0, 10, 64, true)),
  atof: fn(1, (m, [s]) => strtod(m, s, 0)),
  strtol: fn(3, (m, [s, e, b]) => Number(strtoint(m, s, e, b, 32, true))),
  strtoul: fn(3, (m, [s, e, b]) => Number(strtoint(m, s, e, b, 32, false))),
  strtoll: fn(3, (m, [s, e, b]) => strtoint(m, s, e, b, 64, true)),
  strtoull: fn(3, (m, [s, e, b]) => strtoint(m, s, e, b, 64, false)),
  strtod: fn(2, (m, [s, e]) => strtod(m, s, e)),
  strtof: fn(2, (m, [s, e]) => Math.fround(strtod(m, s, e))),
  rand: fn(0, (m) => {
    const r = rng(m)
    r.next = (Math.imul(r.next, 1103515245) + 12345) >>> 0
    return Math.floor(r.next / 65536) % 32768
  }),
  srand: fn(1, (m, [seed]) => {
    rng(m).next = seed >>> 0
  }),
  malloc: fn(1, (m, [n]) => heap(m).malloc(n)),
  calloc: fn(2, (m, [n, s]) => heap(m).calloc(n, s)),
  realloc: fn(2, (m, [p, n]) => heap(m).realloc(p, n)),
  free: fn(1, (m, [p]) => {
    heap(m).release(p)
  }),
  memalign: fn(2, (m, [a, n]) => heap(m).memalign(a, n)),
  exit: fn(1, (m, [code]) => m.exit(code | 0)),
  abort: fn(0, (m) => m.exit(null)),
  atexit: fn(1, (m, [f]) => {
    m.atexit.push(f >>> 0)
    return 0
  }),
  qsort: fn(4, (m, [base, n, size, cmp]) => {
    qsort(m, base >>> 0, n >>> 0, size >>> 0, cmp)
  }),
  bsearch: fn(5, (m, [key, base, n, size, cmp]) => {
    let i = 0
    let j = (n | 0) - 1
    while (i <= j) {
      const pivot = Math.trunc((j + i) / 2)
      const at = (base + pivot * size) >>> 0
      const r = m.callAddress(cmp, [key >>> 0, at]) | 0
      if (r === 0) return at
      if (r < 0) j = pivot - 1
      else i = pivot + 1
    }
    return 0
  }),
  getenv: fn(1, () => 0),
  system: fn(1, () => -1),
  // assert.h: _assert(expr != 0, "Assertion failed, (expr), file F, line N\n")
  _assert: fn(2, (m, [ok, msg]) => {
    if (ok === 0) {
      m.io.write(m.mem.cstring(msg), 'stderr')
      m.exit(null)
    }
  })
}
```

- [ ] **Step 6: Register the modules**

Replace `src/interp/runtime/index.ts` with:

```ts path=src/interp/runtime/index.ts
import { STDLIB } from './stdlib'
import { STRING } from './string'
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = { ...STDLIB, ...STRING }

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = new Set<string>()
```

- [ ] **Step 7: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/runtime/stdlib.test.ts && npm run typecheck`
Expected: PASS (8 tests), and no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/interp/runtime tests/unit/interp/runtime
git commit -m "feat(interp): TI heap, rand, qsort and the rest of stdlib, string.h and ctype.h"
```

---
### Task 7: printf formatting (port of TI's `_printfi.c`)

**Files:**
- Create: `src/interp/runtime/printf.ts`
- Modify: `src/interp/runtime/index.ts`
- Test: `tests/unit/interp/runtime/printf.test.ts`

**Interfaces:**
- Consumes: `Machine`, and `fn`/`vfn` (Task 4).
- Produces:
  - `VaReader {int(), uint(), ll(), ull(), dbl(), ptr()}` and `vaReader(m, addr)`, which reads variadic arguments from memory with EABI alignment;
  - `PrintfSink {c(ch), s(bytes, len)}`;
  - `formatTI(m, formatAddr, va, sink): number`;
  - `PRINTF`, holding `sprintf snprintf vsprintf vsnprintf`.
  - Task 8 builds `printf`/`fprintf` on `formatTI`.

This is a line-by-line port of TI's formatter, so the console shows what the board shows. The differences from a glibc printf that students can see:
- `%f`, `%e` and `%g` produce digits by repeated `value *= 10`. They round half-up on one extra digit, so `%.2f` of 0.125 is `0.13` and `%.0f` of 2.5 is `3`.
- `%f` of +∞ prints `+inf`.
- `%hd` does not truncate its argument.
- `%p` prints bare hex (`80001234`), and `%#p` adds `0x`.
- `%s` of NULL outputs one NUL character and counts nothing.
- A field of `printf` goes through `fputs`, so a `%c` of `'\0'` prints nothing. `sprintf` copies it.

- [ ] **Step 1: Write the failing test**

```ts path=tests/unit/interp/runtime/printf.test.ts
import { describe, expect, it } from 'vitest'
import { runC } from '../exec/harness'

/** [format, C arguments, what TI's RTS prints] */
const CASES: [string, string, string][] = [
  ['%d|%5d|%-5d|%05d|%+d|% d|%.3d', '42, 42, 42, -42, 5, 5, 7', '42|   42|42   |-0042|+5| 5|007'],
  ['%x|%X|%#x|%#X|%o|%#o', '255, 255, 255, 255, 8, 8', 'ff|FF|0xff|0XFF|10|010'],
  ['%u|%lld|%llu', '-1, -1LL << 40, 18446744073709551615ULL', '4294967295|-1099511627776|18446744073709551615'],
  ['%hd|%hu|%hhu|%ld', '70000, 70000, 300, 123456L', '70000|4464|44|123456'],
  ['%c%c|%5s|%-5s|%.2s|%%', "'A', 'b', \"ab\", \"ab\", \"abcd\"", 'Ab|   ab|ab   |ab|%'],
  ['%p|%#p|%08x', '(void *)0x80001234, (void *)0x80001234, 0xbeef', '80001234|0x80001234|0000beef'],
  ['%f|%.2f|%.0f|%.0f', '3.14159, 0.125, 2.5, 0.5', '3.141590|0.13|3|1'],
  ['%e|%E|%.2e', '12345.678, 0.000123, 0.0', '1.234568e+04|1.230000E-04|0.00e+00'],
  ['%g|%g|%g|%g|%.3g|%G', '0.0001, 123456789.0, 100000.0, 1000000.0, 3.14159, 1e-10', '0.0001|1.23457e+08|100000|1e+06|3.14|1E-10'],
  ['%10.3f|%-8.2f|%+.1f|%5.1f', '-1.5, 3.14159, 2.25, 9.96', '    -1.500|3.14    |+2.3| 10.0'],
  ['%f|%f|%f|%F|%f', '-0.0, INFINITY, -INFINITY, INFINITY, NAN', '-0.000000|+inf|-inf|+INF|nan'],
  ['%5c|%-3c|', "'x', 'y'", '    x|y  |'],
  ['%*d|%-*d|%.*f', '4, 7, 4, 7, 2, 1.5', '   7|7   |1.50'],
  ['%a|%A', '1.0, -0.5', '0x1p+0|-0X1P-1']
]

describe('formatTI (sprintf)', () => {
  it('formats every conversion the way the C6000 RTS does', () => {
    const lines = CASES.map(([f, args], i) => `    sprintf(out[${i}], "${f}", ${args});`)
    const r = runC(`#include <stdio.h>\n#include <math.h>\nchar out[${CASES.length}][64];\nint main(void)\n{\n${lines.join('\n')}\n    return 0;\n}`)
    expect(r.result).toMatchObject({ status: 'exited', code: 0 })
    const got = CASES.map((_, i) => r.m.mem.cstring(r.g('out') + 64 * i))
    expect(got).toEqual(CASES.map((c) => c[2]))
  })

  it('returns the count, stores %n, and handles NULL strings and snprintf truncation', () => {
    const r = runC(`
#include <stdio.h>
char a[16], b[16], c[16];
int v[5];
int main(void)
{
    v[0] = sprintf(a, "x=%d%n!", 123, &v[1]);
    v[2] = sprintf(b, "a%sb", (char *)0);
    v[3] = snprintf(c, 5, "%d", 123456);
    v[4] = snprintf(0, 0, "%s", "hello");
    return 0;
}`)
    expect([0, 1, 2, 3, 4].map((i) => r.m.mem.i32(r.g('v') + 4 * i))).toEqual([6, 5, 2, 6, 5])
    expect(r.m.mem.cstring(r.g('a'))).toBe('x=123!')
    expect([...r.m.mem.read(r.g('b'), 4)]).toEqual([97, 0, 98, 0])
    expect(r.m.mem.cstring(r.g('c'))).toBe('1234')
  })

  it('reads a va_list with vsprintf', () => {
    const r = runC(`
#include <stdio.h>
#include <stdarg.h>
char out[32];
void fmt(const char *f, ...) { va_list ap; va_start(ap, f); vsprintf(out, f, ap); va_end(ap); }
int main(void) { fmt("%d-%.1f-%s", 7, 2.5, "ok"); return 0; }`)
    expect(r.m.mem.cstring(r.g('out'))).toBe('7-2.5-ok')
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/runtime/printf.test.ts`
Expected: FAIL with `LabSim: unsupported construct sprintf() …`.

- [ ] **Step 3: Implement the formatter**

```ts path=src/interp/runtime/printf.ts
import type { Machine } from '../exec/machine'
import { fn, vfn, type LibFunction } from './types'

/** Reads variadic arguments the way va_arg does: each aligned to its size (at least 4 bytes). */
export interface VaReader {
  int(): number
  uint(): number
  ll(): bigint
  ull(): bigint
  dbl(): number
  ptr(): number
}

export function vaReader(m: Machine, start: number): VaReader {
  let p = start >>> 0
  const take = (size: number): number => {
    const align = Math.max(4, size)
    p = Math.ceil(p / align) * align
    const a = p
    p += size
    return a
  }
  return {
    int: () => m.mem.i32(take(4)),
    uint: () => m.mem.u32(take(4)),
    ll: () => m.mem.i64(take(8)),
    ull: () => m.mem.u64(take(8)),
    dbl: () => m.mem.f64(take(8)),
    ptr: () => m.mem.u32(take(4))
  }
}

/** Where formatted output goes: `c` is TI's _outc, `s` its _outs (returns the count to add, or EOF). */
export interface PrintfSink {
  c(ch: number): void
  s(bytes: number[], len: number): number
}

const EOF = -1
const LONG_MAX = 2147483647
/** F_CONVERSION_BUFSIZE for the full printf. */
const BUFSIZE = 510

// _PFIELD flags
const MINUS = 0x1
const PLUS = 0x2
const SPACE = 0x4
const POUND = 0x8
const ZERO = 0x10
const MFH = 0x20
const MFHH = 0x40
const MFL = 0x80
const MFLL = 0x100
const MFLD = 0x200
const MFJ = 0x400
const MFZ = 0x800
const MFT = 0x1000
const MFI40 = 0x2000
const LENGTHS = MFH | MFHH | MFL | MFLL | MFI40 | MFJ | MFZ | MFT

// flags returned by the floating conversions
const NO_FLAG = 0
const MINUS_FLAG = 1
const SPECIAL_FLAG = 2

const ch = (s: string): number => s.charCodeAt(0)
const isHexConv = (c: number): boolean => c === ch('x') || c === ch('X') || c === ch('p')
const isSignedConv = (c: number): boolean => c !== ch('u') && c !== ch('o') && !isHexConv(c)

interface Field {
  flags: number
  fwidth: number
  precision: number
  conv: number
}

/** The conversion buffer, written right to left from its end like TI's `a_it`. */
class Fld {
  readonly b: number[]
  it: number
  constructor(size: number) {
    this.b = new Array(size).fill(32)
    this.b[size - 1] = 0
    this.it = size - 2
  }
  put(c: number): void {
    this.b[this.it--] = c
  }
  /** Writes a string so that it reads left to right. */
  putS(s: string): void {
    for (let i = s.length - 1; i >= 0; i--) this.put(s.charCodeAt(i))
  }
}

function ltostr(cvt: bigint, base: number, conv: number, f: Fld): number {
  const digits = conv === ch('X') ? '0123456789ABCDEF' : '0123456789abcdef'
  if (cvt === 0n) {
    f.put(48)
    return 1
  }
  const b = BigInt(base)
  let n = 0
  while (cvt !== 0n) {
    const q = cvt / b
    f.put(digits.charCodeAt(Number(cvt - q * b)))
    cvt = q
    n++
  }
  return n
}

/** FCVT: `fdigit` digits after the point, rounded half-up on one extra digit (TI does not round to even). */
function fcvt(input: number, fdigitArg: number): { digits: string; decpt: number } {
  let value = input < 0 ? -input : input
  const out: number[] = [48]
  let fdigit = fdigitArg + 1
  let scale = 0
  while (value > LONG_MAX) {
    value /= 10
    scale++
  }
  while (value && value < 1) {
    value *= 10
    scale--
  }
  const ip = String(Math.trunc(value))
  for (let i = 0; i < ip.length; i++) out.push(ip.charCodeAt(i))
  let decpt = scale + ip.length
  fdigit += scale
  if (fdigit > 0) {
    do {
      value -= Math.trunc(value)
      value *= 10
      out.push(48 + Math.trunc(value))
    } while (--fdigit)
  }
  const pos = out.length - 1
  if (out[pos] >= 53) {
    let ptr = pos
    while ((out[--ptr] += 1) > 57) out[ptr] = 48
    if (ptr === 0) return { digits: String.fromCharCode(...out.slice(0, pos)), decpt: decpt + 1 }
  }
  return { digits: String.fromCharCode(...out.slice(1, pos)), decpt }
}

/** ECVT: `sigdigit` significant digits, for %g. */
function ecvt(input: number, sigdigitArg: number): { digits: string; decpt: number } {
  let value = input < 0 ? -input : input
  const out: number[] = [48]
  let sigdigit = sigdigitArg + 1
  let scale = 0
  while (value > LONG_MAX) {
    value /= 10
    scale++
  }
  while (value && value < 1) {
    value *= 10
    scale--
  }
  const ip = String(Math.trunc(value))
  for (let i = 0; i < ip.length; i++) out.push(ip.charCodeAt(i))
  const decpt = scale + ip.length
  let pos: number
  if (ip.length >= sigdigit) pos = 1 + sigdigit
  else {
    sigdigit -= ip.length
    do {
      value -= Math.trunc(value)
      value *= 10
      out.push(48 + Math.trunc(value))
    } while (--sigdigit)
    pos = out.length
  }
  pos--
  if (out[pos] >= 53) {
    let ptr = pos
    while ((out[--ptr] += 1) > 57) out[ptr] = 48
    if (ptr === 0) return { digits: String.fromCharCode(...out.slice(0, pos - 1)), decpt: decpt + 1 }
  }
  return { digits: String.fromCharCode(...out.slice(1, pos)), decpt }
}

function fcpy(digits: string, dpt: number, precisionArg: number, f: Fld): void {
  let precision = precisionArg
  let i = dpt + precision - 1
  while (precision-- > 0) {
    f.put(i >= 0 && i < digits.length ? digits.charCodeAt(i) : 48)
    --i
  }
}

function ecpy(exp: number, letter: number, f: Fld): void {
  ltostr(BigInt(Math.abs(exp)), 10, ch('d'), f)
  if (letter !== ch('p') && letter !== ch('P') && exp < 10 && exp > -10) f.put(48)
  f.put(exp < 0 ? ch('-') : ch('+'))
  f.put(letter)
}

function mcpy(digits: string, dpt: number, putdec: boolean, f: Fld): void {
  const diglen = digits.length
  let wholeend = dpt > 0 && dpt <= diglen ? dpt - 1 : -1
  if (putdec) f.put(ch('.'))
  let i = dpt
  for (; i > diglen; i--) f.put(48)
  if (i > 0) for (; wholeend >= 0; wholeend--) f.put(digits.charCodeAt(wholeend))
  else f.put(48)
}

function pconvF(v: number, fl: Field, f: Fld): void {
  if (fl.precision < 0) fl.precision = 6
  const fracStart = f.it
  const { digits, decpt } = fcvt(v, fl.precision)
  fcpy(digits, decpt, fl.precision, f)
  mcpy(digits, decpt, fracStart !== f.it || (fl.flags & POUND) !== 0, f)
}

function pconvE(input: number, fl: Field, f: Fld): void {
  if (fl.precision < 0) fl.precision = 6
  let v = input
  let exp = 0
  if (v) {
    for (; v < 1; v *= 10, exp--);
    for (; v >= 10; v /= 10, exp++);
  }
  let { digits, decpt } = fcvt(v, fl.precision)
  if (decpt === 2) {
    decpt--
    exp++
    digits = digits.slice(0, -1)
  }
  ecpy(exp, fl.conv, f)
  fcpy(digits, decpt, fl.precision, f)
  mcpy(digits, decpt, decpt !== digits.length || (fl.flags & POUND) !== 0, f)
}

function pconvG(v: number, fl: Field, f: Fld): void {
  if (fl.precision === 0) fl.precision = 1
  if (fl.precision < 0) fl.precision = 6
  const r = ecvt(v, fl.precision)
  const digits = r.digits
  let dpt = r.decpt
  let exp = 0
  if (dpt < -3 || dpt > fl.precision) {
    for (; dpt > 1; dpt--, exp++);
    for (; dpt < 1; dpt++, exp--);
    ecpy(exp, fl.conv - 2, f)
  }
  let seen = false
  for (let i = digits.length - 1; i >= dpt; --i) {
    const d = i >= 0 ? digits.charCodeAt(i) : 48
    if (d !== 48 || seen || fl.flags & POUND) {
      f.put(d)
      seen = true
    }
  }
  mcpy(digits, dpt, (fl.flags & POUND) !== 0 || seen, f)
}

/** %a: C99 hexadecimal floating point (rare in lab code; not a line-by-line port). */
function pconvA(v: number, fl: Field, f: Fld): void {
  const upper = fl.conv === ch('A')
  let lead = 0
  let mant = 0n
  let exp = 0
  if (v !== 0) {
    const dv = new DataView(new ArrayBuffer(8))
    dv.setFloat64(0, v)
    const bits = dv.getBigUint64(0)
    const e = Number((bits >> 52n) & 0x7ffn)
    mant = bits & ((1n << 52n) - 1n)
    lead = e === 0 ? 0 : 1
    exp = e === 0 ? -1022 : e - 1023
  }
  let frac = mant.toString(16).padStart(13, '0')
  if (fl.precision >= 0 && fl.precision < 13) {
    const keep = fl.precision * 4
    let q = (mant >> BigInt(52 - keep)) + ((mant >> BigInt(51 - keep)) & 1n)
    if (q >> BigInt(keep) !== 0n) {
      lead++
      q &= (1n << BigInt(keep)) - 1n
    }
    frac = keep === 0 ? '' : q.toString(16).padStart(fl.precision, '0')
  } else if (fl.precision < 0) frac = frac.replace(/0+$/, '')
  else frac = frac.padEnd(fl.precision, '0')
  const point = frac.length > 0 || fl.flags & POUND ? '.' : ''
  const s = `0x${lead}${point}${frac}p${exp < 0 ? '-' : '+'}${Math.abs(exp)}`
  f.putS(upper ? s.toUpperCase() : s)
}

function fgea(fl: Field, va: VaReader, f: Fld): number {
  const cvt = va.dbl()
  const isCap = fl.conv >= 65 && fl.conv <= 90
  if (Number.isNaN(cvt)) {
    f.putS(isCap ? 'NAN' : 'nan')
    return SPECIAL_FLAG
  }
  if (!Number.isFinite(cvt)) {
    const s = (cvt < 0 ? '-' : '+') + (isCap ? 'INF' : 'inf')
    f.putS(s)
    return SPECIAL_FLAG
  }
  let v = cvt
  let flags = NO_FLAG
  if (v < 0 || Object.is(v, -0)) {
    flags = MINUS_FLAG
    v = -v
  }
  switch (String.fromCharCode(fl.conv)) {
    case 'f':
    case 'F':
      pconvF(v, fl, f)
      break
    case 'e':
    case 'E':
      pconvE(v, fl, f)
      break
    case 'g':
    case 'G':
      pconvG(v, fl, f)
      break
    default:
      pconvA(v, fl, f)
  }
  return flags
}

function getarg(fl: Field, va: VaReader): bigint {
  const c = String.fromCharCode(fl.conv)
  const u64 = (v: number | bigint): bigint => BigInt.asUintN(64, BigInt(v))
  if (c === 'p') return u64(va.ptr())
  const signed = c === 'd' || c === 'i'
  switch (fl.flags & LENGTHS) {
    case MFH:
      return signed ? u64(va.int()) : u64(va.uint() & 0xffff)
    case MFHH:
      return signed ? u64(va.int()) : u64(va.uint() & 0xff)
    case MFLL:
    case MFJ:
      return signed ? u64(va.ll()) : va.ull()
    case MFI40:
      return signed ? u64(BigInt.asIntN(40, va.ll())) : BigInt.asUintN(40, va.ull())
    default:
      return signed ? u64(va.int()) : u64(va.uint())
  }
}

/** Returns minus_flag. */
function diouxp(fl: Field, va: VaReader, f: Fld): boolean {
  if (fl.precision < 0) fl.precision = 1
  else fl.flags &= ~ZERO
  const conv = fl.conv
  const base = isHexConv(conv) ? 16 : conv === ch('o') ? 8 : 10
  let cvt = getarg(fl, va)
  if (fl.precision === 0 && cvt === 0n && !(fl.flags & POUND)) return false
  let minus = false
  if ((conv === ch('d') || conv === ch('i')) && BigInt.asIntN(64, cvt) < 0n) {
    minus = true
    cvt = BigInt.asUintN(64, -BigInt.asIntN(64, cvt))
  }
  let digits = ltostr(cvt, base, conv, f)
  while (digits++ < fl.precision) f.put(48)
  if (isHexConv(conv) && fl.flags & POUND) {
    f.put(conv === ch('p') ? ch('x') : conv)
    f.put(48)
  }
  if (conv === ch('o') && fl.flags & POUND && f.b[f.it + 1] !== 48) f.put(48)
  return minus
}

/** _SETFIELD: one conversion, justified and padded in its field. Returns the field's bytes. */
function setfield(fl: Field, va: VaReader): number[] {
  const size = Math.max(BUFSIZE, fl.fwidth + 64)
  const f = new Fld(size)
  const aEnd = size - 1
  const fEnd = fl.fwidth
  let minusFlag = false
  let plusFlag = false
  let flags = NO_FLAG
  let terminator = 0
  switch (String.fromCharCode(fl.conv)) {
    case 'd':
    case 'i':
    case 'u':
    case 'X':
    case 'p':
    case 'o':
    case 'x':
      minusFlag = diouxp(fl, va, f)
      break
    case 'a':
    case 'A':
    case 'g':
    case 'G':
    case 'e':
    case 'E':
    case 'f':
    case 'F':
      flags = fgea(fl, va, f)
      break
    case 'c': {
      const t = va.int() & 0xff
      terminator = t === 0 ? 1 : 0
      f.put(t)
      fl.flags &= ~PLUS
      break
    }
    case '%':
      return [37]
  }
  if (isSignedConv(fl.conv) && (flags === MINUS_FLAG || flags === NO_FLAG)) {
    if (flags === MINUS_FLAG) minusFlag = true
    plusFlag = (fl.flags & PLUS) !== 0
    if (minusFlag) f.put(ch('-'))
    else if (plusFlag) f.put(ch('+'))
    if (!minusFlag && !plusFlag && fl.flags & SPACE) f.put(32)
  }
  const b = f.b
  const len = aEnd - f.it
  let where = fl.flags & MINUS || len > fl.fwidth ? 0 : fEnd - len + 1
  let src = f.it + 1
  let dst = where
  for (;;) {
    const c = b[src++]
    b[dst++] = c
    if (c === 0) break
  }
  let it = dst
  if (terminator) b[it++] = 0
  if (it <= fEnd) {
    for (let k = it - 1; k < fEnd; k++) b[k] = 32
    b[fEnd] = 0
  }
  if (fl.flags & ZERO) {
    if (where !== 0) {
      for (let k = 0; k < where; k++) b[k] = 48
      let swap = 0
      if (minusFlag || plusFlag || fl.flags & SPACE) {
        b[swap++] = b[where]
        b[where++] = 48
      }
      if ((isHexConv(fl.conv) && fl.flags & POUND) || fl.conv === ch('a') || fl.conv === ch('A')) {
        b[swap + 1] = b[where + 1]
        b[where + 1] = 48
      }
    }
  } else for (let k = 0; k < where; k++) b[k] = 32
  let n = 0
  while (b[n] !== 0) n++
  return b.slice(0, n + terminator)
}

/** _PRINTFI: formats the string at `format`, reading arguments from `va`. Returns the count, or EOF. */
export function formatTI(m: Machine, format: number, va: VaReader, out: PrintfSink): number {
  const fmt: number[] = []
  for (let p = format; ; p++) {
    const c = m.mem.u8(p)
    if (c === 0) break
    fmt.push(c)
  }
  const n = fmt.length
  const digit = (i: number): boolean => i < n && fmt[i] >= 48 && fmt[i] <= 57
  let i = 0
  let count = 0
  while (i < n) {
    const fl: Field = { flags: 0, fwidth: 0, precision: -1, conv: 0 }
    while (i < n && fmt[i] !== 37) {
      out.c(fmt[i++])
      count++
    }
    if (i >= n) break
    i++
    for (let done = false; !done; ) {
      switch (fmt[i]) {
        case 45: fl.flags |= MINUS; i++; break
        case 43: fl.flags |= PLUS; i++; break
        case 32: fl.flags |= SPACE; i++; break
        case 35: fl.flags |= POUND; i++; break
        case 48: fl.flags |= ZERO; i++; break
        default: done = true
      }
    }
    if (fmt[i] === 42) {
      let w = va.int()
      if (w < 0) {
        w = -w
        fl.flags |= MINUS
      }
      fl.fwidth = w
      i++
    } else if (digit(i)) {
      let w = 0
      while (digit(i)) w = w * 10 + fmt[i++] - 48
      fl.fwidth = w
    }
    if (fmt[i] === 46) {
      i++
      if (fmt[i] === 42) {
        fl.precision = va.int()
        i++
      } else {
        let p = 0
        while (digit(i)) p = p * 10 + fmt[i++] - 48
        fl.precision = p
      }
    }
    switch (fmt[i]) {
      case ch('L'): fl.flags |= MFLD; i++; break
      case ch('h'):
        i++
        if (fmt[i] === ch('h')) { fl.flags |= MFHH; i++ } else fl.flags |= MFH
        break
      case ch('l'):
        i++
        if (fmt[i] === ch('l')) { fl.flags |= MFLL; i++ } else fl.flags |= MFL
        break
      case ch('j'): fl.flags |= MFJ; i++; break
      case ch('z'): fl.flags |= MFZ; i++; break
      case ch('t'): fl.flags |= MFT; i++; break
      case ch('I'):
        if (fmt[i + 1] === ch('4') && fmt[i + 2] === ch('0')) { fl.flags |= MFI40; i += 3 }
        break
    }
    fl.conv = i < n ? fmt[i] : 0
    i++
    if (fl.conv === ch('n')) {
      const p = va.ptr()
      switch (fl.flags & LENGTHS) {
        case MFLL:
        case MFJ:
        case MFI40: m.mem.set64(p, BigInt(count)); break
        case MFH: m.mem.set16(p, count); break
        case MFHH: m.mem.set8(p, count); break
        default: m.mem.set32(p, count)
      }
    } else if (fl.conv === ch('s')) {
      const p = va.ptr()
      if (p === 0) out.c(0)
      else {
        let slen = 0
        while (m.mem.u8(p + slen) !== 0) slen++
        const buflen = fl.precision >= 0 && fl.precision < slen ? fl.precision : slen
        const len = fl.fwidth > buflen ? fl.fwidth : buflen
        count += len
        if (buflen < len && !(fl.flags & MINUS)) for (let k = 0; k < len - buflen; k++) out.c(32)
        for (let k = 0; k < buflen; k++) out.c(m.mem.u8(p + k))
        if (buflen < len && fl.flags & MINUS) for (let k = 0; k < len - buflen; k++) out.c(32)
      }
    } else {
      const bytes = setfield(fl, va)
      const r = out.s(bytes, bytes.length)
      count = r === EOF ? EOF : count + r
    }
    if (count === EOF) break
  }
  return count
}

/** sprintf's sink: copies every byte (NULs included) and returns the end pointer through `end()`. */
function memorySink(m: Machine, start: number): PrintfSink & { end(): number } {
  let p = start >>> 0
  return {
    c: (c) => m.mem.set8(p++, c),
    s: (bytes, len) => {
      m.mem.write(p, bytes)
      p += len
      return len
    },
    end: () => p
  }
}

/** snprintf's sink: writes at most n - 1 bytes but counts everything. */
function boundedSink(m: Machine, start: number, size: number): PrintfSink & { end(): number } {
  const n = size === 0 ? 0 : size - 1
  let written = 0
  let p = start >>> 0
  return {
    c: (c) => {
      if (written < n) m.mem.set8(p++, c)
      written++
    },
    s: (bytes, len) => {
      if (written < n) {
        const use = Math.min(len, n - written)
        m.mem.write(p, bytes.slice(0, use))
        p += use
      }
      written += len
      return len
    },
    end: () => p
  }
}

function sprintfTo(m: Machine, buf: number, fmt: number, va: VaReader): number {
  const out = memorySink(m, buf)
  const r = formatTI(m, fmt, va, out)
  m.mem.set8(out.end(), 0)
  return r
}

function snprintfTo(m: Machine, buf: number, size: number, fmt: number, va: VaReader): number {
  const out = boundedSink(m, buf, size >>> 0)
  const r = formatTI(m, fmt, va, out)
  if (size >>> 0) m.mem.set8(out.end(), 0)
  return r
}

export const PRINTF: Record<string, LibFunction> = {
  sprintf: vfn(2, (m, [buf, fmt], va) => sprintfTo(m, buf, fmt, vaReader(m, va))),
  snprintf: vfn(3, (m, [buf, size, fmt], va) => snprintfTo(m, buf, size, fmt, vaReader(m, va))),
  vsprintf: fn(3, (m, [buf, fmt, ap]) => sprintfTo(m, buf, fmt, vaReader(m, ap))),
  vsnprintf: fn(4, (m, [buf, size, fmt, ap]) => snprintfTo(m, buf, size, fmt, vaReader(m, ap)))
}
```

- [ ] **Step 4: Register the module**

In `src/interp/runtime/index.ts`, add `import { PRINTF } from './printf'` and change `LIBRARY` to `{ ...STDLIB, ...STRING, ...PRINTF }`.

- [ ] **Step 5: Run the test and see it pass**

Run: `npx vitest run tests/unit/interp/runtime/printf.test.ts && npm run typecheck`
Expected: PASS (3 tests), and no type errors.

If a case fails, compare with the TI source (`lib/src/_printfi.c`, functions `fcvt`, `ecvt`, `_pconv_*`, `_setfield`) before changing the expected text. The expectations are TI's behaviour, not glibc's.

- [ ] **Step 6: Commit**

```bash
git add src/interp/runtime/printf.ts src/interp/runtime/index.ts tests/unit/interp/runtime/printf.test.ts
git commit -m "feat(interp): port TI's printf formatter (fcvt/ecvt rounding, field layout) with sprintf/snprintf"
```

---
### Task 8: stdio: console streams, CIO host files, scanf

**Files:**
- Create: `src/interp/runtime/scanf.ts`, `src/interp/runtime/stdio.ts`, `src/interp/runtime/hostfs.ts`
- Modify: `src/interp/runtime/index.ts` (register STDIO and add `initRuntime`), `src/interp/run.ts` (call `initRuntime`)
- Modify: `tests/unit/interp/exec/harness.ts` (`runC` accepts `files`)
- Test: `tests/unit/interp/runtime/stdio.test.ts`

**Interfaces:**
- Consumes:
  - `formatTI`, `vaReader`, `VaReader` and `PrintfSink` (Task 7);
  - `heap` (Task 6);
  - `strtod`, `setErrno` and `ENOENT`/`EFPOS` (Task 6);
  - `Machine.io` and `Machine.cleanups`.
- Produces:
  - `scanf.ts`: `CharSource {get(), unget(c)}` and `scanTI(m, formatAddr, va, src): number`.
  - `stdio.ts`: `STDIO` and `stdio(m)`, which returns the per-machine `Stdio` (the streams and the `_ftable` address).
  - `hostfs.ts`: `nodeHostFiles(dir): HostFiles`, whose paths resolve against `dir`.
  - `index.ts`: `initRuntime(m)`, which `loadProgram` calls after static initialisation.

Behaviour, from TI's `defs.c`, `setvbuf.c`, `_io_perm.c`, `fputc.c`, `fputs.c` and `_bufread.c`:
- `_ftable[0..2]` are stdin (line-buffered), stdout (line-buffered) and stderr (unbuffered).
- A buffered stream mallocs `BUFSIZ + 1` = 257 bytes on its first access. If that fails, the call returns EOF and nothing is written, which is why a too-small heap silences `printf` on the LCDK.
- stdout flushes on `'\n'`, when its 256 bytes are full, on `fflush`, and at `exit()`. `abort()` does not flush.
- Reading a line-buffered stream first flushes every line-buffered stream, so prompts appear before input is read.
- `printf` fields go through `fputs`, and `puts` returns `fputs(s) + fputs("\n")`.
- Host files are CIO files, which LabSim resolves against the project folder. An opened file is held in memory and written back on `fflush`, `fclose` and `exit`.

- [ ] **Step 1: Let the harness pass host files**

In `tests/unit/interp/exec/harness.ts`:
- Change the `runC` options type to `BuildOptions & { others?: Record<string, string>; input?: string[]; maxSteps?: number; files?: HostFiles }`.
- Replace `captureIO(opts.input ?? [])` with `captureIO(opts.input ?? [], opts.files ?? null)`.
- Change the machine import to `import type { HostFiles, Machine } from '../../../../src/interp/exec/machine'`.

- [ ] **Step 2: Write the failing test**

```ts path=tests/unit/interp/runtime/stdio.test.ts
import { describe, expect, it } from 'vitest'
import type { HostFiles } from '../../../../src/interp/exec/machine'
import { loadProgram, runProgram } from '../../../../src/interp/run'
import { build, NO_IO, runC } from '../exec/harness'

function memoryFiles(initial: Record<string, string> = {}): HostFiles & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  const text = (d: Uint8Array): string => String.fromCharCode(...d)
  return {
    files,
    readAll: (p) => (files.has(p) ? Uint8Array.from([...files.get(p)!].map((c) => c.charCodeAt(0))) : null),
    writeAll: (p, d) => {
      files.set(p, text(d))
      return true
    },
    remove: (p) => files.delete(p),
    rename: (a, b) => {
      if (!files.has(a)) return false
      files.set(b, files.get(a)!)
      files.delete(a)
      return true
    }
  }
}

describe('console output', () => {
  it('prints through a line-buffered stdout and flushes at exit', () => {
    const r = runC('#include <stdio.h>\nint n;\nint main(void) { n = printf("x=%d y=%.2f\\n", 42, 1.5); printf("tail"); return 0; }')
    expect(r.stdout).toBe('x=42 y=1.50\ntail')
    expect(r.m.mem.i32(r.g('n'))).toBe(12)
  })

  it('loses unflushed output on abort(), as on the board', () => {
    const r = runC('#include <stdio.h>\n#include <stdlib.h>\nint main(void) { printf("line\\n"); printf("lost"); abort(); return 0; }')
    expect(r.stdout).toBe('line\n')
  })

  it("takes stdout's 257-byte buffer from the heap on first use", () => {
    const r = runC('#include <stdio.h>\n#include <stdlib.h>\nunsigned p;\nint main(void) { printf("hi\\n"); p = (unsigned)malloc(4); return 0; }')
    expect(r.m.mem.u32(r.g('p'))).toBe(r.image.heap.start + 8 + 264 + 8)
  })

  it('prints nothing when the heap cannot hold the stdout buffer', () => {
    const r = runC('#include <stdio.h>\nint a, b;\nint main(void) { a = printf("hello\\n"); b = printf("%d\\n", 5); return 0; }', { heap: 0x100 })
    expect(r.stdout).toBe('')
    expect([r.m.mem.i32(r.g('a')), r.m.mem.i32(r.g('b'))]).toEqual([6, -1])
  })

  it('writes puts, putchar, stderr and perror', () => {
    const r = runC(`
#include <stdio.h>
#include <errno.h>
int n;
int main(void)
{
    n = puts("one");
    putchar('2');
    putchar('\\n');
    fputs("warn\\n", stderr);
    fprintf(stderr, "%s!\\n", "err");
    errno = EDOM;
    perror("sqrt");
    return 0;
}`)
    expect(r.stdout).toBe('one\n2\n')
    expect(r.stderr).toBe('warn\nerr!\nsqrt: Domain error\n')
    expect(r.m.mem.i32(r.g('n'))).toBe(4)
  })
})

describe('console input', () => {
  it('reads with scanf and getchar from console lines and returns EOF at the end', () => {
    const r = runC(`
#include <stdio.h>
int a, k, eof;
float f;
char s[16], c;
int main(void)
{
    k = scanf("%d %f %s", &a, &f, s);
    scanf(" %c", &c);
    eof = scanf("%d", &a);
    return 0;
}`, { input: ['12 3.5 word', 'X'] })
    expect([r.m.mem.i32(r.g('k')), r.m.mem.i32(r.g('a')), r.m.mem.i32(r.g('eof'))]).toEqual([3, 12, -1])
    expect(r.m.mem.f32(r.g('f'))).toBe(3.5)
    expect(r.m.mem.cstring(r.g('s'))).toBe('word')
    expect(r.m.mem.u8(r.g('c'))).toBe(88)
  })

  it('flushes a pending prompt before waiting for input', () => {
    const { program, image } = build('#include <stdio.h>\nint n;\nint main(void) { printf("Enter n: "); scanf("%d", &n); printf("n=%d\\n", n); return 0; }')
    const events: string[] = []
    const m = loadProgram(program, image, {
      ...NO_IO,
      write: (t) => events.push(t),
      readLine: () => {
        events.push('<read>')
        return '7'
      }
    })
    expect(runProgram(m)).toMatchObject({ status: 'exited', code: 0 })
    expect(events).toEqual(['Enter n: ', '<read>', 'n=7\n'])
  })

  it('parses with sscanf: %i, scan sets, widths, suppression and %n', () => {
    const r = runC(`
#include <stdio.h>
int v[5];
char s1[8], s2[8];
int main(void)
{
    v[0] = sscanf("0x1f -7 abc,defgh", "%i %d %[a-z],%3s", &v[1], &v[2], s1, s2);
    v[3] = sscanf("5 6", "%*d %d%n", &v[4], &v[1]);
    return 0;
}`)
    expect([0, 1, 2, 3, 4].map((i) => r.m.mem.i32(r.g('v') + 4 * i))).toEqual([4, 3, -7, 1, 6])
    expect([r.m.mem.cstring(r.g('s1')), r.m.mem.cstring(r.g('s2'))]).toEqual(['abc', 'def'])
  })
})

describe('host files (CIO)', () => {
  it('writes, reads back and reports missing files', () => {
    const host = memoryFiles({ 'in.txt': '3 4\n' })
    const r = runC(`
#include <stdio.h>
char line[32];
int v[4];
float back[2];
int main(void)
{
    float w[2] = { 1.5f, -2.0f };
    FILE *fp = fopen("out.txt", "w");
    fprintf(fp, "v=%d\\n", 5);
    fclose(fp);
    fp = fopen("out.txt", "r");
    fgets(line, sizeof line, fp);
    v[0] = fgetc(fp);
    v[1] = feof(fp) != 0;
    fclose(fp);
    v[2] = fopen("nope.txt", "r") == 0;
    fp = fopen("in.txt", "r");
    fscanf(fp, "%d", &v[3]);
    fclose(fp);
    fp = fopen("data.bin", "wb");
    fwrite(w, sizeof(float), 2, fp);
    fclose(fp);
    fp = fopen("data.bin", "rb");
    fread(back, sizeof(float), 2, fp);
    fseek(fp, 0, SEEK_END);
    v[0] = v[0] * 100 + (int)ftell(fp);
    fclose(fp);
    return 0;
}`, { files: host })
    expect(host.files.get('out.txt')).toBe('v=5\n')
    expect(r.m.mem.cstring(r.g('line'))).toBe('v=5\n')
    expect([0, 1, 2, 3].map((i) => r.m.mem.i32(r.g('v') + 4 * i))).toEqual([-100 + 8, 1, 1, 3])
    expect([r.m.mem.f32(r.g('back')), r.m.mem.f32(r.g('back') + 4)]).toEqual([1.5, -2])
  })

  it('returns NULL from fopen when the program has no project folder', () => {
    const r = runC('#include <stdio.h>\nint ok;\nint main(void) { ok = fopen("x.txt", "w") == 0; return 0; }')
    expect(r.m.mem.i32(r.g('ok'))).toBe(1)
  })
})
```

- [ ] **Step 3: Run the test and see it fail**

Run: `npx vitest run tests/unit/interp/runtime/stdio.test.ts`
Expected: FAIL with `LabSim: unsupported construct printf() …`.

- [ ] **Step 4: Implement scanf**

```ts path=src/interp/runtime/scanf.ts
import type { Machine } from '../exec/machine'
import type { VaReader } from './printf'
import { isSpace } from './string'

export interface CharSource {
  /** Next byte, or -1 at end of input. */
  get(): number
  unget(c: number): void
}

const EOF = -1

const isDigitIn = (c: number, base: number): boolean => {
  const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : 99
  return d < base
}

/** A C99 scanf engine: returns the number of assignments, or EOF when input ends before the first conversion. */
export function scanTI(m: Machine, format: number, va: VaReader, src: CharSource): number {
  const fmt = m.mem.cstring(format)
  let assigned = 0
  let consumed = 0
  let converted = false
  const get = (): number => {
    const c = src.get()
    if (c !== EOF) consumed++
    return c
  }
  const unget = (c: number): void => {
    if (c === EOF) return
    consumed--
    src.unget(c)
  }
  const skipSpace = (): number => {
    let c = get()
    while (c !== EOF && isSpace(c)) c = get()
    unget(c)
    return c
  }
  const result = (): number => (!converted && assigned === 0 ? EOF : assigned)

  let i = 0
  while (i < fmt.length) {
    const fc = fmt.charCodeAt(i)
    if (isSpace(fc)) {
      skipSpace()
      i++
      continue
    }
    if (fc !== 37) {
      const c = get()
      if (c !== fc) {
        unget(c)
        return c === EOF ? result() : assigned
      }
      i++
      continue
    }
    i++
    let suppress = false
    if (fmt[i] === '*') {
      suppress = true
      i++
    }
    let width = 0
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') width = width * 10 + fmt.charCodeAt(i++) - 48
    let len = ''
    if (fmt.startsWith('hh', i) || fmt.startsWith('ll', i)) {
      len = fmt.slice(i, i + 2)
      i += 2
    } else if ('hlLjzt'.includes(fmt[i] ?? '#')) len = fmt[i++]
    const conv = fmt[i++] ?? ''
    if (conv === '%') {
      skipSpace()
      const c = get()
      if (c !== 37) {
        unget(c)
        return c === EOF ? result() : assigned
      }
      continue
    }
    if (conv === 'n') {
      if (!suppress) storeInt(m, va.ptr(), len, BigInt(consumed))
      continue
    }
    if (conv !== 'c' && conv !== '[') {
      if (skipSpace() === EOF) return result()
    }
    const max = width > 0 ? width : conv === 'c' ? 1 : Infinity
    const text: number[] = []
    const take = (ok: (c: number) => boolean): void => {
      while (text.length < max) {
        const c = get()
        if (c === EOF || !ok(c)) {
          unget(c)
          return
        }
        text.push(c)
      }
    }
    switch (conv) {
      case 'd':
      case 'i':
      case 'u':
      case 'o':
      case 'x':
      case 'X':
      case 'p': {
        let base = conv === 'o' ? 8 : conv === 'x' || conv === 'X' || conv === 'p' ? 16 : 10
        take((c) => text.length === 0 && (c === 43 || c === 45))
        if (conv === 'i' || base === 16) {
          const c = get()
          if (c === 48 && text.length < max) {
            text.push(c)
            const x = get()
            if ((x === 120 || x === 88) && text.length < max) {
              text.push(x)
              base = 16
            } else {
              unget(x)
              if (conv === 'i') base = 8
            }
          } else unget(c)
        }
        const before = text.length
        take((c) => isDigitIn(c, base))
        const s = String.fromCharCode(...text)
        const digits = s.replace(/^[+-]?(0[xX])?/, '')
        // "0" and a bare "0x" are the number zero; no digits at all is a matching failure.
        if (digits.length === 0 && !(before > 0 && /0$/.test(s.replace(/[xX]$/, '')))) return assigned
        converted = true
        const neg = s.startsWith('-')
        const mag = digits.length === 0 ? 0n : BigInt((base === 16 ? '0x' : base === 8 ? '0o' : '') + digits)
        if (!suppress) {
          const v = neg ? -mag : mag
          if (conv === 'p') m.mem.set32(va.ptr(), Number(BigInt.asUintN(32, v)))
          else {
            storeInt(m, va.ptr(), len, v)
            assigned++
          }
          if (conv === 'p') assigned++
        }
        break
      }
      case 'f':
      case 'F':
      case 'e':
      case 'E':
      case 'g':
      case 'G':
      case 'a':
      case 'A': {
        let seenDot = false
        let seenExp = false
        let digitsSeen = false
        take((c) => {
          const last = text.length === 0 ? -1 : text[text.length - 1]
          if ((c === 43 || c === 45) && (text.length === 0 || last === 101 || last === 69)) return true
          if (c >= 48 && c <= 57) {
            digitsSeen = true
            return true
          }
          if (c === 46 && !seenDot && !seenExp) return (seenDot = true)
          if ((c === 101 || c === 69) && digitsSeen && !seenExp) return (seenExp = true)
          return false
        })
        const s = String.fromCharCode(...text)
        const v = Number(s.replace(/[eE][+-]?$/, ''))
        if (!digitsSeen || Number.isNaN(v)) return assigned
        converted = true
        if (!suppress) {
          const p = va.ptr()
          if (len === 'l' || len === 'L') m.mem.setF64(p, v)
          else m.mem.setF32(p, v)
          assigned++
        }
        break
      }
      case 's':
      case 'c':
      case '[': {
        let accept: (c: number) => boolean = (c) => !isSpace(c)
        if (conv === 'c') accept = () => true
        if (conv === '[') {
          let negate = false
          if (fmt[i] === '^') {
            negate = true
            i++
          }
          const set = new Set<number>()
          let first = true
          while (i < fmt.length && (fmt[i] !== ']' || first)) {
            if (fmt[i + 1] === '-' && fmt[i + 2] !== undefined && fmt[i + 2] !== ']') {
              for (let c = fmt.charCodeAt(i); c <= fmt.charCodeAt(i + 2); c++) set.add(c)
              i += 3
            } else set.add(fmt.charCodeAt(i++))
            first = false
          }
          i++
          accept = (c) => set.has(c) !== negate
        }
        take(accept)
        if (text.length === 0) {
          const c = get()
          unget(c)
          return c === EOF ? result() : assigned
        }
        converted = true
        if (!suppress) {
          const p = va.ptr()
          m.mem.write(p, text)
          if (conv !== 'c') m.mem.set8(p + text.length, 0)
          assigned++
        }
        break
      }
      default:
        return assigned
    }
  }
  return assigned
}

function storeInt(m: Machine, p: number, len: string, v: bigint): void {
  switch (len) {
    case 'hh':
      m.mem.set8(p, Number(BigInt.asIntN(8, v)))
      break
    case 'h':
      m.mem.set16(p, Number(BigInt.asIntN(16, v)))
      break
    case 'll':
    case 'j':
      m.mem.set64(p, v)
      break
    default:
      m.mem.set32(p, Number(BigInt.asIntN(32, v)))
  }
}
```

- [ ] **Step 5: Implement the streams**

```ts path=src/interp/runtime/stdio.ts
import type { Machine } from '../exec/machine'
import { EFPOS, ENOENT, setErrno } from './errno'
import { heap } from './heap'
import { formatTI, vaReader, type PrintfSink } from './printf'
import { scanTI, type CharSource } from './scanf'
import { strlen } from './string'
import { fn, state, vfn, type LibFunction } from './types'

const NFILE = 20
const FILE_SIZE = 24
const BUFSIZ = 256
const EOF = -1
const IOFBF = 1
const IOLBF = 2
const IONBF = 4
const SEEK_SET = 0
const SEEK_CUR = 1
const SEEK_END = 2

type Buffering = 'line' | 'full' | 'none'

class Stream {
  open = false
  console: 'in' | 'out' | 'err' | null = null
  canRead = false
  canWrite = false
  append = false
  buffering: Buffering = 'full'
  /** The malloc'd buffer (BUFSIZ + 1 bytes, as setvbuf allocates it); 0 until the first access. */
  bufAddr = 0
  /** A buffer the program supplied with setvbuf/setbuf, so none is malloc'd. */
  userBuffer = false
  capacity = BUFSIZ
  /** Console output not yet flushed. */
  out: number[] = []
  /** Console input read but not yet consumed. */
  input: number[] = []
  pushback: number[] = []
  eof = false
  err = false
  path = ''
  data: number[] = []
  pos = 0
  dirty = false
}

const latin1 = (bytes: number[]): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.slice(i, i + 4096))
  return s
}

export class Stdio {
  readonly streams: Stream[] = []
  readonly table: number

  constructor(private readonly m: Machine) {
    this.table = m.placement.libraryObject('_ftable')
    for (let i = 0; i < NFILE; i++) this.streams.push(new Stream())
    const [sin, sout, serr] = this.streams
    sin.open = sout.open = serr.open = true
    sin.console = 'in'
    sin.canRead = true
    sin.buffering = 'line'
    sout.console = 'out'
    sout.canWrite = true
    sout.buffering = 'line'
    serr.console = 'err'
    serr.canWrite = true
    serr.buffering = 'none'
    for (let i = 0; i < NFILE; i++) this.syncFd(i)
    m.cleanups.push(() => this.flushAll())
  }

  private syncFd(i: number): void {
    this.m.mem.set32(this.table + i * FILE_SIZE, this.streams[i].open ? i : -1)
  }

  stream(fp: number): Stream | null {
    const off = (fp >>> 0) - this.table
    if (off < 0 || off % FILE_SIZE !== 0 || off / FILE_SIZE >= NFILE) return null
    const s = this.streams[off / FILE_SIZE]
    return s.open ? s : null
  }

  get stdin(): Stream {
    return this.streams[0]
  }
  get stdout(): Stream {
    return this.streams[1]
  }
  get stderr(): Stream {
    return this.streams[2]
  }

  /** __TI_wrt_ok / __TI_rd_ok: a buffered stream mallocs its buffer on first use; failure means EOF. */
  private ready(s: Stream): boolean {
    if (s.buffering === 'none' || s.bufAddr !== 0 || s.userBuffer) return true
    const p = heap(this.m).malloc(s.capacity + 1)
    if (p === 0) {
      s.err = true
      return false
    }
    s.bufAddr = p
    return true
  }

  private emit(s: Stream, bytes: number[]): void {
    if (bytes.length === 0) return
    if (s.console === 'out' || s.console === 'err') {
      this.m.io.write(latin1(bytes), s.console === 'out' ? 'stdout' : 'stderr')
      return
    }
    if (s.append) s.pos = s.data.length
    for (const b of bytes) s.data[s.pos++] = b
    s.dirty = true
  }

  private writeByte(s: Stream, b: number): void {
    if (s.console === null || s.buffering === 'none') {
      this.emit(s, [b])
      return
    }
    if (s.out.length >= s.capacity) this.flush(s)
    s.out.push(b)
    if (s.buffering === 'line' && b === 10) this.flush(s)
  }

  putc(s: Stream, c: number): number {
    if (!s.canWrite) {
      s.err = true
      return EOF
    }
    if (!this.ready(s)) return EOF
    const b = c & 0xff
    this.writeByte(s, b)
    return b
  }

  /** fputs: the bytes up to the first NUL; returns their count or EOF. */
  puts(s: Stream, bytes: number[]): number {
    if (!s.canWrite) {
      s.err = true
      return EOF
    }
    if (!this.ready(s)) return EOF
    const end = bytes.indexOf(0)
    const text = end < 0 ? bytes : bytes.slice(0, end)
    if (s.buffering === 'none' || s.console === null) this.emit(s, text)
    else for (const b of text) this.writeByte(s, b)
    return text.length
  }

  getc(s: Stream): number {
    if (!s.canRead) {
      s.err = true
      return EOF
    }
    if (s.pushback.length > 0) return s.pushback.pop() as number
    if (!this.ready(s)) return EOF
    if (s.console === 'in') {
      if (s.input.length === 0) {
        if (s.eof) return EOF
        // _bufread.c: reading a line-buffered stream flushes every line-buffered stream first.
        for (const t of this.streams) if (t.open && t.buffering === 'line' && t.canWrite) this.flush(t)
        const line = this.m.io.readLine()
        if (line === null) {
          s.eof = true
          return EOF
        }
        s.input = [...line].map((c) => c.charCodeAt(0) & 0xff)
        s.input.push(10)
      }
      return s.input.shift() as number
    }
    if (s.console !== null) return EOF
    if (s.pos >= s.data.length) {
      s.eof = true
      return EOF
    }
    return s.data[s.pos++]
  }

  ungetc(s: Stream, c: number): number {
    if (c === EOF) return EOF
    s.pushback.push(c & 0xff)
    s.eof = false
    return c & 0xff
  }

  flush(s: Stream): void {
    if (s.out.length > 0) {
      const out = s.out
      s.out = []
      this.emit(s, out)
    }
    if (s.dirty && this.m.io.files) {
      this.m.io.files.writeAll(s.path, Uint8Array.from(s.data))
      s.dirty = false
    }
  }

  flushAll(): void {
    for (const s of this.streams) if (s.open) this.flush(s)
  }

  sink(s: Stream): PrintfSink {
    return { c: (c) => void this.putc(s, c), s: (bytes) => this.puts(s, bytes) }
  }

  source(s: Stream): CharSource {
    return { get: () => this.getc(s), unget: (c) => void this.ungetc(s, c) }
  }

  fopen(path: string, mode: string, slot = -1): number {
    const files = this.m.io.files
    const kind = mode[0]
    if (!files || (kind !== 'r' && kind !== 'w' && kind !== 'a')) {
      setErrno(this.m, ENOENT)
      return 0
    }
    const i = slot >= 0 ? slot : this.streams.findIndex((s, k) => k >= 3 && !s.open)
    if (i < 0) return 0
    let data: number[] | null
    if (kind === 'r') {
      const d = files.readAll(path)
      data = d ? [...d] : null
    } else if (kind === 'w') data = files.writeAll(path, new Uint8Array(0)) ? [] : null
    else {
      const d = files.readAll(path)
      data = d ? [...d] : files.writeAll(path, new Uint8Array(0)) ? [] : null
    }
    if (data === null) {
      setErrno(this.m, ENOENT)
      return 0
    }
    const plus = mode.includes('+')
    const s = new Stream()
    Object.assign(s, {
      open: true,
      canRead: kind === 'r' || plus,
      canWrite: kind !== 'r' || plus,
      append: kind === 'a',
      path,
      data,
      pos: kind === 'a' ? data.length : 0
    })
    this.streams[i] = s
    this.syncFd(i)
    return this.table + i * FILE_SIZE
  }

  fclose(fp: number): number {
    const s = this.stream(fp)
    if (!s) return EOF
    this.flush(s)
    if (s.bufAddr !== 0) heap(this.m).release(s.bufAddr)
    const i = ((fp >>> 0) - this.table) / FILE_SIZE
    this.streams[i] = new Stream()
    this.syncFd(i)
    return 0
  }

  seek(s: Stream, offset: number, whence: number): number {
    if (s.console !== null) {
      setErrno(this.m, EFPOS)
      return EOF
    }
    this.flush(s)
    const base = whence === SEEK_SET ? 0 : whence === SEEK_CUR ? s.pos - s.pushback.length : whence === SEEK_END ? s.data.length : NaN
    const pos = base + offset
    if (!(pos >= 0)) {
      setErrno(this.m, EFPOS)
      return EOF
    }
    s.pushback = []
    s.pos = pos
    s.eof = false
    return 0
  }

  tell(s: Stream): number {
    if (s.console !== null) {
      setErrno(this.m, EFPOS)
      return EOF
    }
    return s.pos - s.pushback.length
  }

  setvbuf(s: Stream, buf: number, type: number, size: number): number {
    if (type !== IONBF && size <= 0) return EOF
    if (s.bufAddr !== 0) heap(this.m).release(s.bufAddr)
    s.bufAddr = 0
    s.userBuffer = buf !== 0
    this.flush(s)
    s.buffering = type === IONBF ? 'none' : type === IOLBF ? 'line' : 'full'
    s.capacity = Math.min(size > 0 ? size : BUFSIZ, BUFSIZ)
    if (s.buffering !== 'none' && buf === 0) {
      const p = heap(this.m).malloc(s.capacity + 1)
      if (p === 0) {
        s.err = true
        return EOF
      }
      s.bufAddr = p
    }
    return 0
  }
}

export const stdio = state((m) => new Stdio(m))

const bytesAt = (m: Machine, s: number): number[] => [...m.mem.read(s, strlen(m, s))]

function withStream<T>(m: Machine, fp: number, fail: T, f: (io: Stdio, s: Stream) => T): T {
  const io = stdio(m)
  const s = io.stream(fp)
  return s ? f(io, s) : fail
}

function printTo(m: Machine, s: Stream, fmt: number, va: number): number {
  return formatTI(m, fmt, vaReader(m, va), stdio(m).sink(s))
}

function fgets(m: Machine, io: Stdio, s: Stream, buf: number, n: number): number {
  if (n <= 0) return 0
  let i = 0
  while (i < n - 1) {
    const c = io.getc(s)
    if (c === EOF) break
    m.mem.set8(buf + i++, c)
    if (c === 10) break
  }
  if (i === 0) return 0
  m.mem.set8(buf + i, 0)
  return buf
}

const ERRORS: Record<number, string> = { 0: 'No error', 0x21: 'Domain error', 0x22: 'Range error', 0x02: 'No such file or directory', 0x98: 'File positioning error' }

export const STDIO: Record<string, LibFunction> = {
  printf: vfn(1, (m, [fmt], va) => {
    const io = stdio(m)
    return io.stdout.open ? printTo(m, io.stdout, fmt, va) : EOF
  }),
  fprintf: vfn(2, (m, [fp, fmt], va) => withStream(m, fp, EOF, (_io, s) => printTo(m, s, fmt, va))),
  vprintf: fn(2, (m, [fmt, ap]) => printTo(m, stdio(m).stdout, fmt, ap)),
  vfprintf: fn(3, (m, [fp, fmt, ap]) => withStream(m, fp, EOF, (_io, s) => printTo(m, s, fmt, ap))),
  puts: fn(1, (m, [p]) => {
    const io = stdio(m)
    return io.puts(io.stdout, bytesAt(m, p)) + io.puts(io.stdout, [10])
  }),
  fputs: fn(2, (m, [p, fp]) => withStream(m, fp, EOF, (io, s) => io.puts(s, bytesAt(m, p)))),
  putchar: fn(1, (m, [c]) => stdio(m).putc(stdio(m).stdout, c)),
  fputc: fn(2, (m, [c, fp]) => withStream(m, fp, EOF, (io, s) => io.putc(s, c))),
  putc: fn(2, (m, [c, fp]) => withStream(m, fp, EOF, (io, s) => io.putc(s, c))),
  getchar: fn(0, (m) => stdio(m).getc(stdio(m).stdin)),
  fgetc: fn(1, (m, [fp]) => withStream(m, fp, EOF, (io, s) => io.getc(s))),
  getc: fn(1, (m, [fp]) => withStream(m, fp, EOF, (io, s) => io.getc(s))),
  ungetc: fn(2, (m, [c, fp]) => withStream(m, fp, EOF, (io, s) => io.ungetc(s, c))),
  fgets: fn(3, (m, [buf, n, fp]) => withStream(m, fp, 0, (io, s) => fgets(m, io, s, buf, n))),
  gets: fn(1, (m, [buf]) => {
    const io = stdio(m)
    let i = 0
    for (let c = io.getc(io.stdin); c !== EOF && c !== 10; c = io.getc(io.stdin)) m.mem.set8(buf + i++, c)
    if (i === 0 && io.stdin.eof) return 0
    m.mem.set8(buf + i, 0)
    return buf
  }),
  fopen: fn(2, (m, [p, mode]) => stdio(m).fopen(m.mem.cstring(p), m.mem.cstring(mode))),
  freopen: fn(3, (m, [p, mode, fp]) => {
    const io = stdio(m)
    const i = ((fp >>> 0) - io.table) / FILE_SIZE
    if (!Number.isInteger(i) || i < 0 || i >= NFILE) return 0
    io.fclose(fp)
    return io.fopen(m.mem.cstring(p), m.mem.cstring(mode), i)
  }),
  fclose: fn(1, (m, [fp]) => stdio(m).fclose(fp)),
  fflush: fn(1, (m, [fp]) => {
    const io = stdio(m)
    if (fp === 0) io.flushAll()
    else {
      const s = io.stream(fp)
      if (!s) return EOF
      io.flush(s)
    }
    return 0
  }),
  fread: fn(4, (m, [ptr, size, n, fp]) =>
    withStream(m, fp, 0, (io, s) => {
      const total = Math.imul(size, n) >>> 0
      let k = 0
      for (; k < total; k++) {
        const c = io.getc(s)
        if (c === EOF) break
        m.mem.set8(ptr + k, c)
      }
      return size === 0 ? 0 : Math.floor(k / size)
    })
  ),
  fwrite: fn(4, (m, [ptr, size, n, fp]) =>
    withStream(m, fp, 0, (io, s) => {
      const total = Math.imul(size, n) >>> 0
      let k = 0
      for (; k < total; k++) if (io.putc(s, m.mem.u8(ptr + k)) === EOF) break
      return size === 0 ? 0 : Math.floor(k / size)
    })
  ),
  fseek: fn(3, (m, [fp, off, whence]) => withStream(m, fp, EOF, (io, s) => io.seek(s, off, whence))),
  ftell: fn(1, (m, [fp]) => withStream(m, fp, EOF, (io, s) => io.tell(s))),
  rewind: fn(1, (m, [fp]) =>
    withStream(m, fp, undefined, (io, s) => {
      io.seek(s, 0, SEEK_SET)
      s.err = false
      return undefined
    })
  ),
  fgetpos: fn(2, (m, [fp, pos]) =>
    withStream(m, fp, EOF, (io, s) => {
      const t = io.tell(s)
      if (t < 0) return EOF
      m.mem.set32(pos, t)
      return 0
    })
  ),
  fsetpos: fn(2, (m, [fp, pos]) => withStream(m, fp, EOF, (io, s) => io.seek(s, m.mem.i32(pos), SEEK_SET))),
  feof: fn(1, (m, [fp]) => withStream(m, fp, 0, (_io, s) => (s.eof ? 1 : 0))),
  ferror: fn(1, (m, [fp]) => withStream(m, fp, 0, (_io, s) => (s.err ? 1 : 0))),
  clearerr: fn(1, (m, [fp]) =>
    withStream(m, fp, undefined, (_io, s) => {
      s.eof = false
      s.err = false
      return undefined
    })
  ),
  remove: fn(1, (m, [p]) => (m.io.files?.remove(m.mem.cstring(p)) ? 0 : -1)),
  rename: fn(2, (m, [a, b]) => (m.io.files?.rename(m.mem.cstring(a), m.mem.cstring(b)) ? 0 : -1)),
  perror: fn(1, (m, [p]) => {
    const io = stdio(m)
    const err = io.stderr
    if (p !== 0 && m.mem.u8(p) !== 0) {
      io.puts(err, bytesAt(m, p))
      io.puts(err, [58, 32])
    }
    const e = m.mem.i32(m.placement.libraryObject('errno'))
    io.puts(err, [...(ERRORS[e] ?? 'Unknown error')].map((c) => c.charCodeAt(0)))
    io.putc(err, 10)
  }),
  setvbuf: fn(4, (m, [fp, buf, type, size]) => withStream(m, fp, EOF, (io, s) => io.setvbuf(s, buf, type, size))),
  setbuf: fn(2, (m, [fp, buf]) =>
    withStream(m, fp, undefined, (io, s) => {
      io.setvbuf(s, buf, buf !== 0 ? IOFBF : IONBF, BUFSIZ)
      return undefined
    })
  ),
  scanf: vfn(1, (m, [fmt], va) => {
    const io = stdio(m)
    return scanTI(m, fmt, vaReader(m, va), io.source(io.stdin))
  }),
  fscanf: vfn(2, (m, [fp, fmt], va) => withStream(m, fp, EOF, (io, s) => scanTI(m, fmt, vaReader(m, va), io.source(s)))),
  sscanf: vfn(2, (m, [str, fmt], va) => {
    let p = str >>> 0
    const src: CharSource = {
      get: () => {
        const c = m.mem.u8(p)
        if (c === 0) return EOF
        p++
        return c
      },
      unget: () => {
        p--
      }
    }
    return scanTI(m, fmt, vaReader(m, va), src)
  })
}
```

```ts path=src/interp/runtime/hostfs.ts
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
```

- [ ] **Step 6: Register stdio and create it at load**

Replace `src/interp/runtime/index.ts` with:

```ts path=src/interp/runtime/index.ts
import type { Machine } from '../exec/machine'
import { PRINTF } from './printf'
import { STDIO, stdio } from './stdio'
import { STDLIB } from './stdlib'
import { STRING } from './string'
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = { ...STDLIB, ...STRING, ...PRINTF, ...STDIO }

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = new Set<string>()

/** Run-time library start-up (what the RTS boot code sets up before main): the stdio FILE table. */
export function initRuntime(m: Machine): void {
  stdio(m)
}
```

In `src/interp/run.ts`:
- Change `import { LIBRARY, UNSUPPORTED } from './runtime/index'` to `import { initRuntime, LIBRARY, UNSUPPORTED } from './runtime/index'`.
- In `loadProgram`, after `placement.initialize()`, add `initRuntime(m)`.

- [ ] **Step 7: Run the tests and see them pass**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: every interpreter test passes, including 10 in `stdio.test.ts`, and there are no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/interp tests/unit/interp
git commit -m "feat(interp): stdio with TI buffering, console input, CIO host files and scanf"
```

---
### Task 9: math.h, time.h and the C6000 intrinsics

**Files:**
- Create: `src/interp/runtime/math.ts`, `src/interp/runtime/time.ts`, `src/interp/runtime/c6x.ts`
- Modify: `src/interp/runtime/index.ts`
- Test: `tests/unit/interp/runtime/math.test.ts`, `tests/unit/interp/runtime/c6x.test.ts`, `tests/unit/interp/runtime/library.test.ts`

**Interfaces:**
- Consumes: `fn`, `setErrno`/`EDOM`/`ERANGE`, `Machine.cycles`, `Machine.note`, `Placement.alloc`, and `library()` (Task 3).
- Produces:
  - `MATH`, `TIME`, `INTRINSICS`
  - `UNSUPPORTED_INTRINSICS`: the intrinsics whose exact C6000 semantics LabSim cannot guarantee. A program that calls one does not load.
  - `index.ts` registers all of them. The library test checks that every function the built-in headers declare is either implemented or listed as unsupported.

math.h follows TI's RTS, not IEEE libm. Normal values use JS `Math`, and float versions round the result with `Math.fround`. The edge behaviour comes from TI's `*_i.h` sources:

| Function | TI behaviour |
|---|---|
| `sqrt(x<0)` | 0, EDOM |
| `log`/`log10`/`log2(x≤0)` | −∞, ERANGE for 0 and EDOM for x<0 |
| `pow(x<0, non-integer y)` | `pow(x, round(y))`, EDOM |
| `pow(0, y<0)` | −DBL_MAX, EDOM |
| `pow` overflow | DBL_MAX, ERANGE; underflow gives 0 |
| `asin`/`acos(\|x\|>1)` | clamps x to ±1, EDOM |
| `atan2(0,0)` | 0, EDOM |
| `fmod(x,0)` | 0, EDOM |
| `cosh` overflow | ±∞ with the sign of x, EDOM |
| `exp` | 0 below ln(DBL_MIN), +∞ with ERANGE above ln(DBL_MAX) |

- `erf`, `erfc`, `lgamma` and `tgamma` use series approximations (Taylor and continued fraction for erf, Stirling with a recurrence shift for gamma), accurate to about 1e-14.
- `fma` is not fused.

time.h:
- `clock()` is the cycle estimate.
- `time_t` counts seconds from 1900, as TI's RTS does.
- `localtime` is UTC.

The intrinsics follow the TMS320C674x CPU instruction set reference, and are bit-exact for the ones listed in `INTRINSICS`.

- [ ] **Step 1: Write the failing tests**

```ts path=tests/unit/interp/runtime/math.test.ts
import { describe, expect, it } from 'vitest'
import { runC } from '../exec/harness'

const doubles = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.f64(r.g(name) + 8 * i))
const ints = (r: ReturnType<typeof runC>, name: string, n: number): number[] => Array.from({ length: n }, (_, i) => r.m.mem.i32(r.g(name) + 4 * i))

describe('math.h edge cases follow the TI RTS', () => {
  it('returns what the board returns for domain and range errors', () => {
    const r = runC(`
#include <math.h>
#include <errno.h>
double d[12];
int e[6];
int main(void)
{
    errno = 0; d[0] = sqrt(-1.0); e[0] = errno;
    errno = 0; d[1] = log(0.0); e[1] = errno;
    errno = 0; d[2] = log(-1.0); e[2] = errno;
    errno = 0; d[3] = pow(-8.0, 1.0 / 3.0); e[3] = errno;
    errno = 0; d[4] = pow(10.0, 400.0); e[4] = errno;
    d[5] = pow(0.0, -1.0);
    errno = 0; d[6] = asin(2.0); e[5] = errno;
    d[7] = fmod(5.0, 0.0);
    d[8] = atan2(0.0, 0.0);
    d[9] = cosh(-1000.0);
    d[10] = pow(-2.0, 3.0);
    d[11] = log10(1000.0);
    return 0;
}`)
    expect(doubles(r, 'd', 12)).toEqual([0, -Infinity, -Infinity, 1, 1.7976931348623157e308, -1.7976931348623157e308, Math.PI / 2, 0, 0, -Infinity, -8, 3])
    expect(ints(r, 'e', 6)).toEqual([0x21, 0x22, 0x21, 0x21, 0x22, 0x21])
  })

  it('computes float functions in single precision and the C99 extras accurately', () => {
    const r = runC(`
#include <math.h>
float f[2];
double d[12];
int i[4];
int main(void)
{
    int ex;
    double ip;
    f[0] = sinf(1.0f);
    f[1] = sqrtf(2.0f);
    d[0] = erf(1.0);
    d[1] = erfc(3.0);
    d[2] = tgamma(5.0);
    d[3] = lgamma(10.0);
    d[4] = round(-2.5);
    d[5] = rint(2.5);
    d[6] = frexp(8.0, &ex);
    i[0] = ex;
    d[7] = ldexp(0.5, 4);
    d[8] = modf(-3.75, &ip);
    d[9] = ip;
    d[10] = nextafter(1.0, 2.0);
    d[11] = hypot(3.0, 4.0);
    i[1] = fpclassify(0.0);
    i[2] = isnan(NAN) != 0;
    i[3] = (int)lround(-2.5);
    return 0;
}`)
    expect([r.m.mem.f32(r.g('f')), r.m.mem.f32(r.g('f') + 4)]).toEqual([Math.fround(Math.sin(1)), Math.fround(Math.SQRT2)])
    const d = doubles(r, 'd', 12)
    expect(d[0]).toBeCloseTo(0.8427007929497149, 14)
    expect(d[1] / 2.209049699858544e-5).toBeCloseTo(1, 12)
    expect(d[2]).toBeCloseTo(24, 12)
    expect(d[3]).toBeCloseTo(12.801827480081469, 12)
    expect(d.slice(4)).toEqual([-3, 2, 0.5, 8, -0.75, -3, 1 + 2 ** -52, 5])
    expect(ints(r, 'i', 4)).toEqual([4, 4, 1, -3])
  })
})

describe('time.h', () => {
  it('counts seconds from 1900 and formats like the C library', () => {
    const r = runC(`
#include <time.h>
#include <string.h>
int v[6];
char text[32], stamp[32];
int main(void)
{
    time_t t = 2208988800u;
    struct tm *tm = gmtime(&t);
    v[0] = tm->tm_year;
    v[1] = tm->tm_mon;
    v[2] = tm->tm_mday;
    v[3] = tm->tm_wday;
    strcpy(text, asctime(tm));
    v[4] = mktime(tm) == t;
    strftime(stamp, sizeof stamp, "%Y-%m-%d %H:%M:%S", tm);
    v[5] = time(0) > 3900000000u;
    return 0;
}`)
    expect(ints(r, 'v', 6)).toEqual([70, 0, 1, 4, 1, 1])
    expect(r.m.mem.cstring(r.g('text'))).toBe('Thu Jan  1 00:00:00 1970\n')
    expect(r.m.mem.cstring(r.g('stamp'))).toBe('1970-01-01 00:00:00')
  })
})
```

```ts path=tests/unit/interp/runtime/c6x.test.ts
import { describe, expect, it } from 'vitest'
import { loadProgram } from '../../../../src/interp/run'
import { build, NO_IO, runC } from '../exec/harness'

/** [C expression, expected value as unsigned 32-bit] */
const CASES: [string, number][] = [
  ['_dotp2(0x00030002, 0x00050004)', 23],
  ['_pack2(0x1234abcd, 0x5678ef01)', 0xabcdef01],
  ['_add2(0x0001ffff, 0x00010001)', 0x00020000],
  ['_sub2(0x00010000, 0x00010001)', 0x0000ffff],
  ['_mpy(0x0001fffe, 3)', -6 >>> 0],
  ['_mpyh(0x00020000, 0xfffd0000)', -6 >>> 0],
  ['_sadd(0x7fffffff, 1)', 0x7fffffff],
  ['_ssub(-2147483647 - 1, 1)', 0x80000000],
  ['_norm(1)', 30],
  ['_norm(0)', 31],
  ['_norm(-1)', 31],
  ['_lmbd(1, 0x00100000)', 11],
  ['_lmbd(0, 0xffff0000)', 16],
  ['_abs(-2147483647 - 1)', 0x7fffffff],
  ['_extu(0xabcd1234, 8, 24)', 0xcd],
  ['_ext(0x0000ff00, 16, 24)', 0xffffffff],
  ['_set(0, 4, 7)', 0xf0],
  ['_clr(0xff, 0, 3)', 0xf0],
  ['_hi(1.0)', 0x3ff00000],
  ['_lo(1.0)', 0],
  ['_smpy(0x8000, 0x8000)', 0x7fffffff],
  ['_smpy(0x4000, 0x4000)', 0x20000000],
  ['_swap4(0x11223344)', 0x22114433],
  ['_bitr(1)', 0x80000000],
  ['_rotl(0x80000001, 1)', 3],
  ['_bitc4(0xff0f0301)', 0x08040201],
  ['_deal(0xaaaaaaaa)', 0xffff0000],
  ['_shfl(0xffff0000)', 0xaaaaaaaa],
  ['_avgu4(0x02040608, 0x01010101)', 0x02030405],
  ['_packh4(0x11223344, 0x55667788)', 0x11335577],
  ['_packl4(0x11223344, 0x55667788)', 0x22446688],
  ['_cmpgt2(0x00050003, 0x00040004)', 2],
  ['_max2(0xfffe0005, 0x00010002)', 0x00010005],
  ['_saddu4(0xf0100000, 0x20200000)', 0xff300000],
  ['_spack2(70000, -70000)', 0x7fff8000],
  ['_subabs4(0x0510ff00, 0x0a0500ff)', 0x050bffff],
  ['_shr2(0x80000010, 4)', 0xf8000001],
  ['_mpy32(0x10000, 0x10000)', 0],
  ['_ftoi(1.0f)', 0x3f800000]
]

describe('C6000 intrinsics', () => {
  it('compute bit-exact results', () => {
    const lines = CASES.map(([e], i) => `    r[${i}] = (unsigned)(${e});`)
    const r = runC(`#include <c6x.h>\nunsigned r[${CASES.length}];\nlong long w[3];\ndouble d;\nint main(void)\n{\n${lines.join('\n')}\n    w[0] = _mpy32ll(-2, 3);\n    w[1] = _mpy2ll(0x00020003, 0x00040005);\n    w[2] = _itoll(1, 2);\n    d = _itod(0x40000000, 0);\n    return 0;\n}`)
    expect(r.result).toMatchObject({ status: 'exited' })
    const got = CASES.map((_, i) => r.m.mem.u32(r.g('r') + 4 * i))
    expect(Object.fromEntries(got.map((v, i) => [CASES[i][0], v]))).toEqual(Object.fromEntries(CASES.map(([e, v]) => [e, v >>> 0])))
    expect([0, 1, 2].map((i) => r.m.mem.i64(r.g('w') + 8 * i))).toEqual([-6n, (8n << 32n) + 15n, (1n << 32n) + 2n])
    expect(r.m.mem.f64(r.g('d'))).toBe(2)
  })

  it('refuses to load a program that uses an intrinsic LabSim cannot run exactly', () => {
    const { program, image } = build('#include <c6x.h>\nint main(void) { return _gmpy4(1, 2); }')
    expect(() => loadProgram(program, image, NO_IO)).toThrow('LabSim: unsupported construct _gmpy4()')
  })
})
```

```ts path=tests/unit/interp/runtime/library.test.ts
import { describe, expect, it } from 'vitest'
import { library } from '../../../../src/interp/frontend/program'
import { LIBRARY, UNSUPPORTED } from '../../../../src/interp/runtime/index'

describe('runtime library', () => {
  it('implements every function the built-in headers declare, or names it as unsupported', () => {
    const declared = [...library().functions]
    expect(declared.filter((f) => !(f in LIBRARY) && !UNSUPPORTED.has(f))).toEqual([])
    expect(Object.keys(LIBRARY).filter((f) => !library().functions.has(f))).toEqual([])
    expect([...UNSUPPORTED].every((f) => f.startsWith('_'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/interp/runtime/math.test.ts tests/unit/interp/runtime/c6x.test.ts tests/unit/interp/runtime/library.test.ts`
Expected: FAIL. `sqrt`, `gmtime` and `_dotp2` are not in the runtime library, and the library test lists every math, time and intrinsic name.

- [ ] **Step 3: Implement math.h**

```ts path=src/interp/runtime/math.ts
import type { Machine } from '../exec/machine'
import { f2big, f2i } from '../exec/scalar'
import { EDOM, ERANGE, setErrno } from './errno'
import { fn, type LibFunction } from './types'

interface Precision {
  round: (v: number) => number
  max: number
  min: number
  expMax: number
  expMin: number
  float: boolean
}

const D: Precision = { round: (v) => v, max: 1.7976931348623157e308, min: 2.2250738585072014e-308, expMax: 709.782712893384, expMin: -708.3964185322641, float: false }
const F: Precision = { round: Math.fround, max: 3.4028234663852886e38, min: 1.1754943508222875e-38, expMax: 88.72283935546875, expMin: -87.33654475055311, float: true }

/** C round(): halves away from zero. */
const cRound = (x: number): number => {
  const t = Math.trunc(x)
  return Math.abs(x - t) >= 0.5 ? t + Math.sign(x) : t
}

/** rint()/nearbyint(): halves to even. */
const rint = (x: number): number => {
  if (!Number.isFinite(x)) return x
  const f = Math.floor(x)
  const d = x - f
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1
  return r === 0 ? (x < 0 ? -0 : 0) : r
}

function ldexp(input: number, exp: number): number {
  let x = input
  let n = Math.max(-2200, Math.min(2200, exp))
  if (!Number.isFinite(x) || x === 0) return x
  while (n > 1023) {
    x *= 2 ** 1023
    n -= 1023
  }
  while (n < -1022) {
    x *= 2 ** -1022
    n += 1022
  }
  return x * 2 ** n
}

function frexp(x: number): [number, number] {
  if (x === 0 || !Number.isFinite(x)) return [x, 0]
  let e = Math.floor(Math.log2(Math.abs(x))) + 1
  let f = ldexp(x, -e)
  while (Math.abs(f) < 0.5) {
    f *= 2
    e--
  }
  while (Math.abs(f) >= 1) {
    f /= 2
    e++
  }
  return [f, e]
}

function nextafter(x: number, y: number, p: Precision): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (x === y) return y
  const dv = new DataView(new ArrayBuffer(8))
  if (x === 0) return y > 0 ? (p.float ? 1.401298464324817e-45 : 5e-324) : p.float ? -1.401298464324817e-45 : -5e-324
  const up = (y > x) === (x > 0)
  if (p.float) {
    dv.setFloat32(0, x)
    dv.setInt32(0, dv.getInt32(0) + (up ? 1 : -1))
    return dv.getFloat32(0)
  }
  dv.setFloat64(0, x)
  dv.setBigInt64(0, dv.getBigInt64(0) + (up ? 1n : -1n))
  return dv.getFloat64(0)
}

function erfcLarge(x: number): number {
  let f = x
  for (let k = 60; k >= 1; k--) f = x + k / 2 / f
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f
}

function erf(x: number): number {
  if (Number.isNaN(x)) return x
  const ax = Math.abs(x)
  if (ax >= 2.5) return Math.sign(x) * (1 - erfcLarge(ax))
  let sum = x
  let term = x
  for (let n = 1; n < 200; n++) {
    term *= (-x * x) / n
    const t = term / (2 * n + 1)
    sum += t
    if (Math.abs(t) < 1e-17 * Math.abs(sum)) break
  }
  return (2 / Math.sqrt(Math.PI)) * sum
}

function erfc(x: number): number {
  if (Number.isNaN(x)) return x
  if (x < 0) return 2 - erfc(-x)
  return x < 2.5 ? 1 - erf(x) : erfcLarge(x)
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]

function lanczosSum(x: number): number {
  let a = LANCZOS[0]
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i)
  return a
}

function tgamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * tgamma(1 - x))
  const y = x - 1
  const t = y + 7.5
  return Math.sqrt(2 * Math.PI) * t ** (y + 0.5) * Math.exp(-t) * lanczosSum(y)
}

function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x)
  const y = x - 1
  const t = y + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(lanczosSum(y))
}

function logTI(m: Machine, x: number): number {
  if (x <= 0) {
    setErrno(m, x === 0 ? ERANGE : EDOM)
    return -Infinity
  }
  return Math.log(x)
}

function expTI(m: Machine, x: number, p: Precision): number {
  if (x < p.expMin) return 0
  if (x === Infinity) return Infinity
  if (x > p.expMax) {
    setErrno(m, ERANGE)
    return Infinity
  }
  return Math.exp(x)
}

const isOdd = (y: number): boolean => (Math.abs(y) < 2147483648 ? (y & 1) !== 0 : (y / 2) % 1 !== 0)

function powTI(m: Machine, x: number, y: number, p: Precision): number {
  if (x <= 0) {
    if (x < 0) {
      if (Math.trunc(y) !== y) {
        setErrno(m, EDOM)
        return powTI(m, x, cRound(y), p)
      }
      const z = powTI(m, -x, y, p)
      return isOdd(y) ? -z : z
    }
    if (y < 0) {
      setErrno(m, EDOM)
      return -p.max
    }
    return y === 0 ? 1 : x
  }
  if (x === 1 || y === 1) return x
  const r = Math.pow(x, y)
  if (r > p.max) {
    setErrno(m, ERANGE)
    return p.max
  }
  return r < p.min ? 0 : r
}

function atan2TI(m: Machine, y: number, x: number): number {
  let r: number
  if (x === 0) {
    if (y === 0) {
      setErrno(m, EDOM)
      return 0
    }
    r = Math.PI / 2
  } else {
    r = Math.atan(Math.abs(y / x))
    if (x < 0) r = Math.PI - r
  }
  return y < 0 ? -r : r
}

function classify(x: number, p: Precision): number {
  if (Number.isNaN(x)) return 2
  if (!Number.isFinite(x)) return 1
  if (x === 0) return 4
  return Math.abs(x) < p.min ? 5 : 3
}

const table: Record<string, LibFunction> = {}

/** Registers `name` (double) and `name` + 'f' (float, result rounded to single precision). */
function both(name: string, fixed: number, f: (m: Machine, a: any[], p: Precision) => any): void {
  table[name] = fn(fixed, (m, a) => f(m, a, D))
  table[`${name}f`] = fn(fixed, (m, a) => {
    const r = f(m, a, F)
    return typeof r === 'number' ? Math.fround(r) : r
  })
}

const unary = (name: string, f: (m: Machine, x: number, p: Precision) => number): void => both(name, 1, (m, [x], p) => f(m, x, p))
const binary = (name: string, f: (m: Machine, x: number, y: number, p: Precision) => number): void => both(name, 2, (m, [x, y], p) => f(m, x, y, p))

unary('sqrt', (m, x) => {
  if (x === Infinity || x === -Infinity) return x
  if (x <= 0) {
    if (x === 0) return 0
    setErrno(m, EDOM)
    return 0
  }
  return Math.sqrt(x)
})
unary('log', (m, x) => logTI(m, x))
unary('log10', (m, x) => (logTI(m, x) === -Infinity ? -Infinity : Math.log10(x)))
unary('log2', (m, x) => (logTI(m, x) === -Infinity ? -Infinity : Math.log2(x)))
unary('exp', (m, x, p) => expTI(m, x, p))
unary('exp2', (m, x, p) => expTI(m, x * Math.LN2, p))
unary('asin', (m, x) => {
  if (x > 1 || x < -1) {
    setErrno(m, EDOM)
    return Math.asin(x > 0 ? 1 : -1)
  }
  return Math.asin(x)
})
unary('acos', (m, x) => {
  if (x > 1 || x < -1) {
    setErrno(m, EDOM)
    return Math.acos(x > 0 ? 1 : -1)
  }
  return Math.acos(x)
})
unary('cosh', (m, x, p) => {
  const r = Math.cosh(x)
  if (r > p.max) {
    setErrno(m, EDOM)
    return x < 0 ? -Infinity : Infinity
  }
  return r
})
unary('sinh', (m, x, p) => {
  const r = Math.sinh(x)
  if (Math.abs(r) > p.max) setErrno(m, EDOM)
  return r
})
for (const [name, f] of Object.entries({
  sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, tanh: Math.tanh, ceil: Math.ceil, floor: Math.floor,
  fabs: Math.abs, acosh: Math.acosh, asinh: Math.asinh, atanh: Math.atanh, cbrt: Math.cbrt, expm1: Math.expm1,
  log1p: Math.log1p, trunc: Math.trunc, round: cRound, rint, nearbyint: rint, erf, erfc, tgamma, lgamma
})) unary(name, (_m, x) => f(x))
unary('logb', (_m, x) => (x === 0 ? -Infinity : !Number.isFinite(x) ? Math.abs(x) : frexp(x)[1] - 1))
binary('pow', (m, x, y, p) => powTI(m, x, y, p))
binary('atan2', (m, y, x) => atan2TI(m, y, x))
binary('fmod', (m, x, y) => {
  if (y === 0) {
    setErrno(m, EDOM)
    return 0
  }
  return x % y
})
binary('copysign', (_m, x, y) => (Object.is(y, -0) || y < 0 ? -Math.abs(x) : Math.abs(x)))
binary('fdim', (_m, x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : x > y ? x - y : 0))
binary('fmax', (_m, x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.max(x, y)))
binary('fmin', (_m, x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y)))
binary('hypot', (_m, x, y) => Math.hypot(x, y))
binary('nextafter', (_m, x, y, p) => nextafter(x, y, p))
binary('remainder', (_m, x, y) => x - y * rint(x / y))
both('fma', 3, (_m, [x, y, z]) => x * y + z)
both('frexp', 2, (m, [x, e]) => {
  const [f, n] = frexp(x)
  m.mem.set32(e, n)
  return f
})
both('ldexp', 2, (_m, [x, n]) => ldexp(x, n))
both('scalbn', 2, (_m, [x, n]) => ldexp(x, n))
both('scalbln', 2, (_m, [x, n]) => ldexp(x, n))
both('modf', 2, (m, [x, ip], p) => {
  const t = Math.trunc(x)
  if (p.float) m.mem.setF32(ip, t)
  else m.mem.setF64(ip, t)
  return Number.isFinite(x) ? x - t : x === x ? 0 : x
})
both('remquo', 3, (m, [x, y, quo]) => {
  const n = rint(x / y)
  m.mem.set32(quo, Number.isFinite(n) ? (Math.abs(n) % 8) * Math.sign(n) : 0)
  return x - y * n
})
both('nan', 1, () => NaN)
both('ilogb', 1, (_m, [x]) => (x === 0 || Number.isNaN(x) ? -2147483648 : !Number.isFinite(x) ? 2147483647 : frexp(x)[1] - 1))
both('lrint', 1, (_m, [x]) => f2i(rint(x)))
both('lround', 1, (_m, [x]) => f2i(cRound(x)))
both('llrint', 1, (_m, [x]) => f2big(rint(x), 64, true))
both('llround', 1, (_m, [x]) => f2big(cRound(x), 64, true))
both('__signbit', 1, (_m, [x]) => (x < 0 || Object.is(x, -0) ? 1 : 0))
for (const suffix of ['', 'f', 'l']) {
  const p = suffix === 'f' ? F : D
  table[`__fpclassify${suffix}`] = fn(1, (_m, [x]) => classify(x, p))
  table[`__isfinite${suffix}`] = fn(1, (_m, [x]) => (Number.isFinite(x) ? 1 : 0))
  table[`__isinf${suffix}`] = fn(1, (_m, [x]) => (x === Infinity || x === -Infinity ? 1 : 0))
  table[`__isnan${suffix}`] = fn(1, (_m, [x]) => (Number.isNaN(x) ? 1 : 0))
  table[`__isnormal${suffix}`] = fn(1, (_m, [x]) => (classify(x, p) === 3 ? 1 : 0))
}

export const MATH: Readonly<Record<string, LibFunction>> = table
```

- [ ] **Step 4: Implement time.h**

```ts path=src/interp/runtime/time.ts
import type { Machine } from '../exec/machine'
import { CYCLES_PER_STATEMENT } from '../exec/machine'
import { fn, state, type LibFunction } from './types'

/** Seconds between 1900-01-01 (TI's time_t epoch) and 1970-01-01. */
const EPOCH_1900 = 2208988800
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The static buffers gmtime/localtime and asctime/ctime return. */
const buffers = state((m) => ({ tm: m.placement.alloc(36, 4), text: m.placement.alloc(32, 1) }))

interface Tm {
  sec: number
  min: number
  hour: number
  mday: number
  mon: number
  year: number
  wday: number
  yday: number
  isdst: number
}

function readTm(m: Machine, p: number): Tm {
  const f = (i: number): number => m.mem.i32(p + 4 * i)
  return { sec: f(0), min: f(1), hour: f(2), mday: f(3), mon: f(4), year: f(5), wday: f(6), yday: f(7), isdst: f(8) }
}

function writeTm(m: Machine, p: number, t: Tm): void {
  ;[t.sec, t.min, t.hour, t.mday, t.mon, t.year, t.wday, t.yday, t.isdst].forEach((v, i) => m.mem.set32(p + 4 * i, v))
}

function toTm(t: number): Tm {
  const d = new Date(((t >>> 0) - EPOCH_1900) * 1000)
  const start = Date.UTC(d.getUTCFullYear(), 0, 1)
  return {
    sec: d.getUTCSeconds(),
    min: d.getUTCMinutes(),
    hour: d.getUTCHours(),
    mday: d.getUTCDate(),
    mon: d.getUTCMonth(),
    year: d.getUTCFullYear() - 1900,
    wday: d.getUTCDay(),
    yday: Math.floor((d.getTime() - start) / 86400000),
    isdst: 0
  }
}

const two = (n: number): string => String(n).padStart(2, '0')

function asctime(t: Tm): string {
  return `${DAYS[t.wday] ?? '???'} ${MONTHS[t.mon] ?? '???'} ${String(t.mday).padStart(2, ' ')} ${two(t.hour)}:${two(t.min)}:${two(t.sec)} ${t.year + 1900}\n`
}

function strftime(fmt: string, t: Tm): string {
  return fmt.replace(/%(.)/g, (all, c: string) => {
    switch (c) {
      case 'a': return DAYS[t.wday] ?? ''
      case 'A': return FULL_DAYS[t.wday] ?? ''
      case 'b': return MONTHS[t.mon] ?? ''
      case 'B': return FULL_MONTHS[t.mon] ?? ''
      case 'c': return asctime(t).slice(0, -1)
      case 'd': return two(t.mday)
      case 'H': return two(t.hour)
      case 'I': return two(t.hour % 12 === 0 ? 12 : t.hour % 12)
      case 'j': return String(t.yday + 1).padStart(3, '0')
      case 'm': return two(t.mon + 1)
      case 'M': return two(t.min)
      case 'p': return t.hour < 12 ? 'AM' : 'PM'
      case 'S': return two(t.sec)
      case 'w': return String(t.wday)
      case 'x': return `${two(t.mon + 1)}/${two(t.mday)}/${two(t.year % 100)}`
      case 'X': return `${two(t.hour)}:${two(t.min)}:${two(t.sec)}`
      case 'y': return two(t.year % 100)
      case 'Y': return String(t.year + 1900)
      case 'Z': return 'GMT'
      case '%': return '%'
      default: return all
    }
  })
}

function writeString(m: Machine, p: number, s: string): void {
  m.mem.write(p, [...s].map((c) => c.charCodeAt(0) & 0xff))
  m.mem.set8(p + s.length, 0)
}

function convert(m: Machine, tp: number): number {
  if (tp === 0) return 0
  const b = buffers(m)
  writeTm(m, b.tm, toTm(m.mem.u32(tp)))
  return b.tm
}

export const TIME: Record<string, LibFunction> = {
  clock: fn(0, (m) => {
    m.note('clock', `clock() gives an estimated cycle count (${CYCLES_PER_STATEMENT} cycles per C statement), not the C674x's real timing.`)
    return m.cycles >>> 0
  }),
  time: fn(1, (m, [tp]) => {
    const t = (Math.floor(Date.now() / 1000) + EPOCH_1900) >>> 0
    if (tp !== 0) m.mem.set32(tp, t)
    return t
  }),
  difftime: fn(2, (_m, [a, b]) => (a >>> 0) - (b >>> 0)),
  gmtime: fn(1, (m, [tp]) => convert(m, tp)),
  localtime: fn(1, (m, [tp]) => convert(m, tp)),
  mktime: fn(1, (m, [p]) => {
    const t = readTm(m, p)
    const ms = Date.UTC(t.year + 1900, t.mon, t.mday, t.hour, t.min, t.sec)
    const secs = (Math.floor(ms / 1000) + EPOCH_1900) >>> 0
    writeTm(m, p, toTm(secs))
    return secs
  }),
  asctime: fn(1, (m, [p]) => {
    const b = buffers(m)
    writeString(m, b.text, asctime(readTm(m, p)))
    return b.text
  }),
  ctime: fn(1, (m, [tp]) => {
    const b = buffers(m)
    writeString(m, b.text, asctime(toTm(m.mem.u32(tp))))
    return b.text
  }),
  strftime: fn(4, (m, [buf, max, fmt, p]) => {
    const s = strftime(m.mem.cstring(fmt), readTm(m, p))
    if (s.length + 1 > max >>> 0) return 0
    writeString(m, buf, s)
    return s.length
  })
}
```

- [ ] **Step 5: Implement the intrinsics**

```ts path=src/interp/runtime/c6x.ts
import { fn, type LibFunction } from './types'

const s16 = (x: number): number => (x << 16) >> 16
const u16 = (x: number): number => x & 0xffff
const h16 = (x: number): number => x >> 16
const uh16 = (x: number): number => x >>> 16
const ubyte = (x: number, i: number): number => (x >>> (8 * i)) & 0xff
const sbyte = (x: number, i: number): number => (x << (24 - 8 * i)) >> 24
const sat32 = (v: number): number => (v > 2147483647 ? 2147483647 : v < -2147483648 ? -2147483648 : v)
const sat16 = (v: number): number => (v > 32767 ? 32767 : v < -32768 ? -32768 : v)
const clampU = (v: number, max: number): number => (v > max ? max : v < 0 ? 0 : v)
const pack = (hi: number, lo: number): number => (((hi & 0xffff) << 16) | (lo & 0xffff)) >>> 0
const bytes = (b3: number, b2: number, b1: number, b0: number): number => (((b3 & 0xff) << 24) | ((b2 & 0xff) << 16) | ((b1 & 0xff) << 8) | (b0 & 0xff)) >>> 0
const perByte = (a: number, b: number, f: (x: number, y: number) => number): number =>
  bytes(f(ubyte(a, 3), ubyte(b, 3)), f(ubyte(a, 2), ubyte(b, 2)), f(ubyte(a, 1), ubyte(b, 1)), f(ubyte(a, 0), ubyte(b, 0)))
const ll = (hi: number, lo: number): bigint => BigInt.asIntN(64, (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0))
const bits = (lo: number, hi: number): number[] => {
  const out: number[] = []
  for (let b = lo & 31; b <= (hi & 31); b++) out.push(b)
  return out
}
const mask = (a: number, b: number): number => bits(a, b).reduce((m, k) => m | (1 << k), 0)
const smpy = (x: number, y: number): number => {
  const p = x * y * 2
  return p === 0x80000000 ? 0x7fffffff : p | 0
}
const sat40 = (v: bigint): bigint => (v > (1n << 39n) - 1n ? (1n << 39n) - 1n : v < -(1n << 39n) ? -(1n << 39n) : v)
const dv = new DataView(new ArrayBuffer(8))
const doubleBits = (d: number): [number, number] => {
  dv.setFloat64(0, d, true)
  return [dv.getUint32(4, true), dv.getUint32(0, true)]
}
const fromBits = (hi: number, lo: number): number => {
  dv.setUint32(4, hi >>> 0, true)
  dv.setUint32(0, lo >>> 0, true)
  return dv.getFloat64(0, true)
}
const floatBits = (f: number): number => {
  dv.setFloat32(0, f, true)
  return dv.getUint32(0, true)
}
const bitsFloat = (u: number): number => {
  dv.setUint32(0, u >>> 0, true)
  return dv.getFloat32(0, true)
}
/** SPINT/DPINT: round to nearest (even), saturate, NaN gives 0x80000000. */
const toIntRounded = (v: number): number => {
  if (v !== v) return -2147483648
  const f = Math.floor(v)
  const d = v - f
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1
  return sat32(r) | 0
}
const shiftSat = (x: number, n: number): number => (n <= 0 ? x >> Math.min(-n, 31) : sat32(x * 2 ** Math.min(n, 31)) | 0)
const add2 = (a: number, b: number): number => pack(h16(a) + h16(b), a + b) | 0
const sub2 = (a: number, b: number): number => pack(h16(a) - h16(b), a - b) | 0
const sadd2 = (a: number, b: number): number => pack(sat16(h16(a) + h16(b)), sat16(s16(a) + s16(b))) | 0
const ssub2 = (a: number, b: number): number => pack(sat16(h16(a) - h16(b)), sat16(s16(a) - s16(b))) | 0
const packh2 = (a: number, b: number): number => ((a & 0xffff0000) | (b >>> 16)) >>> 0
const pack2 = (a: number, b: number): number => pack(a, b)

type Impl = (...a: any[]) => any
const i = (arity: number, f: Impl): LibFunction => fn(arity, (_m, a) => f(...a))

export const INTRINSICS: Record<string, LibFunction> = {
  _extu: i(3, (s, a, b) => ((s << (a & 31)) >>> (b & 31)) >>> 0),
  _ext: i(3, (s, a, b) => (s << (a & 31)) >> (b & 31)),
  _set: i(3, (s, a, b) => (s | mask(a, b)) >>> 0),
  _clr: i(3, (s, a, b) => (s & ~mask(a, b)) >>> 0),
  _extur: i(2, (s, r) => ((s << ((r >> 5) & 31)) >>> (r & 31)) >>> 0),
  _extr: i(2, (s, r) => (s << ((r >> 5) & 31)) >> (r & 31)),
  _setr: i(2, (s, r) => (s | mask((r >> 5) & 31, r & 31)) >>> 0),
  _clrr: i(2, (s, r) => (s & ~mask((r >> 5) & 31, r & 31)) >>> 0),
  _sadd: i(2, (a, b) => sat32(a + b) | 0),
  _ssub: i(2, (a, b) => sat32(a - b) | 0),
  _sshl: i(2, (a, n) => shiftSat(a, Math.min(n >>> 0, 31))),
  _add2: i(2, add2),
  _sub2: i(2, sub2),
  _subc: i(2, (a, b) => {
    const d = a - b
    return (d >= 0 ? d * 2 + 1 : a * 2) >>> 0
  }),
  _lmbd: i(2, (a, b) => Math.clz32(a & 1 ? b : ~b)),
  _abs: i(1, (x) => (x === -2147483648 ? 2147483647 : Math.abs(x))),
  _labs: i(1, (x: bigint) => sat40(x < 0n ? -x : x)),
  _norm: i(1, (x) => (x === 0 || x === -1 ? 31 : Math.clz32(x ^ (x >> 31)) - 1)),
  _lnorm: i(1, (x: bigint) => {
    if (x === 0n || x === -1n) return 39
    const v = x < 0n ? ~x : x
    return 39 - v.toString(2).length
  }),
  _smpy: i(2, (a, b) => smpy(s16(a), s16(b))),
  _smpyhl: i(2, (a, b) => smpy(h16(a), s16(b))),
  _smpylh: i(2, (a, b) => smpy(s16(a), h16(b))),
  _smpyh: i(2, (a, b) => smpy(h16(a), h16(b))),
  _mpy: i(2, (a, b) => s16(a) * s16(b)),
  _mpyus: i(2, (a, b) => u16(a) * s16(b)),
  _mpysu: i(2, (a, b) => s16(a) * u16(b)),
  _mpyu: i(2, (a, b) => (u16(a) * u16(b)) >>> 0),
  _mpyhl: i(2, (a, b) => h16(a) * s16(b)),
  _mpyhuls: i(2, (a, b) => uh16(a) * s16(b)),
  _mpyhslu: i(2, (a, b) => h16(a) * u16(b)),
  _mpyhlu: i(2, (a, b) => (uh16(a) * u16(b)) >>> 0),
  _mpylh: i(2, (a, b) => s16(a) * h16(b)),
  _mpyluhs: i(2, (a, b) => u16(a) * h16(b)),
  _mpylshu: i(2, (a, b) => s16(a) * uh16(b)),
  _mpylhu: i(2, (a, b) => (u16(a) * uh16(b)) >>> 0),
  _mpyh: i(2, (a, b) => h16(a) * h16(b)),
  _mpyhus: i(2, (a, b) => uh16(a) * h16(b)),
  _mpyhsu: i(2, (a, b) => h16(a) * uh16(b)),
  _mpyhu: i(2, (a, b) => (uh16(a) * uh16(b)) >>> 0),
  _lsadd: i(2, (a, b: bigint) => sat40(BigInt(a) + b)),
  _lssub: i(2, (a, b: bigint) => sat40(BigInt(a) - b)),
  _sat: i(1, (x: bigint) => (x > 2147483647n ? 2147483647 : x < -2147483648n ? -2147483648 : Number(x))),
  _fabs: i(1, Math.abs),
  _fabsf: i(1, Math.abs),
  _mpyidll: i(2, (a, b) => BigInt(a) * BigInt(b)),
  _spint: i(1, toIntRounded),
  _dpint: i(1, toIntRounded),
  _hi: i(1, (d) => doubleBits(d)[0]),
  _lo: i(1, (d) => doubleBits(d)[1]),
  _hif: i(1, (d) => bitsFloat(doubleBits(d)[0])),
  _lof: i(1, (d) => bitsFloat(doubleBits(d)[1])),
  _hill: i(1, (x: bigint) => Number(BigInt.asUintN(64, x) >> 32n)),
  _loll: i(1, (x: bigint) => Number(BigInt.asUintN(32, x))),
  _itod: i(2, (hi, lo) => fromBits(hi, lo)),
  _ftod: i(2, (hi, lo) => fromBits(floatBits(hi), floatBits(lo))),
  _itoll: i(2, (hi, lo) => ll(hi, lo)),
  _itof: i(1, (u) => bitsFloat(u)),
  _ftoi: i(1, (f) => floatBits(f)),
  _dtoll: i(1, (d) => {
    const [hi, lo] = doubleBits(d)
    return ll(hi, lo)
  }),
  _lltod: i(1, (x: bigint) => fromBits(Number(BigInt.asUintN(64, x) >> 32n), Number(BigInt.asUintN(32, x)))),
  _add4: i(2, (a, b) => perByte(a, b, (x, y) => x + y) | 0),
  _sub4: i(2, (a, b) => perByte(a, b, (x, y) => x - y) | 0),
  _avg2: i(2, (a, b) => pack((h16(a) + h16(b) + 1) >> 1, (s16(a) + s16(b) + 1) >> 1) | 0),
  _avgu4: i(2, (a, b) => perByte(a, b, (x, y) => (x + y + 1) >> 1)),
  _cmpeq2: i(2, (a, b) => (h16(a) === h16(b) ? 2 : 0) | (s16(a) === s16(b) ? 1 : 0)),
  _cmpeq4: i(2, (a, b) => [0, 1, 2, 3].reduce((m, k) => m | (ubyte(a, k) === ubyte(b, k) ? 1 << k : 0), 0)),
  _cmpgt2: i(2, (a, b) => (h16(a) > h16(b) ? 2 : 0) | (s16(a) > s16(b) ? 1 : 0)),
  _cmpgtu4: i(2, (a, b) => [0, 1, 2, 3].reduce((m, k) => m | (ubyte(a, k) > ubyte(b, k) ? 1 << k : 0), 0)),
  _dotp2: i(2, (a, b) => (s16(a) * s16(b) + h16(a) * h16(b)) | 0),
  _dotpn2: i(2, (a, b) => (h16(a) * h16(b) - s16(a) * s16(b)) | 0),
  _dotpnrsu2: i(2, (a, b) => Math.floor((h16(a) * uh16(b) - s16(a) * u16(b) + 0x8000) / 65536) | 0),
  _dotprsu2: i(2, (a, b) => Math.floor((h16(a) * uh16(b) + s16(a) * u16(b) + 0x8000) / 65536) | 0),
  _dotpsu4: i(2, (a, b) => [0, 1, 2, 3].reduce((s, k) => s + sbyte(a, k) * ubyte(b, k), 0) | 0),
  _dotpu4: i(2, (a, b) => [0, 1, 2, 3].reduce((s, k) => s + ubyte(a, k) * ubyte(b, k), 0) >>> 0),
  _ldotp2: i(2, (a, b) => BigInt(s16(a) * s16(b) + h16(a) * h16(b))),
  _max2: i(2, (a, b) => pack(Math.max(h16(a), h16(b)), Math.max(s16(a), s16(b))) | 0),
  _min2: i(2, (a, b) => pack(Math.min(h16(a), h16(b)), Math.min(s16(a), s16(b))) | 0),
  _maxu4: i(2, (a, b) => perByte(a, b, Math.max)),
  _minu4: i(2, (a, b) => perByte(a, b, Math.min)),
  _mpy2ll: i(2, (a, b) => ll(h16(a) * h16(b), s16(a) * s16(b))),
  _mpyhill: i(2, (a, b) => BigInt(h16(a)) * BigInt(b)),
  _mpylill: i(2, (a, b) => BigInt(s16(a)) * BigInt(b)),
  _mpyhir: i(2, (a, b) => Number((BigInt(h16(a)) * BigInt(b) + 0x4000n) >> 15n) | 0),
  _mpylir: i(2, (a, b) => Number((BigInt(s16(a)) * BigInt(b) + 0x4000n) >> 15n) | 0),
  _mpysu4ll: i(2, (a, b) => {
    const p = [0, 1, 2, 3].map((k) => sbyte(a, k) * ubyte(b, k))
    return ll(pack(p[3], p[2]), pack(p[1], p[0]))
  }),
  _mpyu4ll: i(2, (a, b) => {
    const p = [0, 1, 2, 3].map((k) => ubyte(a, k) * ubyte(b, k))
    return ll(pack(p[3], p[2]), pack(p[1], p[0]))
  }),
  _pack2: i(2, pack2),
  _packh2: i(2, packh2),
  _packhl2: i(2, (a, b) => ((a & 0xffff0000) | (b & 0xffff)) >>> 0),
  _packlh2: i(2, (a, b) => (((a & 0xffff) << 16) | (b >>> 16)) >>> 0),
  _packh4: i(2, (a, b) => bytes(ubyte(a, 3), ubyte(a, 1), ubyte(b, 3), ubyte(b, 1))),
  _packl4: i(2, (a, b) => bytes(ubyte(a, 2), ubyte(a, 0), ubyte(b, 2), ubyte(b, 0))),
  _rotl: i(2, (a, n) => {
    const k = n & 31
    return k === 0 ? a >>> 0 : ((a << k) | (a >>> (32 - k))) >>> 0
  }),
  _sadd2: i(2, sadd2),
  _saddu4: i(2, (a, b) => perByte(a, b, (x, y) => clampU(x + y, 255))),
  _saddus2: i(2, (a, b) => pack(clampU(uh16(a) + h16(b), 65535), clampU(u16(a) + s16(b), 65535)) | 0),
  _shlmb: i(2, (a, b) => ((b << 8) | (a >>> 24)) >>> 0),
  _shrmb: i(2, (a, b) => ((b >>> 8) | ((a & 0xff) << 24)) >>> 0),
  _shr2: i(2, (a, n) => pack(h16(a) >> Math.min(n & 31, 15), s16(a) >> Math.min(n & 31, 15)) | 0),
  _shru2: i(2, (a, n) => ((n & 31) >= 16 ? 0 : pack(uh16(a) >>> (n & 31), u16(a) >>> (n & 31)))),
  _smpy2ll: i(2, (a, b) => ll(smpy(h16(a), h16(b)), smpy(s16(a), s16(b)))),
  _spack2: i(2, (a, b) => pack(sat16(a), sat16(b)) | 0),
  _spacku4: i(2, (a, b) => bytes(clampU(h16(a), 255), clampU(s16(a), 255), clampU(h16(b), 255), clampU(s16(b), 255))),
  _sshvl: i(2, (a, n) => shiftSat(a, Math.max(-31, Math.min(31, n)))),
  _sshvr: i(2, (a, n) => shiftSat(a, -Math.max(-31, Math.min(31, n)))),
  _subabs4: i(2, (a, b) => perByte(a, b, (x, y) => Math.abs(x - y))),
  _abs2: i(1, (a) => pack(sat16(Math.abs(h16(a))), sat16(Math.abs(s16(a)))) | 0),
  _bitc4: i(1, (a) => perByte(a, 0, (x) => x.toString(2).split('1').length - 1)),
  _bitr: i(1, (a) => {
    let r = 0
    for (let k = 0; k < 32; k++) if (a & (1 << k)) r |= 1 << (31 - k)
    return r >>> 0
  }),
  _deal: i(1, (a) => {
    let r = 0
    for (let k = 0; k < 16; k++) {
      if (a & (1 << (2 * k))) r |= 1 << k
      if (a & (1 << (2 * k + 1))) r |= 1 << (16 + k)
    }
    return r >>> 0
  }),
  _shfl: i(1, (a) => {
    let r = 0
    for (let k = 0; k < 16; k++) {
      if (a & (1 << k)) r |= 1 << (2 * k)
      if (a & (1 << (16 + k))) r |= 1 << (2 * k + 1)
    }
    return r >>> 0
  }),
  _mvd: i(1, (a) => a),
  _swap4: i(1, (a) => (((a & 0x00ff00ff) << 8) | ((a >>> 8) & 0x00ff00ff)) >>> 0),
  _unpkhu4: i(1, (a) => (((a >>> 24) << 16) | ((a >>> 16) & 0xff)) >>> 0),
  _unpklu4: i(1, (a) => ((((a >>> 8) & 0xff) << 16) | (a & 0xff)) >>> 0),
  _xpnd2: i(1, (a) => ((a & 2 ? 0xffff0000 : 0) | (a & 1 ? 0xffff : 0)) >>> 0),
  _xpnd4: i(1, (a) => bytes(a & 8 ? 0xff : 0, a & 4 ? 0xff : 0, a & 2 ? 0xff : 0, a & 1 ? 0xff : 0)),
  _addsub: i(2, (a, b) => ll((a + b) | 0, (a - b) | 0)),
  _addsub2: i(2, (a, b) => ll(add2(a, b), sub2(a, b))),
  _saddsub: i(2, (a, b) => ll(sat32(a + b), sat32(a - b))),
  _saddsub2: i(2, (a, b) => ll(sadd2(a, b), ssub2(a, b))),
  _dpack2: i(2, (a, b) => ll(packh2(a, b), pack2(a, b))),
  _dmv: i(2, (a, b) => ll(a, b)),
  _fdmv: i(2, (a, b) => fromBits(floatBits(a), floatBits(b))),
  _mpy32ll: i(2, (a, b) => BigInt(a) * BigInt(b)),
  _mpy32: i(2, (a, b) => Math.imul(a, b)),
  _mpy32su: i(2, (a, b) => BigInt(a) * BigInt(b >>> 0)),
  _mpy32us: i(2, (a, b) => BigInt(a >>> 0) * BigInt(b)),
  _mpy32u: i(2, (a, b) => BigInt.asIntN(64, BigInt(a >>> 0) * BigInt(b >>> 0))),
  _smpy32: i(2, (a, b) => {
    const p = BigInt(a) * BigInt(b) * 2n
    return p > (1n << 63n) - 1n ? 0x7fffffff : Number(p >> 32n) | 0
  }),
  _ssub2: i(2, ssub2),
  _nassert: i(1, () => undefined)
}

/** Intrinsics whose exact C674x results LabSim cannot guarantee (Galois-field, complex and reciprocal-estimate
 * instructions): a program that uses one does not load, rather than getting a plausible but wrong value. */
export const UNSUPPORTED_INTRINSICS: ReadonlySet<string> = new Set([
  '_gmpy4', '_gmpy', '_xormpy', '_ddotph2', '_ddotph2r', '_ddotpl2', '_ddotpl2r', '_ddotp4', '_dpackx2', '_shfl3',
  '_mpy2ir', '_cmpy', '_cmpyr', '_cmpyr1', '_rpack2', '_rcpsp', '_rcpdp', '_rsqrsp', '_rsqrdp', '_dtol', '_ltod'
])
```

- [ ] **Step 6: Register everything**

Replace `src/interp/runtime/index.ts` with:

```ts path=src/interp/runtime/index.ts
import type { Machine } from '../exec/machine'
import { INTRINSICS, UNSUPPORTED_INTRINSICS } from './c6x'
import { MATH } from './math'
import { PRINTF } from './printf'
import { STDIO, stdio } from './stdio'
import { STDLIB } from './stdlib'
import { STRING } from './string'
import { TIME } from './time'
import type { LibFunction } from './types'

/** Every library function LabSim implements, by name. */
export const LIBRARY: Readonly<Record<string, LibFunction>> = { ...STDLIB, ...STRING, ...PRINTF, ...STDIO, ...MATH, ...TIME, ...INTRINSICS }

/** Library functions LabSim declares but cannot run yet: a program that calls one does not load. */
export const UNSUPPORTED: ReadonlySet<string> = UNSUPPORTED_INTRINSICS

/** Run-time library start-up (what the RTS boot code sets up before main): the stdio FILE table. */
export function initRuntime(m: Machine): void {
  stdio(m)
}
```

In `src/interp/run.ts`, change the load error for an unsupported library function so that intrinsics read naturally. Replace:

```ts
    if (!lib || UNSUPPORTED.has(f.name)) {
      throw new LoadError(`LabSim: unsupported construct ${f.name}() (not in LabSim's runtime library yet)`, at)
    }
```

with:

```ts
    if (UNSUPPORTED.has(f.name)) throw new LoadError(`LabSim: unsupported construct ${f.name}() (LabSim cannot reproduce this intrinsic exactly yet)`, at)
    if (!lib) throw new LoadError(`LabSim: unsupported construct ${f.name}() (not in LabSim's runtime library yet)`, at)
```

- [ ] **Step 7: Run all interpreter tests and the typecheck**

Run: `npx vitest run tests/unit/interp && npm run typecheck`
Expected: everything passes: math (3 tests), c6x (2) and library (1), plus all the earlier suites. There are no type errors.

If the library test lists names, a header declares a function that no module implements. Implement it in the matching module rather than adding it to `UNSUPPORTED`, which is only for the intrinsics above.

- [ ] **Step 8: Commit**

```bash
git add src/interp tests/unit/interp/runtime
git commit -m "feat(interp): math.h with TI edge behaviour, time.h and bit-exact C6000 intrinsics"
```

---
### Task 10: `labsim run` CLI, corpus goldens and the cross-check

**Files:**
- Create: `src/cli/defaultCmd.ts`, `src/cli/prepare.ts`, `src/cli/labsim.ts`, `vite.cli.config.ts`
- Modify: `package.json` (the `labsim` script), `tsconfig.node.json` (include `src/cli`)
- Create: `tests/unit/cli/prepare.test.ts`, `tests/unit/interp/run-corpus.test.ts`, `tests/fixtures/golden/*.txt` (generated)
- Create: `scripts/golden-check/compare.py`, `dft_8_m.py`, `exp11.py`, `linear_disc_conv.py`, `fir_lowpass.py`
- Modify: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`

**Interfaces:**
- Consumes:
  - the run API (Task 5) and `nodeHostFiles` (Task 8);
  - `findSources`, `readBuildConfig`, `defaultConfig`, `frontendOptions`, `renderDiagnostic`, `FALLBACK_CGT`, `layoutProgram` and `parseLinkerCommandFile` (Step 2/3 build modules, all Electron-free).
- Produces:
  - `prepare(target, {rewrite?}) → {ok:true, program, image, dir} | {ok:false, messages, dir}`
  - `DEFAULT_CMD`
  - the CLI `npm run labsim -- run <project | file.c> [--input file] [--max-steps n] [--stats]`
  - one golden transcript per corpus program.

A golden transcript is the program's stdout, followed by any stderr and LabSim notes, and ends with one status line:
- `--- exit N`
- `--- abort`
- `--- halted: <message> at <file>:<line>`
- `--- does not build`, followed by the cl6x-style errors.

The goldens are generated once, then checked against Python transcriptions of four programs' arithmetic, as was done for Exp 5.

- [ ] **Step 1: Write the failing test for `prepare`**

```ts path=tests/unit/cli/prepare.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { prepare } from '../../../src/cli/prepare'
import { captureIO, loadProgram, runProgram } from '../../../src/interp/run'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'labsim-cli-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function run(target: string, rewrite?: (f: string, t: string) => string): Promise<string> {
  const p = await prepare(target, { rewrite })
  if (!p.ok) throw new Error(p.messages.join('\n'))
  const cap = captureIO()
  runProgram(loadProgram(p.program, p.image, cap.io))
  return cap.stdout()
}

describe('prepare', () => {
  it('builds a single .c file with the default C6748 memory map', async () => {
    writeFileSync(join(dir, 'solo.c'), '#include <stdio.h>\nfloat y[4];\nint main(void) { printf("%d\\n", 7); return 0; }\n')
    const p = await prepare(join(dir, 'solo.c'))
    expect(p.ok && p.image.globals.y.addr).toBeGreaterThanOrEqual(0x80000000)
    expect(await run(join(dir, 'solo.c'))).toBe('7\n')
  })
  it("builds a project folder with its own .cmd", async () => {
    writeFileSync(join(dir, 'main.c'), '#include <stdio.h>\n#include "coef.h"\nint main(void) { printf("%d\\n", K); return 0; }\n')
    writeFileSync(join(dir, 'coef.h'), '#define K 42\n')
    copyFileSync(join(__dirname, '../../fixtures/ccs/C6748.cmd'), join(dir, 'C6748.cmd'))
    expect(await run(dir)).toBe('42\n')
  })
  it('reports compile errors like cl6x', async () => {
    writeFileSync(join(dir, 'main.c'), 'int main(void)\n{\n    return x;\n}\n')
    const p = await prepare(dir)
    expect(p.ok).toBe(false)
    expect(!p.ok && p.messages).toEqual(['"main.c", line 3: error #20: identifier "x" is undefined'])
  })
  it('applies a rewrite to the sources in memory only', async () => {
    const file = join(dir, 'v.c')
    writeFileSync(file, '#include <stdio.h>\n#define V 1\nint main(void) { printf("%d\\n", V); return 0; }\n')
    expect(await run(file, (_f, t) => t.replace('#define V 1', '#define V 2'))).toBe('2\n')
  })
})
```

Run: `npx vitest run tests/unit/cli/prepare.test.ts`
Expected: FAIL, because `src/cli/prepare` does not exist.

- [ ] **Step 2: Implement `prepare` and the default memory map**

```ts path=src/cli/defaultCmd.ts
/** MEMORY and SECTIONS of CCS's C6748.cmd template (ccs_base/c6000/include), for programs without a .cmd file. */
export const DEFAULT_CMD = `MEMORY
{
    DSPL2ROM     o = 0x00700000  l = 0x00100000
    DSPL2RAM     o = 0x00800000  l = 0x00040000
    DSPL1PRAM    o = 0x00E00000  l = 0x00008000
    DSPL1DRAM    o = 0x00F00000  l = 0x00008000
    SHDSPL2ROM   o = 0x11700000  l = 0x00100000
    SHDSPL2RAM   o = 0x11800000  l = 0x00040000
    SHDSPL1PRAM  o = 0x11E00000  l = 0x00008000
    SHDSPL1DRAM  o = 0x11F00000  l = 0x00008000
    EMIFACS0     o = 0x40000000  l = 0x20000000
    EMIFACS2     o = 0x60000000  l = 0x02000000
    EMIFACS3     o = 0x62000000  l = 0x02000000
    EMIFACS4     o = 0x64000000  l = 0x02000000
    EMIFACS5     o = 0x66000000  l = 0x02000000
    SHRAM        o = 0x80000000  l = 0x00020000
    DDR2         o = 0xC0000000  l = 0x20000000
}
SECTIONS
{
    .text          >  SHRAM
    .stack         >  SHRAM
    .bss           >  SHRAM
    .cio           >  SHRAM
    .const         >  SHRAM
    .data          >  SHRAM
    .switch        >  SHRAM
    .sysmem        >  SHRAM
    .far           >  SHRAM
    .args          >  SHRAM
    .ppinfo        >  SHRAM
    .ppdata        >  SHRAM
    .pinit         >  SHRAM
    .cinit         >  SHRAM
    .binit         >  SHRAM
    .init_array    >  SHRAM
    .neardata      >  SHRAM
    .fardata       >  SHRAM
    .rodata        >  SHRAM
    .c6xabi.exidx  >  SHRAM
    .c6xabi.extab  >  SHRAM
}
`
```

```ts path=src/cli/prepare.ts
import { promises as fs } from 'fs'
import * as path from 'path'
import type { ProgramImage } from '@shared/program'
import type { TranslationUnit } from '../interp/frontend/ast'
import { compileUnit, linkProgram, type Program } from '../interp/frontend/program'
import { FALLBACK_CGT, frontendOptions, renderDiagnostic } from '../main/build/fallback'
import { layoutProgram } from '../main/build/fallbackImage'
import { parseLinkerCommandFile } from '../main/build/linkerCmd'
import { defaultConfig, readBuildConfig } from '../main/build/projectConfig'
import { findSources } from '../main/build/sources'
import { DEFAULT_CMD } from './defaultCmd'

export type Prepared =
  | { ok: true; program: Program; image: ProgramImage; dir: string }
  | { ok: false; messages: string[]; dir: string }

/**
 * Builds a project folder or a single .c file the way the fallback build does (LabSim's front-end and the synthetic
 * linker), without writing anything. `rewrite` changes a source's text in memory, e.g. to select a lab experiment.
 */
export async function prepare(target: string, opts: { rewrite?: (file: string, text: string) => string } = {}): Promise<Prepared> {
  const isFile = (await fs.stat(target)).isFile()
  const dir = isFile ? path.dirname(target) : target
  const cfg = isFile ? defaultConfig(path.basename(target, '.c'), dir, FALLBACK_CGT) : await readBuildConfig(dir, FALLBACK_CGT)
  const sources = isFile ? [target] : await findSources(dir)
  if (sources.length === 0) return { ok: false, messages: [`LabSim: no C source files in ${dir}`], dir }
  const base = frontendOptions(cfg, FALLBACK_CGT)
  const rewrite = opts.rewrite
  const options = rewrite
    ? {
        ...base,
        readFile: (f: string): string | null => {
          const text = base.readFile(f)
          return text === null ? null : rewrite(f, text)
        }
      }
    : base
  const messages: string[] = []
  const units: TranslationUnit[] = []
  for (const src of sources) {
    const r = compileUnit(src, options)
    for (const d of r.diagnostics) if (d.severity === 'error') messages.push(renderDiagnostic(d, dir))
    if (r.unit) units.push(r.unit)
  }
  if (units.length < sources.length) return { ok: false, messages, dir }
  const link = linkProgram(units)
  if (!link.program) {
    return {
      ok: false,
      messages: link.problems.map((p) => (p.kind === 'unresolved' ? `LabSim: unresolved symbol ${p.name}` : `LabSim: symbol ${p.name} is defined twice`)),
      dir
    }
  }
  const cmdText = !isFile && cfg.linkerCommandFile ? await fs.readFile(path.join(dir, cfg.linkerCommandFile), 'utf8') : DEFAULT_CMD
  const layout = layoutProgram(link.program, parseLinkerCommandFile(cmdText), {
    heapSize: Number(cfg.heapSize),
    stackSize: Number(cfg.stackSize),
    outFile: ''
  })
  if (!layout.image) return { ok: false, messages: [layout.error], dir }
  return { ok: true, program: link.program, image: layout.image, dir }
}
```

In `tsconfig.node.json`, add `"src/cli/**/*"` to `include`.

Run: `npx vitest run tests/unit/cli/prepare.test.ts && npm run typecheck`
Expected: PASS (4 tests), and no type errors.

- [ ] **Step 3: Implement the CLI**

```ts path=src/cli/labsim.ts
import { readFileSync } from 'fs'
import * as path from 'path'
import type { RunIO } from '../interp/exec/machine'
import { LoadError, loadProgram, runProgram, type Machine } from '../interp/run'
import { nodeHostFiles } from '../interp/runtime/hostfs'
import { prepare } from './prepare'

const USAGE = `usage: labsim run <project-folder | file.c> [--input <file>] [--max-steps <n>] [--stats]

Builds the program with LabSim's C front-end (as a build without cl6x does), runs it on the simulated C6748 and
prints its console output. Exit status: the program's exit code; 1 when the target halts; 2 when it does not build.`

const toLines = (text: string): string[] => {
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

async function main(argv: string[]): Promise<number> {
  const [cmd, target, ...rest] = argv
  if (cmd !== 'run' || !target) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  let input: string[] | null = null
  let maxSteps = 1_000_000_000
  let stats = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--input') input = toLines(readFileSync(rest[++i], 'utf8'))
    else if (rest[i] === '--max-steps') maxSteps = Number(rest[++i])
    else if (rest[i] === '--stats') stats = true
    else {
      process.stderr.write(`${USAGE}\n`)
      return 2
    }
  }
  const prepared = await prepare(path.resolve(target))
  if (!prepared.ok) {
    for (const line of prepared.messages) process.stderr.write(`${line}\n`)
    return 2
  }
  const where = (file: string, line: number): string => `${path.relative(prepared.dir, file) || file}:${line}`
  const io: RunIO = {
    write: (text, stream) => void (stream === 'stdout' ? process.stdout : process.stderr).write(text, 'latin1'),
    note: (text) => void process.stderr.write(`LabSim: ${text}\n`),
    readLine: () => {
      if (input === null) input = toLines(readFileSync(0, 'utf8'))
      return input.shift() ?? null
    },
    files: nodeHostFiles(prepared.dir)
  }
  let m: Machine
  try {
    m = loadProgram(prepared.program, prepared.image, io, { maxSteps })
  } catch (e) {
    if (!(e instanceof LoadError)) throw e
    process.stderr.write(`${e.loc ? `${where(e.loc.file, e.loc.line)}: ` : ''}${e.message}\n`)
    return 2
  }
  const t0 = performance.now()
  const r = runProgram(m)
  const seconds = (performance.now() - t0) / 1000
  if (stats) process.stderr.write(`LabSim: ${r.steps} statements in ${seconds.toFixed(3)} s (${(r.steps / seconds / 1e6).toFixed(1)} M statements/s)\n`)
  if (r.status === 'halted') {
    process.stderr.write(`LabSim: ${r.message} (${where(r.loc.file, r.loc.line)})\n`)
    return 1
  }
  return r.code === null ? 1 : r.code & 0xff
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (e) => {
    console.error(e)
    process.exitCode = 3
  }
)
```

```ts path=vite.cli.config.ts
import { resolve } from 'path'
import { defineConfig } from 'vite'

/** Bundles the headless `labsim` CLI for Node (npm run labsim -- run <project>). */
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  build: {
    ssr: resolve(__dirname, 'src/cli/labsim.ts'),
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'labsim.cjs' } }
  }
})
```

In `package.json` `scripts`, add after `"test:e2e"`:

```json
    "labsim": "vite build -c vite.cli.config.ts --logLevel warn && node out/cli/labsim.cjs",
```

Run: `npm run labsim -- run "$HOME/workspace_v12/exp11" --stats`
Expected:
- the exp11 table (`k	Real	Imag	Magnitude	Phase` and 8 rows) on stdout;
- a `LabSim: N statements in … s` line on stderr;
- exit status 0.

Run: `npm run labsim -- run "$HOME/dsp_ccs_lab/conv_linear_discrete.c"`
Expected: that program's output; it has no .cmd, so it uses the default memory map.

- [ ] **Step 4: Write the corpus golden test**

```ts path=tests/unit/interp/run-corpus.test.ts
import { describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import * as path from 'path'
import { prepare } from '../../../src/cli/prepare'
import { captureIO, LoadError, loadProgram, runProgram } from '../../../src/interp/run'
import { runBuild } from '../../../src/main/build/builder'
import { findToolchain } from '../../../src/main/build/toolchain'
import { NO_IO } from './exec/harness'

const tc = await findToolchain()

const WS = path.join(homedir(), 'workspace_v12')
const LAB = path.join(homedir(), 'dsp_ccs_lab')
const GOLDEN = path.join(__dirname, '../../fixtures/golden')
const UPDATE = !!process.env.UPDATE_GOLDEN

const projects = existsSync(WS)
  ? readdirSync(WS)
      .map((n) => path.join(WS, n))
      .filter((d) => statSync(d).isDirectory() && !path.basename(d).startsWith('.') && path.basename(d) !== 'RemoteSystemsTempFiles')
  : []
const labFiles = existsSync(LAB) ? readdirSync(LAB).filter((f) => f.endsWith('.c')) : []

const VARIANTS: [string, string, number[]][] = [
  ['dsp_lab_ccs_exp09_15.c', 'EXPERIMENT', [9, 10, 11, 12, 13, 14, 15]],
  ['dsp_lab_exp5_filters.c', 'FILTER', [1, 2, 3, 4, 5, 6]],
  ['dsp_lab_exp5_fir_iir.c', 'FILTER', [1, 2]]
]

/** What the console shows for one run, plus how it ended. Nothing is written to the corpus folders. */
async function transcript(target: string, rewrite?: (f: string, t: string) => string): Promise<string> {
  const p = await prepare(target, { rewrite })
  if (!p.ok) return `--- does not build\n${p.messages.join('\n')}\n`
  const cap = captureIO()
  let m
  try {
    m = loadProgram(p.program, p.image, cap.io, { maxSteps: 50_000_000 })
  } catch (e) {
    if (e instanceof LoadError) return `--- does not load: ${e.message}${e.loc ? ` at ${path.basename(e.loc.file)}:${e.loc.line}` : ''}\n`
    throw e
  }
  const r = runProgram(m)
  let out = cap.stdout()
  if (out && !out.endsWith('\n')) out += '\n'
  const err = cap.stderr()
  if (err) out += `--- stderr\n${err}${err.endsWith('\n') ? '' : '\n'}`
  for (const n of cap.notes) out += `--- note: ${n}\n`
  if (r.status === 'exited') out += r.code === null ? '--- abort\n' : `--- exit ${r.code}\n`
  else out += `--- halted: ${r.message} at ${path.basename(r.loc.file)}:${r.loc.line}\n`
  return out
}

function check(name: string, text: string): void {
  const file = path.join(GOLDEN, `${name}.txt`)
  if (UPDATE) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(file, text)
    return
  }
  expect(existsSync(file), `${file} is missing: run UPDATE_GOLDEN=1 npx vitest run tests/unit/interp/run-corpus.test.ts`).toBe(true)
  expect(text).toBe(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
}

describe.skipIf(projects.length === 0)('~/workspace_v12 programs run like the board', () => {
  for (const dir of projects) {
    it(path.basename(dir), async () => check(path.basename(dir), await transcript(dir)), 60_000)
  }
})

describe.skipIf(labFiles.length === 0)('~/dsp_ccs_lab programs run like the board', () => {
  for (const f of labFiles) it(f, async () => check(`lab-${f}`, await transcript(path.join(LAB, f))), 60_000)
  for (const [f, macro, values] of VARIANTS) {
    for (const v of values) {
      it(`${f} with ${macro} ${v}`, async () => {
        const rewrite = (file: string, text: string): string =>
          path.basename(file) === f ? text.replace(new RegExp(`^#define\\s+${macro}\\s+\\d+`, 'm'), `#define ${macro} ${v}`) : text
        check(`lab-${f}@${macro}=${v}`, await transcript(path.join(LAB, f), rewrite))
      }, 60_000)
    }
  }
})

describe.skipIf(!tc || projects.length === 0)('the interpreter uses the addresses of the real cl6x link', () => {
  for (const dir of projects) {
    it(path.basename(dir), async () => {
      // Build a copy in a temporary folder: nothing is ever written to ~/workspace_v12.
      const tmp = mkdtempSync(path.join(tmpdir(), 'labsim-addr-'))
      try {
        const copy = path.join(tmp, path.basename(dir))
        cpSync(dir, copy, { recursive: true, filter: (src) => !/[\\/](Debug|Release|\.labsim)$/i.test(src) })
        const built = await runBuild({ projectDir: copy, kind: 'build', toolchain: tc!, onOutput: () => {} })
        if (!built.ok) return // fft_m and idft_8_m do not build in CCS either
        const p = await prepare(copy)
        if (!p.ok) throw new Error(p.messages.join('\n'))
        const m = loadProgram(p.program, built.image!, NO_IO)
        expect(m.placement.unplaced).toEqual([])
        for (const [name, v] of p.program.globals) expect(m.placement.objectAddress(v), name).toBe(built.image!.globals[name].addr)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }, 120_000)
  }
})
```

The last suite builds each project with real cl6x. It checks that every global and static the program defines is placed at the address the ELF gives it, and that none falls back to the LabSim region. It is skipped when cl6x is not installed.

- [ ] **Step 5: Generate the goldens and read every one**

Run: `UPDATE_GOLDEN=1 npx vitest run tests/unit/interp/run-corpus.test.ts`
Expected: every test passes, and `tests/fixtures/golden/` holds one `.txt` per project, lab file and variant (20 + 8 + 15).

Read each golden, and check:
- `fft_m` and `idft_8_m` end in `--- does not build` with the same errors as cl6x: #1965 at line 2, and #29 at lines 33 and 34.
- `FFT` and `FFT_16` end in `--- halted: LabSim stopped the program after 50000000 statements … at main.c:<the while(1) line>`. That is their `while(1);`; the output before it is complete.
- Every other program ends in `--- exit 0`, has no `does not load` line, and its console text looks plausible (magnitudes non-negative, phases in [-π, π], IDFT returning the input).
- Any `--- note:` line (out-of-range writes, the TSC estimate) is real behaviour of that program. Explain each one in the step's report.

If a program halts or fails to load unexpectedly, fix the interpreter, not the golden. Add a focused regression test in the matching `tests/unit/interp/**` file, then regenerate.

Then run: `npx vitest run tests/unit/interp/run-corpus.test.ts`
Expected: PASS, comparing against the files just written, in under a minute in total.

- [ ] **Step 6: Cross-check four goldens against Python transcriptions**

```python path=scripts/golden-check/compare.py
"""Compares a LabSim golden transcript with a Python transcription of the same program.

Words must match exactly; numbers must agree to within one unit of the last digit the golden prints (TI's printf
rounds half-up on a generated digit, Python rounds exactly, so the last digit may differ by one).
"""
import re
import sys

NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


def tokens(text):
    lines = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith("--- "):
            break
        lines.append(line)
    return re.findall(r"[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?|[A-Za-z_]+|\S", "\n".join(lines))


def tolerance(tok):
    mantissa = re.split(r"[eE]", tok)[0]
    decimals = len(mantissa.split(".")[1]) if "." in mantissa else 0
    scale = 10 ** int(re.split(r"[eE]", tok)[1]) if re.search(r"[eE]", tok) else 1
    return 1.01 * 10 ** -decimals * scale


def main(golden_path, python_path):
    golden = tokens(open(golden_path, encoding="latin-1").read())
    python = tokens(open(python_path, encoding="latin-1").read())
    if len(golden) != len(python):
        print(f"token count differs: golden {len(golden)}, python {len(python)}")
        return 1
    bad = 0
    for g, p in zip(golden, python):
        if NUMBER.match(g) and NUMBER.match(p):
            if abs(float(g) - float(p)) > tolerance(g):
                print(f"number differs: golden {g}, python {p}")
                bad += 1
        elif g != p:
            print(f"text differs: golden {g!r}, python {p!r}")
            bad += 1
    print("match" if bad == 0 else f"{bad} differences")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
```

```python path=scripts/golden-check/dft_8_m.py
"""Python transcription of ~/workspace_v12/dft_8_m/main.c with C6000 float semantics (numpy float32)."""
import math
import numpy as np

f32 = np.float32
x = [f32(v) for v in (1, 1, 2, 3, 0, 2, 1, 3)]
N = 8
XR = [f32(0)] * 8
XI = [f32(0)] * 8
for j in range(N):
    XR[j] = f32(0)
    XI[j] = f32(0)
    for i in range(N):
        XR[j] = f32(float(XR[j]) + float(x[i]) * math.cos(2.0 * 3.14 * i * j / N))
        XI[j] = f32(float(XI[j]) - float(x[i]) * math.sin(2.0 * 3.14 * i * j / N))
    print("%f +i %f" % (XR[j], XI[j]))
for i in range(N):
    amplitude = f32(math.sqrt(float(XR[i] * XR[i] + XI[i] * XI[i])))
    print("amplitude %f " % amplitude)
for i in range(N):
    print("phase %f " % f32(math.atan2(float(XI[i]), float(XR[i]))))
```

```python path=scripts/golden-check/exp11.py
"""Python transcription of ~/workspace_v12/exp11/main.c (radix-2 FFT in float)."""
import math
import numpy as np

f32 = np.float32
N = 8
PI = 3.14159265358979323846
xr = [f32(v) for v in (1, 2, 3, 4, 0, 0, 0, 0)]
xi = [f32(0)] * N
j = 0
for i in range(1, N - 1):
    m = N // 2
    while j >= m:
        j -= m
        m //= 2
    j += m
    if i < j:
        xr[i], xr[j] = xr[j], xr[i]
        xi[i], xi[j] = xi[j], xi[i]
m = 2
while m <= N:
    ang = f32(-2 * PI / m)
    for k in range(0, N, m):
        for jj in range(m // 2):
            wr = f32(math.cos(float(f32(jj) * ang)))
            wi = f32(math.sin(float(f32(jj) * ang)))
            a = k + jj + m // 2
            tr = wr * xr[a] - wi * xi[a]
            ti = wr * xi[a] + wi * xr[a]
            xr[a] = xr[k + jj] - tr
            xi[a] = xi[k + jj] - ti
            xr[k + jj] = xr[k + jj] + tr
            xi[k + jj] = xi[k + jj] + ti
    m *= 2
print("k\tReal\tImag\tMagnitude\tPhase")
for i in range(N):
    mag = f32(math.sqrt(float(xr[i] * xr[i] + xi[i] * xi[i])))
    phase = f32(math.atan2(float(xi[i]), float(xr[i])))
    print("%d\t%f\t%f\t%f\t%f" % (i, xr[i], xi[i], mag, phase))
```

```python path=scripts/golden-check/linear_disc_conv.py
"""Python transcription of ~/workspace_v12/linear_disc_conv/main.c (float convolution)."""
import math
import numpy as np

f32 = np.float32
NT = 400
DT = f32(0.01)
NY = 2 * NT - 1
t = [f32(0)] * NT
x = [f32(0)] * NT
h = [f32(0)] * NT
y = [f32(0)] * NY
for n in range(NT):
    t[n] = f32(n) * DT
    x[n] = f32(1.0) if t[n] < f32(1.0) else f32(0.0)
    h[n] = f32(math.exp(-float(t[n])))
for n in range(NY):
    s = f32(0.0)
    for k in range(NT):
        if 0 <= n - k < NT:
            s = s + x[k] * h[n - k]
    y[n] = s * DT
print("Linear convolution of continuous signals, dt = %.3f" % DT)
for n in range(0, NY, 25):
    print("t = %5.2f   y = %8.5f" % (f32(n) * DT, y[n]))
```

```python path=scripts/golden-check/fir_lowpass.py
"""Python transcription of ~/workspace_v12/fir lowpass/main.c (double DFTs around a 51-tap FIR)."""
import math
import os
import re

header = open(os.path.expanduser("~/workspace_v12/fir lowpass/firlowpass.h")).read()
B = [float(v) for v in re.search(r"B\[\d+\]\s*=\s*\{([^}]*)\}", header).group(1).split(",")]
PI = 3.14159265358979323846
N = 480
FS = 48000.0
F1 = 4800.0
F2 = 16000.0
NTAPS = len(B)


def dft(sig):
    mags = []
    for j in range(N):
        xr = 0.0
        xi = 0.0
        for i in range(N):
            xr = xr + (sig[i] * math.cos(2 * PI * i * j / N))
            xi = xi - (sig[i] * math.sin(2 * PI * i * j / N))
        mags.append(math.sqrt((xr * xr) + (xi * xi)) / N)
    return mags


x = [math.sin(2 * PI * F1 * i / FS) + math.sin(2 * PI * F2 * i / FS) for i in range(N)]
m1 = dft(x)
w = [0.0] * NTAPS
y = []
for i in range(N):
    w = [x[i]] + w[:-1]
    acc = 0.0
    for j in range(NTAPS):
        acc = acc + (B[j] * w[j])
    y.append(acc)
m2 = dft(y)
print("Fs = %.0f Hz, N = %d, taps = %d, bin spacing = %.1f Hz" % (FS, N, NTAPS, FS / N))
print("Input tones: %.0f Hz (bin %.0f) and %.0f Hz (bin %.0f)\n" % (F1, F1 / (FS / N), F2, F2 / (FS / N)))
print("    Hz     |X(f)|      |Y(f)|")
for j in range(N // 2 + 1):
    print("%6.0f  %9.5f  %9.5f" % (j * FS / N, m1[j], m2[j]))
```

Run each program's transcription and compare it with its golden:

```bash
cd ~/dsp-labsim
SP=$(mktemp -d)
for p in dft_8_m exp11 linear_disc_conv fir_lowpass; do
  python scripts/golden-check/$p.py > "$SP/$p.txt"
done
python scripts/golden-check/compare.py tests/fixtures/golden/dft_8_m.txt "$SP/dft_8_m.txt"
python scripts/golden-check/compare.py tests/fixtures/golden/exp11.txt "$SP/exp11.txt"
python scripts/golden-check/compare.py tests/fixtures/golden/linear_disc_conv.txt "$SP/linear_disc_conv.txt"
python scripts/golden-check/compare.py "tests/fixtures/golden/fir lowpass.txt" "$SP/fir_lowpass.txt"
rm -rf "$SP"
```

Expected: `match` four times. A numeric difference means the executor's arithmetic differs from C6000 semantics: float vs double promotion, conversion order, or a runtime function. Find the cause, add a regression test, fix the executor, regenerate the goldens, and repeat.

- [ ] **Step 7: Check the speed target**

Run: `npm run labsim -- run "$HOME/workspace_v12/fir lowpass" --stats > /dev/null`
Expected: the `LabSim:` stats line reports a rate. The spec target is at least 20 M statements/s. Record the figure in the step's report.

If the rate is below 20 M/s, profile with `node --cpu-prof out/cli/labsim.cjs run …` and fix the hot path before continuing. Common culprits are per-call argument arrays, generic `arith` closures in the inner loop, and `m.mem` page lookups. Re-run the full test suite after any optimisation.

- [ ] **Step 8: Confirm the corpus folders were only read**

```bash
SP=$(mktemp -d)
find ~/workspace_v12 ~/dsp_ccs_lab -type f -not -path '*/.labsim/*' -printf '%p %T@\n' | sort > "$SP/before.txt"
npx vitest run tests/unit/interp/run-corpus.test.ts > /dev/null
npm run labsim -- run "$HOME/workspace_v12/exp11" > /dev/null
find ~/workspace_v12 ~/dsp_ccs_lab -type f -not -path '*/.labsim/*' -printf '%p %T@\n' | sort > "$SP/after.txt"
diff "$SP/before.txt" "$SP/after.txt" && echo unchanged
rm -rf "$SP"
```

Expected: `unchanged`.

- [ ] **Step 9: Record the runtime decisions in the spec**

In `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, under **Runtime library.**, append:

```markdown
**Fidelity to TI's RTS.** Where the board's console output depends on the library's implementation, LabSim ports
TI's own source (`ti-cgt-c6000_8.3.12/lib/src`). The ported behaviour:

- `printf`: digits come from repeated `value *= 10` with half-up rounding on one extra digit, so `%.2f` of 0.125 prints
  `0.13`. `+inf` is printed for infinity, and `%p` prints bare hex.
- stdout: a line-buffered stream whose 257-byte buffer is malloc'd from `.sysmem` on first use, so later `malloc`
  addresses match the board. With too small a heap, `printf` prints nothing, and `abort()` loses unflushed text.
- The `malloc` family: TI's size-ordered free list with 8-byte packet headers inside `.sysmem`.
- `rand`/`srand`: TI's LCG. `qsort`/`bsearch` use TI's algorithms. `strcmp`/`memcmp` return byte differences, and the
  ctype functions return `_ctypes_` bits.
- math.h: JS `Math` for normal values (float versions rounded with `Math.fround`), with TI's edge behaviour: `sqrt(-1)`
  is 0, `log(x≤0)` is −∞, `pow` overflow gives DBL_MAX, `asin(2)` clamps, `fmod(x,0)` is 0, `atan2(0,0)` is 0. The
  last bit can differ from the board, because TI evaluates `sin`/`sqrt`/division with its own polynomial and Newton
  code.

Other runtime decisions:

- `TSCL`/`TSCH` and `clock()` count 4 cycles per C statement executed (an estimate, which the console says once).
- `CSR` reads 0x14000100 (C674x CPU ID 0x14, little-endian).
- The C6000 intrinsics are bit-exact, except the Galois-field, complex-multiply and reciprocal-estimate ones
  (`_gmpy4`, `_cmpy`, `_rcpsp`, …), which make the program fail to load with `LabSim: unsupported construct`
  rather than return a guess.

**LabSim region.** String literals, `_ftable`, `errno` and any object the image has no symbol for live in an otherwise
unused region at 0x70000000. Static and unused library functions get code addresses from 0x71000000.
```

Under **Execution strategy.**, append:

```markdown
A statement that has code sets the current line and increments the statement counter. The counter implements the
step limit of headless runs, the TSC estimate and (Step 5) the debugger's pause checks. `goto` may jump to a label
in any enclosing block. Jumping into a nested block, or a `case` label that is not a statement of its switch body,
is a load error. Loads and stores ignore the low address bits alignment requires, as LDH/LDW/LDDW do. `_memN`
intrinsics access any byte address.
```

- [ ] **Step 10: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: every unit test passes, including the corpus goldens, and there are no type errors.

Run: `npm run test:e2e`
Expected: all 11 Playwright tests still pass. Step 4 does not touch the UI.

```bash
git add src/cli vite.cli.config.ts package.json tsconfig.node.json tests/unit/cli tests/unit/interp/run-corpus.test.ts tests/fixtures/golden scripts/golden-check docs/superpowers/specs/2026-09-23-dsp-labsim-design.md
git commit -m "feat(cli): labsim run, golden console transcripts for the corpus, and a Python cross-check"
```
