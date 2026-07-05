import { useStore } from '../store'

const PHASE_LABEL: Record<string, string> = {
  counting: 'Counting commits…',
  'reading-history': 'Reading history…',
  cloning: 'Cloning repository…'
}

export default function Loading(): React.JSX.Element {
  const progress = useStore((s) => s.progress)
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="loading">
      <h2>Building your city…</h2>
      <div className="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="phase">
        {progress ? PHASE_LABEL[progress.phase] ?? progress.phase : 'Starting…'}
        {progress && progress.phase === 'reading-history' && progress.total > 1
          ? ` ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} commits`
          : ''}
      </div>
    </div>
  )
}
