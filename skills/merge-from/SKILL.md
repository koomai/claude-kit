---
name: merge-from
description: >-
  Merge the target branch into this one, resolving conflicts while preserving this branch's intent.
  Defaults to the repo's default branch.
argument-hint: "[target-branch]"
allowed-tools: Bash(git:*)
disable-model-invocation: true
---

## Task

Target branch: $ARGUMENTS — if blank, detect the repo's default branch via `git symbolic-ref refs/remotes/origin/HEAD` (fall back to checking for `main`, then `master`).

Reconcile this feature branch with the target so it merges cleanly. Never modify the target branch, and never push — leave that to me. If the working tree is dirty, stop and ask before doing anything.

1. `git fetch origin`.
2. Assess the divergence in both directions against `origin/<target>` — and more importantly, understand the *intent* of this branch's changes.
3. Merge `origin/<target>` into this branch (merge the remote-tracking ref, not a stale local one).
4. Resolve conflicts: take the target's newer changes by default, but this branch's intent wins where they collide. Example: target modified `component.tsx`, but this branch renamed it to `component-tab.tsx` — the rename was intentional, so apply the target's edit to `component-tab.tsx` and delete `component.tsx`.
5. Verify: run the project's test suite if one exists; otherwise build/typecheck. Report anything you couldn't verify.

Done means: no conflicts with the target, no target-branch changes overridden except where this branch's feature required it, and the feature's behaviour intact.

If divergence is severe enough that cherry-picking this branch's intent onto a fresh branch from the target would be cleaner, say so and ask before taking that path.