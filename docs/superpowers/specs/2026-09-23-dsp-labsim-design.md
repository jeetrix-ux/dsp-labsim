# DSP LabSim — design

A desktop app for practising the TMS320C6748 DSP lab without the LCDK board. It looks and
behaves like Code Composer Studio 12: write C in an editor, **Build** (real TI compiler),
**Debug** (load, run, breakpoints, stepping, console), and open **Tools → Graph → Single
Time** with the same property dialog CCS has.

Date: 2026-09-23. Target user: one student (EC1311 DSP Lab) on Windows 11 with CCS 12.8.1
installed at `C:\ti\ccs1281`.

## Goals

1. Programs the lab writes for the C6748 (see `~/workspace_v12/*/main.c`,
   `~/dsp_ccs_lab/*.c`) build with TI's own diagnostics and run with the same console output
   they would give on the board.
2. A Debug phase that feels like CCS: stop at `main`, Resume / Suspend / Terminate / Restart,
   editor breakpoints, Step Into / Over / Return, Variables, Expressions, Breakpoints views.
3. A Single Time graph with CCS's property names, defaults and refresh behaviour, plotting
   memory at the addresses the real linker assigned.

## Non-goals

- Cycle-accurate simulation of the C674x pipeline. `TSCL`/`TSCH` return an *estimate*.
- Peripherals (McASP, AIC3106 codec, EDMA, interrupts). Programs that need live audio are
  out of scope.
- Dual Time, FFT graphs, image analyzer, disassembly, register views.
- C++.

## Architecture

Electron + TypeScript. React renderer; Monaco editor. Four isolated units:

| Unit | Job | Interface |
|---|---|---|
| `src/main/build/` | Runs `cl6x` with the exact flags a CCS-generated makefile uses, streams a CCS-format Build Console, parses diagnostics, reads the linked `.out` (ELF symbol table) and `.map` | `build(project) → BuildResult { ok, diagnostics[], image: ProgramImage }` |
| `src/interp/` | C front-end (preprocessor, lexer, parser, type checker) and an executor over a simulated C6748 memory | Runs in a worker thread. Debug API: `load`, `run`, `suspend`, `step(kind)`, `setBreakpoints`, `evaluate(expr, frame)`, `readMemory(addr, len)`, `stackFrames`, `variables(frame)` |
| `src/interp/runtime/` | Emulated RTS: `stdio.h` (CIO), `math.h`, `stdlib.h`, `string.h`, and `<c6x.h>` (TSCL/TSCH, CSR, intrinsics) | Called by the executor |
| `src/renderer/` | CCS-like UI: perspectives, views, graph windows | IPC to main; debug API via main |

The interpreter has **no Electron dependency**. That means it can be unit-tested in Node and
driven from a CLI (`labsim run file.c`).

## Workspace and projects

- A workspace is a folder, by default `~/workspace_v12`. Each subfolder with a `.project` or a
  `.c` file is a project. Existing CCS projects open unchanged.
- **New CCS Project** creates `main.c` (the CCS "Empty Project (with main.c)" template), a
  copy of `C6748.cmd` from `ccs_base/c6000/include`, and a `labsim.json` holding build
  options (heap/stack size, opt level, defines).
- Build output goes to `<project>/.labsim/Debug/`, never CCS's own `Debug/`. That way CCS
  and LabSim can share a project.
- Settings: the path to the C6000 compiler is auto-detected
  (`C:\ti\ccs*\ccs\tools\compiler\ti-cgt-c6000_*`) and can be overridden.

## Build phase

Mirrors the Debug configuration of a CCS-generated makefile. Compile step, per `.c` file:

```
cl6x -mv6740 --include_path=<proj> --include_path=<cgt>/include --define=c6748 -g
     --diag_warning=225 --diag_wrap=off --display_error_number --preproc_with_compile
     --preproc_dependency=<name>.d_raw --obj_directory=<out> <file>
```

Link step:

```
cl6x -mv6740 --define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number
     -z -m<proj>.map --heap_size=0x800 --stack_size=0x800 -i<cgt>/lib -i<cgt>/include
     --reread_libs --warn_sections --xml_link_info=<proj>_linkInfo.xml --rom_model
     -o <proj>.out <objs> <cmd file> -llibc.a
```

