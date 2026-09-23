
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

## Use it

Download `DSP-LabSim-<version>-portable.exe` and run it. There is nothing to install.

- **Workspace.** It opens `%USERPROFILE%\workspace_v12` if that exists; switch with File > Switch Workspace.
- **Build output.** It goes to `<project>\.labsim\Debug`, so CCS's own `Debug` folder is never touched.
- **Compiler.** It is auto-detected under `C:\ti`. Choose another in Window > Preferences.

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
