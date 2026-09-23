# Step 6: Single Time Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement CCS's **Tools → Graph → Single Time**:
- the Graph Properties dialog, with CCS's property names and defaults, and Import/Export;
- graphs that read the simulated target's memory at the Start Address, decode it with the chosen DSP data type and Q value, and scroll it through the display buffer;
- refresh on every halt and a 100 ms Continuous Refresh while the program runs;
- a CCS-style canvas plot with a cursor readout, zoom, save data (.csv/.dat) and PNG export.

**Architecture:**
- **Start address.** The debugger gains an `address` request, so a Start Address such as `y`, `&x[4]`, `buf+2` or `0x80009498` is evaluated in the selected frame.
- **Reading data.** A graph resolves its address when the target halts, then reads memory with `readMemory`. The debugger answers that even while the program runs (Step 5), which makes Continuous Refresh work on the running target.
- **Graph model.** Decoding, the display buffer, axes, ticks and export formats are pure functions in `src/renderer/src/graph/model.ts`, unit-tested in Node.
- **Store.** `graphStore` owns the graphs, their refresh timers and the properties dialog. It remembers each project's last-used properties.
- **Views.** In CCS Debug, graph windows are tabs in a graph panel beside the editor, drawn on a canvas by `graph/plot.ts`.

**Tech Stack:** React 19, zustand 5, Canvas 2D, Electron dialogs (save/open) over IPC, vitest 4.1, Playwright for Electron. There are no new dependencies.

## Global Constraints

The properties and their defaults, exactly as the spec lists them:

| Group | Property | Default | Values |
|---|---|---|---|
| Data | Acquisition Buffer Size | 1 | ≥1 |
| Data | Dsp Data Type | 32 bit signed integer | 8/16/32/64-bit signed & unsigned integer, 32 bit floating point, 64 bit floating point |
| Data | Index Increment | 1 | ≥1 |
| Data | Interleaved Data Sources | false | bool (a single source has no effect) |
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

Semantics (these match CCS):
1. Each refresh reads `Acquisition Buffer Size` elements from `Start Address`, stepping by `Index Increment` elements, decoded with `Dsp Data Type` and `Q_Value`.
2. The samples are pushed into a display buffer of `Display Data Size`. When the acquisition is smaller than the display, successive refreshes scroll the plot.
3. The x axis is the sample index, or time (index / Sampling Rate) in the chosen unit.

Behaviour:
- **Refresh** happens automatically on every halt (breakpoint, step, suspend, end of program). The graph toolbar has Refresh, Continuous Refresh (every 100 ms while running), Reset Graph, Show Graph Properties, Zoom In/Out/Fit, Save Data (.csv/.dat) and Export Image (.png).
- **Plot style:** white background, grey grid, blue trace, and an x/y readout under the cursor.
- **Graph windows:** several can be open at once, each a tab.
- **Import/Export** save and load a settings file. The last-used settings are remembered per project.
- **Invalid start address:** when the Start Address does not evaluate, the graph shows `Invalid start address: <reason>` in place of the plot.
- **Safety:** never write to `~/workspace_v12` or `~/dsp_ccs_lab`. Write files that contain backslashes with the Write/Edit tools or a `String.raw` node script.

## File map

| File | Responsibility |
|---|---|
| `src/interp/debug/inspect.ts`, `debugger.ts`, `src/shared/debug.ts` | `address` request: Start Address → memory address |
| `src/renderer/src/graph/model.ts` | Properties, defaults, validation, decoding, display buffer, axes, ticks, zoom, CSV/DAT, settings files |
| `src/renderer/src/graph/plot.ts` | Draws a graph on a canvas and maps the cursor to x/y |
| `src/renderer/src/graphStore.ts` | Graphs, the properties dialog, refresh on halt, Continuous Refresh, per-project settings, save/export |
| `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/menu.ts` | `saveFile`/`openTextFile` dialogs; Tools → Graph → Single Time |
| `src/renderer/src/components/GraphPanel.tsx`, `GraphPropertiesDialog.tsx` | The graph panel (tabs, toolbar, canvas) and the dialog |
| `src/main/chosenFiles.ts` | Only paths picked in a save dialog may be written |
| `App.tsx`, `appStore.ts`, `styles.css` | Graph panel beside the editor in CCS Debug, the menu command |
| `tests/e2e/graph.spec.ts` | Open a graph on `y`, run, check the canvas has a trace, invalid address, save CSV |

---

### Task 1: `address` request: Start Address → memory address

A graph's Start Address is a C expression, evaluated in a stack frame like the Expressions view. The rules below give each kind of expression an address:

| Expression | Address |
|---|---|
| array (`y`, `pts`) | where it starts |
| pointer value (`p`, `&x[4]`, `buf+2`) | where it points |
| integer that is not an object (`0x80009498`, `(int)buf + 8`) | that number |
| any other object (`total`, `*p`, `pts[1].y`) | where the object lives (so a scalar can be graphed over time) |
| function | error: `'<name>' is a function` |
| empty text | error: `the Start Address is empty` |

**Files:**
- Modify: `src/shared/debug.ts`: add `AddressResult` and the `address` command.
- Modify: `src/interp/debug/inspect.ts`: add `Inspector.address`, and make `withFrame` generic.
- Modify: `src/interp/debug/debugger.ts`: answer `address`.
- Test: `tests/unit/interp/debug/inspect.test.ts`, `tests/unit/interp/debug/debugger.test.ts`

**Interfaces:**
- Produces: `type AddressResult = { address: number } | { error: string }` (in `@shared/debug`). `DebugCommand` gains `{ cmd: 'address'; frame: number; expr: string }`, whose reply result is an `AddressResult`, never a reply error. `Inspector.address(frame: number, text: string): AddressResult`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('Inspector', …)` block in `tests/unit/interp/debug/inspect.test.ts`:

```ts
  it('resolves graph start addresses', () => {
    pauseAt(8, (ins) => {
      const at = (expr: string): number => Number(ins.evaluate(1, expr).address)
      const a = (expr: string) => ins.address(1, expr)
      expect(a('pts')).toEqual({ address: at('pts') })
      expect(a('&pts[1]')).toEqual({ address: at('pts[1]') })
      expect(a('name + 2')).toEqual({ address: at('name[2]') })
      expect(a('p')).toEqual({ address: at('acc') })
      expect(a('total')).toEqual({ address: at('total') })
      expect(a('pts[1].y')).toEqual({ address: at('pts[1].y') })
      expect(a('0x80009498')).toEqual({ address: 0x80009498 })
      expect(ins.address(0, 'twice')).toEqual({ address: Number(ins.evaluate(0, 'twice').address) })
      expect(a('twice')).toMatchObject({ error: expect.stringMatching(/twice/) })
      expect(a('  ')).toEqual({ error: 'the Start Address is empty' })
      expect(a('scale')).toEqual({ error: "'scale' is a function" })
      expect(a('scale(1, 2)')).toEqual({ error: 'LabSim does not call functions from the Expressions view' })
    })
  })
```

Append to the `describe` block in `tests/unit/interp/debug/debugger.test.ts` that holds `'reads memory for the graphs'`:

```ts
  it('resolves start addresses for the graphs', () => {
    let y = 0
    const { ch } = session(PROGRAM, (image) => {
      y = image.globals.y.addr
      return [{ cmd: 'address', frame: 0, expr: 'y' }, { cmd: 'address', frame: 0, expr: 'nosuch' }, { cmd: 'terminate' }]
    })
    expect(ch.reply(1)).toEqual({ address: y })
    expect(ch.reply(2)).toMatchObject({ error: expect.stringMatching(/nosuch/) })
  })
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/interp/debug`
Expected: FAIL. `ins.address is not a function`, and TypeScript/vitest reports the unknown `address` command reply as `{ error: 'unexpected request address' }`.

- [ ] **Step 3: Add the protocol type**

In `src/shared/debug.ts`, add `| { cmd: 'address'; frame: number; expr: string }` to `DebugCommand` after the `readMemory` line. Then add this after the `StopReason` line:

```ts
/** Where a graph's Start Address expression points, or why it does not evaluate. */
export type AddressResult = { address: number } | { error: string }
```

- [ ] **Step 4: Implement `Inspector.address`**

In `src/interp/debug/inspect.ts`:

1. Change the import to `import type { AddressResult, FrameInfo, NumberFormat, VarNode } from '@shared/debug'`.
2. Replace `withFrame` with this generic version:

```ts
  /** Runs `run` with the frame pointer of the frame and without bounds notes; runtime errors go to `fail`. */
  private withFrame<T>(ctx: Context, fail: (message: string) => T, run: () => T): T {
    const m = this.m
    const fp = m.fp
    const note = m.note
    m.fp = ctx.fp
    m.note = () => {}
    try {
      return run()
    } catch (err) {
      if (err instanceof Trap || err instanceof LoadError) return fail(err.message)
      throw err
    } finally {
      m.fp = fp
      m.note = note
    }
  }
