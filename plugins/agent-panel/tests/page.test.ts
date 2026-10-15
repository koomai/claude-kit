import { expect, test } from 'claude-code/testing'

import { pageData, pageFor, pageHtml, planData, readVerdict, splitPlan } from '../hooks/page'
import { historyEntry, historyScript, savedRun, withEntry } from '../hooks/history'
import { closeRound, parseSeat } from '../hooks/seats'
import type { Run, Seat } from '../types'

const ASSETS = { css: '.x{}', script: 'run()', marked: 'lib()', fonts: 'https://fonts.example/css2?family=A:wght@400;600&display=swap' }
const seatOf = (spec: string, patch: Partial<Seat> = {}): Seat => ({ ...parseSeat(spec)!, status: 'done', ...patch })
const RUN: Run = {
  id: 'ab12cd',
  kind: 'panel',
  question: 'Why is `feed` slow?',
  seats: [seatOf('opus:high', { answer: '1. **Answer:** Index it.\n\n2. **Evidence:** <script>alert(1)</script> in feed.ts:12.' }), seatOf('sonnet:high:contrarian', { answer: 'The cache is cold.' })],
  phase: 'drafting',
  round: 1,
  rounds: 2,
  challenges: [],
  startedAt: Date.UTC(2026, 9, 14),
}
const told = (run: Run) => pageData(run, 9).messages.map(message => `${message.round}.${message.seat} ${message.state}`)

test('a live run shows who has answered and who is still writing, and its page asks for updates', () => {
  const live = pageData({ ...RUN, seats: [RUN.seats[0]!, seatOf('sonnet:high:contrarian', { status: 'working' })] }, 7)
  const html = pageHtml(live, ASSETS, 'local')

  expect(live.isLive).toBe(true)
  expect(live.messages.map(message => `${message.round}.${message.seat} ${message.state}`)).toEqual(['1.1 answered', '1.2 working'])
  expect(live.status).toBe('Round 1 of 2 is in progress: 1 of 2 seats have replied.')
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('data-rev="7" data-poll="yes"')
  expect(html).toContain('Writing its reply.')
  expect(html).toContain('<section class="sec stance"><h4 class="sec-label">Answer</h4>')
  expect(pageData({ ...RUN, seats: [seatOf('opus:high', { answer: '**Weakest part**\nThe join.\n\n**2. Evidence checked**\n- feed.ts:12' })] }, 1).messages[0]?.sections.map(section => `${section.label}/${section.kind}`)).toEqual(['Weakest part/stance', 'Evidence checked/support'])
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('<script>lib()</script>')
  expect(html).not.toContain('id="verdict"')
})

test('a finished discussion shows each round, who a reply answers, and a seat that kept its answer', () => {
  const first = closeRound(RUN)
  const replies = ['NO CHANGE', '1. Withdrawn: Seat 1 is right about the index.\n\n2. Standing objections: none.']
  const done = closeRound({ ...first, seats: first.seats.map((seat, i) => ({ ...seat, status: 'done' as const, answer: replies[i] ?? '' })) })
  const data = pageData(done, 9)
  const html = pageHtml(data, ASSETS, 'local')

  expect(told(first)).toEqual(['1.1 answered', '1.2 answered', '2.1 waiting', '2.2 waiting'])
  expect(told(done)).toEqual(['1.1 answered', '1.2 answered', '2.1 unchanged', '2.2 moved'])
  expect(data.messages[2]?.keptFrom).toBe(1)
  expect(data.messages[3]?.replyTo).toEqual([1])
  const crowd = { ...first, seats: first.seats.map(seat => ({ ...seat, status: 'done' as const, answer: '1. Changed: nothing.\n\n2. Still disputed: Seats 1, 2 and 9 miss it; seat 12 too.' })) }
  expect(pageData(closeRound(crowd), 9).messages[2]?.replyTo).toEqual([2])
  expect(data.status).toBe('completed 2 of 2 rounds')
  expect(html).toContain('Kept its <a href="#r1-s1">round 1 answer</a> without changes.')
  expect(html).toContain('Replying to <a class="ref s1" href="#r1-s1">Seat 1</a>')
  expect(html).toContain('No verdict has been added to this page yet.')
  expect(html).toContain('<span class="role">contrarian</span>')
  expect(html).toContain('<header class="msg-head"><span class="who">Seat 2</span><span class="model">sonnet·high</span><span class="role">contrarian</span><span class="state moved">moved</span></header>')
  expect(html).not.toContain('<span class="state answered">')
  expect(html).toContain('<section class="sec dispute fold-away"><h4 class="sec-label">Standing objections</h4>')
  expect(html).toContain('<button type="button" class="more" data-more>Show standing objections</button>')
  expect(html).toContain('data-set-density="brief"')
})

