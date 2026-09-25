
# DSP LabSim

Practise the TMS320C6748 (LCDK) DSP lab without the board. DSP LabSim looks and behaves like Code Composer Studio 12:

- **Edit and build.** It opens CCS workspaces unchanged. It builds with TI's `cl6x` when CCS is installed, and otherwise with its own C front-end, whose diagnostics follow cl6x 8.3.
- **Debug.** It runs the program in a C6748 simulator:
  - Resume/Suspend/Terminate/Restart;
  - editor breakpoints and Step Into/Over/Return;
  - the Variables, Expressions and Breakpoints views;
  - the CIO console with stdin.
- **Tools > Graph > Single Time.** CCS's properties, refresh on halt and Continuous Refresh.
- **View > Memory Browser.** An address or symbol, in hex, int, float or character formats.
- **File > New > CCS Project.** `main.c`, `C6748.cmd` and `labsim.json`.

## Download and first run

Get the latest version from the [Releases page](https://github.com/jeetrix-ux/dsp-labsim/releases/latest).

### Windows

1. Download `DSP-LabSim-Setup-X.Y.Z.exe` (installs, with a Start-menu entry) or `DSP-LabSim-X.Y.Z-portable.exe` (runs from anywhere, nothing installed).
2. If Windows says **"Windows protected your PC"**, click **More info → Run anyway**. This happens once, because the app is not code-signed.
3. With Code Composer Studio 12 installed, builds use TI's `cl6x`; otherwise they use LabSim's own C compiler.

### macOS (Apple Silicon or Intel)

1. Download `DSP-LabSim-X.Y.Z-universal.dmg`, open it and drag **DSP LabSim** into **Applications**.
2. Open it once. macOS says it cannot verify the app. Go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run this once in Terminal: `xattr -dr com.apple.quarantine "/Applications/DSP LabSim.app"`.
3. Builds use LabSim's own C compiler: TI's C6000 compiler is not available for macOS. Projects copied from a Windows CCS workspace open unchanged.

### Both

- **Workspace.** It opens `~/workspace_v12` (`%USERPROFILE%\workspace_v12` on Windows) if that exists. Switch with **File → Switch Workspace**, or start a project with **File → New → CCS Project**.
- **Build output.** It goes to `<project>/.labsim/Debug`, so CCS's own `Debug` folder is never touched.
- **Compiler.** It is auto-detected under `C:\ti` (Windows) or `/Applications/ti` and `~/ti` (macOS). Choose another in **Window → Preferences** (on macOS: **DSP LabSim → Settings**).
- **Pop-out windows.** The small button at the right end of the editor's and the graphs' tab bars moves that view into its own window. Close the window to bring it back.
- **Not supported.** Programs that need the LCDK's audio codec, McASP, EDMA or interrupts cannot run. Cycle counts from `TSCL` are estimates.

### `labsim.json`

A project's `labsim.json` overrides its `.cproject` build options. All fields are optional:

| Field | Example | Meaning |
|---|---|---|
| `heapSize` | `"0x800"` | `--heap_size` |
| `stackSize` | `"0x800"` | `--stack_size` |
| `optLevel` | `"off"`, `"0"`…`"3"` | `-O` level |
| `defines` | `["c6748", "N=64"]` | `--define` symbols |

## Develop

```bash
npm install
npm run dev          # the app with hot reload
npm test             # unit tests (vitest)
npm run test:e2e     # builds, then runs the Playwright tests against Electron
npm run typecheck
npm run labsim -- run path/to/main.c   # headless run of one C file
npm run dist:dir     # unpacked app in dist/win-unpacked (the packaged-app test uses it)
npm run dist         # dist/DSP-LabSim-<version>-portable.exe
```

Environment variables for tests:

| Variable | Effect |
|---|---|
| `LABSIM_WORKSPACE` | Workspace folder |
| `LABSIM_USERDATA` | Settings folder |
| `LABSIM_COMPILER_ROOT` | C6000 CGT folder to use; an empty folder simulates "not installed" |
| `LABSIM_TI_ROOT` | Where to look for CCS's `C6748.cmd`; an empty folder forces the bundled copy |

The design is in `docs/superpowers/specs/2026-09-23-dsp-labsim-design.md`, and there is one plan per delivery step in `docs/superpowers/plans/`.