```

3. In `evaluate`, change `return this.withFrame(ctx, base, () => {` to `return this.withFrame(ctx, (error) => ({ ...base, error }), () => {`.
4. Add this method after `assign`:

```ts
  /** A graph's Start Address: where an array or pointer points, an address constant, or where an object lives. */
  address(frame: number, text: string): AddressResult {
    if (!text.trim()) return { error: 'the Start Address is empty' }
    const r = this.compile(frame, text)
    if ('error' in r) return r
    const { e, ctx } = r
    const t = e.type
    if (t.kind === 'function' || (t.kind === 'pointer' && t.to.kind === 'function')) return { error: `'${text.trim()}' is a function` }
    const byValue = t.kind === 'array' || t.kind === 'pointer' || (t.kind === 'int' && !isLvalue(e))
    if (!byValue && !isLvalue(e)) return { error: `'${text.trim()}' is not an address or an object` }
    return this.withFrame<AddressResult>(ctx, (error) => ({ error }), () => {
      const ex = new ExprCompiler(this.m, ctx.def ? (this.m.scopes.get(ctx.def) ?? NO_FRAME) : NO_FRAME)
      const v = (byValue ? ex.value(e)() : ex.address(e, 'none')()) as number | bigint
      return { address: typeof v === 'bigint' ? Number(BigInt.asUintN(32, v)) : Number(v) >>> 0 }
    })
  }
```

- [ ] **Step 5: Answer the request in the debugger**

In `src/interp/debug/debugger.ts`, in `answer`, add this case after `readMemory`:

```ts
        case 'address':
          this.reply(req.id, this.ins.address(req.frame, req.expr))
          return
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `npx vitest run tests/unit/interp/debug && npm run typecheck`
Expected: all debug tests PASS, and typecheck prints no errors.

If `a('scale')` gives a different result, sema is decaying function names in some other way. Adjust only the function check in `address`, so that the error stays `'scale' is a function`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/debug.ts src/interp/debug/inspect.ts src/interp/debug/debugger.ts tests/unit/interp/debug
git commit -m "feat(debug): resolve a graph's Start Address expression to a memory address"
```

---

### Task 2: Graph model: properties, decoding, display buffer, axes and file formats

Everything here is a pure function, with no DOM access, so it runs in vitest's Node environment. The model makes these choices where the spec leaves room:

- **Use Dc Value For Graph** centres the y range on Dc Value and draws a dashed reference line there. The data is not altered, so the readout and the saved data show the real values.
- **Magnitude Display Scale = Log** plots 20·log10(|v|) in dB. A zero sample leaves a gap.
- **The display buffer** starts empty and keeps the newest `Display Data Size` samples. The x axis always spans `Display Data Size` samples.
- **One refresh** may read at most 1 MiB (`MAX_READ`).
- **`.dat`** uses the CCS data-file header `1651 4 <start address hex> 0 <count hex>`, then one value per line.
- **The settings file** (`.graphProp`) is LabSim's own format: `Property Label=value` lines, with `#` comments. It is not CCS's file format.

**Files:**
- Create: `src/renderer/src/graph/model.ts`
- Test: `tests/unit/graph/model.test.ts`

**Interfaces:**
- Produces (all exported from `src/renderer/src/graph/model.ts`):
  - `DSP_DATA_TYPES`, `type DspDataType`, `PLOT_STYLES`, `GRID_STYLES`, `SCALES`, `TIME_UNITS`
  - `interface GraphProps`, `DEFAULT_PROPS: GraphProps`
  - `interface PropSpec`, `PROPS: PropSpec[]`, `type Draft = Record<keyof GraphProps, string>`
  - `toDraft(p): Draft`, `fromDraft(d): { props: GraphProps } | { error: string }`, `validateProps(p): string | null`
  - `MAX_READ = 1 << 20`, `typeInfo(t): { size; float; signed }`, `readSpan(p): number`
  - `decode(bytes: ArrayLike<number>, p): number[]`, `pushSamples(buffer, samples, size): number[]`
  - `plotValue(v, p): number`, `xValue(i, p): number`, `xLabel(p): string`, `nearestSample(x, p, length): number | null`
  - `interface View { x0; x1; y0; y1 }`, `fitView(buffer, p): View`, `zoomView(v, factor): View`
  - `niceTicks(lo, hi, count): { ticks: number[]; step: number }`, `ticksEvery(lo, hi, step): number[]`, `fmtTick(v, step): string`, `fmtNum(v, digits?): string`
  - `toCsv(buffer, p): string`, `toDat(buffer, p, address): string`, `toSettingsFile(p): string`, `fromSettingsFile(text): { props } | { error }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROPS, decode, fitView, fmtNum, fmtTick, fromDraft, fromSettingsFile, nearestSample, niceTicks, plotValue, pushSamples, readSpan,
  toCsv, toDat, toDraft, toSettingsFile, validateProps, xLabel, xValue, zoomView, type GraphProps
} from '../../../src/renderer/src/graph/model'

const props = (over: Partial<GraphProps>): GraphProps => ({ ...DEFAULT_PROPS, ...over })

function bytes(size: number, write: (v: DataView) => void): number[] {
  const v = new DataView(new ArrayBuffer(size))
  write(v)
  return [...new Uint8Array(v.buffer)]
}

describe('properties', () => {
  it('has CCS defaults', () => {
    expect(DEFAULT_PROPS).toEqual({
      acquisitionBufferSize: 1, dspDataType: '32 bit signed integer', indexIncrement: 1, interleavedDataSources: false, qValue: 0,
      samplingRateHz: 1, startAddress: '', axisDisplay: true, dataPlotStyle: 'Line', displayDataSize: 100, gridStyle: 'Major Grid',
      magnitudeDisplayScale: 'Linear', timeDisplayUnit: 'sample', useDcValueForGraph: false, dcValue: 0
    })
    expect(validateProps(DEFAULT_PROPS)).toBeNull()
  })

  it('parses and validates drafts', () => {
    const d = toDraft(DEFAULT_PROPS)
    expect(d.acquisitionBufferSize).toBe('1')
    expect(d.axisDisplay).toBe('true')
    expect(fromDraft({ ...d, acquisitionBufferSize: ' 128 ', dspDataType: '32 BIT FLOATING POINT', startAddress: ' &x[4] ' })).toEqual({
      props: props({ acquisitionBufferSize: 128, dspDataType: '32 bit floating point', startAddress: '&x[4]' })
    })
    expect(fromDraft({ ...d, acquisitionBufferSize: '0' })).toEqual({ error: 'Acquisition Buffer Size must be a whole number from 1 to 65536' })
    expect(fromDraft({ ...d, qValue: '1.5' })).toEqual({ error: 'Q_Value must be a whole number from 0 to 31' })
    expect(fromDraft({ ...d, samplingRateHz: '0' })).toEqual({ error: 'Sampling Rate Hz must be a number greater than 0' })
    expect(fromDraft({ ...d, dcValue: 'abc' })).toEqual({ error: 'Dc Value must be a number' })
    expect(fromDraft({ ...d, axisDisplay: 'yes' })).toEqual({ error: 'Axis Display must be true or false' })
    expect(fromDraft({ ...d, gridStyle: 'Dotted' })).toEqual({ error: 'Grid Style must be one of: No Grid, Minor Grid, Major Grid' })
    expect(validateProps(props({ acquisitionBufferSize: 65536, indexIncrement: 4, dspDataType: '64 bit floating point' }))).toMatch(/limit is 1048576 bytes/)
  })

  it('writes and reads settings files', () => {
    const p = props({ startAddress: 'buf+2', acquisitionBufferSize: 64, dspDataType: '16 bit signed integer', qValue: 15, gridStyle: 'Minor Grid' })
    const text = toSettingsFile(p)
    expect(text).toContain('Start Address=buf+2\n')
    expect(text).toContain('Dsp Data Type=16 bit signed integer\n')
    expect(fromSettingsFile(text)).toEqual({ props: p })
    expect(fromSettingsFile('# comment\r\nq_value = 3\r\nUnknown=1\r\n')).toEqual({ props: props({ qValue: 3 }) })
    expect(fromSettingsFile('hello')).toEqual({ error: 'This file has no graph properties.' })
    expect(fromSettingsFile('Q_Value=99')).toEqual({ error: 'Q_Value must be a whole number from 0 to 31' })
  })
})

describe('decoding', () => {
  it('reads the span the acquisition needs', () => {
    expect(readSpan(props({ acquisitionBufferSize: 4, indexIncrement: 2, dspDataType: '32 bit floating point' }))).toBe(28)
    expect(readSpan(props({ acquisitionBufferSize: 3, dspDataType: '8 bit unsigned integer' }))).toBe(3)
  })

  it('decodes little-endian data with Q scaling for integer types', () => {
    const s16 = bytes(4, (v) => { v.setInt16(0, -2, true); v.setInt16(2, 3, true) })
    expect(decode(s16, props({ acquisitionBufferSize: 2, dspDataType: '16 bit signed integer', qValue: 1 }))).toEqual([-1, 1.5])
    expect(decode([255], props({ dspDataType: '8 bit unsigned integer' }))).toEqual([255])
    expect(decode([255], props({ dspDataType: '8 bit signed integer' }))).toEqual([-1])
    expect(decode(bytes(4, (v) => v.setUint32(0, 0xffffffff, true)), props({ dspDataType: '32 bit unsigned integer' }))).toEqual([4294967295])
    expect(decode(bytes(8, (v) => v.setBigInt64(0, -5n, true)), props({ dspDataType: '64 bit signed integer' }))).toEqual([-5])
    expect(decode(bytes(8, (v) => v.setFloat64(0, 0.1, true)), props({ dspDataType: '64 bit floating point', qValue: 3 }))).toEqual([0.1])
    const f32 = bytes(16, (v) => [0.5, 1, 2, 4.5].forEach((x, i) => v.setFloat32(i * 4, x, true)))
    expect(decode(f32, props({ acquisitionBufferSize: 2, indexIncrement: 2, dspDataType: '32 bit floating point' }))).toEqual([0.5, 2])
  })

  it('scrolls the display buffer', () => {
    let b: number[] = []
    for (const v of [1, 2, 3, 4]) b = pushSamples(b, [v], 3)
    expect(b).toEqual([2, 3, 4])
    expect(pushSamples([1], [2, 3, 4, 5], 3)).toEqual([3, 4, 5])
  })
})

describe('axes', () => {
  it('maps samples to time units', () => {
    const p = props({ samplingRateHz: 8000, timeDisplayUnit: 'ms' })
    expect(xValue(8, p)).toBeCloseTo(1)
    expect(xLabel(p)).toBe('Time (ms)')
    expect(xLabel(DEFAULT_PROPS)).toBe('Sample')
    expect(nearestSample(1.06, p, 100)).toBe(8)
    expect(nearestSample(-3, DEFAULT_PROPS, 10)).toBe(0)
    expect(nearestSample(3, DEFAULT_PROPS, 0)).toBeNull()
  })

  it('fits, pads and zooms the view', () => {
    const p = props({ displayDataSize: 4 })
    const v = fitView([0, 0.5, 2, 4.5], p)
    expect(v.x0).toBe(0)
    expect(v.x1).toBe(3)
    expect(v.y0).toBeCloseTo(-0.225)
    expect(v.y1).toBeCloseTo(4.725)
    expect(fitView([], p)).toMatchObject({ y0: -1.1, y1: 1.1 })
    const dc = fitView([1, 3], props({ useDcValueForGraph: true, dcValue: 1, displayDataSize: 2 }))
    expect((dc.y0 + dc.y1) / 2).toBeCloseTo(1)
    expect(zoomView({ x0: 0, x1: 10, y0: -2, y1: 2 }, 0.5)).toEqual({ x0: 2.5, x1: 7.5, y0: -1, y1: 1 })
  })

  it('plots log magnitude in dB', () => {
    const p = props({ magnitudeDisplayScale: 'Log' })
    expect(plotValue(-100, p)).toBeCloseTo(40)
    expect(plotValue(0, p)).toBeNaN()
    expect(plotValue(-100, DEFAULT_PROPS)).toBe(-100)
  })

  it('chooses nice ticks and labels', () => {
    expect(niceTicks(0, 99, 5)).toEqual({ ticks: [0, 20, 40, 60, 80], step: 20 })
    expect(niceTicks(-1.1, 1.1, 4)).toEqual({ ticks: [-1, -0.5, 0, 0.5, 1], step: 0.5 })
    expect(fmtTick(0.5, 0.5)).toBe('0.5')
    expect(fmtTick(40, 20)).toBe('40')
    expect(fmtTick(2e7, 1e7)).toBe('2.00e+7')
    expect(fmtNum(0.10000000149011612)).toBe('0.1')
    expect(fmtNum(2147483647)).toBe('2147483647')
  })
})

describe('saved data', () => {
  it('writes CSV with the x unit', () => {
    expect(toCsv([0, 0.5], DEFAULT_PROPS)).toBe('Sample,Value\r\n0,0\r\n1,0.5\r\n')
    expect(toCsv([0.10000000149011612], props({ dspDataType: '32 bit floating point', samplingRateHz: 1000, timeDisplayUnit: 'ms' }))).toBe('Time (ms),Value\r\n0,0.100000001\r\n')
  })

  it('writes CCS .dat files', () => {
    expect(toDat([1, -2], DEFAULT_PROPS, 0x80001000)).toBe('1651 4 80001000 0 2\r\n1\r\n-2\r\n')
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/graph`
Expected: FAIL, because it cannot resolve `../../../src/renderer/src/graph/model`.

- [ ] **Step 3: Implement the model**

Create `src/renderer/src/graph/model.ts`:

```ts
/** The Single Time graph's properties and the pure maths behind it (no DOM). */

export const DSP_DATA_TYPES = [
  '8 bit signed integer',
  '8 bit unsigned integer',
  '16 bit signed integer',
  '16 bit unsigned integer',
  '32 bit signed integer',
  '32 bit unsigned integer',
  '64 bit signed integer',
  '64 bit unsigned integer',
  '32 bit floating point',
  '64 bit floating point'
] as const
export type DspDataType = (typeof DSP_DATA_TYPES)[number]
export const PLOT_STYLES = ['Line', 'Bar'] as const
export const GRID_STYLES = ['No Grid', 'Minor Grid', 'Major Grid'] as const
export const SCALES = ['Linear', 'Log'] as const
export const TIME_UNITS = ['sample', 's', 'ms', 'us'] as const

export interface GraphProps {
  acquisitionBufferSize: number
  dspDataType: DspDataType
  indexIncrement: number
  interleavedDataSources: boolean
  qValue: number
  samplingRateHz: number
  startAddress: string
  axisDisplay: boolean
  dataPlotStyle: (typeof PLOT_STYLES)[number]
  displayDataSize: number
  gridStyle: (typeof GRID_STYLES)[number]
  magnitudeDisplayScale: (typeof SCALES)[number]
  timeDisplayUnit: (typeof TIME_UNITS)[number]
  useDcValueForGraph: boolean
  dcValue: number
}

export const DEFAULT_PROPS: GraphProps = {
  acquisitionBufferSize: 1,
  dspDataType: '32 bit signed integer',
  indexIncrement: 1,
  interleavedDataSources: false,
  qValue: 0,
  samplingRateHz: 1,
  startAddress: '',
  axisDisplay: true,
  dataPlotStyle: 'Line',
  displayDataSize: 100,
  gridStyle: 'Major Grid',
  magnitudeDisplayScale: 'Linear',
  timeDisplayUnit: 'sample',
  useDcValueForGraph: false,
  dcValue: 0
}

type Key = keyof GraphProps

export interface PropSpec {
  key: Key
  label: string
  group: 'Data' | 'Display'
  kind: 'int' | 'number' | 'positive' | 'bool' | 'enum' | 'text'
  options?: readonly string[]
  min?: number
  max?: number
  /** Shown in the dialog only while this property is true. */
  when?: Key
}

export const MAX_ELEMENTS = 65536
/** Bytes one refresh may read. */
export const MAX_READ = 1 << 20

/** The dialog's rows, in CCS's order. */
export const PROPS: PropSpec[] = [
  { key: 'acquisitionBufferSize', label: 'Acquisition Buffer Size', group: 'Data', kind: 'int', min: 1, max: MAX_ELEMENTS },
  { key: 'dspDataType', label: 'Dsp Data Type', group: 'Data', kind: 'enum', options: DSP_DATA_TYPES },
  { key: 'indexIncrement', label: 'Index Increment', group: 'Data', kind: 'int', min: 1, max: MAX_ELEMENTS },
  { key: 'interleavedDataSources', label: 'Interleaved Data Sources', group: 'Data', kind: 'bool' },
  { key: 'qValue', label: 'Q_Value', group: 'Data', kind: 'int', min: 0, max: 31 },
  { key: 'samplingRateHz', label: 'Sampling Rate Hz', group: 'Data', kind: 'positive' },
  { key: 'startAddress', label: 'Start Address', group: 'Data', kind: 'text' },
  { key: 'axisDisplay', label: 'Axis Display', group: 'Display', kind: 'bool' },
  { key: 'dataPlotStyle', label: 'Data Plot Style', group: 'Display', kind: 'enum', options: PLOT_STYLES },
  { key: 'displayDataSize', label: 'Display Data Size', group: 'Display', kind: 'int', min: 1, max: MAX_ELEMENTS },
  { key: 'gridStyle', label: 'Grid Style', group: 'Display', kind: 'enum', options: GRID_STYLES },
  { key: 'magnitudeDisplayScale', label: 'Magnitude Display Scale', group: 'Display', kind: 'enum', options: SCALES },
  { key: 'timeDisplayUnit', label: 'Time Display Unit', group: 'Display', kind: 'enum', options: TIME_UNITS },
  { key: 'useDcValueForGraph', label: 'Use Dc Value For Graph', group: 'Display', kind: 'bool' },
  { key: 'dcValue', label: 'Dc Value', group: 'Display', kind: 'number', when: 'useDcValueForGraph' }
]

/** The dialog's text for each property (booleans as 'true' / 'false'). */
export type Draft = Record<Key, string>

export function toDraft(p: GraphProps): Draft {
  const d = {} as Draft
  for (const s of PROPS) d[s.key] = String(p[s.key])
  return d
}

function parseField(s: PropSpec, raw: string): { value: unknown } | { error: string } {
  const text = raw.trim()
  const n = text === '' ? NaN : Number(text)
  switch (s.kind) {
    case 'int':
      return Number.isInteger(n) && n >= (s.min ?? -Infinity) && n <= (s.max ?? Infinity)
        ? { value: n }
        : { error: `${s.label} must be a whole number from ${s.min} to ${s.max}` }
    case 'positive':
      return Number.isFinite(n) && n > 0 ? { value: n } : { error: `${s.label} must be a number greater than 0` }
    case 'number':
      return Number.isFinite(n) ? { value: n } : { error: `${s.label} must be a number` }
    case 'bool':
      return /^(true|false)$/i.test(text) ? { value: text.toLowerCase() === 'true' } : { error: `${s.label} must be true or false` }
    case 'enum': {
      const option = s.options?.find((o) => o.toLowerCase() === text.toLowerCase())
      return option ? { value: option } : { error: `${s.label} must be one of: ${s.options?.join(', ')}` }
    }
    default:
      return { value: text }
  }
}

export function fromDraft(d: Draft): { props: GraphProps } | { error: string } {
  const p = { ...DEFAULT_PROPS } as Record<Key, unknown>
  for (const s of PROPS) {
    const r = parseField(s, d[s.key] ?? '')
    if ('error' in r) return r
    p[s.key] = r.value
  }
  const props = p as unknown as GraphProps
  const span = readSpan(props)
  if (span > MAX_READ) {
    return { error: `The graph would read ${span} bytes per refresh; the limit is ${MAX_READ} bytes (lower Acquisition Buffer Size or Index Increment)` }
  }
  return { props }
}

export function validateProps(p: GraphProps): string | null {
  const r = fromDraft(toDraft(p))
  return 'error' in r ? r.error : null
}

export function typeInfo(t: DspDataType): { size: number; float: boolean; signed: boolean } {
  return { size: Number(t.split(' ')[0]) / 8, float: t.endsWith('floating point'), signed: !t.includes('unsigned') }
}

/** Bytes from the Start Address to the end of the last element one refresh reads. */
export function readSpan(p: GraphProps): number {
  return ((p.acquisitionBufferSize - 1) * p.indexIncrement + 1) * typeInfo(p.dspDataType).size
}

/** The C6748 is little-endian; integer types are scaled by 2^-Q. */
export function decode(bytes: ArrayLike<number>, p: GraphProps): number[] {
  const { size, float, signed } = typeInfo(p.dspDataType)
  const view = new DataView(Uint8Array.from(bytes).buffer)
  const scale = float ? 1 : 2 ** p.qValue
  const out: number[] = []
  for (let i = 0; i < p.acquisitionBufferSize; i++) {
    const at = i * p.indexIncrement * size
    let v: number
    if (size === 1) v = signed ? view.getInt8(at) : view.getUint8(at)
    else if (size === 2) v = signed ? view.getInt16(at, true) : view.getUint16(at, true)
    else if (size === 4) v = float ? view.getFloat32(at, true) : signed ? view.getInt32(at, true) : view.getUint32(at, true)
    else v = float ? view.getFloat64(at, true) : Number(signed ? view.getBigInt64(at, true) : view.getBigUint64(at, true))
    out.push(v / scale)
  }
  return out
}

/** Appends a refresh's samples and keeps the newest `size` (CCS's scrolling display buffer). */
export function pushSamples(buffer: number[], samples: number[], size: number): number[] {
  const all = buffer.concat(samples)
  return all.length > size ? all.slice(all.length - size) : all
}

/** The y value drawn for a sample: the sample, or its magnitude in dB on the Log scale (NaN for 0). */
export function plotValue(v: number, p: GraphProps): number {
  if (p.magnitudeDisplayScale === 'Linear') return v
  return Math.abs(v) < 1e-30 ? NaN : 20 * Math.log10(Math.abs(v))
}

const UNIT_SCALE = { sample: 1, s: 1, ms: 1e3, us: 1e6 } as const

export function xValue(i: number, p: GraphProps): number {
  return p.timeDisplayUnit === 'sample' ? i : (i / p.samplingRateHz) * UNIT_SCALE[p.timeDisplayUnit]
}

export function xLabel(p: GraphProps): string {
  return p.timeDisplayUnit === 'sample' ? 'Sample' : `Time (${p.timeDisplayUnit})`
}

/** The buffer index nearest to x, or null for an empty buffer. */
export function nearestSample(x: number, p: GraphProps, length: number): number | null {
  if (length === 0) return null
  const i = p.timeDisplayUnit === 'sample' ? x : (x / UNIT_SCALE[p.timeDisplayUnit]) * p.samplingRateHz
  return Math.min(length - 1, Math.max(0, Math.round(i)))
}

export interface View {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** The whole display buffer on x; the data (or ±1) on y with a 5% margin, centred on Dc Value when it is used. */
export function fitView(buffer: number[], p: GraphProps): View {
  const n = Math.max(p.displayDataSize, 2)
  let lo = Infinity
  let hi = -Infinity
  for (const v of buffer) {
    const y = plotValue(v, p)
    if (!Number.isFinite(y)) continue
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  if (lo > hi) {
    lo = -1
    hi = 1
  }
  if (p.useDcValueForGraph && p.magnitudeDisplayScale === 'Linear') {
    const r = Math.max(Math.abs(hi - p.dcValue), Math.abs(lo - p.dcValue)) || 1
    lo = p.dcValue - r
    hi = p.dcValue + r
  }
  if (lo === hi) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.05
  return { x0: xValue(0, p), x1: xValue(n - 1, p), y0: lo - pad, y1: hi + pad }
}

/** Scales the view about its centre (factor < 1 zooms in). */
export function zoomView(v: View, factor: number): View {
  const cx = (v.x0 + v.x1) / 2
  const cy = (v.y0 + v.y1) / 2
  return { x0: cx - (cx - v.x0) * factor, x1: cx + (v.x1 - cx) * factor, y0: cy - (cy - v.y0) * factor, y1: cy + (v.y1 - cy) * factor }
}

export function ticksEvery(lo: number, hi: number, step: number): number[] {
  const out: number[] = []
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && out.length < 1000; k++) out.push(Number((k * step).toPrecision(12)))
  return out
}

/** About `count` ticks at a 1/2/5 × 10^k step. */
export function niceTicks(lo: number, hi: number, count: number): { ticks: number[]; step: number } {
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(span)) return { ticks: [lo], step: 1 }
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
  return { ticks: ticksEvery(lo, hi, step), step }
}

export function fmtTick(v: number, step: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-4) return v.toExponential(2)
  return v.toFixed(Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))))
}

/** A value with at most `digits` significant digits; integers in full. */
export function fmtNum(v: number, digits = 7): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(digits)))
}

/** Digits that round-trip the data type (9 for float, 17 otherwise). */
const savedDigits = (p: GraphProps): number => (p.dspDataType === '32 bit floating point' ? 9 : 17)

export function toCsv(buffer: number[], p: GraphProps): string {
  const rows = buffer.map((v, i) => `${fmtNum(xValue(i, p), 12)},${fmtNum(v, savedDigits(p))}`)
  return [`${xLabel(p)},Value`, ...rows].join('\r\n') + '\r\n'
}

/** CCS data file: `1651 <format 4 = float> <start address> <page 0> <count>`, both numbers in hex. */
export function toDat(buffer: number[], p: GraphProps, address: number | null): string {
  const head = `1651 4 ${(address ?? 0).toString(16).padStart(8, '0')} 0 ${buffer.length.toString(16)}`
  return [head, ...buffer.map((v) => fmtNum(v, savedDigits(p)))].join('\r\n') + '\r\n'
}

export const SETTINGS_HEADER = '# DSP LabSim Single Time graph properties'

export function toSettingsFile(p: GraphProps): string {
  const d = toDraft(p)
  return [SETTINGS_HEADER, ...PROPS.map((s) => `${s.label}=${d[s.key]}`)].join('\n') + '\n'
}

/** Reads `Label=value` lines (any case, `#` comments); missing properties keep their defaults. */
export function fromSettingsFile(text: string): { props: GraphProps } | { error: string } {
  const d = toDraft(DEFAULT_PROPS)
  let found = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const eq = line.indexOf('=')
    if (!line || line.startsWith('#') || eq < 0) continue
    const label = line.slice(0, eq).trim().toLowerCase()
    const spec = PROPS.find((s) => s.label.toLowerCase() === label)
    if (!spec) continue
    d[spec.key] = line.slice(eq + 1).trim()
    found++
  }
  return found === 0 ? { error: 'This file has no graph properties.' } : fromDraft(d)
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/graph && npm run typecheck`
Expected: PASS, and typecheck prints no errors. `fmtNum(0.10000000149011612)` gives `0.1` at 7 digits, and the CSV row gives `0.100000001` at 9 digits.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/graph/model.ts tests/unit/graph/model.test.ts
git commit -m "feat(graph): Single Time properties, decoder, display buffer, axes and data files"
```

---

### Task 3: Canvas plot in CCS style

**Files:**
- Create: `src/renderer/src/graph/plot.ts`
- Test: `tests/unit/graph/plot.test.ts`

**Interfaces:**
- Consumes (Task 2): `GraphProps`, `View`, `fmtTick`, `niceTicks`, `ticksEvery`, `plotValue`, `xLabel`, `xValue`.
- Produces:
  - `interface Rect { left; top; right; bottom }`, `layoutFor(width, height, axisDisplay): Rect`
  - `toPx(r, v, x, y): [number, number]`, `fromPx(r, v, px, py): [number, number]`
  - `type Ctx2D` (the subset of `CanvasRenderingContext2D` it uses), `COLORS`
  - `interface PlotInput { buffer; props; view; width; height }`, `drawGraph(ctx: Ctx2D, input: PlotInput): number` (returns the number of samples drawn)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph/plot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROPS, type GraphProps } from '../../../src/renderer/src/graph/model'
import { COLORS, drawGraph, fromPx, layoutFor, toPx, type Ctx2D } from '../../../src/renderer/src/graph/plot'

/** Records calls and the style in force at each call. */
function recorder() {
  const calls: { op: string; args: unknown[]; strokeStyle: unknown; fillStyle: unknown }[] = []
  const ctx: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'start', textBaseline: 'alphabetic' }
  for (const op of ['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText', 'save', 'restore', 'rect', 'clip', 'setLineDash']) {
    ctx[op] = (...args: unknown[]) => calls.push({ op, args, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle })
  }
  return { ctx: ctx as unknown as Ctx2D, calls }
}

const props = (over: Partial<GraphProps>): GraphProps => ({ ...DEFAULT_PROPS, displayDataSize: 4, ...over })
const view = { x0: 0, x1: 3, y0: -1, y1: 5 }

describe('plot', () => {
  it('maps values to pixels and back', () => {
    const r = layoutFor(400, 300, true)
    expect(r).toEqual({ left: 64, top: 10, right: 386, bottom: 264 })
    const [px, py] = toPx(r, view, 1.5, 2)
    expect(px).toBeCloseTo(225)
    expect(py).toBeCloseTo(137)
    const [x, y] = fromPx(r, view, px, py)
    expect(x).toBeCloseTo(1.5)
    expect(y).toBeCloseTo(2)
    expect(layoutFor(400, 300, false)).toEqual({ left: 4, top: 4, right: 396, bottom: 296 })
  })

  it('draws a blue line through every sample, with axes and a grid', () => {
    const { ctx, calls } = recorder()
    const n = drawGraph(ctx, { buffer: [0, 0.5, 2, 4.5], props: props({}), view, width: 400, height: 300 })
    expect(n).toBe(4)
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 400, 300], fillStyle: COLORS.background })
    expect(calls.filter((c) => c.op === 'lineTo' && c.strokeStyle === COLORS.trace)).toHaveLength(3)
    expect(calls.some((c) => c.op === 'stroke' && c.strokeStyle === COLORS.major)).toBe(true)
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toContain('Sample')
  })

  it('breaks the line at gaps and hides axes and grid on request', () => {
    const { ctx, calls } = recorder()
    const n = drawGraph(ctx, {
      buffer: [1, 0, 100, 10],
      props: props({ magnitudeDisplayScale: 'Log', axisDisplay: false, gridStyle: 'No Grid' }),
      view: { x0: 0, x1: 3, y0: -10, y1: 50 },
      width: 200,
      height: 100
    })
    expect(n).toBe(3)
    expect(calls.filter((c) => c.op === 'moveTo' && c.strokeStyle === COLORS.trace)).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'fillText')).toHaveLength(0)
    expect(calls.some((c) => c.strokeStyle === COLORS.major || c.strokeStyle === COLORS.minor)).toBe(false)
  })

  it('draws bars, the minor grid and the DC reference line', () => {
    const { ctx, calls } = recorder()
    drawGraph(ctx, {
      buffer: [1, 2, 3],
      props: props({ dataPlotStyle: 'Bar', gridStyle: 'Minor Grid', useDcValueForGraph: true, dcValue: 2 }),
      view,
      width: 400,
      height: 300
    })
    expect(calls.filter((c) => c.op === 'fillRect' && c.fillStyle === COLORS.trace)).toHaveLength(3)
    expect(calls.some((c) => c.op === 'stroke' && c.strokeStyle === COLORS.minor)).toBe(true)
    expect(calls.some((c) => c.op === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(true)
  })

  it('marks a lone sample', () => {
    const { ctx, calls } = recorder()
    expect(drawGraph(ctx, { buffer: [2], props: props({}), view, width: 400, height: 300 })).toBe(1)
    expect(calls.some((c) => c.op === 'fillRect' && c.fillStyle === COLORS.trace)).toBe(true)
  })
})
```

Here is where the numbers in the first test come from. The layout at 400×300 with axes is left 64, top 10, right 400−14 = 386, bottom 300−36 = 264. x = 1.5 of 0..3 gives 64 + 0.5·322 = 225. y = 2 of −1..5 gives 264 − 0.5·254 = 137.

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/graph/plot.test.ts`
Expected: FAIL, because it cannot resolve `plot`.

