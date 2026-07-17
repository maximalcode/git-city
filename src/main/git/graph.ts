import type { CommitGraph, GraphCommit, GraphRef } from '../../shared/types'
import { runGit } from './exec'

const FS = '\x1f' // unit separator between fields

/** Parse a `%D` decoration string into structured refs. */
export function parseRefs(d: string): GraphRef[] {
  if (!d.trim()) return []
  const out: GraphRef[] = []
  for (let part of d.split(', ')) {
    part = part.trim()
    if (!part) continue
    if (part.startsWith('HEAD -> ')) {
      out.push({ name: 'HEAD', kind: 'head' })
      const b = part.slice(8)
      out.push({ name: b, kind: b.includes('/') ? 'remote' : 'branch' })
    } else if (part === 'HEAD') {
      out.push({ name: 'HEAD', kind: 'head' })
    } else if (part.startsWith('tag: ')) {
      out.push({ name: part.slice(5), kind: 'tag' })
    } else {
      out.push({ name: part, kind: part.includes('/') ? 'remote' : 'branch' })
    }
  }
  return out
}

/**
 * Greedy "railroad" lane assignment. `nodes` must be ordered parents-after-
 * children (git --date-order / --topo-order). Mutates each node's `lane` and
 * returns the total column width. A lane holds the hash of the commit it is
 * currently waiting to draw next; merges converge by freeing duplicate lanes.
 */
export function layoutLanes(nodes: { hash: string; parents: string[]; lane: number }[]): number {
  const active: (string | null)[] = []
  let width = 0

  const firstFree = (): number => {
    const i = active.indexOf(null)
    if (i !== -1) return i
    active.push(null)
    return active.length - 1
  }

  for (const node of nodes) {
    let lane = active.indexOf(node.hash)
    if (lane === -1) lane = firstFree()
    node.lane = lane

    // converging merge: free any other lane also waiting for this commit
    for (let i = 0; i < active.length; i++) {
      if (i !== lane && active[i] === node.hash) active[i] = null
    }

    if (node.parents.length === 0) {
      active[lane] = null
    } else {
      const p0 = node.parents[0]
      const existing0 = active.indexOf(p0)
      if (existing0 !== -1 && existing0 !== lane) {
        active[lane] = null // first parent already tracked elsewhere → collapse
      } else {
        active[lane] = p0
      }
      for (let k = 1; k < node.parents.length; k++) {
        const pk = node.parents[k]
        if (active.indexOf(pk) === -1) active[firstFree()] = pk
      }
    }

    let hi = node.lane + 1
    for (let i = 0; i < active.length; i++) if (active[i] !== null) hi = Math.max(hi, i + 1)
    width = Math.max(width, hi)
  }
  return width
}

export async function commitGraph(repoPath: string, limit = 500): Promise<CommitGraph> {
  const format = ['%H', '%P', '%an', '%at', '%D', '%s'].join(FS)
  const raw = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'log',
    '--all',
    '--date-order',
    '--parents',
    `--max-count=${limit}`,
    `--format=${format}`
  ])

  const commits: GraphCommit[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [hash, parents, author, at, refs, ...rest] = line.split(FS)
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      date: (parseInt(at, 10) || 0) * 1000,
      refs: parseRefs(refs ?? ''),
      subject: rest.join(FS),
      lane: 0,
      row: 0
    })
  }
  commits.forEach((c, i) => (c.row = i))
  const laneCount = layoutLanes(commits)
  return { commits, laneCount, truncated: commits.length >= limit }
}
