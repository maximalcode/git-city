# Shared contract note

Draft contracts to approve with #195. They pin names and responsibilities so isolated workers do not independently invent incompatible interfaces. Existing public names remain intact; these are additive seams.

## Review reads — R2 owns the first complete implementation

All requests use existing canonical RehearsalIdentity; the main process resolves trusted repository/sandbox paths. ReviewRevision and ScopeId/EntryId/Cursor are opaque to the renderer.

| Public bridge method   | Request                                                                 | Result                                                                                    |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| rehearsalReviewSummary | identity                                                                | ReviewSummary or explicit refused/unavailable/error                                       |
| rehearsalReviewFiles   | identity, reviewRevision, scopeId, optional cursor and filter           | Revision-bound page of ReviewEntry values and next cursor/count information               |
| rehearsalReviewFile    | identity, reviewRevision, scopeId, entryId, view = changes/before/after | Revision-bound text/hunks or explicit binary/mode-only/absent/too-large/unavailable/error |

ReviewSummary contains identity, reviewRevision, nullable toolResultRevision, completeness/After availability and reason, endpoint provenance, available scopes/defaultScopeId, report/replay notices and relevant carried-work scope facts. Every response repeats identity/revision. Results distinguish no changes, not available and failed to load.

ReviewScope contains stable scopeId, kind (tracked-worktree or committed-reference), label/ref aliases, frozen endpoint descriptors and availability. ReviewEntry contains stable entryId within scope, change kind, old/new path and presence, old/new mode/object identity, binary/type metadata, text availability and meaningful line counts. Entry IDs do not equal an unvalidated raw filesystem path. Null/unknown is not zero.

R2 supports complete inventory and initial tracked-worktree text review, keeping other types explicit. R3 expands affected-reference scopes and rich special-file states without redefining the request identity/version boundary. R7 makes toolResultRevision required for conditional Apply and replaces the 1.3 resolver implementation with public U1 descriptors for both city and content.

## Draft lifecycle — R1 owns, R5 extends decisions

| Public bridge method  | Request                                                                                                                 | Result                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| rehearsalDraftRead    | identity, validated conflict path                                                                                       | DraftRecord plus persistence/revision status, or absent/unavailable/error                       |
| rehearsalDraftWrite   | identity, validated conflict path, base sandbox revision, draft content/decision payload, expected saved draft revision | Acknowledged saved draft revision, or conflict/persistence error preserving the existing record |
| rehearsalDraftDiscard | identity, validated conflict path, expected saved draft revision                                                        | Confirmed removal of that draft revision, or refusal/error                                      |

DraftRecord stores the canonical ownership key, schema version, sandbox base revision/base content needed for reconciliation, editing mode, hunk/whole-file user text and choices, explicit acknowledgement state, and saved draft revision. UI tracks local edit sequence separately: acknowledgement of an older queued write cannot clear newer unsaved edits. The default/unreviewed state is distinct from an explicit Ours choice.

The main-owned store serializes writes per draft. A draft persistence response reports actual durable acknowledgement; failed writes keep the old valid record. Conflict Save and stage retains the existing sandbox revision precondition and clears only the corresponding saved draft after confirmed success. R5 contributes explicit decision eligibility through the same draft model rather than a separate buffer.

## Controlled UI boundaries — R3/R4/R5/R6

- ScopeSelector: scopes, selectedScopeId, disabled, onSelectScope(scopeId). R3 owns content/labels; R4 owns mounting and state. Single-option scope is a label rather than an empty choice.
- FileInventory: current identity/reviewRevision/scope, selectedEntryId, onSelectEntry(entryId), paged read state. R2 supplies the first usable version; R4 places it in the final shell and owns selection. R3 enriches metadata without owning shell state.
- ConflictEditor: exact report/identity and validated draft/save state; onDirtyStateChange and explicit navigation/close decisions. R1/R5 own editing internals; R4 mounts it and performs requested workspace navigation only after its draft-protection result.
- ReviewCity: immutable scope endpoints, selectedEntry, onSelectEntry, endpoint choice and reduced-motion preference. R6 owns scene behavior; R4 owns workspace visibility/selection. Never read/write live global selected to implement rehearsal selection.

Changed identity/scope invalidates pending request adoption before starting another read. A response must match identity, reviewRevision, scope and selected entry to display. A harmless refresh preserves surviving selection. Apply confirmation captures the current identities/revisions; any replacement invalidates the confirmation, even if the rehearsal ID is unchanged.

## Conditional Apply — U1 and R7

Upstream public JSON adds versioned result_revision and authoritative frozen endpoint descriptors. The exact command spelling is chosen in U1 following the existing CLI conventions; its semantics are fixed: expected revision required in conditional mode, compare under ownership, apply the same validated candidate, no downgrade.

R7 extends Git City's existing Apply request with expectedReviewRevision and expectedToolResultRevision. The main process checks the complete local review revision and authoritative tool identity under consistent app admission/queue ordering, then invokes conditional Apply. Tool capability absence/refusal is explicit. A local review digest is never passed as if it were the tool-issued revision.

This contract covers cooperating tool operations. In-memory app coordination does not exclude other processes; tool ownership does not prevent arbitrary filesystem mutation that deliberately bypasses it.
