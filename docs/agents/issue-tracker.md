# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `maximalcode/git-city`. Use `gh`
inside the repository so it resolves the repository from the git remote.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`.
- Read, including discussion and labels:
  `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels`, with
  appropriate filters and pagination for the task.
- Comment: `gh issue comment <number> --body-file <file>`.
- Edit the body: `gh issue edit <number> --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or
  `gh issue edit <number> --remove-label "..."`.
- Close: `gh issue close <number>`.

Write multiline bodies to a UTF-8 file with actual newlines and pass that file
with `--body-file`.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue body, labels, and
comments using the read command above. Follow `AGENTS.md` for the issue-first,
branch, commit, validation, and pull-request workflow.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares its number space between issues and pull requests. When the type
of a reference is unknown, try `gh pr view <number>` and fall back to
`gh issue view <number>`.
