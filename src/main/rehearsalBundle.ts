import { createHash } from 'crypto'
import { lstat, readFile } from 'fs/promises'
import { join } from 'path'
import pin from '../../rehearse-toolchain.json'

export const bundledRepair =
  'Repair or reinstall Git City with its compatible bundled Rehearse tool. Retained work has been preserved; no direct Git action was performed.'

export function resolveRehearsalTool(
  packaged: boolean,
  resources: string,
  platform: string = process.platform,
  developmentTool: string | undefined = process.env.GIT_CITY_REHEARSE_BIN
): string | undefined {
  return packaged
    ? join(resources, 'rehearse', platform === 'win32' ? 'git-rehearse.exe' : 'git-rehearse')
    : developmentTool
}

/** The expected digest is compiled into the app, not trusted from a sidecar file. */
export async function verifyBundledRehearsal(
  tool: string,
  platform: string = process.platform,
  arch: string = process.arch
): Promise<void> {
  const spec = pin.targets[`${platform}-${arch}` as keyof typeof pin.targets]
  if (!spec) throw new Error(`Unsupported Rehearse platform. ${bundledRepair}`)
  try {
    for (const [path, digest] of [
      [tool, spec.binarySha256],
      [join(tool, '..', 'LICENSE'), spec.licenseSha256]
    ]) {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a regular file')
      if (
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex') !== digest
      )
        throw new Error('Checksum mismatch')
    }
  } catch {
    throw new Error(`Bundled Rehearse integrity check failed. ${bundledRepair}`)
  }
}

let bundledTool: string | undefined
export function requireBundledRehearsal(tool: string): void {
  bundledTool = tool
}
export async function verifyRehearsalInvocation(tool: string): Promise<void> {
  if (!bundledTool) return // Explicit development builds only.
  if (tool !== bundledTool) throw new Error(bundledRepair)
  await verifyBundledRehearsal(tool)
}
