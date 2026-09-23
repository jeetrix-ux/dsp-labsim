// Records what TI's cl6x reports for each case in tests/fixtures/diag/cl6x-cases.json.
// Usage: node scripts/capture-cl6x-diagnostics.mjs [path-to-ti-cgt-c6000]
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const FIXTURE = new URL('../tests/fixtures/diag/cl6x-cases.json', import.meta.url)

function findCgt() {
  if (process.argv[2]) return process.argv[2]
  const base = 'C:\\ti'
  for (const ccs of readdirSync(base).filter((d) => d.startsWith('ccs')).sort().reverse()) {
    const dir = join(base, ccs, 'ccs', 'tools', 'compiler')
    if (!existsSync(dir)) continue
    const cgt = readdirSync(dir).filter((d) => d.startsWith('ti-cgt-c6000')).sort().reverse()[0]
    if (cgt) return join(dir, cgt)
  }
  throw new Error('TI C6000 compiler not found; pass its directory as the first argument')
}

const LOCATED = /^"[^"]*", line (\d+): (fatal error|error|warning|remark) #(\S+): (.*)$/
const AT_END = /^At end of source: (fatal error|error|warning|remark) #(\S+): (.*)$/
const severity = (s) => (s === 'warning' || s === 'remark' ? 'warning' : 'error')

const cgt = findCgt()
const cases = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'labsim-diag-'))
for (const c of cases) {
  writeFileSync(join(tmp, 'case.c'), c.source)
  const args = [
    '-mv6740', `--include_path=${join(cgt, 'include')}`, '--define=c6748', '--diag_warning=225', '--diag_wrap=off',
    '--display_error_number', '--compile_only', `--output_file=${join(tmp, 'case.obj')}`, 'case.c'
  ]
  const r = spawnSync(join(cgt, 'bin', 'cl6x.exe'), args, { cwd: tmp, encoding: 'utf8' })
  c.cl6x = []
  for (const line of `${r.stderr}\n${r.stdout}`.split(/\r?\n/)) {
    let m = LOCATED.exec(line)
    if (m) c.cl6x.push({ line: Number(m[1]), severity: severity(m[2]), code: m[3], message: m[4] })
    else if ((m = AT_END.exec(line))) c.cl6x.push({ line: null, severity: severity(m[1]), code: m[2], message: m[3] })
  }
}
rmSync(tmp, { recursive: true, force: true })
writeFileSync(FIXTURE, JSON.stringify(cases, null, 1) + '\n')
console.log(`captured ${cases.length} cases with ${cgt}`)
