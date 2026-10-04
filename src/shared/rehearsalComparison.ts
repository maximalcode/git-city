import type { RehearsalReport } from './types'

/** Bind a scene to the report version the user is reading, including Continue. */
export function rehearsalComparisonKey(report: RehearsalReport): string {
  return JSON.stringify([
    report.id,
    report.repository_id,
    report.origin_worktree,
    report.repository,
    report.sandbox,
    report.checkout,
    report.pre_state,
    report.refs,
    report.outcome,
    report.conflicted,
    report.conflicts,
    report.carried
  ])
}
