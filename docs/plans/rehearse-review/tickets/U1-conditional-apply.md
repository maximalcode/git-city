# U1 — Apply only the exact publicly identified rehearsal result

## Parent

Git City #195; publish to maximalcode/git-rehearse after the strict contract is approved. Status: draft, not an implementation issue yet.

## What to build

Give a client a public, stable identifier for the completed result it inspected, and allow it to request Apply only if that result still matches under the tool's execution ownership.

This is a result revision, not a secret capability or user-authorization token. It revisits the distinction omitted by git-rehearse #41: original-worktree staleness checks and agreement to a particular reviewed sandbox result are different contracts.

## Acceptance criteria

- [ ] Public JSON for a finished retained result provides an opaque versioned result revision and authoritative frozen endpoint descriptors, calculated while owning the rehearsal.
- [ ] Revision binds exact rehearsal/origin identity, action/checkout, frozen pre-state, resulting ref movements, completed outcome and carried/replayed snapshot objects relevant to transfer. Stable unchanged reads yield the same revision; a changed result yields another revision.
- [ ] Endpoint descriptors let Git City verify that the content it shows corresponds to that same revision, including tracked carried work and per-reference committed results. They do not require clients to guess private retained ref names.
- [ ] Conditional Apply accepts the expected revision, acquires ownership, reloads state, calculates the candidate once, compares, then applies that same validated candidate under existing recovery/ref protections.
- [ ] Missing/malformed/mismatched expected revision in conditional mode refuses before changing original refs/index/files, recovery journal or retained-rehearsal lifecycle. Preserve the result and explain refresh/review.
- [ ] Coordinated second-process tests cover changed refs, a continued result and changed carried objects with unchanged high-level carry metadata between review and Apply. Unchanged expected revision succeeds.
- [ ] Original-state staleness, linked-worktree occupancy, local collisions, recovery, signing and hook protections retain their current behavior.
- [ ] Public schema/capability evolution is explicit. Sufficient old retained metadata can issue a revision on read; unsupported data stays preserved with refusal.
- [ ] Existing unconditional CLI syntax may retain its documented old guarantees for compatibility. It is never described as revision-bound; Git City will require the conditional form.
- [ ] Document the concurrency boundary: cooperating git-rehearse operations respect ownership; arbitrary writes that bypass it are not controlled by a CLI lock. Never emulate another tool's private lock files.
- [ ] Update authoritative scope/docs to explain why the new reviewed-result contract differs from the old undefined apply-token wording. Tests exercise the public CLI with real Git repositories.

## Blocked by

None after product approval. This is its own git-rehearse integration branch/PR, not a Git City worker commit.

## Validation

Run that repository's required formatting, locked tests, warning-clean clippy, policy checks and public-CLI concurrency/compatibility acceptance. Follow its maximalcode identity rail and issue-first workflow. Finish with an independently reviewed PR to develop; no release is implied by implementation completion.