- Console text uses CCS's own format: `**** Build of configuration Debug for project X ****`,
  `Building file: "../main.c"`, `Invoking: C6000 Compiler`, the command line, compiler
  output, `Finished building: ...`, then the linker block and `**** Build Finished ****`.
- Incremental: a file is recompiled only if it, or a header listed in its `.d_raw`, is newer
  than its `.obj`. **Clean** deletes the output directory. **Rebuild** = Clean + Build.
- Diagnostics are parsed from `"<file>", line N: error|warning|remark #NNNN[-D]: text` and
  from linker `error #10234-D` / `undefined ... first referenced` blocks. They feed the
  Problems view and Monaco squiggles.
- **Program image**: read from the ELF `.out` (our own ELF32 reader). It contains every data
  symbol (global and file-static) with its address and size, `.stack`, `.sysmem` (heap) and
  `.bss/.far` placement, and the memory configuration from the `.map`.
- **Fallback when `cl6x` is missing:** the build uses LabSim's front-end, which gives cl6x-numbered diagnostics
  (verified against 179 reference cases). A synthetic linker then reads MEMORY/SECTIONS from the project's
  `.cmd`, puts objects in cl6x's sections (`.bss`/`.neardata` for scalars, `.far`/`.fardata` for aggregates,
  `.const` for const data), assumes 0x7000 bytes of `.text`, and places sections in SECTIONS order. The console
  says the fallback is in use. After every successful `cl6x` build the front-end also checks the program, and
  the console warns when LabSim cannot run something `cl6x` accepted.
- The interpreter always parses the source itself. `cl6x` is the authority on *whether* the
  program builds and *where* things live; the interpreter is the authority on *what it does*.

## C front-end and executor

**Language.** C89 plus the C99 features lab code uses: `//` comments, mixed declarations,
`for (int i…)`, `long long`, `_Bool`/`stdbool.h`, `inline`, designated initialisers, compound
literals, VLAs. Also structs, unions, enums, typedefs, pointers of any depth, function
pointers, arrays of arrays, `sizeof`, casts, `static`/`extern`/`const`/`volatile`, `goto`,
`switch`, and variadic functions via `stdarg.h`. TI extensions are accepted and ignored where
they are only hints: `#pragma DATA_ALIGN`, `DATA_SECTION`, `MUST_ITERATE`, `UNROLL`,
`restrict`, `interrupt`, `cregister`, `near`/`far`.
The dialect follows the project's C_DIALECT option, like cl6x: by default relaxed C89 (`__STDC_VERSION__`
199409L), where `for (int i …)` is error #29. C99 (`--c99`) allows it. The other C99 features above are accepted
in both modes.

**Preprocessor.** Full: object and function macros, `#`/`##`, `#if`/`#elif` with `defined`,
`#include` of project headers. Standard and TI headers resolve to our own built-in versions,
so `c6748`, `__TI_COMPILER_VERSION__`, `_TMS320C6740` and similar are predefined the way
`cl6x -mv6740` predefines them.

**Target model (C6000 EABI, little-endian).** char 8, short 16, int 32, **long 32**, long long
64, float 32, double 64, pointers 32, with EABI alignment. Integer arithmetic wraps at the
declared width, and float arithmetic is done in true single precision (`Math.fround`), so
results match the board bit-for-bit wherever the board's RTS matches IEEE.

**Memory.** A sparse 32-bit address space made of regions taken from the memory
configuration (SHRAM, L2, DDR2…), each backed by lazily allocated 64 KB pages. Globals and
statics live at their ELF addresses. Locals live on a simulated stack inside `.stack`, and
`malloc` works inside `.sysmem`. Because everything is real memory, pointers, casts,
`memcpy`, graphs and the Memory view all see the same bytes.

- **Access checks.** An access outside every mapped region halts the program with
  `Illegal memory access at 0x...`. An access inside mapped memory but outside the object the
  pointer came from behaves like the hardware (it silently touches the neighbour) and adds a
  one-time warning in the console, such as `write past end of 'y' (y[8], size 8)`.
- **Stack/heap overflow.** Overflowing `.stack` or running out of `.sysmem` halts or returns
  NULL like the board would, with an explanatory console line. For example, a `printf` with
  too small a heap prints nothing, as on the LCDK.

