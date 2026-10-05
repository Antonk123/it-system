# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Antonk123/it-system`.
Use the `gh` CLI from this clone; it infers the repository from origin.

## Conventions

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open`, with appropriate label filters.
- Comment: `gh issue comment <number> --body-file <file>`
- Apply labels: `gh issue edit <number> --add-label "..."`
- Remove labels: `gh issue edit <number> --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

For multiline bodies, write the exact Markdown to a temporary file.

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. For an ambiguous reference,
try `gh pr view <number>` and fall back to `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child tickets: link as GitHub sub-issues; if unavailable, use a
  task list in the map and `Part of #<map>` in each child.
- Label children `wayfinder:<type>`:
  `research`, `prototype`, `grilling`, or `task`.
- Blocking: use native GitHub issue dependencies. If unavailable,
  record `Blocked by: #<number>` in the child.
- Frontier: select the first open, unassigned child in map order
  whose blockers are all closed.
- Claim: assign the ticket with `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the result, close the child, and append
  a summary and link to the map's Decisions-so-far.
