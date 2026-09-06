---
name: artifact-theme
description: >-
  House visual identity for artifacts and standalone HTML pages — palette, typefaces, layout, and
  the looks to avoid. Read before building any artifact, artifact page, visual explainer, dashboard,
  landing page, or self-contained HTML document.
---

# Artifact Theme

House tokens and rules for anything published as an artifact or a standalone HTML page.

Precedence: follow the user's request in the session, then the project's design system if it has one, then this file. This file replaces the model's default aesthetic choices — not the structural rules in `artifact-design` (theme token structure, CSP-permitted hosts, `<title>` naming, visible-at-rest rendering), which still apply.

> Replace the palette, type, and Never list below with your own.

## Color

Neutrals carry a blue cast, away from the teal accent.

```css
:root {
  --ground: #f7f9fc;        /* page background */
  --surface: #ffffff;       /* cards, raised panels */
  --sunken: #f1f6fd;        /* bands separating content groups */
  --line: #e3e9f1;          /* hairlines — barely visible by design */
  --line-strong: #c4d1e0;   /* the rare border that must read */
  --ink: #0f1720;           /* body text */
  --ink-2: #45535f;         /* secondary text */
  --ink-3: #73828e;         /* captions, labels */
  --accent: #0e7f6f;
  --accent-soft: #d8f3ed;
  --on-accent: #ffffff;

  --link: #2563eb;
  --warn: #8a6108;
  --bad: #a4372a;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --shadow-1: 0 1px 2px rgba(16, 24, 40, 0.05);
  --shadow-2: 0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 10px -3px rgba(16, 24, 40, 0.08);
  --shadow-3: 0 2px 4px rgba(16, 24, 40, 0.04), 0 12px 24px -8px rgba(16, 24, 40, 0.12);
}
```

Dark values. The accent brightens — `#0e7f6f` reads near-black at badge size on a dark ground. Shadows go black and heavier.

```css
--ground: #0e1214;
--surface: #191f22;
--sunken: #14191c;
--line: #262d31;
--line-strong: #3a444a;
--ink: #eef2f3;
--ink-2: #a8b4b8;
--ink-3: #77848a;
--accent: #57d7be;
--accent-soft: #123b33;
--on-accent: #04211d;

--link: #8ab4ff;
--warn: #e5b352;
--bad: #ee9182;

--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-2: 0 1px 2px rgba(0, 0, 0, 0.35), 0 4px 10px -3px rgba(0, 0, 0, 0.5);
--shadow-3: 0 2px 4px rgba(0, 0, 0, 0.35), 0 12px 24px -8px rgba(0, 0, 0, 0.6);
```

`link`, `warn` and `bad` are semantic — never substitutes for the accent.

## Type

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap">
```

| Role | Face | Stack |
|---|---|---|
| Display | Inter 700, tracking `-0.02em` | `Inter, ui-sans-serif, system-ui, sans-serif` |
| Body | Inter 400/500 | same |
| Data, code, labels | JetBrains Mono 400 | `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace` |

Inter is deliberate here, overriding `artifact-design`'s warning against it. For a display face with more character, swap the display row only.

- Scale: 12 / 14 / 16 / 20 / 26 / 34 / 44
- Running text near 65 characters wide
- `text-wrap: balance` on headings, `0.06em` letter-spacing on uppercase labels
- `font-variant-numeric: tabular-nums` wherever digits align

## Layout

**Elevation, not edges.** A card is `--surface` plus `--shadow-2`, with a hairline faint enough to only catch the edge. Borders on every card, row, panel and input make the screen read as a wireframe.

Radius by role: `sm` inputs and chips, `md` cards, `lg` panels and modals.

## Never

- Borders as the primary separator. Reach for shadow first.
- A second accent. One teal, spent sparingly; semantic colors do the rest.
- Emoji as section markers, gradient heroes, or `01 / 02 / 03` numbering on content that isn't a sequence.
- Pure `#808080`-family greys. Every neutral here carries a cast.

## Applying it

1. Declare every token in the bare `:root` block, light values first.
2. Redefine only the token values under `@media (prefers-color-scheme: dark)`, guarded as `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.
3. Style every component through the tokens. Never put a color's only definition inside a media or `[data-theme]` block.
4. Set `body` background from `--ground` explicitly, and set `color-scheme` under the same three-state rule so the browser paints scrollbars and form controls to match.
