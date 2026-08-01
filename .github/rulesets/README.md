# Branch rulesets

Branch protection for `main` and `develop`, kept here as versioned payloads
because GitHub's Free plan refuses to create rulesets on a **private** repo
(`403: Upgrade to GitHub Pro or make this repository public`). Apply them the
moment the repository goes public:

```bash
gh api repos/maximalcode/git-city/rulesets -X POST --input .github/rulesets/protect-main.json
gh api repos/maximalcode/git-city/rulesets -X POST --input .github/rulesets/protect-develop.json
```

Verify with `gh api repos/maximalcode/git-city/rulesets`, then confirm a direct
push to `main` is rejected.

## What each one does

**`protect-main.json`** — `main` is release-only, so it is locked down:

- blocks deletion and force-push
- requires a pull request. `required_approving_review_count` is **0** on
  purpose: GitHub does not let you approve your own pull request, so any higher
  number would make merging impossible for a solo maintainer while still forcing
  every change through a PR.
- requires the `ci` status check (the job name in
  [`../workflows/ci.yml`](../workflows/ci.yml) — renaming that job silently
  unprotects `main`). `strict_required_status_checks_policy` is false, so a PR
  does not have to be rebased onto the newest `main` before merging.
- the bypass list is empty, deliberately: the point is to stop the maintainer
  from casually pushing to `main`. Tag pushes are unaffected, so releases still
  work.

**`protect-develop.json`** — `develop` is the working branch, so it only gets a
safety net: deletion and force-push are blocked, nothing else. No PR requirement
and no required checks — required status checks would block every direct push,
since checks only run _after_ a push lands. CI still runs on `develop` pushes, so
a red build is visible even though it is not blocking.