test('a verdict is read leniently and drawn with its checks, and the page for claude.ai is a fragment', () => {
  const verdict = readVerdict({
    headline: ' Index it. ',
    conclusions: [{ text: 'The join is the cost.', basis: 'independent', detail: 'feed.ts:12' }, 'A bare string', { text: '' }],
    changes: [{ seat: '2', text: 'Dropped the cache claim.' }],
    rejected: ['Too slow to matter.', 3],
    checks: [{ round: 1, seat: 1, text: 'Confirmed in feed.ts.' }, { round: 0, seat: 1, text: 'no such round' }],
  })
  if ('error' in verdict) throw new Error(verdict.error)
  const html = pageHtml({ ...pageData(closeRound({ ...RUN, rounds: 1 }), 3), verdict }, ASSETS, 'artifact')

  expect(verdict.headline).toBe('Index it.')
  expect(verdict.conclusions).toEqual([{ text: 'The join is the cost.', detail: 'feed.ts:12', basis: 'independent' }, { text: 'A bare string' }])
  expect(verdict.changes).toEqual([{ text: 'Dropped the cache claim.', seat: 2 }])
  expect(verdict.rejected).toEqual(['Too slow to matter.'])
  expect(verdict.checks).toHaveLength(1)
  expect('error' in readVerdict({ conclusions: [] })).toBe(true)
  expect(html.startsWith('<title>Panel ab12cd</title>')).toBe(true)
  expect(html).not.toContain('<!doctype')
  expect(html).toContain('cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js')
  expect(html).not.toContain('lib()')
  expect(html).not.toContain('data-poll')
  expect(html).toContain('Held independently in round 1')
  expect(html).toContain('Confirmed in feed.ts.')
})

const PLAN: Run = {
  id: 'cd34ef',
  kind: 'pingpong',
  question: 'Plan the billing move',
  seats: [seatOf('opus:high', { answer: 'Draft one.' }), seatOf('sonnet:high', { status: 'working' })],
  phase: 'drafting',
  round: 0,
  rounds: 2,
  challenges: [],
  startedAt: Date.UTC(2026, 9, 14),
}
const DRAFTS = ['Draft one.', 'Draft two.']
const REVISED = '## Steps\n\n1. Move the tables.\n\n## Rejected corrections\n\n- The lock claim: `jobs.ts:9` shows no lock.'
const steps = (run: Run) => planData(run, 5).turns.map(turn => `${turn.step}${turn.round || ''} ${turn.by} ${turn.state}`)