- [ ] **Step 3: Implement the plot**

Create `src/renderer/src/graph/plot.ts`:

```ts
import { fmtTick, niceTicks, plotValue, ticksEvery, xLabel, xValue, type GraphProps, type View } from './model'

/** The plot area inside the canvas, in CSS pixels. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export function layoutFor(width: number, height: number, axisDisplay: boolean): Rect {
  return axisDisplay
    ? { left: 64, top: 10, right: Math.max(65, width - 14), bottom: Math.max(11, height - 36) }
    : { left: 4, top: 4, right: Math.max(5, width - 4), bottom: Math.max(5, height - 4) }
}

export function toPx(r: Rect, v: View, x: number, y: number): [number, number] {
  return [r.left + ((x - v.x0) / (v.x1 - v.x0)) * (r.right - r.left), r.bottom - ((y - v.y0) / (v.y1 - v.y0)) * (r.bottom - r.top)]
}

export function fromPx(r: Rect, v: View, px: number, py: number): [number, number] {
  return [v.x0 + ((px - r.left) / (r.right - r.left)) * (v.x1 - v.x0), v.y0 + ((r.bottom - py) / (r.bottom - r.top)) * (v.y1 - v.y0)]
}

export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'strokeRect' | 'beginPath'
  | 'moveTo' | 'lineTo' | 'stroke' | 'fillText' | 'save' | 'restore' | 'rect' | 'clip' | 'setLineDash'
>

/** CCS's graph colours. */
export const COLORS = {
  background: '#ffffff',
  major: '#c0c0c0',
  minor: '#e6e6e6',
  frame: '#808080',
  text: '#000000',
  trace: '#0000ff',
  reference: '#808080'
}

export interface PlotInput {
  buffer: number[]
  props: GraphProps
  view: View
  width: number
  height: number
}

function grid(ctx: Ctx2D, r: Rect, v: View, xs: number[], ys: number[], color: string): void {
  ctx.strokeStyle = color
  ctx.beginPath()
  for (const x of xs) {
    const sx = Math.round(toPx(r, v, x, 0)[0]) + 0.5
    ctx.moveTo(sx, r.top)
    ctx.lineTo(sx, r.bottom)
  }
  for (const y of ys) {
    const sy = Math.round(toPx(r, v, 0, y)[1]) + 0.5
    ctx.moveTo(r.left, sy)
    ctx.lineTo(r.right, sy)
  }
  ctx.stroke()
}

/** Draws a Single Time graph; returns how many samples were plotted. */
export function drawGraph(ctx: Ctx2D, { buffer, props, view, width, height }: PlotInput): number {
  const r = layoutFor(width, height, props.axisDisplay)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, width, height)
  ctx.lineWidth = 1
  const xt = niceTicks(view.x0, view.x1, Math.max(2, Math.floor((r.right - r.left) / 80)))
  const yt = niceTicks(view.y0, view.y1, Math.max(2, Math.floor((r.bottom - r.top) / 40)))
  if (props.gridStyle === 'Minor Grid') {
    grid(ctx, r, view, ticksEvery(view.x0, view.x1, xt.step / 5), ticksEvery(view.y0, view.y1, yt.step / 5), COLORS.minor)
  }
  if (props.gridStyle !== 'No Grid') grid(ctx, r, view, xt.ticks, yt.ticks, COLORS.major)

  const dc = props.useDcValueForGraph && props.magnitudeDisplayScale === 'Linear'
  if (dc) {
    const sy = Math.round(toPx(r, view, 0, props.dcValue)[1]) + 0.5
    ctx.strokeStyle = COLORS.reference
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(r.left, sy)
    ctx.lineTo(r.right, sy)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top)
  ctx.clip()
  ctx.strokeStyle = COLORS.trace
  ctx.fillStyle = COLORS.trace
  let drawn = 0
  let last = null as [number, number] | null
  if (props.dataPlotStyle === 'Bar') {
    const w = Math.max(1, Math.abs(toPx(r, view, xValue(1, props), 0)[0] - toPx(r, view, xValue(0, props), 0)[0]) * 0.6)
    const base = toPx(r, view, 0, dc ? props.dcValue : Math.min(Math.max(0, view.y0), view.y1))[1]
    buffer.forEach((v, i) => {
      const y = plotValue(v, props)
      if (!Number.isFinite(y)) return
      const [px, py] = toPx(r, view, xValue(i, props), y)
      ctx.fillRect(px - w / 2, Math.min(py, base), w, Math.max(1, Math.abs(base - py)))
      drawn++
    })
  } else {
    ctx.beginPath()
    let pen = false
    buffer.forEach((v, i) => {
      const y = plotValue(v, props)
      if (!Number.isFinite(y)) {
        pen = false
        return
      }
      const [px, py] = toPx(r, view, xValue(i, props), y)
      if (pen) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
      pen = true
      last = [px, py]
      drawn++
    })
    ctx.stroke()
    if (drawn === 1 && last) ctx.fillRect(last[0] - 1.5, last[1] - 1.5, 3, 3)
  }
  ctx.restore()

  if (props.axisDisplay) {
    ctx.strokeStyle = COLORS.frame
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, r.right - r.left, r.bottom - r.top)
    ctx.fillStyle = COLORS.text
    ctx.font = '11px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const x of xt.ticks) ctx.fillText(fmtTick(x, xt.step), toPx(r, view, x, 0)[0], r.bottom + 4)
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(xLabel(props), (r.left + r.right) / 2, height - 3)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const y of yt.ticks) ctx.fillText(fmtTick(y, yt.step), r.left - 6, toPx(r, view, 0, y)[1])
    if (props.magnitudeDisplayScale === 'Log') {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('dB', 4, r.top)
    }
  }
  return drawn
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/graph && npm run typecheck`
Expected: PASS, and typecheck prints no errors.


- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/graph/plot.ts tests/unit/graph/plot.test.ts
git commit -m "feat(graph): CCS-style canvas plot with grid, axes, line/bar trace and DC line"
```

---

### Task 4: File dialogs and the Tools → Graph → Single Time menu item

Graph data, images and settings files are saved wherever the user chooses. The renderer cannot write arbitrary paths. It may write only a path that the save dialog returned in this run of the app.

**Files:**
- Create: `src/main/chosenFiles.ts`
- Modify: `src/shared/api.ts`: add `FileDialogOptions`, three API methods, and the `tools.graphSingleTime` menu command.
- Modify: `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/menu.ts:46`
- Modify: `tests/unit/store.test.ts`, `tests/unit/debugStore.test.ts`: the fake APIs gain the three methods.
- Test: `tests/unit/chosenFiles.test.ts`

**Interfaces:**
- Produces, in `@shared/api`:
  - `interface FileDialogOptions { title: string; defaultName?: string; filters: { name: string; extensions: string[] }[] }`
  - `LabsimApi.chooseSaveFile(opts): Promise<string | null>`
  - `LabsimApi.writeChosenFile(path: string, data: string, encoding: 'utf8' | 'base64'): Promise<void>`
  - `LabsimApi.openTextFile(opts): Promise<{ path: string; content: string } | null>`
  - `MenuCommand` gains `'tools.graphSingleTime'`.
- Produces, in `src/main/chosenFiles.ts`: `class ChosenFiles { add(p: string): void; assert(p: string): string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chosenFiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ChosenFiles } from '../../src/main/chosenFiles'

