import type { RoundEntry, Run, Seat } from '../types'
import { isLive } from './pane'
import { closedEntry, isPass, seatSkills, splitSections, standing } from './seats'
import type { Section } from './seats'

export type PageState = 'answered' | 'moved' | 'held' | 'unchanged' | 'failed' | 'interrupted' | 'absent' | 'working' | 'waiting'
export type PageMessage = { round: number; seat: number; state: PageState; lead: string; sections: Section[]; replyTo: number[]; keptFrom?: number; note?: string }
export type PageSeat = { n: number; model: string; role: string; skills: string[] }
export type Basis = 'independent' | 'discussion'

export type Verdict = {
  headline: string
  author?: string
  conclusions: { text: string; detail?: string; basis?: Basis }[]
  changes: { seat?: number; rounds?: string; text: string; holds?: string }[]
  rejected: string[]
  disagreements: { text: string; sides: { who: string; evidence: string }[]; settle?: string }[]
  uncertainty: string[]
  blindSpots: string[]
  ending?: string
  checks: { round: number; seat: number; text: string }[]
  plan?: string
  figures?: { svg: string; caption: string }[]
}

type PageBase = {
  id: string
  question: string
  seats: PageSeat[]
  rounds: number
  isLive: boolean
  status: string
  startedAt?: number
  rev: number
  verdict?: Verdict
}

export type PageData = PageBase & { kind?: 'panel'; messages: PageMessage[] }

export type PlanState = 'drafted' | 'merged' | 'challenged' | 'passed' | 'revised' | 'failed' | 'working' | 'waiting'
export type PlanTurn = { step: 'draft' | 'merge' | 'challenge' | 'revision'; round: number; by: 0 | 1 | 2; state: PlanState; text: string }
export type PlanData = PageBase & { kind: 'pingpong'; turns: PlanTurn[]; isFailed: boolean; plan?: { text: string; from: string } }
export type AnyPage = PageData | PlanData

export type PageAssets = { css: string; script: string; marked: string; fonts: string }

const MARKED_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js'
const WORD: Record<PageState, string> = { answered: 'answered', moved: 'moved', held: 'held', unchanged: 'no change', failed: 'failed', interrupted: 'interrupted', absent: 'not in this round', working: 'writing', waiting: 'waiting' }

const SEAT_LIST = /\bseats?\s+(\d+(?:(?:\s*[,&]\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)\d+)*)/gi

function mentions(sections: readonly Section[], self: number, seatCount: number): number[] {
  const seen = new Set<number>()
  for (const section of sections) {
    if (section.kind === 'stance' || section.kind === 'support') continue
    for (const hit of section.body.matchAll(SEAT_LIST)) for (const n of (hit[1] ?? '').match(/\d+/g) ?? []) seen.add(Number(n))
  }

  return [...seen].filter(n => n !== self && n >= 1 && n <= seatCount).sort((a, b) => a - b)
}

const hue = (seat: number) => ((seat - 1) % 6) + 1

function messageOf(entry: RoundEntry, round: number, seat: number, transcript: readonly RoundEntry[][]): PageMessage {
  const state: PageState = entry.state !== 'answered' ? entry.state : entry.isMoved === undefined ? 'answered' : entry.isMoved ? 'moved' : 'held'
  const split = entry.state === 'answered' ? splitSections(entry.text) : { lead: '', sections: [] }
  const hasStance = round > 1 || split.sections.some(section => section.kind === 'stance')
  const sections = split.sections.map((section, i): Section => (!hasStance && i === 0 ? { ...section, kind: 'stance' } : section))
  const keptFrom = standing(transcript.slice(0, round - 1), seat - 1)?.round

  return {
    round,
    seat,
    state,
    lead: split.lead,
    sections,
    replyTo: round > 1 ? mentions(sections, seat, transcript[0]?.length ?? 0) : [],
    ...(entry.state === 'unchanged' && keptFrom !== undefined ? { keptFrom } : {}),
    ...(entry.state === 'failed' || entry.state === 'interrupted' ? { note: entry.text } : {}),
  }
}

function openEntry(run: Run, seat: Seat, index: number, closed: readonly RoundEntry[][]): PageMessage {
  const round = Math.max(run.round, 1)
  const pending = (state: PageState): PageMessage => ({ round, seat: index + 1, state, lead: '', sections: [], replyTo: [] })
  if (round > 1 && standing(closed, index) === undefined) return pending('absent')
  if (seat.status === 'working') return pending('working')
  if (seat.status === 'starting') return pending('waiting')

  return messageOf(closedEntry(run, seat, index), round, index + 1, [...closed])
}

