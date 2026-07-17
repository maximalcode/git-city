import { useEffect, useMemo, useState } from 'react'
import type { CommitGraph, GraphCommit } from '../../../shared/types'
import { cleanError, hasApi, useStore } from '../store'

const ROW_H = 34
const LANE_W = 20
const DOT = 5
const PAD_LEFT = 12
const LANE_COLORS = ['#6ec8ff', '#ffb347', '#7dd87d', '#ff6b6b', '#c084fc', '#f472b6', '#22d3ee', '#facc15']
const laneColor = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length]

const cx = (lane: number): number => PAD_LEFT + lane * LANE_W + LANE_W / 2
const cy = (row: number): number => row * ROW_H + ROW_H / 2

export default function CommitGraphPanel(): React.JSX.Element | null {
  const graphOpen = useStore((s) => s.graphOpen)
  const repoPath = useStore((s) => s.repoPath)
  const busy = useStore((s) => s.opInProgress !== null)
  const setGraphOpen = useStore((s) => s.setGraphOpen)
  const askConfirm = useStore((s) => s.askConfirm)
  const cherryPick = useStore((s) => s.cherryPick)
  const switchBranch = useStore((s) => s.switchBranch)

  const [graph, setGraph] = useState<CommitGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (!graphOpen || !repoPath || !hasApi()) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.gitCity
      .commitGraph(repoPath, 500)
      .then((g) => !cancelled && setGraph(g))
      .catch((err) => {
        if (!cancelled) {
          setGraph(null)
          setError(cleanError(err))
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [graphOpen, repoPath, retryNonce])

  const rowIndex = useMemo(() => {
    const m = new Map<string, GraphCommit>()
    graph?.commits.forEach((c) => m.set(c.hash, c))
    return m
  }, [graph])

  if (!graphOpen) return null

  const graphW = graph ? PAD_LEFT + graph.laneCount * LANE_W + 8 : 40
  const totalH = graph ? graph.commits.length * ROW_H : 0

  return (
    <div className="graph-panel">
      <div className="panel-head">
        <span>Commit graph{graph?.truncated ? ' · showing latest 500' : ''}</span>
        <button className="close" aria-label="Close" onClick={() => setGraphOpen(false)}>
          ✕
        </button>
      </div>

      <div className="graph-scroll">
        {loading && <div className="empty">Building graph…</div>}
        {!loading && error && (
          <div className="panel-error">
            <span>{error}</span>
            <button onClick={() => setRetryNonce((n) => n + 1)}>Retry</button>
          </div>
        )}
        {!loading && graph && (
          <div className="graph-inner" style={{ height: totalH }}>
            <svg className="graph-svg" width={graphW} height={totalH}>
              {/* edges */}
              {graph.commits.map((c) =>
                c.parents.map((p, pi) => {
                  const pj = rowIndex.get(p)
                  if (!pj) return null
                  const x1 = cx(c.lane)
                  const y1 = cy(c.row)
                  const x2 = cx(pj.lane)
                  const y2 = cy(pj.row)
                  const my = (y1 + y2) / 2
                  const color = pi === 0 ? laneColor(c.lane) : laneColor(pj.lane)
                  return (
                    <path
                      key={c.hash + p}
                      d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      opacity={0.85}
                    />
                  )
                })
              )}
              {/* dots */}
              {graph.commits.map((c) => (
                <circle
                  key={c.hash}
                  cx={cx(c.lane)}
                  cy={cy(c.row)}
                  r={c.refs.length ? DOT + 1.5 : DOT}
                  fill={laneColor(c.lane)}
                  stroke={c.refs.some((r) => r.kind === 'head') ? '#fff' : 'rgba(0,0,0,0.35)'}
                  strokeWidth={c.refs.some((r) => r.kind === 'head') ? 2 : 1}
                />
              ))}
            </svg>

            {/* commit rows */}
            {graph.commits.map((c) => (
              <div
                key={c.hash}
                className={`graph-row ${active === c.hash ? 'active' : ''}`}
                style={{ top: c.row * ROW_H, height: ROW_H, left: graphW }}
                onClick={() => setActive(active === c.hash ? null : c.hash)}
              >
                {c.refs.map((r) => (
                  <span key={r.name} className={`ref-chip ref-${r.kind}`}>
                    {r.kind === 'tag' ? '🏷 ' : ''}
                    {r.name}
                  </span>
                ))}
                <span className="graph-subject">{c.subject}</span>
                <span className="graph-meta">
                  {c.shortHash} · {c.author}
                </span>
                {active === c.hash && (
                  <span className="graph-actions" onClick={(e) => e.stopPropagation()}>
                    {c.refs
                      .filter((r) => r.kind === 'branch')
                      .map((r) => (
                        <button key={r.name} disabled={busy} onClick={() => void switchBranch(r.name)}>
                          Checkout {r.name}
                        </button>
                      ))}
                    <button
                      disabled={busy}
                      onClick={() =>
                        askConfirm({
                          title: 'Cherry-pick this commit?',
                          body: `Apply ${c.shortHash} "${c.subject}" onto the current branch.`,
                          confirmLabel: 'Cherry-pick',
                          danger: false,
                          onConfirm: () => void cherryPick(c.hash)
                        })
                      }
                    >
                      Cherry-pick
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
