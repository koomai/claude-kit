---
name: git-summary
description: >-
  Summarise what's happened on the current branch so far — commits, uncommitted work, untracked
  files, and how it diverges from the default branch — as bullet points. Use when the user asks
  what's on this branch, what's changed, where things are up to, to recap or catch up on the branch,
  or for a git status, diff, or branch summary.
allowed-tools: Bash(git:*)
---

## Context

Detect the default branch via `git symbolic-ref refs/remotes/origin/HEAD` (fall back to `main`, then `master`), then:

```
git branch --show-current
git status --short
git log --oneline <default>..HEAD
git diff --stat <default>...HEAD
git diff HEAD --stat
```

Read the diffs of anything whose purpose isn't obvious from the file name.

## Task

Summarise the branch as bullets, grouped under these headings. Skip a heading with nothing under it.

- **Branch** — name, and how far ahead/behind the default branch.
- **Committed** — what the commits on this branch actually accomplish, grouped by purpose rather than listed commit by commit.
- **Uncommitted** — staged and unstaged work in progress, by purpose.
- **Untracked** — new files, and whether they look intentional or incidental.
- **Loose ends** — anything that looks unfinished, contradictory, or accidentally included: debug code, a half-applied rename, an unrelated file, a stray artefact.

## Style

- One line per bullet. Say what changed and why, not which files.
- Reference paths only when they identify the thing being described.
- No commit SHAs unless a specific commit needs pointing at.
- Report only what the commands show. If the branch is empty or clean, say that in one line rather than padding the summary.
