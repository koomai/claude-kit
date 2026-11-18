# Decisions

A pane beside the chat that holds the questions Claude leaves for you. Claude posts each open
decision to the pane instead of writing a "still waiting on you" list that scrolls away. You
answer and comment in the pane and send everything back in one go.

## Install

From a Claude Code terminal session:

```
/plugin install decisions --marketplace koomai/claude-kit
```

Answer `y` to add the marketplace, then pick a scope.

## Use

- The pane opens on the right when Claude posts decisions, in fullscreen mode at 110 columns or
  wider. In a narrower terminal it waits until you run `/decisions`.
- `/decisions` opens the pane with the keyboard in it. Esc returns to the prompt.
- Number keys 1–9 switch tabs: `All`, then one per group.
- Tab and Down move to the next control, Shift+Tab and Up to the previous one.
- Enter on an option sets the answer and moves to its comment. Enter in a field saves it and moves
  to the next decision.
- `s` sends your answers to Claude as a prompt headed "Decisions from the pane". Answered decisions
  move to Sent; unanswered ones stay open. `x` clears the sent ones.

[`SPEC.md`](SPEC.md) lists every key's behaviour, and `hooks/register.test.tsx` checks it.

## What Claude gets

Two tools, both in the prompt from the start:

| Tool | Does |
| --- | --- |
| `mcp__decisions__post` | Adds decisions, or updates one by its `id`. Each takes a `title`, an optional `recommendation` and `group`, and an `ask`: `ok`, `yesno`, `choice` with `choices`, `text`, or none for an information row. |
| `mcp__decisions__resolve` | Removes decisions by `id` once their answers have arrived. |

A short section added to the system prompt tells Claude to post its open questions there.

## Develop

```bash
claude plugin validate plugins/decisions
claude plugin test plugins/decisions
```