describe('ChosenFiles', () => {
  it('allows only paths the save dialog returned', () => {
    const c = new ChosenFiles()
    c.add('C:\\data\\y.csv')
    expect(c.assert('c:\\DATA\\y.csv')).toBe('c:\\DATA\\y.csv')
    expect(c.assert('C:/data/./y.csv')).toBe('C:/data/./y.csv')
    expect(() => c.assert('C:\\Windows\\win.ini')).toThrow('C:\\Windows\\win.ini was not chosen in a save dialog')
  })
})
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/chosenFiles.test.ts`
Expected: FAIL, because it cannot resolve `chosenFiles`.

- [ ] **Step 3: Implement `ChosenFiles`**

Create `src/main/chosenFiles.ts`:

```ts
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
```

- [ ] **Step 4: Run the test and check it passes**

Run: `npx vitest run tests/unit/chosenFiles.test.ts`
Expected: PASS

- [ ] **Step 5: Add the API, preload and IPC handlers**

In `src/shared/api.ts`:
1. Add `| 'tools.graphSingleTime'` to `MenuCommand`, after `'window.compilerLocation'`.
2. Add this interface after `FileNode`:

```ts
export interface FileDialogOptions {
  title: string
  /** File name (or path) the dialog starts with. */
  defaultName?: string
  filters: { name: string; extensions: string[] }[]
}
```

3. Add these methods at the end of `LabsimApi`:

```ts
  /** A save dialog; resolves to the chosen path (writable with writeChosenFile) or null if cancelled. */
  chooseSaveFile(opts: FileDialogOptions): Promise<string | null>
  /** Writes a file the user picked with chooseSaveFile. */
  writeChosenFile(path: string, data: string, encoding: 'utf8' | 'base64'): Promise<void>
  /** An open dialog for a text file; resolves to its path and content, or null if cancelled. */
  openTextFile(opts: FileDialogOptions): Promise<{ path: string; content: string } | null>
```

In `src/preload/index.ts`, add these after `onDebugEvent`'s closing `},`:

```ts
  chooseSaveFile: (opts) => ipcRenderer.invoke('file:chooseSave', opts),
  writeChosenFile: (path, data, encoding) => ipcRenderer.invoke('file:writeChosen', path, data, encoding),
  openTextFile: (opts) => ipcRenderer.invoke('file:openText', opts)
```

In `src/main/ipc.ts`:
1. Add the imports `import { promises as fs } from 'fs'`, `import type { FileDialogOptions } from '@shared/api'` and `import { ChosenFiles } from './chosenFiles'`.
2. Add this at the end of `registerIpc`:

```ts
  const chosen = new ChosenFiles()
  ipcMain.handle('file:chooseSave', async (_e, o: FileDialogOptions) => {
    const win = ctx.getWindow()
    const options = { title: o.title, defaultPath: o.defaultName, filters: o.filters }
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return null
    chosen.add(r.filePath)
    return r.filePath
  })
  ipcMain.handle('file:writeChosen', async (_e, p: string, data: string, encoding: 'utf8' | 'base64') => {
    await fs.writeFile(chosen.assert(p), Buffer.from(data, encoding))
  })
  ipcMain.handle('file:openText', async (_e, o: FileDialogOptions) => {
    const win = ctx.getWindow()
    const options = { title: o.title, defaultPath: o.defaultName, filters: o.filters, properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || r.filePaths.length === 0) return null
    return { path: r.filePaths[0], content: await fs.readFile(r.filePaths[0], 'utf8') }
  })
```

In `src/main/menu.ts`, replace the Tools line with:

```ts
    { label: 'Tools', submenu: [{ label: 'Graph', submenu: [{ label: 'Single Time', click: send('tools.graphSingleTime') }] }] },
```

- [ ] **Step 6: Give the test fakes the new methods**

In `tests/unit/store.test.ts`, in the `api: FakeApi = { … }` literal, add:

```ts
    chooseSaveFile: async () => null,
    writeChosenFile: async () => {},
    openTextFile: async () => null,
```

Add the same three lines to the object returned by `fakeApi()` in `tests/unit/debugStore.test.ts`, after `onDebugEvent`.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck prints no errors, and all unit tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/chosenFiles.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts src/main/menu.ts tests/unit
git commit -m "feat(app): save/open dialogs for graph files and the Tools > Graph > Single Time command"
```

---

### Task 5: Graph store: graphs, dialog, refresh on halt, Continuous Refresh, files

**Files:**
- Create: `src/renderer/src/graphStore.ts`
- Test: `tests/unit/graphStore.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `AddressResult`, and the `{ cmd: 'address', frame, expr }` request.
  - Task 2: `DEFAULT_PROPS`, `decode`, `fitView`, `fromSettingsFile`, `pushSamples`, `readSpan`, `toCsv`, `toDat`, `toSettingsFile`, `validateProps`, `zoomView`, `GraphProps`, `View`.
  - Task 4: `api.chooseSaveFile`, `api.writeChosenFile`, `api.openTextFile`.
  - Existing: `AppStore` (`setPerspective`, `selectedProject`) and `SessionStatus`.
- Produces:
  - `interface Graph { id; title; project; props; buffer; address; error; continuous; view }`
  - `interface DebugSource`, `interface KeyValueStorage`
  - `NO_SESSION`, `CONTINUOUS_MS = 100`
  - `createGraphStore(api, app, debug, storage)` returns a zustand vanilla store of `GraphState`, with:
    - fields `graphs`, `active`, `dialog: { graphId: string | null; props: GraphProps } | null`
    - `openNew()`, `showProperties(id)`, `cancelDialog()`, `applyDialog(props): Promise<string | null>`
    - `importProps(): Promise<{ props } | { error } | null>`, `exportProps(props): Promise<void>`
    - `select(id)`, `close(id)`, `refresh(id)`, `reset(id)`, `setContinuous(id, on)`, `zoom(id, 'in' | 'out' | 'fit')`
    - `saveData(id): Promise<void>`, `exportImage(id, pngDataUrl): Promise<void>`
  - `type GraphStore = ReturnType<typeof createGraphStore>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graphStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { FileDialogOptions, LabsimApi } from '@shared/api'
import type { DebugCommand } from '@shared/debug'
import type { SessionStatus } from '../../src/renderer/src/debugStore'
import { DEFAULT_PROPS, type GraphProps } from '../../src/renderer/src/graph/model'
import { createGraphStore, NO_SESSION, type GraphStore } from '../../src/renderer/src/graphStore'
import { createAppStore, type AppStore } from '../../src/renderer/src/store'

const P = 'C:\\ws\\exp11'
const Y = 0x80001000

function f32(values: number[]): number[] {
  const v = new DataView(new ArrayBuffer(values.length * 4))
  values.forEach((x, i) => v.setFloat32(i * 4, x, true))
  return [...new Uint8Array(v.buffer)]
}

function fakeApi() {
  const api = {
    requests: [] as DebugCommand[],
    /** Target memory: address → float32 values. */
    memory: new Map<number, number[]>([[Y, [0, 0.5, 2, 4.5]]]),
    written: [] as { path: string; data: string; encoding: string }[],
    savePath: null as string | null,
    saveOptions: [] as FileDialogOptions[],
    openResult: null as { path: string; content: string } | null,
    debugRequest: async (cmd: DebugCommand): Promise<unknown> => {
      api.requests.push(cmd)
      if (cmd.cmd === 'address') return cmd.expr === 'y' ? { address: Y } : cmd.expr === 'bad' ? { address: 0 } : { error: `identifier "${cmd.expr}" is undefined` }
      if (cmd.cmd === 'readMemory') {
        const vals = api.memory.get(cmd.addr)
        return vals ? f32(vals).slice(0, cmd.length) : null
      }
      return null
    },
    chooseSaveFile: async (o: FileDialogOptions) => {
      api.saveOptions.push(o)
      return api.savePath
    },
    writeChosenFile: async (path: string, data: string, encoding: string) => {
      api.written.push({ path, data, encoding })
    },
    openTextFile: async () => api.openResult
  }
  return api
}

type Mini = { status: SessionStatus; project: string | null; selectedFrame: number }

let api: ReturnType<typeof fakeApi>
let app: AppStore
let debug: StoreApi<Mini>
let storage: Map<string, string>
let graphs: GraphStore
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}
const props = (over: Partial<GraphProps>): GraphProps => ({ ...DEFAULT_PROPS, startAddress: 'y', acquisitionBufferSize: 4, displayDataSize: 4, dspDataType: '32 bit floating point', ...over })
const g0 = () => graphs.getState().graphs[0]

async function open(over: Partial<GraphProps> = {}): Promise<string> {
  graphs.getState().openNew()
  expect(await graphs.getState().applyDialog(props(over))).toBeNull()
  return g0().id
}

