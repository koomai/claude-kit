---
name: artifact-conventions
description: >-
  Builds artifacts and standalone HTML pages in the house style, taking the look from the project's
  DESIGN.md. Use when asked to make, publish, redesign or fix an artifact, HTML page, report,
  explainer, review, decision page, dashboard or mockup canvas; when a page looks generic, off-brand,
  like "AI slop" or broken on a phone; or when the reader has to answer decisions and paste the
  answers back.
---

# Artifact Conventions

How every artifact and standalone HTML page is built. The look (colours, type, radius, layout
style) lives in a separate `DESIGN.md`; this file holds the rules that apply whatever the look.

Precedence: the user's words in the session, then `DESIGN.md`, then this file. The structural rules
of `artifact-design` (CSP hosts, `<title>` naming, content visible at rest) still apply.

## 1. Load the design

Read the first of these that exists, before writing any CSS:

1. `DESIGN.md` at the project root
2. `.claude/DESIGN.md` in the project
3. `references/DESIGN.md` in this skill's directory, the bundled starter

Take every colour, font, size and radius from it. A value the page needs that `DESIGN.md` lacks is
a gap to raise with the user, not one to fill with an invented value. When the page falls back to
the starter, say once that the project can copy it to its root and make it its own.

`DESIGN.md` decides theme support too: if it defines dark values, build both themes; if it says
light only, declare `color-scheme: light` and add no dark palette.

### Required tokens

The decisions-table script styles itself with these CSS variables, so every `DESIGN.md` defines
them on `:root`: `--ground`, `--surface`, `--sunken`, `--line`, `--line-strong`, `--ink`,
`--ink-2`, `--accent`, `--accent-soft`, `--on-accent`, `--radius-sm`, `--radius-md`.

## 2. Page structure

