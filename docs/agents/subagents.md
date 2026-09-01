# Sub-agent model tiers

Read this file whenever a skill assigns a stage the `fast`, `balanced`, or
`strongest` tier.

## Codex

### Spawning

Fresh-context spawning: **confirmed** with this repository's issue-loop run
on 2026-09-01.

In this Codex harness, use `collaboration.spawn_agent` with `fork_turns: "none"`
for a fresh context. Paste the stage's required inputs into its brief; the child
receives no parent conversation. Independent stages can run in parallel when
the invoking skill requests it, within the available concurrency limit.

### Models and reasoning

| Tier        | `model`         | `reasoning_effort` |
| ----------- | --------------- | ------------------ |
| `fast`      | `gpt-5.6-luna`  | `low`              |
| `balanced`  | `gpt-5.6-terra` | `medium`           |
| `strongest` | `gpt-5.6-sol`   | `high`             |

Pass both values explicitly when spawning a tiered stage. The invoking skill
chooses the tier; this table resolves it to a model and reasoning effort.
Keep that selection for the duration of the stage.

If a configured model is unavailable, use the invoking skill's fallback rule
and report the substitution. For `issue-loop`, fall back one tier at a time:
`strongest` to `balanced` to `fast`, then inherit the session model if no mapped
tier is available. Record the actual model and reasoning effort when the
harness reports them; otherwise record the requested settings and mark actual
usage details unavailable.

Revisit this mapping when available model identifiers or harness capabilities
change.
