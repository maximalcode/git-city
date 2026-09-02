# Everything Git City does

The [README](../README.md) shows the main ideas with pictures. This is the full
inventory, for anyone deciding whether the app covers what they need.

## Seeing the repository

**Two view modes.** City and Farm, switched with `V`, remembered between
sessions.

**The city.** A district per folder, a building per file. Buildings have real
facades: window grids in three styles, ground-floor shopfronts, rooftop clutter
(AC units, water tanks, antennas) and a contact shadow at the base. Streets are
surfaced with bundled CC0 PBR textures, with zebra crossings, stop lines,
manholes, parked cars at the curb and traffic lights at the big junctions.
Traffic is weighted by commit activity and comes in four body styles, plus
bikes. Lamp posts and street trees line the roads.

**The farm.** Every file is a cultivated field. The crop rises and falls with
the live line count, and the crop class follows the file's peak line count: leafy rows for
small files, standing cereal for mid-size, orchards for the largest. Folders are
fenced parcels with a barn and silo, and wind pumps on the big ones. Herds of
cattle, sheep, pigs and chickens graze across the holding, walking with a
footfall bob. One or two tractors work the dirt tracks. After dark the
steadings light up: hayloft windows, the spill under the big door, a yard lamp
on a post.

**Compressed plot areas.** City plots and farm fields are weighted by the square
root of each file's peak line count, with a minimum of one for empty files.
Lockfiles, generated code and other outliers still get larger plots, but leave
more ground for smaller source files. Building heights keep their square-root
scale, crops keep their logarithmic height scale, and crop classes still use raw
peak line counts. Repositories above the draw ceiling keep the same largest
20,000 files, with ties broken by path.

**A layout that stays put.** Plots use peaks across the whole history rather
than sizes right now, so buildings and crops rise, shrink and vanish as you scrub
but never move. That holds across commits you make in the app too: the layout is
rebuilt only when its inputs change, including a one-line increase in a peak.
The switch to compressed areas rearranges existing repositories once.

**Timeline playback.** Scrub or play the whole history. A full replay takes
about ten seconds.

**Five themes.** Daylight, Night, Neon, Golden Hour, Midnight Ink. Each has
procedural lit windows, its own sky gradient and ambient occlusion. A theme that
lights the city lights the farm too, and a test holds that together.

**Six colour modes.** Language, activity, author, recency, size and kind. Each
has an always-visible legend, and the encoding is identical in both view modes.
See [what the colours mean](colour-modes.md).

**Time of day**, decoupled from the theme. Drag the sun from night through noon
to dusk and the key light and shadows follow. Or leave _sky follows commit time_
on, the default, and the sun tracks each commit's local hour. Scrubbing history
then walks the city from a morning commit's light into a late-night commit's
dark.

**Activity hotspots.** The files churning most this week pulse with a beacon
over the roof or canopy.

**Orientation minimap** with a compass marker that tracks the camera, north up,
so a big repository never loses you.

**Camera fly-to** on selection, and a cinematic intro orbit.

**First-run guide** explaining what height, colour and shape encode. Reopen it
any time from the `?` button.

**Hover any file** for a tooltip following the cursor: language, size, commits,
last author and date. Double-click to jump straight into its diff.

**A now-playing banner** during playback, naming the commit, its author and its
date.

## Working with git

**Staging at three levels.** By file, by hunk, or by individual line. Expand any
changed file to stage, unstage or discard single hunks. Click individual changed
lines to stage, unstage or discard just those. It is `git add -p`, made visual.

**Commit**, with amend, and a _Sign_ toggle that defaults to the repository's
`commit.gpgsign`. Commits carry a verified or unverified badge. Keys stay with
gpg-agent or ssh-agent and are never handled by the app.

**Fetch, pull and push** with progress and cancel. Force-push does not exist in
this app, by design.

**Branches**, including remote-tracking ones. Merge, rebase, cherry-pick,
stashes and tags.

**Submodules** (status, and update in one click) and **worktrees** (list, open,
remove), both in the Branches panel.

**An interactive rebase editor.** Reorder, squash, drop. Local history only.

**A merge-conflict resolver** in-app: ours, theirs, both, or edit, per hunk.

**Time machine.** One click undoes the last HEAD move, keeps your uncommitted
work, and is itself undoable. A panel lists every past HEAD position, so you can
rewind the branch to any of them or recover a lost commit as a new branch. Local
refs only. It never force-pushes.

**Diff viewer**, unified or side-by-side, with word-level highlighting inside
changed lines. The layout choice is remembered. Image diffs render the old and
new picture side by side with a byte-size delta. File history follows renames,
and blame is one click away.

**Commit graph** with branch topology, ref chips, and checkout or cherry-pick
from any row.

**Pull requests**, GitHub through the `gh` CLI, GitLab through `glab`, and Azure
DevOps through `az`. No token setup either way. List open PRs with rolled-up CI
status, see the current branch's, check one out, open it in a browser, or create
one. GitLab merge requests use the same model, and only the wording follows the
host. A missing or logged-out CLI gets a clear hint.

**Review a PR in the city.** Pick any pull request and its changed files light
up with beacons across the scene, so you see its blast radius at a glance. Step
the camera through each touched file. A banner names the PR and counts the
files. Escape ends the review.

## Around the edges

**The command palette** (`Ctrl`/`Cmd`+`K`) fuzzy-searches every action, jumps to
any file with a camera fly-to, switches branch, pops a stash, and changes view,
theme or colour. Two extra modes by leading character: `@` searches commits by
message, author or hash across all refs, and `:` greps code in tracked files. A
commit hit opens a detail panel with signature state, changed files, cherry-pick
and fly-to. It works for any commit, not only the sampled ones.

**Fresh repositories welcome.** Open a brand-new `git init` with no commits and
make the first commit from inside Git City. The city grows the moment you do.
Detached HEAD is labelled clearly, and a missing git install is explained on the
welcome screen.

**Settings** (`,`) gathers every preference: theme, view, time of day, sky
follows commit time, reduce motion, activity hotspots and the default diff
layout. Reduce motion skips the intro orbit, stills the wind, and parks traffic
and tractors where they stand. A mid-stride animal settles flat instead of
freezing tilted. The panel also re-shows the first-run guide, clears recent
repositories and resets all preferences.

**Update check.** On launch the app asks GitHub Releases whether a newer version
exists, and shows a quiet banner if so. No token, no background download, no
telemetry. There is a manual check in Settings.

**Time-lapse export.** The record button replays the whole history while
capturing the canvas to a WebM you can share. It uses the browser's own
MediaRecorder, so it needs no extra dependency.

**Recent repositories**, drag-and-drop a folder to open, and file search with
fly-to.