- Real `h2`/`h3` headings that name their subject flatly. No slogan headings ("Three locks, one at
  each level").
- Tables for comparisons and decisions. A `dl` for paired facts.
- One framed figure per illustration.
- Summary before detail. Body text near 16px; nothing smaller than 13px, SVG labels included.
- Keep running text near 65 characters wide.
- No horizontal page scroll at 390px. Only a table, diagram or code block may be wider, inside its
  own `overflow-x: auto` box.

## 3. AI tells to avoid

These mark a page as machine-made at a glance. Adapted from the
[Impeccable slop catalog](https://impeccable.style/slop/#catalog).

**Never put a side-tab accent border on a card**: a thick coloured stripe down one side of a
rounded box. It is the most recognisable tell, and it makes an ordinary card look like an alert
with nothing to report. A real alert that needs status colour uses a tinted fill or an icon, not a
stripe.

Structure:
- A label, eyebrow or kicker above a heading, and a badge or pill above the main headline.
- An icon tile stacked above a heading.
- Grids of identical cards (icon, heading, two lines) that give every point the same weight.
- Cards inside cards.
- A hero metric: a huge number with a small label, when the figure isn't the point of the page.
- Small `01 / 02 / 03` numbers beside headings when the content is not a sequence.

Surfaces:
- A coloured bar along the top of a rounded card.
- A hairline border and a wide shadow on the same card. Pick one.
- Glassmorphism, decorative grid-line backgrounds, repeating stripes.
- Radial halos or soft spotlights behind content.
- Gradient text, and gradients generally.
- The default AI palettes: purple-to-blue gradients, cyan on near-black, cream and terracotta.
- Very large corner radii on cards.

Type:
- All-caps body text, crushed letter spacing, wide letter spacing on body text.
- An oversized italic serif display headline used for an "editorial" look.
- Flat hierarchy where headings and body text look alike.

Motion:
- Pulsing status dots, blinking cursors, marquees.
- Bounce or elastic easing.
- Hover lifts, and images that zoom or rotate on hover.
- Content hidden until an entrance animation runs.

Copy:
- An em dash in every other sentence. Use full stops.
- Forced contrast ("Not a feature. A platform.") and "not X, but Y" framing.
- Generic marketing claims ("supercharge", "seamless").
- The same label repeated in several slots of one container.

Imagery:
- Placeholder SVG art: avatar blobs, generic circles and blocks, rough mascots.
- Unicode arrows (→) used as connectors in diagrams. Draw the connector.

## 4. Diagrams

- Keep diagrams; they carry the page. Prefer a clearly labelled illustration to a paragraph when
  explaining a workflow or a structure.
- Draw charts to scale: every mark and tick from one scale, every label a value the chart reaches.
- Below 720px wide, draw a portrait SVG or show a list version. Never give a figure a `min-width`
  inside a scroll box.
- Narrow-screen grids use `minmax(0, 1fr)`. Without it, a `pre` widens the page.

## 5. Copy

- Say each fact once.
- Use the project's own terms for its concepts. Do not swap in a generic word that reads more
  smoothly.
- Never describe the audience's abilities ("non-technical", "for beginners"). Name the document's
  purpose instead.
- Explain technical detail in plain language.
- End with an explicit ask: the decisions table in section 6.

## 6. Decisions table

Every page that asks the reader for decisions ends with an answerable decisions table. The script
`scripts/decisions.js` in this skill's directory turns the table into a form and adds a copy
button; the reader pastes the copied text back to Claude.

Inline the script's contents in a `<script>` at the end of the page. A `src` on another host is
blocked by the artifact CSP.

```html
<table class="decisions" data-decisions="Search filter usage">
  <thead><tr><th>Decision</th><th>Recommendation</th><th>Status</th></tr></thead>
  <tbody>
    <tr data-decision="guests-bar" data-ask="ok">
      <td>Guests in the search bar</td>
      <td>Move Guests out of the Filters sheet into the search bar.</td>
      <td><span class="pill">Needs your OK</span></td>
    </tr>
  </tbody>
</table>
```

- `data-decisions` names the table in the copied text and keys the saved draft.
- The last column is the answer column. The script renames its heading "Your answer" and stacks the
  status pill (`.pill`, styled by the page) above the controls.
- `data-decision` is a short stable id, so a draft survives a republish.
- `data-ask` sets the control:

| `data-ask` | Control | Use for |
| --- | --- | --- |
| `ok` | OK / Not OK radios | Every "Needs your OK" row. Radios, not a checkbox, so an unanswered row is never read as a rejection. |
| `yesno` | Yes / No radios | A row phrased as a question. |
| `choice` + `data-choices="A\|B\|C"` | One radio per option | A choice between named options. |
| `text` | An always-open textarea | A row that needs a written answer. |
| omitted | Comment only | An information row, such as "No change". |

Every row also gets an optional comment, and the form ends with "Anything else" and "Copy answers
for Claude". The copied text lists each decision with its recommendation, the answer ("No answer"
when blank) and any comment. Answers are kept in the viewer's `localStorage` as an unsent draft
only; nothing reaches Claude until the reader pastes. When the browser blocks the copy, the text
appears selected in a textarea for a keyboard copy.

Mark rows that need an answer visibly (a tinted row or a status pill), and say above the table that
the reader answers here and pastes the result back.

## 7. Design-canvas mockups

When the artifact is a canvas of artboards (mockups, screen states):

- The per-artboard open control is an eye or magnifying-glass icon, never a play button.
- In the zoomed view, the left and right arrow keys move to the previous or next artboard without
  returning to the canvas, and ‹ › buttons sit at the left and right screen edges.
- The zoomed view shows the caption in a bottom-centre pill: `title · n / total`.
- Switching artboards never flickers through the canvas. Cover the switch with a slide curtain: a
  dark full-screen panel slides in from the direction of travel and out the other side.
- A stock canvas template usually lacks these. Patch the template once per task and seed from the
  patched copy. Patch it again if the template's skill version changes.

## 8. Before publishing

Look at the rendered page once, at desktop width and at 390px:

- No horizontal scroll and no console errors.
- Every colour, font, size and radius comes from `DESIGN.md`.
- None of the tells in section 3.
- The decisions table answers, copies and keeps its draft across a reload.
