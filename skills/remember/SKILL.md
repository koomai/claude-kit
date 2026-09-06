---
name: remember
description: >-
  Save feature context for future sessions. Use when finishing significant work, after important
  discussions, or when the user says "save context". Captures decisions, corrections, architecture,
  and deliberately deferred work.
---

# Save Feature Context

Record the decisions behind a feature so future sessions don't rederive or reverse them. This captures what code alone cannot: why an approach was chosen, what was tried and rejected, and what was deliberately left undone.

The file is a dated decision record, not a status report. Never write progress state — how far along the work is, what's in flight — it is stale by the next session. Check `git log` for that instead.

## When to Save

- After significant feature work (code changes, architecture, multi-step tasks)
- After important discussions (planning, corrections, decisions about approach)
- When the user explicitly asks to save context
- Before ending a long session where valuable context would be lost

## Context Storage

The memory root is this session's auto-memory directory — the path named in your system prompt's memory section, i.e. `~/.claude/projects/<slug>/memory/`, where `<slug>` is the absolute working directory with every non-alphanumeric character replaced by `-`.

Feature context files live in `<memory root>/features/`, one file per feature named `{feature-name}.md` (kebab-case).

**IMPORTANT**: If `features/` does not exist, follow [Saving a feature for the first time](#saving-a-feature-for-the-first-time) before continuing.

## How to Save

1. **Determine the feature name** — use the git branch name, the primary topic, or ask the user if unclear
2. **Check if a context file already exists** for this feature using Glob on `<memory root>/features/`
3. **If creating a NEW file** — read the template at `<memory root>/features/_template.md` and follow its structure exactly
4. **If UPDATING an existing file** — read the existing file, preserve its structure, and merge new information into the relevant sections. Don't overwrite prior context — append to it.
5. **Review the transcript** for:
   - Architecture decisions and why they were made
   - Corrections and course changes (what was tried, what was wrong, what we switched to)
   - User preferences or feedback that changed the approach
   - Key files created or modified and their roles
   - Gotchas, things that tripped us up, or things easy to get wrong
   - Work deliberately deferred, and why
6. **Write the context file**
7. **Update the repo's reference docs, if it has any** — only when the session produced reusable system knowledge, and only in a doc that already exists. Never create one.
8. **Confirm what was saved** — the context file, and any reference doc updated.

## What to Save

- Decisions and the reasoning behind them
- Corrections: "initially tried X, switched to Y because Z"
- User feedback that changed the approach
- Key files and their roles (paths only, not contents)
- Non-obvious patterns or conventions used
- Gotchas and things that required multiple attempts
- Work deliberately deferred, and open questions

## Two Destinations

A session can produce two kinds of knowledge. Save to the right place:

| Knowledge type | Where | Format |
|---|---|---|
| **Session context** — decisions, corrections, what was tried, what was deferred | `<memory root>/features/{feature-name}.md` | Follow `_template.md` |
| **System knowledge** — how something works, reusable patterns, gotchas the team should know | The repo's existing reference docs | Lean: decisions, mental models, gotchas, file pointers. No code dumps. |

A gotcha specific to this feature stays in the feature file. One about a shared system belongs in that system's reference doc, if the repo has one.

## What NOT to Save

- Obvious framework conventions — anything a competent reader gets from the framework's own docs
- Full file contents — just reference paths
- Temporary debugging state
- Information already captured in existing docs
- Code snippets or config dumps in reference docs — agents can read source files directly
- Copy, translation, and config value tweaks — visible in the diff. Save only the decision behind one, if there was one.
- In-flight status: unpushed, no PR, awaiting review. It goes stale; readers can check `git log` / `gh pr view`. A merged PR number and sha is fine as history.

## Saving a feature for the first time

1. Create `features/` under the memory root resolved in [Context Storage](#context-storage).
2. Add a `_template.md` file with the contents below:

```
# Feature: {Feature Name}

## Date
DD-MM-YYYY

## Branch
{branch-name}

## Key Files
- `path/to/file` — role/purpose

## Architecture Decisions
- Decision and why it was chosen over alternatives

## Corrections & Course Changes
- What was initially tried or assumed, what was wrong, and what we switched to
- User preferences or feedback that changed the approach

## Deferred & Open Questions
- Work consciously not done, and why
- Questions left unresolved

## Patterns Used
- Non-obvious patterns, conventions, or libraries specific to this feature

## Gotchas
- Things that were tricky, easy to get wrong, or required multiple attempts
```