export function pageData(run: Run, rev: number): PageData {
  const live = isLive(run)
  const recorded = run.transcript ?? []
  const closed = recorded.length === 0 && !live ? [run.seats.map((seat, index) => closedEntry({ ...run, round: 1, transcript: [] }, seat, index))] : recorded
  const open = Math.max(run.round, 1)
  const isOpen = live && closed.length < open
  const settled = run.seats.filter(seat => seat.status === 'done' || seat.status === 'failed').length

  return {
    id: run.id,
    question: run.question,
    seats: run.seats.map((seat, index) => ({ n: index + 1, model: seat.label.split(' ')[0] ?? seat.model, role: seat.role === 'contrarian' ? 'contrarian' : '', skills: seatSkills(seat) })),
    rounds: Math.max(run.rounds, closed.length),
    messages: [
      ...closed.flatMap((entries, r) => entries.map((entry, index) => messageOf(entry, r + 1, index + 1, closed))),
      ...(isOpen ? run.seats.map((seat, index) => openEntry(run, seat, index, closed)) : []),
    ],
    isLive: live,
    status: live ? `Round ${open} of ${run.rounds} is in progress: ${settled} of ${run.seats.length} seats have replied.` : (run.outcome ?? (run.phase === 'failed' ? 'The run failed.' : 'Complete.')),
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    rev,
  }
}

const REJECTED_HEAD = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?:\d+[.)][ \t]*)?Rejected corrections(?:\*\*)?[ \t]*:?[ \t]*(?:\*\*)?[ \t]*(.*)$/gim

export function splitPlan(revision: string): { plan: string; rejected: string } {
  const head = [...revision.matchAll(REJECTED_HEAD)].pop()
  if (head?.index === undefined) return { plan: revision.trim(), rejected: '' }

  return { plan: revision.slice(0, head.index).trim(), rejected: `${head[1] ?? ''}${revision.slice(head.index + head[0].length)}`.trim() }
}

export const turnId = (turn: Pick<PlanTurn, 'step' | 'round' | 'by'>) => (turn.step === 'draft' ? `draft-${turn.by === 1 ? 'a' : 'b'}` : turn.step === 'merge' ? 'merge' : `r${turn.round}-s${turn.by}`)

function planStatus(run: Run): string {
  if (run.phase === 'drafting') return 'A and B are each drafting a plan.'
  if (run.phase === 'merging') return 'Both drafts are in. The session is merging them into one plan.'
  if (run.phase === 'challenging') return `Round ${run.round} of ${run.rounds}: A is looking for problems in the plan.`
  if (run.phase === 'integrating') return `Round ${run.round} of ${run.rounds}: B is revising the plan.`

  return run.outcome ?? (run.phase === 'failed' ? 'The run failed.' : 'Complete.')
}

export function planData(run: Run, rev: number): PlanData {
  const [a, b] = run.seats
  const plans = run.plans ?? []
  const pending = (seat: Seat | undefined): PlanState => (seat?.status === 'working' ? 'working' : seat?.status === 'failed' ? 'failed' : 'waiting')
  const failure = (seat: Seat | undefined) => (seat?.status === 'failed' ? (seat.answer ?? '') : '')
  const draft = (seat: Seat | undefined, index: 0 | 1): PlanTurn => {
    const by = index === 0 ? 1 : 2
    const kept = run.drafts?.[index]
    if (kept !== undefined || run.round > 0) return { step: 'draft', round: 0, by, state: 'drafted', text: kept ?? '' }
    if (seat?.status === 'done') return { step: 'draft', round: 0, by, state: 'drafted', text: seat.answer ?? '' }

    return { step: 'draft', round: 0, by, state: pending(seat), text: failure(seat) }
  }
  const turns: PlanTurn[] = [draft(a, 0), draft(b, 1)]
  if (plans[0] !== undefined) turns.push({ step: 'merge', round: 0, by: 0, state: 'merged', text: plans[0] })
  else if (run.phase === 'merging') turns.push({ step: 'merge', round: 0, by: 0, state: 'working', text: '' })

  for (let round = 1; round <= run.round; round += 1) {
    const isOpen = round === run.round && (isLive(run) || run.phase === 'failed')
    const challenge = run.challenges[round - 1]
    if (challenge === undefined) {
      if (isOpen) turns.push({ step: 'challenge', round, by: 1, state: pending(a), text: failure(a) })
      break
    }
    turns.push({ step: 'challenge', round, by: 1, state: isPass(challenge) ? 'passed' : 'challenged', text: challenge })
    const revision = plans[round]
    if (revision !== undefined) turns.push({ step: 'revision', round, by: 2, state: 'revised', text: revision })
    else if (isOpen && !isPass(challenge)) turns.push({ step: 'revision', round, by: 2, state: pending(b), text: failure(b) })
  }
  const latest = [...turns].reverse().find(turn => turn.state === 'merged' || turn.state === 'revised')
  const current = latest === undefined ? '' : splitPlan(latest.text).plan

  return {
    kind: 'pingpong',
    id: run.id,
    question: run.question,
    seats: run.seats.map((seat, index) => ({ n: index + 1, model: seat.label.split(' ')[0] ?? seat.model, role: index === 0 ? 'challenges' : 'revises', skills: seatSkills(seat) })),
    rounds: run.rounds,
    turns,
    isLive: isLive(run),
    isFailed: run.phase === 'failed',
    status: planStatus(run),
    ...(latest === undefined || current === '' ? {} : { plan: { text: current, from: turnId(latest) } }),
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    rev,
  }
}

export function pageFor(run: Run, rev: number): AnyPage {
  return run.kind === 'pingpong' ? planData(run, rev) : pageData(run, rev)
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined)
const texts = (value: unknown): string[] => items(value).map(item => text(item) || text(field(item, 'text'))).filter(Boolean)
const whole = (value: unknown): number | undefined => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined)
const optional = <K extends string>(key: K, value: string): { [P in K]?: string } => (value === '' ? {} : ({ [key]: value } as { [P in K]?: string }))