test('a ping-pong page follows the run from the drafts through the merge and each round', () => {
  const merged = { ...PLAN, drafts: DRAFTS, plans: ['Merged plan.'], candidate: 'Merged plan.', round: 1 }
  const stale = [seatOf('opus:high', { answer: 'Draft one.' }), seatOf('sonnet:high', { answer: 'Draft two.' })]

  expect(steps(PLAN)).toEqual(['draft 1 drafted', 'draft 2 working'])
  expect(planData(PLAN, 5).plan).toBeUndefined()
  expect(steps({ ...PLAN, phase: 'merging', drafts: DRAFTS, seats: stale })).toEqual(['draft 1 drafted', 'draft 2 drafted', 'merge 0 working'])
  expect(steps({ ...merged, phase: 'challenging', seats: stale })).toEqual(['draft 1 drafted', 'draft 2 drafted', 'merge 0 merged', 'challenge1 1 waiting'])
  expect(steps({ ...merged, phase: 'integrating', challenges: ['The lock is missing.'], seats: [stale[0]!, seatOf('sonnet:high', { status: 'working' })] }).slice(3)).toEqual(['challenge1 1 challenged', 'revision1 2 working'])
  expect(steps({ ...merged, phase: 'failed', challenges: ['The lock is missing.'], seats: [stale[0]!, seatOf('sonnet:high', { status: 'failed', answer: '(failed: aborted)' })] }).at(-1)).toBe('revision1 2 failed')
  expect(steps({ ...merged, phase: 'done', challenges: ['PASS'], seats: stale }).slice(3)).toEqual(['challenge1 1 passed'])
  expect(planData({ ...merged, phase: 'done', challenges: ['PASS'], seats: stale }, 5).plan).toEqual({ text: 'Merged plan.', from: 'merge' })
  expect(steps({ ...PLAN, phase: 'done', round: 1, challenges: ['x'], seats: stale }).slice(0, 2)).toEqual(['draft 1 drafted', 'draft 2 drafted'])
  expect(planData({ ...PLAN, phase: 'done', round: 1, challenges: ['x'], seats: stale }, 5).turns[0]?.text).toBe('')
})

test('a finished ping-pong page leads with the final plan and folds the superseded ones', () => {
  const done: Run = { ...PLAN, phase: 'done', round: 1, rounds: 1, drafts: DRAFTS, plans: ['Merged plan.', REVISED], challenges: ['The lock is missing in `jobs.ts`.'], candidate: REVISED, outcome: 'Completed 1 of 1 round.' }
  const data = planData(done, 5)
  const html = pageHtml(data, ASSETS, 'local')
  const verdict = readVerdict({ headline: 'Ready.', conclusions: ['Move the tables.'], changes: [{ seat: 1, text: 'Dropped the lock step.' }], checks: [{ round: 1, seat: 2, text: 'No lock at jobs.ts:9.' }], plan: ' Corrected plan. ' })
  if ('error' in verdict) throw new Error(verdict.error)
  const summed = pageHtml({ ...data, verdict }, ASSETS, 'artifact')

  expect(splitPlan(REVISED)).toEqual({ plan: '## Steps\n\n1. Move the tables.', rejected: '- The lock claim: `jobs.ts:9` shows no lock.' })
  expect(splitPlan('Plan.\n\n**Rejected corrections:** none.')).toEqual({ plan: 'Plan.', rejected: 'none.' })
  expect(splitPlan('Just a plan.')).toEqual({ plan: 'Just a plan.', rejected: '' })
  expect(pageFor(done, 5).kind).toBe('pingpong')
  expect(data.plan).toEqual({ text: '## Steps\n\n1. Move the tables.', from: 'r1-s2' })
  expect(data.status).toBe('Completed 1 of 1 round.')
  expect(html).toContain('<title>Ping-pong cd34ef</title>')
  expect(html).toContain('<h2>Final plan</h2><p class="byline">As revised by B in <a href="#r1-s2">round 1</a>.</p>')
  expect(html).toContain('<details class="fold" id="draft-a-text"><summary><span>Draft A</span><span class="count">2 words</span>')
  expect(html).toContain('<details class="fold" id="merge-text"><summary><span>Merged candidate plan</span>')
  expect(html).toContain('<h4 class="sec-label">Rejected corrections</h4>')
  expect(html).toContain('This is the <a href="#plan">final plan</a>, shown in full above.')
  expect(html).not.toContain('id="r1-s2-text"')
  expect(html).toContain('No summary has been added to this page yet.')
  expect(html).not.toContain('data-set-view')
  expect(summed).toContain('<p class="byline">Summary by the session that ran it, after checking the plan against the files it cites.</p>')
  expect(summed).toContain('<ol class="conclusions steps">')
  expect(summed).toContain('<span class="state answered">Revision</span>')
  expect(summed).toContain('<nav class="outline" id="outline"')
  expect(summed).toContain('<li class="sub s2"><a href="#r1-s2"><span>B</span><span class="note">revision</span></a></li>')
  expect(pageHtml({ ...data, verdict: { ...verdict, uncertainty: ['Ship it now?'] } }, ASSETS, 'local')).toContain('<a class="flag" href="#open">1 decision is still open</a></p>')
  expect(summed).toContain('The plan in brief')
  expect(summed).toContain('<span class="who">A</span>')
  expect(summed).toContain('Session’s check')
  expect(summed).toContain('Corrected by the session after its checks.')
  expect(summed).toContain('Corrected plan.')
})

