import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { defaultConfig, parseCproject } from '../../../src/main/build/projectConfig'

const CGT = 'C:\\ti\\ccs1281\\ccs\\tools\\compiler\\ti-cgt-c6000_8.3.12'
const DIR = 'C:\\ws\\exp11'

describe('parseCproject', () => {
  it('reads the Debug configuration of a real CCS 12 project', () => {
    const xml = readFileSync(join(__dirname, '../../fixtures/ccs/exp11.cproject'), 'utf8')
    const cfg = parseCproject(xml, 'exp11', DIR, CGT)
    expect(cfg).toEqual({
      projectName: 'exp11',
      projectDir: DIR,
      silicon: '6740',
      defines: ['c6748'],
      includePaths: ['C:/ws/exp11', 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include'],
      optLevel: null,
      diagWarnings: ['225'],
      heapSize: '0x800',
      stackSize: '0x800',
      libraries: ['libc.a'],
      searchPaths: ['C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/lib', 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include'],
      linkerCommandFile: 'C6748.cmd',
      dialect: 'c89'
    })
  })
  it('reads the C dialect option', () => {
    const xml = `<configuration name="Debug"><option superClass="com.ti.ccstudio.buildDefinitions.C6000_8.3.compilerID.C_DIALECT" value="com.ti.ccstudio.buildDefinitions.C6000_8.3.compilerID.C_DIALECT.C99" valueType="enumerated"/></configuration>`
    expect(parseCproject(xml, 'p', DIR, CGT).dialect).toBe('c99')
    expect(defaultConfig('p', DIR, CGT).dialect).toBe('c89')
  })
  it('picks up changed heap, stack, optimisation and defines', () => {
    const xml = `<cproject><storageModule><cconfiguration>
      <storageModule><configuration name="Release"><option superClass="x.linkerID.HEAP_SIZE" value="0x9999"/></configuration></storageModule>
      <storageModule><configuration artifactName="\${ProjName}" name="Debug">
        <option id="a.1" superClass="com.ti.x.compilerID.OPT_LEVEL" value="com.ti.x.compilerID.OPT_LEVEL.2" valueType="enumerated"/>
        <option superClass="com.ti.x.linkerID.HEAP_SIZE" value="0x2000" valueType="string"/>
        <option value="0x1000" superClass="com.ti.x.linkerID.STACK_SIZE"/>
        <option superClass="com.ti.x.compilerID.DEFINE" valueType="definedSymbols">
          <listOptionValue builtIn="false" value="c6748"/>
          <listOptionValue builtIn="false" value="USE_Q15=1"/>
        </option>
      </configuration></storageModule>
    </cconfiguration></storageModule></cproject>`
    const cfg = parseCproject(xml, 'p', DIR, CGT)
    expect(cfg.optLevel).toBe('2')
    expect(cfg.heapSize).toBe('0x2000')
    expect(cfg.stackSize).toBe('0x1000')
    expect(cfg.defines).toEqual(['c6748', 'USE_Q15=1'])
    expect(cfg.libraries).toEqual(['libc.a'])
  })
  it('treats OPT_LEVEL.off as no optimisation', () => {
    const xml = `<configuration name="Debug"><option superClass="c.compilerID.OPT_LEVEL" value="c.compilerID.OPT_LEVEL.off"/></configuration>`
    expect(parseCproject(xml, 'p', DIR, CGT).optLevel).toBeNull()
  })
})

describe('defaultConfig', () => {
  it('matches what CCS generates for a new C6748 project', () => {
    const cfg = defaultConfig('p', DIR, CGT)
    expect(cfg.defines).toEqual(['c6748'])
    expect(cfg.includePaths).toEqual(['C:/ws/exp11', 'C:/ti/ccs1281/ccs/tools/compiler/ti-cgt-c6000_8.3.12/include'])
    expect([cfg.heapSize, cfg.stackSize]).toEqual(['0x800', '0x800'])
    expect(cfg.linkerCommandFile).toBeNull()
  })
})
