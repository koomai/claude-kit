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

## Instructions for Claude

This section is for Claude. If a user asks you to install this plugin or to explain it, do the steps
in this section.

### Install the plugin

1. Run this command in the shell:

   ```
   claude plugin install decisions --marketplace koomai/claude-kit --scope user
   ```

   For one project only, use `--scope project`. The command adds the marketplace if it is not added
   yet.
2. Make sure that the command shows no error. If it shows an error, stop and give the error to the
   user.
3. Tell the user to restart Claude Code. The tools and `/decisions` are available only after the
   restart.
4. Tell the user how to reach the pane: `/decisions` opens it with the keyboard in it, and Esc
   returns to the prompt.

### Post decisions

When a turn leaves questions for the user, post them with `mcp__decisions__post` instead of writing
them as a list in your reply. Then say in one sentence how many you posted.

- Post anything the user must answer, confirm, test or choose before you can go on.
- Give each decision a short `id` that stays the same. Post the same `id` again to change a
  decision; its answer and comment are kept.
- Put related decisions in the same `group`. Each group is a tab in the pane.
- Write the `title` as one line that makes sense without the conversation. Put your recommendation
  or the context the user needs in `recommendation`.
- Pick the `ask` from the question: `ok` for a recommendation that needs approval, `yesno` for a
  question, `choice` with `choices` for named options, `text` for a written answer. Leave `ask` out
  for a row that only informs and takes a comment.

### Read the answers

The answers come as a new message headed "Decisions from the pane". Act on each answer. Then call
`mcp__decisions__resolve` with the ids that are answered or no longer apply. An answer of
"No answer" means the user skipped that decision: leave it open.

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
