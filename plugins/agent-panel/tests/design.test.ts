import { expect, test } from 'claude-code/testing'

import { designCss, hashOf, layerDesign, readDesign } from '../hooks/design'
import { MAX_FIGURES, cleanSvg, pageData, pageHtml, readVerdict } from '../hooks/page'
import { closeRound, panelSynthesis, parseSeat, planAsk } from '../hooks/seats'
import type { Run } from '../types'

const BUILT_IN = `---
name: Plain document
webfonts: https://fonts.example/css2?family=A:wght@400;600&display=swap
# Surfaces
ink: #18202c
accent: #2a3fa8
font: 'Atkinson', system-ui, sans-serif
---

# Notes that no section owns

## Writing

Lead with the point.

## Illustrations

Draw only structure.

### A sub-heading stays in its section

## Styles

\`\`\`css
\`\`\`
`

test('a design file gives tokens, a font stylesheet, two prompts and extra styles', () => {
  const design = layerDesign([readDesign(BUILT_IN)])

  expect(design.name).toBe('Plain document')
  expect(design.webfonts).toBe('https://fonts.example/css2?family=A:wght@400;600&display=swap')
  expect(design.tokens).toEqual({ ink: '#18202c', accent: '#2a3fa8', font: "'Atkinson', system-ui, sans-serif" })
  expect(design.writing).toBe('Lead with the point.')
  expect(design.illustrations).toBe('Draw only structure.\n\n### A sub-heading stays in its section')
  expect(design.styles).toBe('')
  expect(designCss(design, '.x{}\n')).toBe(":root {\n  --ink: #18202c;\n  --accent: #2a3fa8;\n  --font: 'Atkinson', system-ui, sans-serif;\n}\n\n.x{}")
})

test('a later design file replaces only the keys and sections it contains', () => {
  const mine = readDesign('---\n--accent: #b4005a\nwebfonts:\nbad: red; } body { display: none\n---\n\n## Illustrations\n\n## Styles\n\n```css\n.headline { font-weight: 400; }\n</style><script>x()</script>\n```\n')
  const design = layerDesign([readDesign(BUILT_IN), mine])

  expect(design.tokens).toEqual({ ink: '#18202c', accent: '#b4005a', font: "'Atkinson', system-ui, sans-serif" })
  expect(design.name).toBe('Plain document')
  expect(design.webfonts).toBe('')
  expect(design.writing).toBe('Lead with the point.')
  expect(design.illustrations).toBe('')
  expect(designCss(design, '.x{}')).toContain('.headline { font-weight: 400; }\n<\\/style><script>x()</script>')
  expect(readDesign('---\nwebfonts: javascript:alert(1)\n---\n').webfonts).toBe('')
  expect(readDesign('Just a note.')).toEqual({})
  expect(hashOf('#fff')).not.toBe(hashOf('#000'))
})

test('a figure keeps its drawing and loses everything that could run or reach out', () => {
  const drawn = cleanSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 120" width="720" height="120" onload="x()">
<!-- note --><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8"/></marker></defs>
<style>rect { fill: red }</style><script>alert(1)</script><foreignObject><div>hi</div></foreignObject>
<a href="https://x.example"><text>kept</text></a><image href="https://x.example/a.png"/>
<rect x="10" y="10" width="200" height="60" rx="4" fill="var(--wash)" stroke="url(https://x.example/a)" class="history" style="position:fixed"/>
<line x1="210" y1="40" x2="300" y2="40" stroke="var(--s1)" marker-end="url(#tip)"/>
<text x="20" y="45" font-size="15">Read & <b>index</b> "it"</text></svg><p>after</p>`,
    'figure-1-',
  )

  expect(drawn).toBe(
    `<svg viewBox="0 0 720 120">
<defs><marker id="figure-1-tip" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8"/></marker></defs>

<text>kept</text>
<rect x="10" y="10" width="200" height="60" rx="4" fill="var(--wash)"/>
<line x1="210" y1="40" x2="300" y2="40" stroke="var(--s1)" marker-end="url(#figure-1-tip)"/>
<text x="20" y="45" font-size="15">Read &amp; index &quot;it&quot;</text></svg>`,
  )
  expect(cleanSvg('<svg width="640" height="200"><g><rect width="5" height="5"></svg>', 'f-')).toBe('<svg viewBox="0 0 640 200"><g><rect width="5" height="5"></rect></g></svg>')
  expect(cleanSvg('<svg><rect/></svg>', 'f-')).toBeUndefined()
  expect(cleanSvg('<div>not a drawing</div>', 'f-')).toBeUndefined()
  expect(cleanSvg('<svg viewBox="0 0 1 1"><svg viewBox="0 0 1 1"><rect/></svg><circle r="1"/></svg>', 'f-')).toBe('<svg viewBox="0 0 1 1"><circle r="1"/></svg>')
})

test('a verdict carries at most two captioned figures, drawn under the headline', () => {
  const svg = '<svg viewBox="0 0 720 40"><rect width="10" height="10"/></svg>'
  const verdict = readVerdict({ headline: 'Index it.', figures: [{ svg, caption: 'The read path, **before** and after.' }] })
  if ('error' in verdict) throw new Error(verdict.error)
  const run: Run = { id: 'ab12cd', kind: 'panel', question: 'Why?', seats: [{ ...parseSeat('opus:high')!, status: 'done', answer: 'Index it.' }], phase: 'drafting', round: 1, rounds: 1, challenges: [] }
  const html = pageHtml({ ...pageData(closeRound(run), 1), verdict }, { css: '', script: '', marked: '', fonts: '' }, 'local')

  expect(html).toContain(`<div class="figures">\n<figure class="figure" id="figure-1"><div class="figure-art">${svg}</div><figcaption><span class="raw" data-md="inline">The read path, **before** and after.</span></figcaption></figure>\n</div>`)
  expect(html).not.toContain('<link rel="stylesheet"')
  expect(readVerdict({ headline: 'x' })).not.toHaveProperty('figures')
  expect(readVerdict({ headline: 'x', figures: [{ svg }] })).toEqual({ error: 'Figure 1 needs a caption: one sentence that states what it shows.' })
  expect(readVerdict({ headline: 'x', figures: [{ svg: '<svg></svg>', caption: 'c' }] })).toEqual({ error: 'Figure 1 is not usable: it must be one <svg> element with a viewBox. Fix it or leave it out.' })
  expect('error' in readVerdict({ headline: 'x', figures: Array.from({ length: MAX_FIGURES + 1 }, () => ({ svg, caption: 'c' })) })).toBe(true)
})

test('the session is given the design’s writing and illustration rules only when it has them', () => {
  const run: Run = { id: 'ab12cd', kind: 'panel', question: 'Why?', seats: [{ ...parseSeat('opus:high')!, status: 'done', answer: 'Index it.' }], phase: 'done', round: 1, rounds: 1, challenges: [], page: '/runs/x/discussion.html' }
  const guided = panelSynthesis(run, { writing: 'Lead with the point.', illustrations: 'Draw only structure.' })
  const wordsOnly = planAsk(run, { writing: 'Lead with the point.', illustrations: '' })

  expect(guided).toContain('- figures: optional illustrations, each an inline SVG with a caption, drawn to the rules under Figures below\n\nLead with the point.\n\nFigures:\nDraw only structure.\n\nAfter the tool call')
  expect(wordsOnly).toContain('leave it out otherwise\n\nLead with the point.\n\nAfter the tool call')
  expect(wordsOnly).not.toContain('figures:')
  expect(panelSynthesis(run)).toContain('by round and seat\n\nAfter the tool call')
})
