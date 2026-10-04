import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveRehearsalTool, verifyBundledRehearsal } from './rehearsalBundle'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it('production ignores a development override and resolves only the bundled executable', () => {
  expect(resolveRehearsalTool(true, '/resources', 'darwin', '/other/tool')).toBe(
    join('/resources', 'rehearse', 'git-rehearse')
  )
  expect(resolveRehearsalTool(true, '/resources', 'win32', '/other/tool')).toBe(
    join('/resources', 'rehearse', 'git-rehearse.exe')
  )
  expect(resolveRehearsalTool(false, '/resources', 'darwin', '/other/tool')).toBe('/other/tool')
  expect(resolveRehearsalTool(false, '/resources', 'darwin', '')).toBe('')
})
it('missing, corrupt and unsupported packages require repair without executing anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bundle-integrity-'))
  roots.push(root)
  const binary = join(root, 'git-rehearse')
  await expect(verifyBundledRehearsal(binary, 'darwin', 'x64')).rejects.toThrow(
    'Repair or reinstall'
  )
  await writeFile(binary, 'not the pinned tool')
  await writeFile(join(root, 'LICENSE'), 'not the license')
  await expect(verifyBundledRehearsal(binary, 'darwin', 'x64')).rejects.toThrow('integrity')
  await expect(verifyBundledRehearsal(binary, 'linux', 'arm64')).rejects.toThrow('Unsupported')
})
