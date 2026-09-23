import type { Toolchain } from '@shared/build'
import type { DebugLaunch } from '@shared/debug'
import type { ProgramImage } from '@shared/program'
import { FALLBACK_CGT, frontendOptions } from '../build/fallback'
import { readBuildConfig } from '../build/projectConfig'
import { findSources } from '../build/sources'

/** Everything a debug worker needs: the sources and front-end options of the build, and where the linker put things. */
export async function debugLaunch(projectDir: string, image: ProgramImage, toolchain: Toolchain | null): Promise<DebugLaunch> {
  const cgt = toolchain?.root ?? FALLBACK_CGT
  const cfg = await readBuildConfig(projectDir, cgt)
  const o = frontendOptions(cfg, cgt)
  return {
    projectDir,
    sources: await findSources(projectDir),
    includePaths: o.includePaths,
    defines: o.defines,
    dialect: o.dialect,
    diagWarnings: o.diagWarnings,
    image
  }
}
