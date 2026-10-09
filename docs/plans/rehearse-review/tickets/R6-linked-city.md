# R6 — Select the same frozen change in the list, diff and city

## Parent

Git City #195; source finding #191. Status: draft awaiting approval.

## What to build

Use the existing city to locate and select changed files in a rehearsal while retaining a complete accessible text workflow and exactly one active scene.

## Acceptance criteria

- [ ] Selecting a changed file in the list focuses/highlights its building when represented; selecting a rendered changed building selects the same entry and content diff.
- [ ] Change markers distinguish at least added/modified/deleted/renamed states with text/shape as well as color and remain visible for a same-LOC replacement.
- [ ] Before/After retains layout and camera context. Renames use the correct old/new path; absent-side or capped files remain selected with an explicit reason and full text review.
- [ ] Current scope drives city endpoints and markers; when a scope cannot be represented honestly, text review stays available and the city explains its limit instead of showing another scope.
- [ ] Live global selection/review state is not reused. Leaving rehearsal restores prior live context without an unexpected camera flight.
- [ ] At most one active canvas/scene exists. Instanced geometry and GPU disposal constraints are preserved; reduced-motion preference applies to review focus.
- [ ] Keyboard file selection provides all review content without requiring building picking. Show/hide city and narrow layouts preserve controls and selection.
- [ ] Browser and real Electron evidence covers same-LOC, rename/delete, unrepresented path, endpoint toggling, scope switch and return to live view.
- [ ] Capture real app screenshots and update relevant feature/guide/color-mode prose; the schematic concept is not shipped as scene art.

## Blocked by

R3 — complete scopes, entry identities and special-file semantics.
R4 — settled review-local selection and workspace scene host.

## Owned behavior and validation

Own review scene binding, explicit focus/pick interfaces and markers, reusing current camera/layout infrastructure. Keep scene math pure and unit tested; preserve all ordinary scene consumers with explicit optional inputs. Required checks follow the runbook.
