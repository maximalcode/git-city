# What the colours mean

The shape of the city is fixed: a **building is a file**, its **height is the
line count**, and a **district is a folder**. Colour is the free variable, and
Git City has six encodings for it. Switch with the picker in the top bar; the
legend in the bottom-right always describes the one in use.

The same six apply to the farm, where a field is a file and the crop's growth
stands in for the line count.

## Language — the default

Each programming language gets its own colour, the way GitHub's language bars
do. Good for the first look at an unfamiliar repository: you see instantly
whether it is one language or five, and where the odd one out lives.

The legend lists the eight most common languages present.

## Activity — how often a file changes

A blue → amber → red ramp over each file's commit count. Red is the code that
is rewritten constantly.

Read it as a map of where the work is. A large red building is a file that is
both big and permanently in flux — often the one worth splitting up. A large
blue one is settled.

The ramp is square-rooted, so a handful of runaway files cannot flatten
everything else into one shade.

## Author — who touched it last

One colour per person, derived from their name, so the same author is always the
same colour within a repository. Districts of a single colour are code with one
owner; a speckled one is shared ground.

The legend lists the eight authors who own the most files.

## Recency — how recently it changed

Grey-blue → cyan → green, oldest to newest, spread across the range actually
present in the snapshot. Green is this week's work; grey-blue is the code nobody
has needed to touch.

## Size — lines of code

Pale → deep violet, square-rooted like Activity. Height already encodes size, so
this mostly earns its keep from above, where heights foreshorten and colour
doesn't.

## Kind — what a file is for

Six fixed categories by path and extension: **Code**, **Test**, **Config**,
**Docs**, **Assets**, **Other**. The one to reach for when the question is
"how much of this repository is actually tests?"

---

## Small and new repositories

Activity, Recency and Size all describe a _spread_ — they scale to the range of
values in front of them. A repository with a single commit has no spread, so
every file carries the same value and the ramp has nothing to say. The same
happens at commit 1 when you scrub any repository's timeline back to the start.

Language, Author and Kind do not have this problem; they are categories, not
ranges. Tracked in
[#28](https://github.com/maximalcode/git-city/issues/28).

Note also that the legend shows at most eight entries, so a repository with more
than eight languages or authors will have on-screen colours with no entry
explaining them.
