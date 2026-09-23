import { describe, expect, it } from 'vitest'
import { compileArgs, linkArgs, renderCommand, toSpawnArgs } from '../../../src/main/build/commands'
import { defaultConfig } from '../../../src/main/build/projectConfig'

const CGT = 'C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12'
const CL6X = 'C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12\\bin\\cl6x.exe'
const cfg = defaultConfig('exp11', 'C:\\Users\\jeetm\\workspace_v12\\exp11', CGT)

describe('compileArgs', () => {
  it('reproduces the CCS 12 subdir_rules.mk compile line', () => {
    const args = compileArgs(cfg, { rel: '../../main.c', objDir: null, depFile: 'main.d_raw' })
    expect(renderCommand(CL6X, args)).toBe(
      '"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/bin/cl6x" -mv6740 ' +
        '--include_path="C:/Users/jeetm/workspace_v12/exp11" ' +
        '--include_path="C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include" ' +
        '--define=c6748 -g --diag_warning=225 --diag_wrap=off --display_error_number ' +
        '--preproc_with_compile --preproc_dependency="main.d_raw" "../../main.c"'
    )
  })
  it('passes unquoted values to spawn', () => {
    const args = toSpawnArgs(compileArgs(cfg, { rel: '../../main.c', objDir: null, depFile: 'main.d_raw' }))
    expect(args[1]).toBe('--include_path=C:/Users/jeetm/workspace_v12/exp11')
    expect(args.at(-1)).toBe('../../main.c')
  })
  it('adds -O and an object directory when needed', () => {
    const args = compileArgs({ ...cfg, optLevel: '2' }, { rel: '../../src/fir.c', objDir: 'src', depFile: 'src/fir.d_raw' })
    const line = renderCommand(CL6X, args)
    expect(line).toContain('cl6x" -mv6740 -O2 --include_path=')
    expect(line).toContain('--preproc_dependency="src/fir.d_raw" --obj_directory="src" "../../src/fir.c"')
  })
})

describe('linkArgs', () => {
  it('reproduces the CCS 12 makefile link line', () => {
    const args = linkArgs(cfg, ['./main.obj'], '../../C6748.cmd')
    expect(renderCommand(CL6X, args)).toBe(
      '"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/bin/cl6x" -mv6740 --define=c6748 -g ' +
        '--diag_warning=225 --diag_wrap=off --display_error_number -z -m"exp11.map" ' +
        '--heap_size=0x800 --stack_size=0x800 ' +
        '-i"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/lib" ' +
        '-i"C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include" ' +
        '--reread_libs --diag_wrap=off --display_error_number --warn_sections ' +
        '--xml_link_info="exp11_linkInfo.xml" --rom_model -o "exp11.out" "./main.obj" "../../C6748.cmd" -llibc.a'
    )
  })
  it('spawns -o and the object list as separate, unquoted arguments', () => {
    const args = toSpawnArgs(linkArgs({ ...cfg, projectName: 'fir lowpass' }, ['./main.obj'], '../../C6748.cmd'))
    expect(args).toContain('-mfir lowpass.map')
    const o = args.indexOf('-o')
    expect(args[o + 1]).toBe('fir lowpass.out')
    expect(args.slice(-3)).toEqual(['./main.obj', '../../C6748.cmd', '-llibc.a'])
  })
})
