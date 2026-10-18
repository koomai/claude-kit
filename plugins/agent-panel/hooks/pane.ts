import type { RoundState, Run, Seat } from '../types'
import { isPass } from './seats'

export type Tone = 'live' | 'good' | 'bad' | 'warn' | 'quiet' | 'plain'
export type Chip = { text: string; tone: Tone; isBold?: boolean }
export type StepState = 'done' | 'now' | 'todo' | 'skipped' | 'failed'
export type Step = { label: string; cells: StepState[] }

const SPINNER = ['◐', '◓', '◑', '◒']

export function spinner(now: number): string {
  return SPINNER[Math.floor(now / 1000) % SPINNER.length] ?? '◐'
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  const [value, unit] = count < 999_500 ? [count / 1000, 'k'] : [count / 1_000_000, 'M']

  return `${value < 9.95 ? Math.round(value * 10) / 10 : Math.round(value)}${unit}`
}

export function meter(value: number, max: number, width: number): { on: string; off: string } {
  const filled = max <= 0 || value <= 0 ? 0 : Math.max(1, Math.min(width, Math.round((value / max) * width)))

  return { on: '━'.repeat(filled), off: '─'.repeat(width - filled) }
}

export function isLive(run: Pick<Run, 'phase'>): boolean {
  return run.phase !== 'done' && run.phase !== 'failed'
}

export function seatTime(seat: Pick<Seat, 'status' | 'startedAt' | 'durationMs'>, now: number): number | undefined {
  if (seat.status === 'working') return seat.startedAt === undefined ? seat.durationMs : (seat.durationMs ?? 0) + Math.max(0, now - seat.startedAt)

  return seat.durationMs
}

export function runTime(run: Pick<Run, 'startedAt' | 'endedAt'>, now: number): number | undefined {
  return run.startedAt === undefined ? undefined : Math.max(0, (run.endedAt ?? now) - run.startedAt)
}

export function seatChips(seat: Pick<Seat, 'label' | 'unknownSkills'>, prefix?: string): Chip[] {
  const [name = '', ...rest] = seat.label.split(' ')
  const unknown = new Set(seat.unknownSkills ?? [])

  return [
    ...(prefix === undefined ? [] : [{ text: prefix, tone: 'quiet' as const }]),
    { text: name, tone: 'plain', isBold: true },
    ...rest.map((part): Chip => {
      if (!part.startsWith('+')) return { text: part, tone: 'warn' }

      return unknown.has(part.slice(1)) ? { text: `${part}?`, tone: 'warn' } : { text: part, tone: 'quiet' }
    }),
  ]
}

export function fitChips(chips: readonly Chip[], width: number): Chip[] {
  const fitted: Chip[] = []
  let room = width
  for (const chip of chips) {
    const space = room - (fitted.length === 0 ? 0 : 1)
    if (space <= 0) break
    if (chip.text.length <= space) {
      fitted.push(chip)
      room = space - chip.text.length
      continue
    }
    if (space >= 2) fitted.push({ ...chip, text: `${chip.text.slice(0, space - 1)}…` })
    break
  }

  return fitted
}

export function pingpongSteps(run: Pick<Run, 'phase' | 'round' | 'rounds' | 'challenges'>): Step[] {
  const isOver = run.phase === 'done' || run.phase === 'failed'
  const hasMerged = run.round > 0
  const drafts: StepState = run.phase === 'drafting' ? 'now' : run.phase === 'failed' && !hasMerged && run.challenges.length === 0 ? 'failed' : 'done'
  const merge: StepState = hasMerged ? 'done' : run.phase === 'merging' ? 'now' : isOver ? 'skipped' : 'todo'

  const rounds = Array.from({ length: run.rounds }, (_, i): Step => {
    const round = i + 1
    const label = `r${round}`
    if (round < run.round) return { label, cells: ['done', 'done'] }
    if (round > run.round || !hasMerged) return { label, cells: isOver ? ['skipped', 'skipped'] : ['todo', 'todo'] }
    if (run.phase === 'challenging') return { label, cells: ['now', 'todo'] }
    if (run.phase === 'integrating') return { label, cells: ['done', 'now'] }

    const isChallenged = run.challenges.length >= round
    if (run.phase === 'failed') return { label, cells: isChallenged ? ['done', 'failed'] : ['failed', 'skipped'] }

    return { label, cells: ['done', isPass(run.challenges[round - 1] ?? '') ? 'skipped' : 'done'] }
  })

  return [{ label: 'drafts', cells: [drafts] }, { label: 'merge', cells: [merge] }, ...rounds]
}

export function runBadge(run: Run, now: number): Chip {
  const time = runTime(run, now)
  const clock = time === undefined ? '' : formatDuration(time)
  if (run.phase === 'failed') return { text: ['✗ failed', clock].filter(Boolean).join(' · '), tone: 'bad' }
  if (run.phase === 'done') return { text: `✓ ${clock || 'done'}`, tone: 'good' }

  const spin = spinner(now)
  const settled = run.seats.filter(seat => seat.status === 'done' || seat.status === 'failed').length
  const step =
    run.kind === 'panel'
      ? `${spin} ${run.rounds > 1 ? `round ${Math.max(run.round, 1)}/${run.rounds} · ` : ''}${settled}/${run.seats.length} in`
      : run.phase === 'drafting'
        ? `${spin} drafting`
        : run.phase === 'merging'
          ? '◆ merging'
          : `${spin} round ${run.round}/${run.rounds}`

  return { text: [step, clock].filter(Boolean).join(' · '), tone: 'live' }
}