beforeEach(() => {
  api = fakeApi()
  app = createAppStore(api as unknown as LabsimApi)
  debug = createStore<Mini>()(() => ({ status: 'suspended', project: P, selectedFrame: 1 }))
  storage = new Map()
  graphs = createGraphStore(api as unknown as LabsimApi, app, debug, { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dialog', () => {
  it('starts from the defaults, then from the project’s last-used properties', async () => {
    graphs.getState().openNew()
    expect(graphs.getState().dialog).toEqual({ graphId: null, props: DEFAULT_PROPS })
    await graphs.getState().applyDialog(props({ qValue: 3 }))
    graphs.getState().openNew()
    expect(graphs.getState().dialog?.props).toEqual(props({ qValue: 3 }))
    debug.setState({ project: 'C:\\ws\\other' })
    graphs.getState().openNew()
    expect(graphs.getState().dialog?.props).toEqual(DEFAULT_PROPS)
  })

  it('rejects invalid properties and keeps the dialog open', async () => {
    graphs.getState().openNew()
    expect(await graphs.getState().applyDialog({ ...DEFAULT_PROPS, qValue: 40 })).toBe('Q_Value must be a whole number from 0 to 31')
    expect(graphs.getState().dialog).not.toBeNull()
    expect(graphs.getState().graphs).toHaveLength(0)
  })

  it('imports and exports settings files', async () => {
    api.savePath = 'C:\\tmp\\g.graphProp'
    await graphs.getState().exportProps(props({ qValue: 2 }))
    expect(api.written[0]).toMatchObject({ path: 'C:\\tmp\\g.graphProp', encoding: 'utf8' })
    api.openResult = { path: 'C:\\tmp\\g.graphProp', content: api.written[0].data }
    expect(await graphs.getState().importProps()).toEqual({ props: props({ qValue: 2 }) })
    api.openResult = null
    expect(await graphs.getState().importProps()).toBeNull()
  })
})

describe('refresh', () => {
  it('opens a graph in CCS Debug, resolves the address in the selected frame and plots the data', async () => {
    const id = await open()
    expect(g0()).toMatchObject({ id, title: 'Single Time - 1', project: P, buffer: [0, 0.5, 2, 4.5], address: Y, error: null })
    expect(graphs.getState()).toMatchObject({ active: id, dialog: null })
    expect(app.getState().perspective).toBe('debug')
    expect(api.requests).toEqual([
      { cmd: 'address', frame: 1, expr: 'y' },
      { cmd: 'readMemory', addr: Y, length: 16 }
    ])
  })

  it('shows why the start address does not evaluate or cannot be read', async () => {
    await open({ startAddress: 'nosuch' })
    expect(g0().error).toBe('Invalid start address: identifier "nosuch" is undefined')
    graphs.getState().showProperties(g0().id)
    await graphs.getState().applyDialog(props({ startAddress: 'bad' }))
    expect(g0().error).toBe('Invalid start address: cannot read 16 bytes at 0x00000000')
  })

  it('scrolls when the acquisition is smaller than the display', async () => {
    const id = await open({ acquisitionBufferSize: 1, displayDataSize: 3 })
    for (const v of [7, 8, 9]) {
      api.memory.set(Y, [v])
      await graphs.getState().refresh(id)
    }
    expect(g0().buffer).toEqual([7, 8, 9])
    graphs.getState().reset(id)
    expect(g0().buffer).toEqual([])
  })

  it('refreshes on every halt in the top frame and forgets addresses when a session starts', async () => {
    await open()
    api.requests.length = 0
    debug.setState({ status: 'running' })
    api.memory.set(Y, [1, 2, 3, 4])
    debug.setState({ status: 'suspended' })
    await settle()
    expect(api.requests[0]).toEqual({ cmd: 'address', frame: 0, expr: 'y' })
    expect(g0().buffer).toEqual([1, 2, 3, 4])
    debug.setState({ status: 'starting' })
    expect(g0().address).toBeNull()
  })

  it('says there is no session instead of reading', async () => {
    debug.setState({ status: 'idle' })
    await open()
    expect(g0().error).toBe(NO_SESSION)
    expect(api.requests).toEqual([])
  })

  it('reads every 100 ms while running with Continuous Refresh, reusing the address', async () => {
    const id = await open({ acquisitionBufferSize: 1, displayDataSize: 10 })
    vi.useFakeTimers()
    api.requests.length = 0
    debug.setState({ status: 'running' })
    graphs.getState().setContinuous(id, true)
    await vi.advanceTimersByTimeAsync(350)
    expect(api.requests.filter((r) => r.cmd === 'readMemory')).toHaveLength(3)
    expect(api.requests.some((r) => r.cmd === 'address')).toBe(false)
    expect(g0().continuous).toBe(true)
    graphs.getState().setContinuous(id, false)
    await vi.advanceTimersByTimeAsync(300)
    expect(api.requests.filter((r) => r.cmd === 'readMemory')).toHaveLength(3)
  })

  it('ignores a read that finishes after the properties changed', async () => {
    const id = await open()
    let release: () => void = () => {}
    const slow = api.debugRequest
    api.debugRequest = async (cmd) => {
      if (cmd.cmd === 'readMemory') await new Promise<void>((r) => (release = r))
      return slow(cmd)
    }
    const pending = graphs.getState().refresh(id)
    await settle()
    graphs.getState().showProperties(id)
    api.debugRequest = slow
    await graphs.getState().applyDialog(props({ acquisitionBufferSize: 2, displayDataSize: 2 }))
    release()
    await pending
    expect(g0().buffer).toEqual([0, 0.5])
  })
})

describe('view and files', () => {
  it('zooms about the centre and fits again', async () => {
    const id = await open()
    graphs.getState().zoom(id, 'in')
    expect(g0().view).toMatchObject({ x0: 0.75, x1: 2.25 })
    graphs.getState().zoom(id, 'out')
    expect(g0().view?.x1).toBeCloseTo(3)
    graphs.getState().zoom(id, 'fit')
    expect(g0().view).toBeNull()
  })

  it('saves CSV or .dat by the chosen extension, and PNG images', async () => {
    const id = await open()
    api.savePath = 'C:\\tmp\\y.csv'
    await graphs.getState().saveData(id)
    expect(api.saveOptions[0]).toMatchObject({ title: 'Save Graph Data', defaultName: 'Single Time - 1.csv' })
    expect(api.written[0]).toEqual({ path: 'C:\\tmp\\y.csv', data: 'Sample,Value\r\n0,0\r\n1,0.5\r\n2,2\r\n3,4.5\r\n', encoding: 'utf8' })
    api.savePath = 'C:\\tmp\\y.DAT'
    await graphs.getState().saveData(id)
    expect(api.written[1].data.startsWith('1651 4 80001000 0 4\r\n')).toBe(true)
    api.savePath = 'C:\\tmp\\y.png'
    await graphs.getState().exportImage(id, 'data:image/png;base64,iVBORw0K')
    expect(api.written[2]).toEqual({ path: 'C:\\tmp\\y.png', data: 'iVBORw0K', encoding: 'base64' })
    api.savePath = null
    await graphs.getState().saveData(id)
    expect(api.written).toHaveLength(3)
  })

  it('closes graphs and stops their timers', async () => {
    const a = await open()
    graphs.getState().openNew()
    await graphs.getState().applyDialog(props({}))
    const b = graphs.getState().graphs[1].id
    expect(graphs.getState().graphs[1].title).toBe('Single Time - 2')
    expect(graphs.getState().active).toBe(b)
    graphs.getState().setContinuous(b, true)
    graphs.getState().close(b)
    expect(graphs.getState().graphs.map((g) => g.id)).toEqual([a])
    expect(graphs.getState().active).toBe(a)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/graphStore.test.ts`
Expected: FAIL, because it cannot resolve `graphStore`.

- [ ] **Step 3: Implement the store**

Create `src/renderer/src/graphStore.ts`:

```ts
import { createStore } from 'zustand/vanilla'
import type { FileDialogOptions, LabsimApi } from '@shared/api'
import type { AddressResult } from '@shared/debug'
import type { SessionStatus } from './debugStore'
import {
  DEFAULT_PROPS, decode, fitView, fromSettingsFile, pushSamples, readSpan, toCsv, toDat, toSettingsFile, validateProps, zoomView,
  type GraphProps, type View
} from './graph/model'
import type { AppStore } from './store'

export interface Graph {
  id: string
  title: string
  /** The project whose remembered properties this graph updates. */
  project: string | null
  props: GraphProps
  /** The display buffer: the newest `displayDataSize` samples. */
  buffer: number[]
  /** Where the last refresh read; Continuous Refresh reuses it while the target runs. */
  address: number | null
  /** Shown in place of the plot. */
  error: string | null
  continuous: boolean
  /** null: fit the data. */
  view: View | null
}

/** What the graphs need from the debug session store. */
export interface DebugSource {
  getState(): { status: SessionStatus; project: string | null; selectedFrame: number }
  subscribe(listener: (state: { status: SessionStatus }, prev: { status: SessionStatus }) => void): () => void
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface GraphState {
  graphs: Graph[]
  active: string | null
  /** The Graph Properties dialog: for a new graph (graphId null) or an open one. */
  dialog: { graphId: string | null; props: GraphProps } | null

  openNew(): void
  showProperties(id: string): void
  cancelDialog(): void
  /** Creates or updates the graph; resolves to a validation error (dialog stays open) or null. */
  applyDialog(props: GraphProps): Promise<string | null>
  importProps(): Promise<{ props: GraphProps } | { error: string } | null>
  exportProps(props: GraphProps): Promise<void>
  select(id: string): void
  close(id: string): void
  refresh(id: string): Promise<void>
  reset(id: string): void
  setContinuous(id: string, on: boolean): void
  zoom(id: string, how: 'in' | 'out' | 'fit'): void
  saveData(id: string): Promise<void>
  exportImage(id: string, pngDataUrl: string): Promise<void>
}

export const NO_SESSION = 'No debug session: start one with Run > Debug (F11).'
export const CONTINUOUS_MS = 100

const HALTED: SessionStatus[] = ['suspended', 'exited', 'halted']
const LIVE: SessionStatus[] = ['running', ...HALTED]
const PROP_FILTERS = [{ name: 'Graph properties', extensions: ['graphProp'] }]
const hex8 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`
const rememberKey = (project: string | null): string => `labsim.graph:${(project ?? '').toLowerCase()}`
/** Drops Electron's "Error invoking remote method 'x': Error: " prefix. */
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function createGraphStore(api: LabsimApi, app: AppStore, debug: DebugSource, storage: KeyValueStorage | null) {
  return createStore<GraphState>()((set, get) => {
    let next = 1
    const timers = new Map<string, ReturnType<typeof setInterval>>()
    const busy = new Set<string>()
    const queued = new Map<string, { resolve: boolean; frame: number }>()

    const find = (id: string): Graph | undefined => get().graphs.find((g) => g.id === id)
    const update = (id: string, patch: Partial<Graph>): void =>
      set((s) => ({ graphs: s.graphs.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
    const currentProject = (): string | null => debug.getState().project ?? app.getState().selectedProject

    const remembered = (project: string | null): GraphProps => {
      try {
        const text = storage?.getItem(rememberKey(project))
        if (text) {
          const p = { ...DEFAULT_PROPS, ...(JSON.parse(text) as Partial<GraphProps>) }
          if (!validateProps(p)) return p
        }
      } catch {
        // unreadable: use the defaults
      }
      return { ...DEFAULT_PROPS }
    }

    const remember = (project: string | null, props: GraphProps): void => {
      try {
        storage?.setItem(rememberKey(project), JSON.stringify(props))
      } catch {
        // storage unavailable: nothing to remember
      }
    }

    const stopTimer = (id: string): void => {
      const t = timers.get(id)
      if (t !== undefined) clearInterval(t)
      timers.delete(id)
    }

    /** One refresh: (re)resolve the Start Address if asked, read, decode and scroll it into the display buffer. */
    const loadOnce = async (id: string, resolve: boolean, frame: number): Promise<void> => {
      const g = find(id)
      if (!g) return
      if (!LIVE.includes(debug.getState().status)) {
        if (g.buffer.length === 0) update(id, { error: NO_SESSION })
        return
      }
      const stale = (): boolean => find(id)?.props !== g.props
      try {
        let address = g.address
        if (resolve || address === null) {
          const r = (await api.debugRequest({ cmd: 'address', frame, expr: g.props.startAddress })) as AddressResult
          if (stale()) return
          if ('error' in r) {
            update(id, { error: `Invalid start address: ${r.error}`, address: null })
            return
          }
          address = r.address
        }
        const length = readSpan(g.props)
        const bytes = (await api.debugRequest({ cmd: 'readMemory', addr: address, length })) as number[] | null
        const now = find(id)
        if (!now || stale()) return
        if (!bytes) {
          update(id, { error: `Invalid start address: cannot read ${length} bytes at ${hex8(address)}`, address })
          return
        }
        update(id, { buffer: pushSamples(now.buffer, decode(bytes, g.props), g.props.displayDataSize), address, error: null })
      } catch (e) {
        if (!stale()) update(id, { error: message(e) })
      }
    }

    /** Refreshes one graph; a refresh asked for while one is in flight runs after it. */
    const load = async (id: string, resolve: boolean, frame: number): Promise<void> => {
      if (busy.has(id)) {
        const q = queued.get(id)
        queued.set(id, { resolve: resolve || (q?.resolve ?? false), frame })
        return
      }
      busy.add(id)
      try {
        await loadOnce(id, resolve, frame)
      } finally {
        busy.delete(id)
      }
      const again = queued.get(id)
      if (again) {
        queued.delete(id)
        await load(id, again.resolve, again.frame)
      }
    }

    debug.subscribe((s, prev) => {
      if (s.status === prev.status) return
      if (s.status === 'starting') set((st) => ({ graphs: st.graphs.map((g) => ({ ...g, address: null })) }))
      if (HALTED.includes(s.status)) for (const g of get().graphs) void load(g.id, true, 0)
    })

    const save = async (title: string, defaultName: string, filters: FileDialogOptions['filters'], data: (path: string) => string, encoding: 'utf8' | 'base64'): Promise<void> => {
      const path = await api.chooseSaveFile({ title, defaultName, filters })
      if (path) await api.writeChosenFile(path, data(path), encoding)
    }

    return {
      graphs: [],
      active: null,
      dialog: null,

      openNew() {
        set({ dialog: { graphId: null, props: remembered(currentProject()) } })
      },

      showProperties(id) {
        const g = find(id)
        if (g) set({ dialog: { graphId: id, props: g.props } })
      },

      cancelDialog() {
        set({ dialog: null })
      },

      async applyDialog(props) {
        const error = validateProps(props)
        if (error) return error
        const dialog = get().dialog
        if (!dialog) return null
        let id = dialog.graphId
        if (id) {
          const g = find(id)
          if (!g) return null
          remember(g.project, props)
          update(id, { props, buffer: [], address: null, error: null, view: null })
        } else {
          const project = currentProject()
          remember(project, props)
          id = `g${next}`
          const g: Graph = { id, title: `Single Time - ${next}`, project, props, buffer: [], address: null, error: null, continuous: false, view: null }
          next++
          set((s) => ({ graphs: [...s.graphs, g] }))
          app.getState().setPerspective('debug')
        }
        set({ dialog: null, active: id })
        await load(id, true, debug.getState().selectedFrame)
        return null
      },

      async importProps() {
        const file = await api.openTextFile({ title: 'Import Graph Properties', filters: PROP_FILTERS })
        return file ? fromSettingsFile(file.content) : null
      },

      async exportProps(props) {
        await save('Export Graph Properties', 'graph.graphProp', PROP_FILTERS, () => toSettingsFile(props), 'utf8')
      },

      select(id) {
        set({ active: id })
      },

      close(id) {
        stopTimer(id)
        queued.delete(id)
        set((s) => {
          const i = s.graphs.findIndex((g) => g.id === id)
          const graphs = s.graphs.filter((g) => g.id !== id)
          const active = s.active !== id ? s.active : ((graphs[i] ?? graphs[i - 1])?.id ?? null)
          return { graphs, active }
        })
      },

      refresh(id) {
        return load(id, true, debug.getState().selectedFrame)
      },

      reset(id) {
        update(id, { buffer: [] })
      },

      setContinuous(id, on) {
        stopTimer(id)
        update(id, { continuous: on })
        if (on) {
          timers.set(id, setInterval(() => {
            if (debug.getState().status === 'running') void load(id, false, 0)
          }, CONTINUOUS_MS))
        }
      },

      zoom(id, how) {
        const g = find(id)
        if (!g) return
        const base = g.view ?? fitView(g.buffer, g.props)
        update(id, { view: how === 'fit' ? null : zoomView(base, how === 'in' ? 0.5 : 2) })
      },

      async saveData(id) {
        const g = find(id)
        if (!g) return
        const filters = [
          { name: 'CSV (comma separated)', extensions: ['csv'] },
          { name: 'CCS data file', extensions: ['dat'] }
        ]
        await save('Save Graph Data', `${g.title}.csv`, filters, (path) => (path.toLowerCase().endsWith('.dat') ? toDat(g.buffer, g.props, g.address) : toCsv(g.buffer, g.props)), 'utf8')
      },

      async exportImage(id, pngDataUrl) {
        const g = find(id)
        if (!g) return
        await save('Export Image', `${g.title}.png`, [{ name: 'PNG image', extensions: ['png'] }], () => pngDataUrl.slice(pngDataUrl.indexOf(',') + 1), 'base64')
      }
    }
  })
}

export type GraphStore = ReturnType<typeof createGraphStore>
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/graphStore.test.ts && npm run typecheck`
Expected: PASS, and typecheck prints no errors.

Four details the tests rely on:
- In the zoom test, the fitted view is x 0..3. Zooming in halves it about 1.5, giving 0.75..2.25.
- In the stale-read test, `applyDialog` replaces `props`. The slow read then sees `stale()` and is dropped, so the buffer holds only the new two-element read.
- In the stale-read test, `applyDialog`'s own load waits in `queued` behind the busy slow refresh, then runs with `resolve: true`.
- `await pending` resolves only after that queued load finishes, so the final buffer is `[0, 0.5]`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/graphStore.ts tests/unit/graphStore.test.ts
git commit -m "feat(graph): graph store with refresh on halt, Continuous Refresh, zoom, per-project properties and files"
```

---

### Task 6: Graph Properties dialog, graph panel and wiring

In the CCS Debug perspective, once a graph is open, the editor area splits: the editor stays on the left and a **graph panel** (one tab per graph) sits on the right. CCS docks graphs beside the editor in the same way, so stepping never hides either one. The Edit perspective does not show graphs.

**Files:**
- Create: `src/renderer/src/components/GraphPropertiesDialog.tsx`, `src/renderer/src/components/GraphPanel.tsx`
- Modify: `src/renderer/src/appStore.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes:
  - Task 2: `PROPS`, `toDraft`, `fromDraft`, `Draft`, `PropSpec`, `fitView`, `fmtNum`, `nearestSample`, `xValue`.
  - Task 3: `drawGraph`, `fromPx`, `layoutFor`.
  - Task 5: `createGraphStore`, `Graph`, `GraphState`.
- Produces:
  - `graphStore` and `useGraphs(selector)` from `appStore.ts`.
  - DOM hooks used by the e2e test in Task 7:
    - the dialog is `role="dialog"` named "Graph Properties", and its fields are labelled with the property names;
    - graph tabs are `.graph-tab`;
    - the canvas is `canvas.graph-canvas`, with `data-points`;
    - the error is `.graph-error`;
    - the toolbar buttons are titled Refresh, Continuous Refresh, Reset Graph, Show Graph Properties, Zoom In, Zoom Out, Zoom Fit, Save Data and Export Image.

- [ ] **Step 1: Create the store instance**

Replace `src/renderer/src/appStore.ts` with:

```ts
import { useStore } from 'zustand'
import { createDebugStore, type DebugState } from './debugStore'
import { createGraphStore, type GraphState, type KeyValueStorage } from './graphStore'
import { createAppStore, type AppState } from './store'

export const appStore = createAppStore(window.labsim)
export const debugStore = createDebugStore(window.labsim, appStore)

/** localStorage, or null where it is unavailable (the graphs then forget their properties). */
function localStore(): KeyValueStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const graphStore = createGraphStore(window.labsim, appStore, debugStore, localStore())

/** Select a slice of app state. Return primitives or existing references only (zustand 5 re-renders on new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector)
}

/** Select a slice of the debug session state (same rule as useApp). */
export function useDebug<T>(selector: (s: DebugState) => T): T {
  return useStore(debugStore, selector)
}

/** Select a slice of the graphs' state (same rule as useApp). */
export function useGraphs<T>(selector: (s: GraphState) => T): T {
  return useStore(graphStore, selector)
}
```

- [ ] **Step 2: Create the Graph Properties dialog**

Create `src/renderer/src/components/GraphPropertiesDialog.tsx`:

```tsx
import { useState, type JSX } from 'react'
import { graphStore, useGraphs } from '../appStore'
import { PROPS, fromDraft, toDraft, type Draft, type GraphProps, type PropSpec } from '../graph/model'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function Field({ spec, value, onChange }: { spec: PropSpec; value: string; onChange: (v: string) => void }): JSX.Element {
  if (spec.kind === 'bool' || spec.kind === 'enum') {
    const options = spec.kind === 'bool' ? ['true', 'false'] : (spec.options ?? [])
    return (
      <select aria-label={spec.label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  return <input aria-label={spec.label} value={value} spellCheck={false} autoFocus={spec.key === 'startAddress'} onChange={(e) => onChange(e.target.value)} />
}

function DialogBody({ initial }: { initial: GraphProps }): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [note, setNote] = useState<string | null>(null)
  const g = graphStore.getState()
  const parsed = fromDraft(draft)
  const error = 'error' in parsed ? parsed.error : null

  const ok = async (): Promise<void> => {
    if ('props' in parsed) setNote(await g.applyDialog(parsed.props))
  }
  const importFile = async (): Promise<void> => {
    try {
      const r = await g.importProps()
      if (!r) return
      if ('error' in r) setNote(r.error)
      else {
        setDraft(toDraft(r.props))
        setNote(null)
      }
    } catch (e) {
      setNote(errorText(e))
    }
  }
  const exportFile = async (): Promise<void> => {
    if (!('props' in parsed)) return
    try {
      await g.exportProps(parsed.props)
    } catch (e) {
      setNote(errorText(e))
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && g.cancelDialog()}>
      <div
        className="modal graph-dialog"
        role="dialog"
        aria-label="Graph Properties"
        onKeyDown={(e) => {
          if (e.key === 'Escape') g.cancelDialog()
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !error) void ok()
        }}
      >
        <div className="modal-title">Graph Properties</div>
        <div className="prop-scroll">
          <table className="grid prop-table">
            <thead>
              <tr><th>Property</th><th>Value</th></tr>
            </thead>
            {(['Data', 'Display'] as const).map((group) => (
              <tbody key={group}>
                <tr className="prop-group"><td colSpan={2}>{group} Properties</td></tr>
                {PROPS.filter((s) => s.group === group && (!s.when || draft[s.when] === 'true')).map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td><Field spec={s} value={draft[s.key]} onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div className="modal-error" role="alert">{note ?? error ?? ''}</div>
        <div className="modal-buttons">
          <button onClick={() => void importFile()}>Import</button>
          <button disabled={!!error} onClick={() => void exportFile()}>Export</button>
          <span className="tb-spacer" />
          <button disabled={!!error} onClick={() => void ok()}>OK</button>
          <button onClick={() => g.cancelDialog()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function GraphPropertiesDialog(): JSX.Element | null {
  const dialog = useGraphs((s) => s.dialog)
  return dialog ? <DialogBody initial={dialog.props} /> : null
}
```

- [ ] **Step 3: Create the graph panel**

Create `src/renderer/src/components/GraphPanel.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import { graphStore, useGraphs } from '../appStore'
import { fitView, fmtNum, nearestSample, xValue } from '../graph/model'
import { drawGraph, fromPx, layoutFor } from '../graph/plot'
import type { Graph } from '../graphStore'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const act = (p: Promise<unknown>): void => {
  p.catch((e) => window.alert(`LabSim: ${errorText(e)}`))
}

function GBtn(props: { title: string; label: string; pressed?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button className={props.pressed ? 'g-btn pressed' : 'g-btn'} title={props.title} aria-label={props.title} aria-pressed={props.pressed} onClick={props.onClick}>
      {props.label}
    </button>
  )
}

function GraphView({ graph }: { graph: Graph }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cursor, setCursor] = useState<string | null>(null)
  const st = graphStore.getState()
  const view = useMemo(() => graph.view ?? fitView(graph.buffer, graph.props), [graph.view, graph.buffer, graph.props])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }))
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.dataset.points = String(drawGraph(ctx, { buffer: graph.buffer, props: graph.props, view, width: size.w, height: size.h }))
  }, [graph.buffer, graph.props, graph.error, view, size])

  const onMove = (e: MouseEvent<HTMLCanvasElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const [x] = fromPx(layoutFor(size.w, size.h, graph.props.axisDisplay), view, e.clientX - box.left, e.clientY - box.top)
    const i = nearestSample(x, graph.props, graph.buffer.length)
    setCursor(i === null ? null : `x: ${fmtNum(xValue(i, graph.props))}   y: ${fmtNum(graph.buffer[i])}`)
  }

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <GBtn title="Refresh" label="Refresh" onClick={() => act(st.refresh(graph.id))} />
        <GBtn title="Continuous Refresh" label="Continuous" pressed={graph.continuous} onClick={() => st.setContinuous(graph.id, !graph.continuous)} />
        <GBtn title="Reset Graph" label="Reset" onClick={() => st.reset(graph.id)} />
        <GBtn title="Show Graph Properties" label="Properties" onClick={() => st.showProperties(graph.id)} />
        <span className="tb-sep" />
        <GBtn title="Zoom In" label="+" onClick={() => st.zoom(graph.id, 'in')} />
        <GBtn title="Zoom Out" label="−" onClick={() => st.zoom(graph.id, 'out')} />
        <GBtn title="Zoom Fit" label="Fit" onClick={() => st.zoom(graph.id, 'fit')} />
        <span className="tb-sep" />
        <GBtn title="Save Data" label="Save Data" onClick={() => act(st.saveData(graph.id))} />
        <GBtn title="Export Image" label="Export Image" onClick={() => canvasRef.current && act(st.exportImage(graph.id, canvasRef.current.toDataURL('image/png')))} />
        <span className="tb-spacer" />
        <span className="graph-readout">{cursor ?? ''}</span>
      </div>
      <div ref={hostRef} className="graph-host">
        {graph.error ? (
          <div className="graph-error" role="alert">{graph.error}</div>
        ) : (
          <canvas ref={canvasRef} className="graph-canvas" style={{ width: size.w, height: size.h }} onMouseMove={onMove} onMouseLeave={() => setCursor(null)} />
        )}
      </div>
    </div>
  )
}

export function GraphPanel(): JSX.Element {
  const graphs = useGraphs((s) => s.graphs)
  const active = useGraphs((s) => s.active)
  const shown = graphs.find((g) => g.id === active) ?? graphs[0]
  const st = graphStore.getState()
  return (
    <div className="view graph-panel">
      <div className="view-tabs">
        {graphs.map((g) => (
          <div key={g.id} className={g.id === shown?.id ? 'vtab graph-tab active' : 'vtab graph-tab'} onMouseDown={() => st.select(g.id)}>
            <span>{g.title}</span>
            <button className="tab-close" aria-label={`Close ${g.title}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => st.close(g.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="view-body graph-body">{shown && <GraphView key={shown.id} graph={shown} />}</div>
    </div>
  )
}
```

- [ ] **Step 4: Wire the menu command and the layout into `App.tsx`**

In `src/renderer/src/App.tsx`:
1. Change the store import to `import { appStore, debugStore, graphStore, useApp, useGraphs } from './appStore'`.
2. Add the imports `import { GraphPanel } from './components/GraphPanel'` and `import { GraphPropertiesDialog } from './components/GraphPropertiesDialog'`.
3. In `handleMenu`, add `case 'tools.graphSingleTime': graphStore.getState().openNew(); break` after the `run.toLine` case.
4. In `App`, add `const graphCount = useGraphs((s) => s.graphs.length)` after `dirtyCount`.
5. Replace the `editorAndConsole` constant with:

```tsx
  const editor =
    perspective === 'debug' && graphCount > 0 ? (
      <Splitter key="with-graphs" direction="row" size={560} fixed="second">
        {[<EditorArea key="editor" />, <GraphPanel key="graphs" />]}
      </Splitter>
    ) : (
      <EditorArea key="editor" />
    )

  const editorAndConsole = (
    <Splitter direction="column" size={220} fixed="second">
      {[editor, <BottomPanel key="bottom" />]}
    </Splitter>
  )
```

6. Render the dialog last inside `<div className="app">`, after the workbench `</div>`: `<GraphPropertiesDialog />`.

- [ ] **Step 5: Add the styles**

Append to `src/renderer/src/styles.css`:

```css
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(30, 35, 45, 0.25); }
.modal { display: flex; flex-direction: column; max-height: 90vh; background: var(--panel); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); }
.modal-title { padding: 8px 12px; font-weight: 600; background: var(--header); border-bottom: 1px solid var(--border); }
.modal-error { min-height: 18px; padding: 4px 12px; color: #c9302c; }
.modal-buttons { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border); }
.modal-buttons button { min-width: 72px; padding: 3px 10px; }
.graph-dialog { width: 520px; }
.prop-scroll { overflow: auto; }
.prop-table { width: 100%; border-collapse: collapse; }
.prop-table td { padding: 2px 6px; border-bottom: 1px solid #eef0f3; }
.prop-table td:first-child { width: 48%; }
.prop-table input, .prop-table select { width: 100%; box-sizing: border-box; font: inherit; }
.prop-group td { font-weight: 600; background: #f7f9fb; }
.graph-panel .view-tabs { overflow-x: auto; }
.graph-tab { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.graph-body { overflow: hidden; }
.graph-view { display: flex; flex-direction: column; height: 100%; }
.graph-toolbar { display: flex; align-items: center; gap: 2px; padding: 2px 4px; border-bottom: 1px solid var(--border); background: var(--header); }
.g-btn { padding: 1px 6px; border: 1px solid transparent; border-radius: 3px; background: none; cursor: pointer; font: inherit; }
.g-btn:hover { border-color: var(--border); background: #fff; }
.g-btn.pressed { border-color: var(--accent); background: var(--select); }
.graph-readout { font-family: Consolas, 'Courier New', monospace; font-size: 12px; color: var(--muted); white-space: nowrap; }
.graph-host { position: relative; flex: 1; min-height: 0; background: #fff; }
.graph-canvas { position: absolute; inset: 0; display: block; }
.graph-error { padding: 12px; color: #c9302c; }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: typecheck prints no errors, all unit tests PASS, and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src
git commit -m "feat(ui): Graph Properties dialog and a docked graph panel with CCS's graph toolbar"
```

---

### Task 7: End-to-end check and documentation

**Files:**
- Create: `tests/e2e/graph.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`: record where the graph departs from CCS or fills in a detail.

**Interfaces:**
- Consumes: Task 4's `tools.graphSingleTime` menu command and `file:chooseSave` handler, plus Task 6's DOM hooks.

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/graph.spec.ts`:

```ts
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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

const FILL = [
  'float y[4];',
  'int main(void)',
  '{',
  '    int i;',
  '    for (i = 0; i < 4; i++)',
  '        y[i] = i * i * 0.5f;',
  '    return 0;',
  '}'
].join('\n') + '\n'

const SPIN = ['volatile int n;', 'int main(void)', '{', '    for (;;)', '        n++;', '}'].join('\n') + '\n'

test.beforeEach(async () => {
  ws = mkdtempSync(join(tmpdir(), 'labsim-graph-'))
  addProject('fill', FILL)
  addProject('spin', SPIN)
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
const dialog = () => page.getByRole('dialog', { name: 'Graph Properties' })
const canvas = () => page.locator('canvas.graph-canvas')

async function debugUntilMain(project: string): Promise<void> {
  await row(project).click()
  await page.getByTitle('Debug (F11)').click()
  await expect(page.locator('.debug-tree')).toContainText('main() at main.c')
}

async function openGraph(fields: Record<string, string>, selects: Record<string, string> = {}): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'tools.graphSingleTime'))
  await expect(dialog()).toBeVisible()
  for (const [label, value] of Object.entries(fields)) await dialog().getByLabel(label, { exact: true }).fill(value)
  for (const [label, value] of Object.entries(selects)) await dialog().getByLabel(label, { exact: true }).selectOption(value)
  await dialog().getByRole('button', { name: 'OK' }).click()
  await expect(dialog()).toBeHidden()
}

test('graphs y at every halt and saves the data as CSV', async () => {
  await debugUntilMain('fill')
  await openGraph({ 'Start Address': 'y', 'Acquisition Buffer Size': '4', 'Display Data Size': '4' }, { 'Dsp Data Type': '32 bit floating point' })
  await expect(page.locator('.graph-tab')).toHaveText(['Single Time - 1'])
  await expect(canvas()).toHaveAttribute('data-points', '4')

  await page.getByTitle('Resume (F8)').click()
  await expect(page.locator('.debug-tree')).toContainText('C$$EXIT')
  const out = join(ws, 'y.csv')
  await app.evaluate(({ dialog: d }, file) => {
    d.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as unknown as typeof d.showSaveDialog
  }, out)
  await expect(async () => {
    await page.getByTitle('Save Data').click()
    expect(readFileSync(out, 'utf8')).toBe('Sample,Value\r\n0,0\r\n1,0.5\r\n2,2\r\n3,4.5\r\n')
  }).toPass()

  await page.getByTitle('Show Graph Properties').click()
  await dialog().getByLabel('Start Address', { exact: true }).fill('nosuch')
  await dialog().getByRole('button', { name: 'OK' }).click()
  await expect(page.locator('.graph-error')).toContainText('Invalid start address:')
  await expect(page.locator('.graph-error')).toContainText('nosuch')
})

test('Continuous Refresh plots a variable while the program runs', async () => {
  await debugUntilMain('spin')
  await openGraph({ 'Start Address': 'n' })
  await page.getByTitle('Continuous Refresh').click()
  await page.getByTitle('Resume (F8)').click()
  await expect.poll(async () => Number(await canvas().getAttribute('data-points')), { timeout: 10000 }).toBeGreaterThan(5)
  await page.getByTitle('Suspend (Alt+F8)').click()
  await expect(page.locator('.debug-tree')).toContainText('(Suspended)')
})
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: all e2e tests PASS: the 14 existing ones and the 2 new ones.

If the `C$$EXIT` check does not match, open `tests/e2e/debug.spec.ts` and copy the exact end-of-program text its last assertion uses.

- [ ] **Step 3: Record the graph notes in the spec**

In `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, add this paragraph block right after the Refresh paragraph of **Single Time graph** (the one ending "…each docked as a tab in the Debug perspective."):

```markdown
**How LabSim fills in the details (Step 6).**
- **Where the graphs appear.** They open in a graph panel to the right of the editor in CCS Debug, with one tab per graph (`Single Time - 1`, `- 2`, …).
- **Start Address.** It is evaluated in the selected stack frame (the top frame at a halt):
  - an array gives where it starts;
  - a pointer gives where it points;
  - an integer that is not an object gives that number;
  - any other object gives where it lives, so a scalar such as `out` scrolls over time.
- **When the address is resolved.**
  - Halts and Refresh resolve it again.
  - Continuous Refresh reuses the last address while the program runs.
  - A new debug session forgets it.
- **Use Dc Value For Graph** centres the y axis on Dc Value and draws a dashed line there. The data is not changed.
- **Magnitude Display Scale = Log** plots 20·log10|v| in dB. A zero sample leaves a gap.
- **Save Data**
  - `.csv` writes `Sample,Value` (or `Time (ms),Value`).
  - `.dat` writes the CCS data-file header `1651 4 <addr> 0 <count>` (hex) and one value per line.
- **Import/Export** use a `.graphProp` file of `Property=value` lines. This is LabSim's own format.
- **Per-project memory.** The last-used properties per project are kept in the app's local storage.
- **Read limit.** One refresh reads at most 1 MiB.
```

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npx vitest run && npm run test:e2e`
Expected: typecheck is clean, all unit tests pass (609 existing plus the new ones), and all e2e tests pass (16).

Then confirm the checks created no `.labsim` folder in the user's workspace:
Run: `ls ~/workspace_v12/*/.labsim -d 2>/dev/null`
Expected: only the user's own folders: 16pointDIT, exp_10, fft_m, FFT, highpassiir.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/graph.spec.ts docs/superpowers/specs/2026-09-23-dsp-labsim-design.md
git commit -m "test(e2e): Single Time graph on y at halts, CSV save, invalid address, Continuous Refresh; spec notes"
```
