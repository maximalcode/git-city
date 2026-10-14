import { expect } from '@playwright/test'
import { execFileSync } from 'child_process'

/** Let inspection children finish after Electron closes before deleting this fixture's rehearsals. */
export async function discardFixtureRehearsals(tool: string, root: string): Promise<void> {
  const list = (): { id: string; active: boolean }[] =>
    JSON.parse(execFileSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' })).rehearsals
  await expect.poll(() => list().some((item) => item.active), { timeout: 30_000 }).toBe(false)
  await expect(async () => {
    for (const item of list()) execFileSync(tool, ['--json', 'discard', item.id], { cwd: root })
    expect(list()).toHaveLength(0)
  }).toPass({ timeout: 30_000 })
}
