---
name: Plain document
webfonts: https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;600&family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,600;0,700;1,400&display=swap

# Type
font: 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', sans-serif
font-code: 'Atkinson Hyperlegible Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace
small: 0.9375rem
meta: 0.875rem

# Surfaces and text
sheet: #ffffff
rail: #f5f6f8
wash: #eceff4
rule: #d9dee7
ink: #18202c
muted: #4d5869
accent: #2a3fa8

# Status: waiting on the reader, held independently, failed
wait: #7a4d00
wait-bg: #fbedc8
good: #17603e
bad: #a02222

# One colour per seat, reused from seat 7
s1: #1f5db4
s2: #0d7458
s3: #b0450f
s4: #7240a8
s5: #a31a5c
s6: #5d6a10

# Layout
measure: 45rem
history: 18rem
outline: 13rem
round-bar: 2.75rem
---

# Agent panel page design

The look and voice of the discussion page and the plan page. The plugin reads this file, then
`~/.claude/agent-panel/design.md`, then `.claude/agent-panel/design.md` in the project. A later
file replaces only the keys and sections it contains, so a copy can be three lines long.

- Every key above except `name` and `webfonts` becomes a CSS variable: `accent` is `var(--accent)`.
- `webfonts` is one https stylesheet URL. Leave it empty to load no web fonts.
- "Writing" and "Illustrations" are given to the session that records the verdict or plan summary.
  An empty "Illustrations" section turns figures off.
- "Styles" is CSS added after the built-in stylesheet.

The page is a document, not a dashboard: white, one type family, no boxes. Colour marks a seat.
Amber marks something waiting on the reader.

## Writing

The page is read by someone who did not watch the run. Lead every field with its point and keep it to sentences: no headings, lists or tables inside a field. Put file paths, commands and identifiers in backticks. Refer to a seat as "Seat 2" so the page can colour the reference. Say what you checked and what you did not, in plain words. Do not grade the seats or restate the question.

## Illustrations

Add a figure only when a picture carries structure that sentences cannot: a sequence of steps, how parts depend on each other, a before and after, where the seats stand across two or three options, or a timeline. Most verdicts need none. A list redrawn as boxes is decoration; leave it as a list. At most two figures.

Draw each figure as one inline SVG:

- `viewBox="0 0 720 H"` with no width or height, and nothing outside the viewBox.
- Lines and outlines: stroke width 1.5, `fill="none"` or `fill="var(--wash)"`, corners square or radius 4. No gradients, shadows, icons or emoji.
- Colour from the page only: `currentColor` for ink, `var(--muted)`, `var(--rule)` and `var(--accent)`. Use `var(--s1)` to `var(--s6)` only to mark seats 1 to 6, and `var(--wait)` only for something waiting on the reader.
- Text at font-size 15 or larger, in sentence case, in the same words the fields use. Do not set a font family.
- Only these elements survive: svg, g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, defs, marker.

Give every figure a caption: one sentence that states what it shows.

## Styles

```css
```
