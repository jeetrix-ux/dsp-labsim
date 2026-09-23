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
