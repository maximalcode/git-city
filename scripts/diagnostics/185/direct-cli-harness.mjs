// Temporary #185 baseline harness. It runs the same Python child and timeout
// as scripts/smoke-package.mjs, without changing that smoke's assertions.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const binaryArgument = process.argv[2]
if (!binaryArgument) {
  console.error('[DEBUG-185] usage: node scripts/diagnostics/185/direct-cli-harness.mjs <binary>')
  process.exitCode = 2
} else {
  const binary = resolve(binaryArgument)
  process.chdir(root)
  const started = performance.now()
  try {
    execFileSync('python3', ['scripts/smoke-rehearse.py', binary], {
      stdio: 'inherit',
      timeout: 180_000
    })
    const durationMs = Math.round((performance.now() - started) * 1000) / 1000
    console.log(JSON.stringify({ debug: '185', status: 'passed', durationMs }))
  } catch (error) {
    const durationMs = Math.round((performance.now() - started) * 1000) / 1000
    console.error(
      JSON.stringify({
        debug: '185',
        status: 'failed',
        durationMs,
        code: error?.code ?? null,
        signal: error?.signal ?? null,
        timedOut: error?.code === 'ETIMEDOUT',
        exitCode: error?.status ?? null
      })
    )
    process.exitCode = 1
  }
}
