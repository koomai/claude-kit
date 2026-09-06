---
name: recall
description: >-
  Load feature context from previous sessions. Use when resuming work on a feature, tweaking
  something previously built, or when the user says "recall", "continue working on", or references a
  feature by name.
---

# Recall Feature Context

Load context from previous work sessions so you can pick up where you left off without grepping the entire codebase.

## Context Storage

The memory root is this session's auto-memory directory — the path named in your system prompt's memory section, i.e. `~/.claude/projects/<slug>/memory/`, where `<slug>` is the absolute working directory with every non-alphanumeric character replaced by `-`.

Feature context files live in `<memory root>/features/`, one file per feature named `{feature-name}.md` (kebab-case). If that directory doesn't exist, no context has been saved for this project yet — say so and proceed with normal codebase exploration.

## When This Skill Is Invoked

1. **List available context files** in `<memory root>/features/` using Glob
2. **Match the relevant file** based on what the user is asking about (the feature name, the branch name, or keywords from their request)
3. **Read the matching context file(s)** to load prior session knowledge
4. **Check recent git history** on the current branch for additional context: `git log --oneline -20`
5. **Summarize what you know** to the user before starting work — confirm you have the right context

If no context file matches, tell the user and proceed with normal codebase exploration.

## After Completing Significant Work

When this skill is active and you complete significant feature work in a session, you MUST update or create the feature context file before finishing. This is non-negotiable. Follow the `remember` skill — it owns the template and the rules for what belongs in a context file.

Briefly: write the feature name in kebab-case, follow `<memory root>/features/_template.md`, merge into an existing file rather than overwriting it, and record decisions, corrections, key file paths, deferred work, patterns, and gotchas. The file is a dated decision record, not a status report — don't save progress state, framework conventions, file contents, or in-flight PR status.
