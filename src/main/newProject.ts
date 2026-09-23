import { promises as fs } from 'fs'
import * as path from 'path'
import { validateNewProject, type NewProjectOptions } from '@shared/newProject'

/** CCS's "Empty Project (with main.c)" template, with Windows line ends as CCS writes it. */
export const MAIN_C_TEMPLATE = ['', '/**', ' * main.c', ' */', 'int main(void)', '{', '\treturn 0;', '}', ''].join('\r\n')

export function labsimJson(o: NewProjectOptions): string {
  return JSON.stringify({ heapSize: o.heapSize, stackSize: o.stackSize, optLevel: o.optLevel, defines: o.defines }, null, 2) + '\n'
}

/** Creates <workspace>/<name> with main.c, C6748.cmd and labsim.json; returns the new folder. */
export async function createProject(workspace: string, o: NewProjectOptions, linkerCmd: string): Promise<string> {
  const error = validateNewProject(o)
  if (error) throw new Error(error)
  const taken = (await fs.readdir(workspace)).some((e) => e.toLowerCase() === o.name.toLowerCase())
  if (taken) throw new Error(`'${o.name}' already exists in the workspace.`)
  const dir = path.join(workspace, o.name)
  await fs.mkdir(dir)
  await fs.writeFile(path.join(dir, 'main.c'), MAIN_C_TEMPLATE)
  await fs.copyFile(linkerCmd, path.join(dir, 'C6748.cmd'))
  await fs.writeFile(path.join(dir, 'labsim.json'), labsimJson(o))
  return dir
}

/** CCS's own C6748.cmd from the newest CCS install under tiRoot, else the copy shipped with LabSim. */
export async function findLinkerCmd(bundled: string, tiRoot = 'C:\\ti'): Promise<string> {
  let installs: string[] = []
  try {
    installs = (await fs.readdir(tiRoot)).filter((n) => /^ccs\d+$/i.test(n)).sort().reverse()
  } catch {
    return bundled
  }
  for (const d of installs) {
    const p = path.join(tiRoot, d, 'ccs', 'ccs_base', 'c6000', 'include', 'C6748.cmd')
    try {
      await fs.access(p)
      return p
    } catch {
      // not in this install
    }
  }
  return bundled
}
