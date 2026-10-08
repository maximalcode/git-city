// Temporary #185 stress harness. It runs an unchanged packaged, CLI-only, or
// open-repository diagnostic as the foreground child and adds bounded CPU
// pressure only after Python tracing proves that the CLI stage has started.
// This is a stress test, not a cause.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'

const POLL_MS = 200
const LOAD_CAP_MS = 185_000
const STOP_SEQUENCE = 35

function burnCpu() {
  let running = true
  parentPort.on('message', (message) => {
    if (message === 'stop') running = false
  })
  let state = 0x6d2b79f5
  const spin = () => {
    for (let index = 0; index < 1_000_000; index++) {
      state = Math.imul(state ^ (state >>> 13), 0x5bd1e995)
      state = (state + index) | 0
    }
    if (running) setImmediate(spin)
  }
  spin()
}

if (!isMainThread) {
  burnCpu()
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const binaryArgument = process.argv[2]
  const tracePath = process.env.GIT_CITY_185_TRACE
  const scenario = process.env.GIT_CITY_185_SCENARIO ?? 'packaged'

  if (!binaryArgument || !tracePath || !['packaged', 'cli-only', 'open-repo'].includes(scenario)) {
    console.error(
      '[DEBUG-185] usage: GIT_CITY_185_TRACE=<trace> [GIT_CITY_185_SCENARIO=packaged|cli-only|open-repo] node scripts/diagnostics/185/stress-packaged-harness.mjs <binary>'
    )
    process.exitCode = 2
  } else {
    const binary = resolve(binaryArgument)
    const configuredWorkers = Number(process.env.GIT_CITY_185_STRESS_WORKERS)
    const defaultWorkers = Math.max(1, Math.min(3, availableParallelism() - 1))
    const workerCount =
      Number.isInteger(configuredWorkers) && configuredWorkers >= 1 && configuredWorkers <= 3
        ? configuredWorkers
        : defaultWorkers

    let traceOffset = 0
    let partialLine = ''
    let load
    let stressError = null
    let stopping = false
    let child

    const log = (event) => {
      console.error(`[DEBUG-185] ${JSON.stringify(event)}`)
    }

    const recordStressError = (kind, error) => {
      const code = error?.code ?? error?.name ?? 'unknown'
      stressError ??= `${kind}:${code}`
      return code
    }

    const stopLoad = async (reason) => {
      if (!load) return
      if (load.stopPromise) return load.stopPromise
      load.stopPromise = (async () => {
        load.stopped = true
        load.stopReason = reason
        if (load.capTimer) clearTimeout(load.capTimer)
        await Promise.allSettled(load.workers.map((worker) => worker.terminate()))
        log({
          event: 'cpu-load-end',
          timestamp: new Date().toISOString(),
          workers: load.workers.length,
          count: load.workers.length,
          reason
        })
      })()
      return load.stopPromise
    }

    const startLoad = () => {
      if (load) return
      const workers = Array.from(
        { length: workerCount },
        () => new Worker(fileURLToPath(import.meta.url))
      )
      load = { workers, stopped: false, stopReason: null, capTimer: null, stopPromise: null }
      workers.forEach((worker, index) => {
        worker.once('error', (error) => {
          const code = recordStressError('worker-error', error)
          log({
            event: 'cpu-load-error',
            timestamp: new Date().toISOString(),
            worker: index,
            error: code
          })
          void stopLoad('worker-error')
        })
      })
      log({
        event: 'cpu-load-start',
        timestamp: new Date().toISOString(),
        workers: workers.length,
        count: workers.length
      })
      load.capTimer = setTimeout(() => {
        void stopLoad('185s-cap')
      }, LOAD_CAP_MS)
    }

    const handleEvent = (event) => {
      if (!event || typeof event !== 'object') return
      if (event.phase === 'start' && !load && !childResult) startLoad()
      if (event.phase === 'end' && (event.timed_out === true || event.sequence === STOP_SEQUENCE)) {
        void stopLoad(event.timed_out === true ? 'timeout' : 'sequence-35')
      }
    }

    const pollTrace = async () => {
      let contents
      try {
        contents = await readFile(tracePath, 'utf8')
      } catch {
        return
      }
      if (contents.length < traceOffset) {
        traceOffset = 0
        partialLine = ''
      }
      const chunk = contents.slice(traceOffset)
      traceOffset = contents.length
      const lines = (partialLine + chunk).split(/\r?\n/)
      partialLine = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        try {
          handleEvent(JSON.parse(line))
        } catch {
          // The final line may be incomplete; it is retained for the next poll.
        }
      }
    }

    const wait = (milliseconds) =>
      new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
    process.chdir(root)
    try {
      traceOffset = (await readFile(tracePath, 'utf8')).length
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const code = recordStressError('trace-initial-read', error)
        log({
          event: 'trace-incomplete',
          timestamp: new Date().toISOString(),
          phase: 'initial-read',
          error: code
        })
      }
    }
    const childExit = new Promise((resolveExit) => {
      const foregroundScript =
        scenario === 'cli-only'
          ? 'scripts/diagnostics/185/direct-cli-harness.mjs'
          : scenario === 'open-repo'
            ? 'scripts/diagnostics/185/open-repo-harness.mjs'
            : 'scripts/smoke-package.mjs'
      child = spawn(process.execPath, [foregroundScript, binary], {
        stdio: 'inherit'
      })
      child.once('error', (error) => resolveExit({ status: null, signal: null, error }))
      child.once('exit', (status, signal) => resolveExit({ status, signal, error: null }))
    })

    const stopForSignal = async (signal) => {
      if (stopping) return
      stopping = true
      await stopLoad(`signal-${signal}`)
      if (child && child.exitCode === null && !child.killed) child.kill()
    }
    process.on('SIGINT', () => void stopForSignal('SIGINT'))
    process.on('SIGTERM', () => void stopForSignal('SIGTERM'))

    let childResult
    while (!childResult) {
      await Promise.race([childExit.then((result) => (childResult = result)), wait(POLL_MS)])
      await pollTrace()
      if (childResult && !load) break
    }
    childResult ??= await childExit
    await stopLoad(stopping ? 'signal' : 'child-exit')
    log({
      event: 'foreground-exit',
      timestamp: new Date().toISOString(),
      scenario,
      status: childResult.status,
      signal: childResult.signal,
      error: childResult.error?.code ?? null,
      stressApplied: Boolean(load),
      stressError
    })
    if (childResult.error) process.exitCode = 1
    else if (childResult.signal) process.exitCode = 1
    else process.exitCode = childResult.status ?? 1
  }
}
