---
name: commit
description: >-
  Create atomic commits by grouping uncommitted changes logically, one commit per purpose.
allowed-tools: Bash(git:*)
disable-model-invocation: true
---

## Context

```
git status
git diff HEAD
git ls-files --others --exclude-standard
git log --oneline -10
```

## Task

Group all uncommitted changes — modified, deleted, and untracked — into atomic commits, one per purpose.

### Grouping

- Read the diffs before grouping. Group by purpose, not file type: a fix touching a controller, a test, and a migration is one commit.
- Split unrelated purposes — config, features, refactors, dependencies, deletions.
- Don't over-split. Closely related small changes belong together.

### Approval gate

**Never stage a file you did not create or edit in this session.** Another session, another worktree, or another agent may have left changes in this tree — they are not yours to commit. A file matching the branch name is not evidence you touched it.

Anything else — untracked files of unknown origin, generated artefacts, another feature stream — list for the user and stop. Do not stage it until they approve.

### Executing

1. Per group: `git add <specific files>`, then commit.
2. `git status` at the end to confirm nothing was missed.

### Commit message style

- Follow the style of recent commits in the repo
- Keep messages concise (1-2 sentences)
- Focus on the why, not the what