export function clip(text: string, width: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (width <= 0) return ''

  return line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line
}

export function usageTokens(usage: unknown): number {
  if (typeof usage !== 'object' || usage === null) return 0

  return Object.values(usage).reduce<number>((sum, value) => (typeof value === 'number' ? sum + value : sum), 0)
}

const ROUND_CELL: Record<RoundState, Chip> = {
  answered: { text: '●', tone: 'good' },
  unchanged: { text: '=', tone: 'quiet' },
  failed: { text: '✗', tone: 'bad' },
  interrupted: { text: '■', tone: 'warn' },
  absent: { text: '·', tone: 'quiet' },
}

export function roundCells(run: Pick<Run, 'kind' | 'phase' | 'round' | 'rounds' | 'transcript' | 'seats'>, index: number, now: number): Chip[] {
  if (run.kind !== 'panel' || run.rounds <= 1) return []
  const closed = run.transcript ?? []
  const seat = run.seats[index]

  return Array.from({ length: run.rounds }, (_, i): Chip => {
    const entry = closed[i]?.[index]
    if (entry?.state === 'answered' && entry.isMoved !== undefined) return entry.isMoved ? { text: '◆', tone: 'live' } : { text: '○', tone: 'good' }
    if (entry) return ROUND_CELL[entry.state]
    if (i + 1 !== run.round || !isLive(run) || !seat) return { text: '·', tone: 'quiet' }
    if (seat.status === 'working') return { text: spinner(now), tone: 'live' }
    if (seat.status === 'done') return { text: '●', tone: 'good' }

    return seat.status === 'failed' ? { text: '✗', tone: 'bad' } : { text: '·', tone: 'quiet' }
  })
}

const SEAT_COLORS = ['#6aa9ff', '#4fd1a5', '#ff9d5c', '#c39bff', '#ff7eb6', '#c6d655']

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length] ?? '#6aa9ff'
}

export type Span = { text: string; isCode: boolean; isBold: boolean }
type Word = Span & { isJoined: boolean }

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/

function paragraphs(text: string): string[] {
  const out: string[] = []
  let isOpen = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*#+\s*/, '').trimEnd()
    if (line.trim() === '') {
      isOpen = false
      continue
    }
    if (isOpen && !LIST_ITEM.test(line)) out[out.length - 1] += ` ${line.trim()}`
    else out.push(line.trim().replace(/^[-*]\s+/, '• '))
    isOpen = true
  }

  return out
}

function words(paragraph: string): Word[] {
  const out: Word[] = []
  let isCode = false
  let isBold = false
  let isSpaced = true
  let word = ''
  const push = () => {
    if (word !== '') out.push({ text: word, isCode, isBold, isJoined: !isSpaced && out.length > 0 })
    if (word !== '') isSpaced = false
    word = ''
  }

  for (let i = 0; i < paragraph.length; i += 1) {
    const char = paragraph[i] ?? ''
    if (char === '`') {
      push()
      isCode = !isCode
    } else if (char === '*' && paragraph[i + 1] === '*' && !isCode) {
      push()
      isBold = !isBold
      i += 1
    } else if (/\s/.test(char)) {
      push()
      isSpaced = true
    } else word += char
  }
  push()

  return out
}

function wrap(list: readonly Word[], width: number): Span[][] {
  const lines: Span[][] = []
  let line: Span[] = []
  let used = 0
  const end = () => {
    if (line.length > 0) lines.push(line)
    line = []
    used = 0
  }

  for (const whole of list) {
    for (let at = 0; at < whole.text.length; at += width) {
      const text = whole.text.slice(at, at + width)
      const gap = used === 0 || (whole.isJoined && at === 0) ? '' : ' '
      if (used + gap.length + text.length > width) end()
      const lead = used === 0 ? '' : gap
      const last = line.at(-1)
      if (last && last.isCode === whole.isCode && last.isBold === whole.isBold) last.text += lead + text
      else line.push({ text: lead + text, isCode: whole.isCode, isBold: whole.isBold })
      used += lead.length + text.length
    }
  }
  end()

  return lines
}

export function flow(text: string, width: number): Span[][] {
  if (width <= 0) return []

  return paragraphs(text).flatMap(paragraph => wrap(words(paragraph), width))
}

export const ROUND_LEGEND ='● answered  ◆ moved  ○ held  = no change'

export function activityOf(tool: string, input: Record<string, unknown>): string {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const base = (path: string) => path.split('/').filter(Boolean).pop() ?? path
  if (tool === 'Read') return `read ${base(text('file_path'))}`
  if (tool === 'Grep') return `grep ${text('pattern')}`
  if (tool === 'Glob') return `glob ${text('pattern')}`
  if (tool === 'WebFetch') return `fetch ${text('url').replace(/^https?:\/\//, '').split('/')[0] ?? ''}`
  if (tool === 'WebSearch') return `search ${text('query')}`
  if (tool.endsWith('__git')) return `git ${text('command')}`

  return tool.replace(/^mcp__/, '')
}