**Execution strategy.** The AST is compiled once into JavaScript closures, not interpreted
node by node. This targets at least 20 M simple statements/s, enough for a 1024-point FFT or
a 51-tap filter over 4096 samples in well under a second. Every statement node carries a
source line. A statement-boundary hook (a counter check, cheap when nothing is armed)
implements breakpoints, stepping and Suspend.

**Pause without async.** The executor runs synchronously in a worker. To stop, it posts
`stopped{reason, line}` and blocks on `Atomics.wait` over a `SharedArrayBuffer` command
channel. While blocked it still serves `evaluate`, `readMemory`, `variables` and
`stackFrames` requests, then waits again. Suspend works the same way: the UI sets a shared
flag that the hook polls.

**Runtime library.**
- `stdio`: printf family (full C99 format spec including `%e %g %x %p %*.*f`), puts, putchar,
  scanf/getchar from the console input line, fopen/fread/fwrite/fprintf/fgets on host files
  relative to the project folder (CIO does this on the real board).
- `math.h`: double functions, plus the `f` variants.
- `stdlib`: malloc/calloc/realloc/free on the simulated heap, rand/srand using the TI RTS
  LCG so sequences match the board, abs, atoi, atof, exit, abort.
- `string.h`: the usual functions.
- `<c6x.h>`: `TSCL`/`TSCH` (an estimated cycle count derived from the operation count, and
  labelled as such), `CSR` with C6748 CPU/rev IDs, `_dotp2 _pack2 _add2 _sub2 _mpy _mpyh
  _sadd _ssub _norm _lmbd _abs _extu _ext _set _clr _amem4 _mem4 _hi _lo _itod`, and
  similar, implemented bit-exactly from the C6000 intrinsics reference.

## Debug phase

**Debug** (bug icon): build if needed → "load" (parse, lay out memory, run static
initialisers, which is what `.cinit` does on the board) → run to `main` → stop there. The
perspective switches to **CCS Debug**.

- **Debug view:** a tree `<project> [Code Composer Studio - Device Debugging]` →
  `Texas Instruments XDS100v3 USB Debug Probe_0/C674X_0 (Suspended - SW Breakpoint)` → call
  stack frames `main() at main.c:12`.
- **Toolbar:** Resume F8, Suspend Alt+F8, Terminate Ctrl+F2, Restart, Step Into F5, Step Over
  F6, Step Return F7, Run to Line Ctrl+R, plus Load / Reload.
- **Breakpoints:** double-click the gutter, as in CCS. Breakpoints are verified against
  statement lines; one on a blank or comment line moves to the next statement, as CCS does.
  The Breakpoints view lists and toggles them.
- **Variables view:** the locals of the selected frame, with expandable arrays and structs.
- **Expressions view:** user expressions (`y`, `y[3]`, `*p`, `x[i]*2`, `&h`), evaluated with
  our own C expression evaluator against the selected frame. Values are editable, and the
  view has a number-format context menu (natural/hex/decimal/binary/char).
- **Console:** program output is prefixed `[C674X_0] ` as in CCS 12, and a stdin line is
  enabled whenever the program blocks in `scanf`.
- **End of program:** when `main` returns, the target halts at `C$$EXIT` exactly as CCS
  reports it ("Suspended"). Memory stays readable, so graphs still work, which matches how
  students graph results after a run.
- **Runtime errors** (illegal access, divide by zero, stack overflow) halt the target with the
  message in the Console and the offending line highlighted.
- A **Memory Browser** view (address or symbol, format 32-bit float / hex / int) is a
  late-stage addition that reuses `readMemory`.

## Single Time graph

**Tools → Graph → Single Time** opens the *Graph Properties* dialog with CCS's properties
and defaults:

| Group | Property | Default | Values |
|---|---|---|---|
| Data | Acquisition Buffer Size | 1 | ≥1 |
| Data | Dsp Data Type | 32 bit signed integer | 8/16/32/64-bit signed & unsigned integer, 32 bit floating point, 64 bit floating point |
| Data | Index Increment | 1 | ≥1 |
| Data | Interleaved Data Sources | false | bool (single source: no effect) |
| Data | Q_Value | 0 | 0-31 (integer types: value / 2^Q) |
| Data | Sampling Rate Hz | 1 | >0 |
| Data | Start Address | (empty) | C expression: symbol, `&x[4]`, `0x80009498`, `buf+2` |
| Display | Axis Display | true | bool |
| Display | Data Plot Style | Line | Line / Bar |
| Display | Display Data Size | 100 | ≥1 |
| Display | Grid Style | Major Grid | No Grid / Minor Grid / Major Grid |
| Display | Magnitude Display Scale | Linear | Linear / Log |
| Display | Time Display Unit | sample | sample / s / ms / us |
| Display | Use Dc Value For Graph | false | bool, plus Dc Value |

