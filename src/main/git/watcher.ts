import { watch, type FSWatcher } from 'fs'
import { existsSync } from 'fs'
import { join, sep } from 'path'
import type { RepoChangeReason } from '../../shared/types'
import { getGitDir } from './status'

const DEBOUNCE_MS = 300

/**
 * Watches a repo for external changes and emits debounced, coalesced
 * change reasons. Deliberately does NOT watch .git recursively — object
 * writes fire constantly; instead: worktree (recursive, .git filtered),
 * the gitDir top level (HEAD, index, MERGE_HEAD, …) and gitDir/refs.
 *
 * mute()/unmute() bracket our own operations so a queued op produces
 * exactly one synthetic event instead of a storm.
 */
export class RepoWatcher {
  private watchers: FSWatcher[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private reasons = new Set<RepoChangeReason>()
  private muted = false
  private emit: ((reasons: RepoChangeReason[]) => void) | null = null

  async start(repoPath: string, emit: (reasons: RepoChangeReason[]) => void): Promise<void> {
    this.stop()
    this.emit = emit
    const gitDir = await getGitDir(repoPath)

    const add = (w: FSWatcher): void => {
      w.on('error', () => {}) // a vanished directory must not crash the app
      this.watchers.push(w)
    }

    add(
      watch(repoPath, { recursive: true }, (_e, filename) => {
        if (filename == null) return this.queue('worktree')
        const rel = String(filename)
        if (rel === '.git' || rel.startsWith(`.git${sep}`) || rel.startsWith('.git/')) return
        this.queue('worktree')
      })
    )

    add(
      watch(gitDir, (_e, filename) => {
        const name = filename == null ? '' : String(filename)
        if (name === 'HEAD') this.queue('head')
        else if (name === 'index') this.queue('index')
        else this.queue('refs') // MERGE_HEAD, packed-refs, ORIG_HEAD, rebase dirs, …
      })
    )

    const refsDir = join(gitDir, 'refs')
    if (existsSync(refsDir)) {
      add(watch(refsDir, { recursive: true }, () => this.queue('refs')))
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.reasons.clear()
    this.emit = null
  }

  mute(): void {
    this.muted = true
  }

  /** Unmute and emit one synthetic event so the renderer refreshes once, deterministically. */
  unmute(): void {
    this.muted = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.reasons.clear()
    this.emit?.(['index', 'head', 'worktree'])
  }

  private queue(reason: RepoChangeReason): void {
    if (this.muted || !this.emit) return
    this.reasons.add(reason)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const reasons = Array.from(this.reasons)
      this.reasons.clear()
      this.timer = null
      this.emit?.(reasons)
    }, DEBOUNCE_MS)
  }
}
