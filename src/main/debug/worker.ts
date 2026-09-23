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