The dialog has CCS's **Import / Export** buttons, which save and load a settings file. The
last-used settings are remembered per project.

**Semantics (matches CCS).**
1. On each refresh the graph reads `Acquisition Buffer Size` elements, starting at `Start
   Address` and stepping by `Index Increment` elements, decoded with `Dsp Data Type`/`Q_Value`.
2. Those samples are pushed into a display buffer of `Display Data Size` samples. When the
   acquisition buffer is smaller than the display, successive refreshes scroll the plot,
   which is how CCS behaves.
3. The x axis is sample index, or time = index / Sampling Rate in the chosen unit.

**Refresh.** Automatic on every halt (breakpoint, step, suspend, end of program), plus
toolbar buttons *Refresh*, *Continuous Refresh* (every 100 ms while running), *Reset Graph*,
*Show Graph Properties*, *Zoom in/out/fit*, *Save data (.csv/.dat)* and *Export image (.png)*.
The plot is drawn on a canvas in CCS's style (white background, grey grid, blue trace, cursor
readout of x/y on hover). Several graph windows can be open at once, each docked as a tab in
the Debug perspective.

## Error handling summary

| Situation | Behaviour |
|---|---|
| `cl6x` not found | Fallback build, with a banner in the Build Console |
| Compile/link errors | Problems view and squiggles; Debug refuses to launch (CCS asks "Errors exist, continue?"; we show the same prompt) |
| Construct our front-end cannot handle but `cl6x` accepts | Load fails with `LabSim: unsupported construct <x> at file:line`. Treated as a bug to fix, and tracked by the corpus test |
| Illegal access, divide by zero, stack overflow | Target halts at the line, with a message in the Console |
| Infinite loop | User presses Suspend. The graph's Continuous Refresh still works |
| Start Address does not evaluate | Graph shows `Invalid start address: <reason>` in place of the plot |

## Testing

- **Unit (vitest):** preprocessor, parser, type sizes/alignment, integer wrap and float
  single-precision semantics, printf formatting against a table of C reference outputs,
  intrinsics, ELF reader, map parser, diagnostic parser, graph decoding (types, Q, index
  increment, scrolling).
- **Corpus test:** every `main.c` in `~/workspace_v12` and every `.c` in `~/dsp_ccs_lab` must
  (a) build with `cl6x` and (b) load and run to completion in the interpreter. Console output
  is compared against golden files, generated once and checked by hand against Python
  transcriptions of the arithmetic, as done previously for Exp 5.
- **Addresses:** for each corpus program, the interpreter's global addresses equal the ELF
  symbol addresses.
- **UI smoke (Playwright for Electron):** open project → build → debug → breakpoint → step →
  open Single Time graph on `y` → the canvas has non-empty data.

## Delivery steps

Each step ends with something runnable.

1. **App shell:** Electron/Vite/React scaffold, CCS-like layout, workspace + Project
   Explorer, Monaco editor tabs with save, Edit/Debug perspective switch, toolbar, Console
   view.
2. **Build phase:** cl6x runner, Build Console, Problems view and squiggles, ELF/map reader →
   ProgramImage, incremental build, Clean/Rebuild.
3. **C front-end:** preprocessor, lexer, parser, type checker, and the corpus parse test.
   Enables the fallback build.
4. **Executor + runtime:** memory model, closure compiler, libc/math/c6x.h, and a headless
   `labsim run` CLI with corpus golden tests.
5. **Debug session:** worker + SharedArrayBuffer protocol, load/run/suspend/terminate/restart,
   breakpoints, stepping, Debug/Variables/Expressions/Breakpoints views, CIO console with
   stdin.
6. **Single Time graph:** properties dialog, decoder, canvas plot, refresh modes, import/export.
7. **Polish:** Memory Browser, New Project wizard, settings page, portable `.exe` packaging.