test('saved answers become a run again, and a history lists runs newest first under their headline', () => {
  const asked = (kind: string, what: string) => `${kind} ab12cd, up to 2 rounds\n\n1. opus·high +ads (claude-opus-5-5, effort high)\n2. sonnet·low contrarian (claude-sonnet-5-5, effort low)\n\n## ${what}\n\nWhy is \`feed\` slow?\n\n## Not a heading of ours\n`
  const panel = savedRun({
    'question.md': asked('Panel', 'Question'),
    'round-1-seat-1-opus-high.md': '# Round 1, seat 1\n\nIndex it.',
    'round-1-seat-2-sonnet-low-contrarian.md': '# Round 1, seat 2\n\nThe cache is cold.',
    'round-2-seat-1-opus-high.md': '# Round 2, seat 1\n\nNO CHANGE',
  })
  const plan = savedRun({ 'question.md': asked('Ping-pong', 'Task'), 'draft-a-opus-high.md': '# Draft A\n\nOne.', 'draft-b-sonnet-low.md': '# Draft B\n\nTwo.', 'candidate.md': '# Merged\n\nBoth.', 'round-1-challenge.md': '# c\n\nPASS' }, 50)

  expect(panel?.seats.map(seat => seat.label)).toEqual(['opus·high +ads', 'sonnet·low contrarian'])
  expect(panel?.question).toBe('Why is `feed` slow?\n\n## Not a heading of ours')
  expect(panel?.transcript?.map(entries => entries.map(entry => entry.state))).toEqual([['answered', 'answered'], ['unchanged', 'failed']])
  expect(plan).toMatchObject({ kind: 'pingpong', phase: 'done', round: 1, drafts: ['One.', 'Two.'], plans: ['Both.'], challenges: ['PASS'], startedAt: 50 })
  expect(savedRun({ 'question.md': 'A note.' })).toBeUndefined()
  expect(savedRun({ 'question.md': asked('Ping-pong', 'Task') })?.phase).toBe('failed')

  const first = historyEntry({ ...pageData(RUN, 1), verdict: { headline: 'Index **it**.', conclusions: [], changes: [], rejected: [], disagreements: [], uncertainty: [], blindSpots: [], checks: [] } }, 'old')
  const second = historyEntry(planData({ ...PLAN, startedAt: Date.UTC(2026, 9, 15) }, 1), 'new')
  const history = withEntry(withEntry({ stamp: 's', runs: [first] }, second), { ...first, headline: 'Later.' })

  expect(first).toEqual({ id: 'ab12cd', kind: 'panel', folder: 'old', question: 'Why is feed slow?', state: 'live', startedAt: Date.UTC(2026, 9, 14), headline: 'Index it.' })
  expect(history.runs.map(run => `${run.folder} ${run.kind} ${run.state} ${run.headline ?? ''}`)).toEqual(['new pingpong live ', 'old panel live Later.'])
  expect(historyScript(history).startsWith('window.__panelHistory&&window.__panelHistory([{"id":"cd34ef"')).toBe(true)
})
