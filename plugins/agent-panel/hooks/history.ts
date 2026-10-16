import type { RoundEntry, Run, Seat } from '../types'
import type { AnyPage } from './page'
import { closedEntry, parseSeat } from './seats'

export type HistoryEntry = { id: string; kind: 'panel' | 'pingpong'; folder: string; question: string; state: 'live' | 'done' | 'failed'; startedAt?: number; headline?: string }
export type History = { stamp: string; runs: HistoryEntry[] }

const QUESTION_MAX = 160
const HEADLINE_MAX = 200
const REBUILT = 'Rebuilt from the saved answers. How the run ended was not recorded.'
const SEAT_LINE = /^\d+\. (\w+)·(\w+)( contrarian)?((?: \+[\w:./-]+)*) \(/gm

const oneLine = (text: string, max: number) => {
  const line = text.replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function historyEntry(data: AnyPage, folder: string): HistoryEntry {
  const isFailed = data.kind === 'pingpong' && data.isFailed

  return {
    id: data.id,
    kind: data.kind ?? 'panel',
    folder,
    question: oneLine(data.question, QUESTION_MAX),
    state: data.isLive ? 'live' : isFailed ? 'failed' : 'done',
    ...(data.startedAt === undefined ? {} : { startedAt: data.startedAt }),
    ...(data.verdict === undefined ? {} : { headline: oneLine(data.verdict.headline, HEADLINE_MAX) }),
  }
}

export function sortHistory(runs: readonly HistoryEntry[]): HistoryEntry[] {
  return [...runs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || b.folder.localeCompare(a.folder))
}

export function withEntry(history: History, entry: HistoryEntry): History {
  return { ...history, runs: sortHistory([...history.runs.filter(run => run.folder !== entry.folder), entry]) }
}

export function historyScript(history: History): string {
  return `window.__panelHistory&&window.__panelHistory(${JSON.stringify(history.runs)})\n`
}

const body = (file: string | undefined) => (file ?? '').replace(/^# .*\n+/, '').trim()

export function savedRun(files: Readonly<Record<string, string>>, startedAt?: number): Run | undefined {
  const [header = '', asked] = (files['question.md'] ?? '').split(/\n## (?:Question|Task)\n+/)
  const head = /^(Panel|Ping-pong) (\w+)/.exec(header)
  const seats = [...header.matchAll(SEAT_LINE)].flatMap((line): Seat[] => {
    const seat = parseSeat(`${line[1]}:${line[2]}${line[3] === undefined ? '' : ':contrarian'}${(line[4] ?? '').replace(/ /g, '')}`)

    return seat ? [{ ...seat, status: 'done' }] : []
  })
  if (!head?.[2] || asked === undefined || seats.length === 0) return undefined
  const names = Object.keys(files)
  const common = { id: head[2], question: asked.trim(), outcome: REBUILT, ...(startedAt === undefined ? {} : { startedAt }) }

  if (head[1] === 'Ping-pong') {
    const named = (start: string) => body(files[names.find(name => name.startsWith(start)) ?? ''])
    const numbered = (what: string) => {
      const found: string[] = []
      while (files[`round-${found.length + 1}-${what}.md`] !== undefined) found.push(body(files[`round-${found.length + 1}-${what}.md`]))

      return found
    }
    const candidate = body(files['candidate.md'])
    const challenges = numbered('challenge')

    return {
      ...common,
      kind: 'pingpong',
      seats,
      phase: candidate === '' ? 'failed' : 'done',
      round: challenges.length,
      rounds: Math.max(1, challenges.length),
      challenges,
      drafts: [named('draft-a-'), named('draft-b-')],
      plans: candidate === '' ? [] : [candidate, ...numbered('plan')],
    }
  }

  const answers = new Map<string, string>()
  for (const name of names) {
    const at = /^(?:round-(\d+)-)?seat-(\d+)-/.exec(name)
    if (at) answers.set(`${at[1] ?? 1}-${at[2]}`, body(files[name]))
  }
  const rounds = Math.max(1, ...[...answers.keys()].map(key => Number(key.split('-')[0])))
  const transcript: RoundEntry[][] = []
  for (let round = 1; round <= rounds; round += 1) {
    transcript.push(
      seats.map((seat, index) => {
        const answer = answers.get(`${round}-${index + 1}`)

        return closedEntry({ kind: 'panel', round, rounds, transcript }, answer === undefined ? { ...seat, status: 'failed' } : { ...seat, answer }, index)
      }),
    )
  }

  return { ...common, kind: 'panel', seats, phase: 'done', round: rounds, rounds, challenges: [], transcript }
}
