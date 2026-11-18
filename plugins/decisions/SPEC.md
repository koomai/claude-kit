# Decisions pane: input spec

The tests in `hooks/register.test.tsx` check each rule. The test kit cannot move the focus ring, so
where the ring lands (rules 3 to 9 and 12) is tested through the functions that pick the target;
rules 1 and 11 are the terminal's own.

## Terminal facts the design works around

- The focus ring keeps its position in the list when elements above it appear or vanish. So
  nothing in the pane opens, closes, appears or disappears because the ring moved.
- An Input empties itself on Enter and stays empty until it is drawn under a new key. So a field
  gets a new key each time Enter saves it.

## Layout

Top to bottom, for the tab on show:

1. Tabs: `All`, then one per group in the order groups were first posted. At most 9.
2. Each decision in the tab, in posted order, always drawn in full:
   - Title line: `○` (open) or `●` (answered), the title, the answer in green, `· comment` when it
     has one. Not a stop.
   - Recommendation, dim. Not a stop.
   - Answer: one button per option (`ok`, `yesno`, `choice`), or an Answer field (`text`).
     Information rows have none.
   - Comment field. A `text` decision has none: its Answer field is the comment.
3. `Anything else` field.
4. `Send answers`, then `Clear sent` when anything was sent.

A stop is a tab, an option, a field or a button. The order of stops is the order above.

## Rules

1. **Tab and Down** move to the next stop. **Shift+Tab and Up** move to the previous one. Both
   follow the same order. Inside a two-line Answer field, Up and Down first move between its lines.
2. **Enter on a tab**, or its number key 1–9, shows that tab. The ring sits on that tab.
3. **Enter on an option** sets the answer and moves the ring to that decision's Comment field.
4. **Enter in an Answer field** saves it and moves the ring to the next decision's first stop.
5. **Enter in a Comment field** saves it and moves the ring to the next decision's first stop.
6. After the last decision in the tab, the next stop is `Anything else`, for Enter and Tab/Down
   alike.
7. **Enter in `Anything else`** saves it and moves the ring to `Send answers`.
8. **Enter on `Send answers`**, or `s`, sends. The ring moves to the first tab.
9. A decision's first stop is its first option, else its Answer field, else its Comment field.
10. **Typing saves as you type.** Leaving a field by any key or a click loses nothing, and a field
    shows its saved text when the ring comes back.
11. **Esc** returns to the prompt. What was typed is already saved.
12. A post or resolve from Claude never moves the ring. It returns to the stop it was on, or to the
    first tab when that stop's decision was removed.

## Sending

`Send answers (n/m)` counts the answered decisions out of the open ones. Sending submits every open
decision as a prompt headed "Decisions from the pane"; an unanswered one reads "No answer". Answered
decisions move to Sent and leave the list. Unanswered ones stay open.
