import type { RehearsalPlan } from './types'

type PreparedPlan = { ok: true; todo: string; command: string[] } | { ok: false; message: string }

/** Prepare the existing newest-first editor plan without changing the caller's entries. */
export function prepareRebasePlan(plan: RehearsalPlan): PreparedPlan {
  const hash = (value: unknown): boolean =>
    typeof value === 'string' && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)
  if (
    !plan ||
    (plan.base !== null && !hash(plan.base)) ||
    !Array.isArray(plan.entries) ||
    !plan.entries.every(
      (entry) =>
        entry &&
        hash(entry.hash) &&
        typeof entry.subject === 'string' &&
        typeof entry.shortHash === 'string' &&
        ['pick', 'squash', 'drop'].includes(entry.action)
    ) ||
    new Set(plan.entries.map((entry) => entry.hash)).size !== plan.entries.length
  )
    return { ok: false, message: 'Choose a valid Pick/Squash/Drop plan and its original base.' }
  if (!plan.entries.length) return { ok: false, message: 'Nothing to rebase.' }
  if (plan.entries.every((entry) => entry.action === 'drop'))
    return { ok: false, message: 'Cannot drop every commit.' }
  const ordered = [...plan.entries].reverse().map((entry) => ({ ...entry }))
  // Preserve the existing editor's semantics: the oldest instruction cannot squash backwards.
  if (ordered[0].action === 'squash') ordered[0].action = 'pick'
  return {
    ok: true,
    todo: ordered.map((entry) => `${entry.action} ${entry.hash}`).join('\n') + '\n',
    command: ['rebase', '-i', plan.base ?? '--root']
  }
}