export const MAX_FIGURES = 2
const SVG_MAX = 30_000
const SVG_ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker'])
const SVG_DROPPED_WHOLE = new Set(['svg', 'script', 'style', 'foreignobject', 'title', 'desc'])
const SVG_ATTRIBUTES = new Map(
  [
    ...['viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'transform', 'id'],
    ...['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity'],
    ...['font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing'],
    ...['marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient'],
  ].map(name => [name.toLowerCase(), name]),
)
const SVG_TOKEN = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>|[^<]+|</g
const SVG_ATTRIBUTE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g
const SVG_REACHES_OUT = /url\(\s*(?!['"]?#)|javascript:|expression\(|@import/i
const SVG_ID = /^[\w-]+$/
const SVG_LENGTH = /^\d+(?:\.\d+)?(?:px)?$/
const entity = (value: string) => value.replace(/&(?![a-z]+;|#\d+;|#x[\da-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function cleanSvg(source: string, prefix: string): string | undefined {
  const open: string[] = []
  let out = ''
  let skipped: { name: string; depth: number } | undefined

  for (const [raw, slash, tag, attributes = '', selfClosed] of source.trim().matchAll(SVG_TOKEN)) {
    if (tag === undefined) {
      if (skipped === undefined && open.length > 0 && !raw.startsWith('<!--')) out += entity(raw)
      continue
    }
    const name = tag.toLowerCase()
    if (skipped !== undefined) {
      if (name === skipped.name && selfClosed !== '/') skipped.depth += slash === '/' ? -1 : 1
      if (skipped.depth === 0) skipped = undefined
      continue
    }
    if (!SVG_ELEMENTS.has(name) || (slash !== '/' && (name === 'svg') !== (open.length === 0))) {
      if (SVG_DROPPED_WHOLE.has(name) && slash !== '/' && selfClosed !== '/') skipped = { name, depth: 1 }
      continue
    }
    if (slash === '/') {
      if (open[open.length - 1] !== name) continue
      open.pop()
      out += `</${name}>`
      if (open.length === 0) return out
      continue
    }

    const kept = new Map<string, string>()
    for (const [, key = '', double, single, bare] of attributes.matchAll(SVG_ATTRIBUTE)) {
      const known = SVG_ATTRIBUTES.get(key.toLowerCase())
      const value = (double ?? single ?? bare ?? '').trim()
      if (known === undefined || SVG_REACHES_OUT.test(value) || (known === 'id' && !SVG_ID.test(value))) continue
      kept.set(known, known === 'id' ? `${prefix}${value}` : value.replace(/url\(\s*(['"]?)#/g, `url($1#${prefix}`))
    }
    if (name === 'svg') {
      const [width = '', height = ''] = [kept.get('width'), kept.get('height')]
      if (!kept.has('viewBox') && SVG_LENGTH.test(width) && SVG_LENGTH.test(height)) kept.set('viewBox', `0 0 ${parseFloat(width)} ${parseFloat(height)}`)
      if (!kept.has('viewBox')) return undefined
      kept.delete('width')
      kept.delete('height')
    }
    out += `<${name}${[...kept].map(([key, value]) => ` ${key}="${entity(value)}"`).join('')}${selfClosed === '/' ? '/' : ''}>`
    if (selfClosed !== '/') open.push(name)
  }

  return out === '' ? undefined : out + open.reverse().map(name => `</${name}>`).join('')
}

function readFigures(input: unknown): NonNullable<Verdict['figures']> | { error: string } {
  const drawn = items(input)
  if (drawn.length > MAX_FIGURES) return { error: `A page takes at most ${MAX_FIGURES} figures. Keep the ones that carry the most and send the verdict again.` }
  const figures: NonNullable<Verdict['figures']> = []
  for (const [index, item] of drawn.entries()) {
    const source = text(field(item, 'svg'))
    const caption = text(field(item, 'caption'))
    if (caption === '') return { error: `Figure ${index + 1} needs a caption: one sentence that states what it shows.` }
    if (source.length > SVG_MAX) return { error: `Figure ${index + 1} is ${source.length} characters of SVG; the limit is ${SVG_MAX}. Simplify it or leave it out.` }
    const svg = cleanSvg(source, `figure-${index + 1}-`)
    if (svg === undefined) return { error: `Figure ${index + 1} is not usable: it must be one <svg> element with a viewBox. Fix it or leave it out.` }
    figures.push({ svg, caption })
  }

  return figures
}

export function readVerdict(input: unknown): Verdict | { error: string } {
  const headline = text(field(input, 'headline'))
  if (headline === '') return { error: 'The verdict needs a headline: the bottom line in one or two sentences.' }
  const figures = readFigures(field(input, 'figures'))
  if ('error' in figures) return figures

  return {
    headline,
    ...optional('author', text(field(input, 'author'))),
    conclusions: items(field(input, 'conclusions')).flatMap(item => {
      const basis = text(field(item, 'basis'))
      const body = text(item) || text(field(item, 'text'))

      return body === '' ? [] : [{ text: body, ...optional('detail', text(field(item, 'detail'))), ...(basis === 'independent' || basis === 'discussion' ? { basis: basis as Basis } : {}) }]
    }),
    changes: items(field(input, 'changes')).flatMap(item => {
      const body = text(item) || text(field(item, 'text'))
      const seat = whole(field(item, 'seat'))

      return body === '' ? [] : [{ text: body, ...(seat === undefined ? {} : { seat }), ...optional('rounds', text(field(item, 'rounds'))), ...optional('holds', text(field(item, 'holds'))) }]
    }),
    rejected: texts(field(input, 'rejected')),
    disagreements: items(field(input, 'disagreements')).flatMap(item => {
      const body = text(item) || text(field(item, 'text'))
      const sides = items(field(item, 'sides')).flatMap(side => (text(field(side, 'evidence')) === '' ? [] : [{ who: text(field(side, 'who')), evidence: text(field(side, 'evidence')) }]))

      return body === '' ? [] : [{ text: body, sides, ...optional('settle', text(field(item, 'settle'))) }]
    }),
    uncertainty: texts(field(input, 'uncertainty')),
    blindSpots: texts(field(input, 'blindSpots')),
    ...optional('ending', text(field(input, 'ending'))),
    checks: items(field(input, 'checks')).flatMap(item => {
      const round = whole(field(item, 'round'))
      const seat = whole(field(item, 'seat'))
      const body = text(field(item, 'text'))

      return round === undefined || seat === undefined || body === '' ? [] : [{ round, seat, text: body }]
    }),
    ...optional('plan', text(field(input, 'plan'))),
    ...(figures.length === 0 ? {} : { figures }),
  }
}

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const md = (source: string) => `<div class="md raw" data-md>${esc(source)}</div>`
const inline = (source: string) => `<span class="raw" data-md="inline">${esc(source)}</span>`
const chips = (seat: PageSeat, hasRole = true) => [hasRole && seat.role !== '' ? `<span class="role">${esc(seat.role)}</span>` : '', ...seat.skills.map(skill => `<span class="skill">+${esc(skill)}</span>`)].join('')
const none = '<span class="none" title="Took no part">–</span>'

type Stop = { href: string; text: string; note?: string; hue?: number; isSub?: boolean }

type Words = {
  kind: string
  answer: string
  pending: string
  byline: string
  conclusions: string
  changes: string
  rejected: string
  disagreements: string
  uncertainty: string
  blindNote: string
  check: string
  seat: (n: number) => string
}

const PANEL_WORDS: Words = {
  kind: 'Panel',
  answer: 'Verdict',
  pending: 'No verdict has been added to this page yet. It appears here when the session that ran the panel records one.',
  byline: 'after checking the seats’ claims',
  conclusions: 'Supported conclusions',
  changes: 'Position changes',
  rejected: 'Rejected claims',
  disagreements: 'Disagreement that survived',
  uncertainty: 'Residual uncertainty',
  blindNote: 'What no seat examined in any round.',
  check: 'Synthesiser’s check',
  seat: n => `Seat ${n}`,
}

const PLAN_WORDS: Words = {
  kind: 'Ping-pong',
  answer: 'Summary',
  pending: 'No summary has been added to this page yet. It appears here when the session that ran the ping-pong records one.',
  byline: 'after checking the plan against the files it cites',
  conclusions: 'The plan in brief',
  changes: 'What the rounds changed',
  rejected: 'Corrections not taken up',
  disagreements: 'Material disagreements',
  uncertainty: 'Decisions still open',
  blindNote: 'What neither agent examined.',
  check: 'Session’s check',
  seat: n => (n === 1 ? 'A' : n === 2 ? 'B' : `Seat ${n}`),
}

const stamp = (data: AnyPage) => (data.startedAt === undefined ? '' : `<span data-ts="${data.startedAt}">${new Date(data.startedAt).toISOString().slice(0, 10)}</span>`)
const checkNote = (words: Words, note: string) => `<aside class="check"><strong>${words.check}.</strong> ${inline(note)}</aside>`

function hero(data: AnyPage, words: Words, facts: readonly string[], hasPending: boolean, flag = ''): string {
  const verdict = data.verdict
  const answer = verdict
    ? `<div class="answer" id="verdict"><p class="headline">${inline(verdict.headline)}</p><p class="byline">${words.answer} by ${esc(verdict.author ?? 'the session that ran it')}, ${words.byline}.${flag}</p></div>`
    : data.isLive
      ? `<p class="live-note">${esc(data.status)} This page updates as replies arrive.</p>`
      : hasPending
        ? `<div class="answer pending" id="verdict"><p class="quiet">${words.pending}</p></div>`
        : ''

  return `<header class="masthead">
<p class="meta">${words.kind} ${esc(data.id)}${stamp(data)}${facts.map(fact => `<span>${fact}</span>`).join('')}</p>
<h1 class="question clamped" id="question">${inline(data.question)}</h1>
${answer}
</header>`
}

const glance = (data: AnyPage, tracker: string, stops: readonly Stop[]) => `<section class="at-a-glance" aria-label="Who did what">
${data.isLive ? '' : `<p class="legend">${esc(data.status)}</p>`}
${tracker}
<nav class="jump" aria-label="Sections">${stops.filter(stop => stop.isSub !== true).map(stop => `<a href="${stop.href}">${stop.text}</a>`).join('')}</nav>
</section>`

const outline = (stops: readonly Stop[]) => `<nav class="outline" id="outline" aria-label="On this page"><p class="rail-title">On this page</p><ol>
${stops.map(stop => `<li class="${stop.isSub === true ? 'sub' : 'top'}${stop.hue === undefined ? '' : ` s${stop.hue}`}"><a href="${stop.href}"><span>${stop.text}</span>${stop.note === undefined ? '' : `<span class="note">${stop.note}</span>`}</a></li>`).join('\n')}
</ol></nav>`

const plain = (list: readonly string[]) => `<ul class="plain">${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`
const part = (title: string, body: string, note = '', isAsk = false) => (body === '' ? '' : `<div class="part${isAsk ? ' ask" id="open' : ''}"><h2>${title}</h2>\n${note === '' ? '' : `<p class="detail">${note}</p>\n`}${body}</div>`)

function drawVerdict(data: AnyPage, words: Words): string {
  const verdict = data.verdict
  if (!verdict) return ''
  const basis = (value: Basis | undefined) => (value === undefined ? '' : `<p class="basis ${value}">${value === 'independent' ? 'Held independently in round 1' : 'Reached in discussion'}</p>`)
  const conclusions = verdict.conclusions.map(item => `<li><p class="claim">${inline(item.text)}</p>${item.detail === undefined ? '' : `<p class="detail">${inline(item.detail)}</p>`}${basis(item.basis)}</li>`)
  const changes = verdict.changes.map(
    item =>
      `<li class="${item.seat === undefined ? '' : `s${hue(item.seat)}`}"><p class="change-who">${item.seat === undefined ? '' : `<span class="who">${words.seat(item.seat)}</span>`}${item.rounds === undefined ? '' : `<span class="model">${esc(item.rounds)}</span>`}</p><p>${inline(item.text)}</p>${item.holds === undefined ? '' : `<p class="detail">${inline(item.holds)}</p>`}</li>`,
  )
  const disputes = verdict.disagreements.map(
    item =>
      `<div class="dispute-box"><p class="claim">${inline(item.text)}</p>${item.sides.length === 0 ? '' : `<div class="sides">${item.sides.map(side => `<div class="side"><p class="side-who">${inline(side.who)}</p><p>${inline(side.evidence)}</p></div>`).join('')}</div>`}${item.settle === undefined ? '' : `<p class="detail"><strong>What would settle it.</strong> ${inline(item.settle)}</p>`}</div>`,
  )
  const figures = (verdict.figures ?? []).map((figure, i) => `<figure class="figure" id="figure-${i + 1}"><div class="figure-art">${figure.svg}</div><figcaption>${inline(figure.caption)}</figcaption></figure>`)
  const isPlan = data.kind === 'pingpong'
  const parts = [
    isPlan ? part(words.uncertainty, verdict.uncertainty.length === 0 ? '' : plain(verdict.uncertainty), '', true) : '',
    figures.length === 0 ? '' : `<div class="figures">\n${figures.join('\n')}\n</div>`,
    part(words.conclusions, conclusions.length === 0 ? '' : isPlan ? `<ol class="conclusions steps">${conclusions.join('\n')}</ol>` : `<ul class="conclusions">${conclusions.join('\n')}</ul>`),
    part(words.changes, changes.length === 0 ? '' : `<ul class="changes">${changes.join('\n')}</ul>`),
    part(words.rejected, verdict.rejected.length === 0 ? '' : plain(verdict.rejected)),
    part(words.disagreements, disputes.join('\n')),
    isPlan ? '' : part(words.uncertainty, verdict.uncertainty.length === 0 ? '' : plain(verdict.uncertainty)),
    part('Blind spots', verdict.blindSpots.length === 0 ? '' : plain(verdict.blindSpots), words.blindNote),
    part('How it ended', verdict.ending === undefined ? '' : `<p>${inline(verdict.ending)}</p>`),
  ].filter(Boolean)

  return parts.length === 0 ? '' : `<section class="verdict" id="verdict-detail" aria-label="${words.answer} in detail">\n${parts.join('\n')}\n</section>`
}

function drawMessage(data: PageData, round: number, seat: PageSeat): string {
  const message = data.messages.find(one => one.round === round && one.seat === seat.n)
  if (!message || message.state === 'absent') return `<article class="msg empty s${hue(seat.n)}"><p class="quiet">Seat ${seat.n} did not take part in this round.</p></article>`
  const checks = (data.verdict?.checks ?? []).filter(check => check.round === round && check.seat === seat.n)
  const replyTo = message.replyTo.map(n => `<a class="ref s${hue(n)}" href="#r${round - 1}-s${n}">Seat ${n}</a>`).join(' ')
  const quiet: Partial<Record<PageState, string>> = {
    unchanged: message.keptFrom === undefined ? 'Kept its earlier answer without changes.' : `Kept its <a href="#r${message.keptFrom}-s${seat.n}">round ${message.keptFrom} answer</a> without changes.`,
    working: 'Writing its reply.',
    waiting: 'Not started yet.',
    failed: `This seat failed in this round. ${esc(message.note ?? '')}`,
    interrupted: `This seat was interrupted. ${esc(message.note ?? '')}`,
  }
  const isCore = (section: Section) => section.kind === 'stance' || section.kind === 'change'
  const folded = message.sections.some(isCore) ? message.sections.filter(section => !isCore(section)) : []
  const said = [
    message.lead === '' ? '' : `<div class="sec-body">${md(message.lead)}</div>`,
    ...message.sections.map(section => `<section class="sec ${section.kind}${folded.includes(section) ? ' fold-away' : ''}"><h4 class="sec-label">${esc(section.label)}</h4><div class="sec-body">${md(section.body)}</div></section>`),
    folded.length === 0 ? '' : `<button type="button" class="more" data-more>Show ${esc(folded.map(section => section.label.toLowerCase()).join(', '))}</button>`,
  ]

  return `<article class="msg s${hue(seat.n)}" id="r${round}-s${seat.n}">
<header class="msg-head"><span class="who">Seat ${seat.n}</span><span class="model">${esc(seat.model)}</span>${chips(seat)}${message.state === 'answered' ? '' : `<span class="state ${message.state}">${WORD[message.state]}</span>`}</header>
${replyTo === '' ? '' : `<p class="reply-to">Replying to ${replyTo}</p>`}
${quiet[message.state] === undefined ? said.filter(Boolean).join('\n') : `<p class="quiet">${quiet[message.state]}</p>`}
${checks.map(check => checkNote(PANEL_WORDS, check.text)).join('\n')}
</article>`
}

function drawTracker(data: PageData, shown: number): string {
  const cell = (seat: PageSeat, round: number) => {
    const state = data.messages.find(one => one.round === round && one.seat === seat.n)?.state
    if (state === undefined || state === 'absent') return none

    return `<a class="state ${state}" href="#r${round}-s${seat.n}">${WORD[state]}</a>`
  }
  const row = (seat: PageSeat) =>
    `<tr class="s${hue(seat.n)}"><th scope="row"><span class="seat-name"><span class="who">Seat ${seat.n}</span><span class="model">${esc(seat.model)}</span>${chips(seat)}</span></th>${Array.from({ length: shown }, (_, i) => `<td>${cell(seat, i + 1)}</td>`).join('')}</tr>`

  return `<div class="scroll"><table class="tracker">
<thead><tr><th scope="col">Seat</th>${Array.from({ length: shown }, (_, i) => `<th scope="col">Round ${i + 1}</th>`).join('')}</tr></thead>
<tbody>
${data.seats.map(row).join('\n')}
</tbody></table></div>`
}

const toggle = (name: string, attribute: string, options: readonly [string, string][]) =>
  `<div class="toggle" role="group" aria-label="${name}">${options.map(([value, text], i) => `<button type="button" ${attribute}="${value}" aria-pressed="${i === 0}">${text}</button>`).join('')}</div>`

function panelBody(data: PageData): { body: string; stops: Stop[] } {
  const shown = Math.max(1, ...data.messages.map(message => message.round))
  const roundNote = (round: number) => (round === 1 ? 'Independent answers. No seat saw another.' : 'Replies. Each seat read the others’ latest answers.')
  const rounds = Array.from({ length: shown }, (_, i) => `<h3 class="round" id="r${i + 1}"><span class="round-n">Round ${i + 1}</span><span class="round-what">${roundNote(i + 1)}</span></h3>\n${data.seats.map(seat => drawMessage(data, i + 1, seat)).join('\n')}`)
  const stops: Stop[] = [
    ...(data.verdict === undefined ? [] : [{ href: '#verdict', text: 'Verdict' }]),
    ...Array.from({ length: shown }, (_, i) => [
      { href: `#r${i + 1}`, text: `Round ${i + 1}` },
      ...data.messages.filter(message => message.round === i + 1 && message.state !== 'absent').map(message => ({ href: `#r${i + 1}-s${message.seat}`, text: `Seat ${message.seat}`, isSub: true, hue: hue(message.seat), ...(message.state === 'answered' ? {} : { note: WORD[message.state] }) })),
    ]).flat(),
  ]
  const body = `${hero(data, PANEL_WORDS, [`${data.seats.length} seats`, data.rounds === 1 ? '1 round' : `up to ${data.rounds} rounds`], !data.isLive)}
${glance(data, drawTracker(data, shown), stops)}
${drawVerdict(data, PANEL_WORDS)}
<section class="discussion" id="discussion">
<div class="bar"><h2>Discussion</h2><div class="tools">${toggle('Detail', 'data-set-density', [['full', 'Full answers'], ['brief', 'Positions only']])}${toggle('Layout', 'data-set-view', [['thread', 'Thread'], ['columns', 'Side by side']])}</div></div>
<div class="rounds-scroll"><div class="rounds" style="--seats:${data.seats.length}">
${rounds.join('\n')}
</div></div>
</section>`

  return { body, stops }
}

const PLAN_WORD: Record<PlanState, string> = { drafted: 'drafted', merged: 'merged', challenged: 'challenged', passed: 'passed', revised: 'revised', failed: 'failed', working: 'writing', waiting: 'waiting' }
const PLAN_TONE: Record<PlanState, PageState> = { drafted: 'answered', merged: 'answered', challenged: 'moved', passed: 'unchanged', revised: 'answered', failed: 'failed', working: 'working', waiting: 'waiting' }
const STEP_NAME: Record<PlanTurn['step'], string> = { draft: 'Draft', merge: 'Merge', challenge: 'Challenge', revision: 'Revision' }
const WORKING: Record<PlanTurn['step'], string> = { draft: 'Writing its draft.', merge: 'Comparing the two drafts and merging them into one plan.', challenge: 'Looking for problems in the plan.', revision: 'Checking the challenge and revising the plan.' }
const wordCount = (source: string) => `${source.split(/\s+/).filter(Boolean).length.toLocaleString('en')} words`
const fold = (id: string, title: string, source: string) => `<details class="fold" id="${id}-text"><summary><span>${title}</span><span class="count">${wordCount(source)}</span></summary><div class="fold-body">${md(source)}</div></details>`
const actor = (by: PlanTurn['by']) => (by === 0 ? 'Session' : by === 1 ? 'A' : 'B')
const isRoutine = (state: PlanState) => state === 'drafted' || state === 'merged' || state === 'challenged' || state === 'revised'

function drawTurn(data: PlanData, turn: PlanTurn): string {
  const id = turnId(turn)
  const seat = data.seats[turn.by - 1]
  const name = actor(turn.by)
  const checks = turn.step === 'challenge' || turn.step === 'revision' ? (data.verdict?.checks ?? []).filter(check => check.round === turn.round && check.seat === turn.by) : []
  const isCurrent = data.plan?.from === id
  const shownAbove = `<p class="quiet">This is the <a href="#plan">${data.isLive ? 'current' : data.isFailed ? 'last' : 'final'} plan</a>, shown in full above.</p>`
  const said = (): string => {
    if (turn.state === 'working') return `<p class="quiet">${WORKING[turn.step]}</p>`
    if (turn.state === 'waiting') return '<p class="quiet">Not started yet.</p>'
    if (turn.state === 'failed') return `<p class="quiet">This agent failed here. ${esc(turn.text)}</p>`
    if (turn.step === 'challenge') {
      const rest = turn.state === 'passed' ? turn.text.trim().split('\n').slice(1).join('\n').trim() : turn.text

      return `${turn.state === 'passed' ? '<p class="quiet">PASS: found nothing material to change. That ended the rounds.</p>' : ''}${rest === '' ? '' : `<div class="sec-body">${md(rest)}</div>`}`
    }
    if (turn.text === '') return '<p class="quiet">This text was not kept.</p>'
    if (turn.step === 'draft') return fold(id, `Draft ${name}`, turn.text)
    const { plan, rejected } = splitPlan(turn.text)
    const reply = rejected === '' ? '' : `<section class="sec dispute"><h4 class="sec-label">Rejected corrections</h4><div class="sec-body">${md(rejected)}</div></section>\n`

    return `${reply}${isCurrent ? shownAbove : fold(id, turn.step === 'merge' ? 'Merged candidate plan' : `Plan as revised in round ${turn.round}`, plan)}`
  }

  return `<article class="msg${turn.by === 0 ? '' : ` s${turn.by}`}" id="${id}">
<header class="msg-head"><span class="who">${name}</span>${seat === undefined ? '' : `<span class="model">${esc(seat.model)}</span>${chips(seat, false)}`}<span class="state ${PLAN_TONE[turn.state]}">${isRoutine(turn.state) ? STEP_NAME[turn.step] : `${STEP_NAME[turn.step]}: ${PLAN_WORD[turn.state]}`}</span></header>
${said()}
${checks.map(check => checkNote(PLAN_WORDS, check.text)).join('\n')}
</article>`
}

function planBody(data: PlanData): { body: string; stops: Stop[] } {
  const shown = Math.max(0, ...data.turns.map(turn => turn.round))
  const hasMerge = data.turns.some(turn => turn.step === 'merge')
  const columns = ['Drafts', ...(hasMerge ? ['Merge'] : []), ...Array.from({ length: shown }, (_, i) => `Round ${i + 1}`)]
  const columnOf = (turn: PlanTurn) => (turn.step === 'draft' ? 'Drafts' : turn.step === 'merge' ? 'Merge' : `Round ${turn.round}`)
  const cell = (by: number, column: string) => {
    const turn = data.turns.find(one => one.by === by && columnOf(one) === column)

    return turn ? `<a class="state ${PLAN_TONE[turn.state]}" href="#${turnId(turn)}">${PLAN_WORD[turn.state]}</a>` : none
  }
  const row = (by: PlanTurn['by'], note: string) => `<tr${by === 0 ? '' : ` class="s${by}"`}><th scope="row"><span class="seat-name"><span class="who">${actor(by)}</span>${note}</span></th>${columns.map(column => `<td>${cell(by, column)}</td>`).join('')}</tr>`
  const seatNote = (seat: PageSeat | undefined) => (seat === undefined ? '' : `<span class="model">${esc(seat.model)}</span>${chips(seat)}`)
  const tracker = `<div class="scroll"><table class="tracker">
<thead><tr><th scope="col">Who</th>${columns.map(column => `<th scope="col">${column}</th>`).join('')}</tr></thead>
<tbody>
${row(1, seatNote(data.seats[0]))}
${row(2, seatNote(data.seats[1]))}
${hasMerge ? row(0, '<span class="model">merges the drafts</span>') : ''}
</tbody></table></div>`
  const head = (id: string, title: string, note: string) => `<h3 class="round" id="${id}"><span class="round-n">${title}</span><span class="round-what">${note}</span></h3>`
  const of = (pick: (turn: PlanTurn) => boolean) => data.turns.filter(pick).map(turn => drawTurn(data, turn)).join('\n')
  const steps = [
    `${head('drafts', 'Drafts', 'Independent. Neither agent saw the other’s draft.')}\n${of(turn => turn.step === 'draft')}`,
    hasMerge ? `${head('merging', 'Merge', 'The session compared the drafts against the files and merged them into one candidate plan.')}\n${of(turn => turn.step === 'merge')}` : '',
    ...Array.from({ length: shown }, (_, i) => `${head(`r${i + 1}`, `Round ${i + 1}`, 'A challenges the plan. B checks each correction and revises.')}\n${of(turn => turn.round === i + 1)}`),
  ]
  const planTitle = data.isLive ? 'Current plan' : data.isFailed ? 'Last candidate plan' : 'Final plan'
  const corrected = data.verdict?.plan
  const from = data.turns.find(turn => turnId(turn) === data.plan?.from)
  const author = corrected !== undefined ? `Corrected by ${esc(data.verdict?.author ?? 'the session')} after its checks.` : from?.step === 'revision' ? `As revised by B in <a href="#${turnId(from)}">round ${from.round}</a>.` : `The session’s <a href="#merge">merge</a> of the two drafts, ${data.isLive ? 'not yet revised' : 'unchanged by the rounds'}.`
  const plan = data.plan === undefined ? '' : `<section class="plan" id="plan">
<h2>${planTitle}</h2><p class="byline">${author}</p>
${md(corrected ?? data.plan.text)}
</section>`
  const sub = (turn: PlanTurn): Stop => ({ href: `#${turnId(turn)}`, text: actor(turn.by), isSub: true, note: isRoutine(turn.state) ? STEP_NAME[turn.step].toLowerCase() : PLAN_WORD[turn.state], ...(turn.by === 0 ? {} : { hue: turn.by }) })
  const stops: Stop[] = [
    ...(data.verdict === undefined ? [] : [{ href: '#verdict', text: 'Summary' }]),
    ...(data.plan === undefined ? [] : [{ href: '#plan', text: planTitle }]),
    { href: '#drafts', text: 'Drafts' },
    ...data.turns.filter(turn => turn.step === 'draft').map(sub),
    ...(hasMerge ? [{ href: '#merging', text: 'Merge' }] : []),
    ...Array.from({ length: shown }, (_, i) => [{ href: `#r${i + 1}`, text: `Round ${i + 1}` }, ...data.turns.filter(turn => turn.round === i + 1).map(sub)]).flat(),
  ]
  const open = data.verdict?.uncertainty.length ?? 0
  const flag = open === 0 ? '' : ` <a class="flag" href="#open">${open === 1 ? '1 decision is' : `${open} decisions are`} still open</a>`
  const body = `${hero(data, PLAN_WORDS, ['2 agents', data.rounds === 1 ? '1 challenge round' : `up to ${data.rounds} challenge rounds`], !data.isLive && !data.isFailed && data.plan !== undefined, flag)}
${glance(data, tracker, stops)}
${drawVerdict(data, PLAN_WORDS)}
${plan}
<section class="discussion" id="discussion">
<div class="bar"><h2>How the plan was made</h2></div>
<div class="rounds">
${steps.filter(Boolean).join('\n')}
</div>
</section>`

  return { body, stops }
}

export function pageHtml(data: AnyPage, assets: PageAssets, target: 'local' | 'artifact'): string {
  const isPolling = target === 'local' && data.verdict === undefined
  const { body, stops } = data.kind === 'pingpong' ? planBody(data) : panelBody(data)
  const page = `<title>${data.kind === 'pingpong' ? 'Ping-pong' : 'Panel'} ${esc(data.id)}</title>
${assets.fonts === '' ? '' : `<link rel="stylesheet" href="${esc(assets.fonts)}">\n`}<style>
${assets.css}
</style>
<div class="frame${target === 'local' ? ' with-history' : ''}">
<div class="page" id="page" data-view="thread" data-density="full" data-run="${esc(data.id)}" data-rev="${data.rev}"${isPolling ? ' data-poll="yes"' : ''}>
${body}
</div>
${outline(stops)}
</div>
${target === 'local' ? '<aside class="history" id="history" aria-label="Earlier runs"><p class="rail-title">History<span id="history-where"></span></p><ol class="history-list" id="history-list"></ol></aside>' : ''}
${target === 'local' ? `<script>${assets.marked.replace(/<\/script/gi, '<\\/script')}</script>` : `<script src="${MARKED_CDN}"></script>`}
<script>${assets.script.replace(/<\/script/gi, '<\\/script')}</script>
`

  return target === 'artifact' ? page : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${page}</body>\n</html>\n`
}
