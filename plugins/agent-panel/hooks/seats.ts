import type { Role, Run, SaveMode, Seat } from '../types'

export const MODELS: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
  fable: 'claude-fable-5-1',
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const MAX_ROUNDS = 5

export const SAVE_MODES = ['off', 'files', 'solo', 'both'] as const

export const SOLO_BRIEF_PREFIX = 'brief-'

export const GIT_COMMANDS = ['status', 'diff', 'log', 'show', 'blame'] as const

export function isSaveMode(value: string): value is SaveMode {
  return (SAVE_MODES as readonly string[]).includes(value)
}

export const FALLBACK_PRESETS: Record<string, string[]> = {
  deep: ['opus:xhigh', 'opus:high', 'sonnet:high'],
  quick: ['sonnet:medium', 'sonnet:low', 'haiku:high'],
  duo: ['opus:high', 'sonnet:high'],
  review: ['opus:xhigh', 'sonnet:high', 'opus:high:contrarian'],
}

const SEAT = /^(opus|sonnet|haiku|fable):(low|medium|high|xhigh|max)(?::(panelist|contrarian))?((?:\+[\w:./-]+)*)$/i

export function parseSeat(token: string): Seat | undefined {
  const match = SEAT.exec(token)
  if (!match?.[1] || !match[2]) return undefined

  const model = match[1].toLowerCase()
  const effort = match[2].toLowerCase()
  const role = (match[3]?.toLowerCase() ?? 'panelist') as Role
  const skills = match[4] ? match[4].split('+').filter(Boolean) : []
  const label = [`${model}·${effort}`, role === 'contrarian' ? 'contrarian' : '', ...skills.map(s => `+${s}`)]
    .filter(Boolean)
    .join(' ')

  return { label, model, effort, role, skills, status: 'starting' }
}

export type ParsedArgs = { seats: Seat[]; rounds?: number; brief?: string; save?: SaveMode; question: string; errors: string[] }

export function parseArgs(args: string, presets: Record<string, string[]>): ParsedArgs {
  const seats: Seat[] = []
  const errors: string[] = []
  let rounds: number | undefined
  let brief: string | undefined
  let save: SaveMode | undefined
  let rest = args.trim()

  while (rest.length > 0) {
    const token = rest.split(/\s+/, 1)[0] ?? ''
    const after = rest.slice(token.length).trimStart()

    if (token === '--') {
      rest = after
      break
    }

    const roundsMatch = /^rounds=(\d+)$/i.exec(token)
    const briefMatch = /^brief=([\w.-]+)$/i.exec(token)
    const saveMatch = /^save=(\w+)$/i.exec(token)
    const seat = parseSeat(token)
    const preset = presets[token.toLowerCase()]

    if (roundsMatch) {
      const error = roundsError(Number(roundsMatch[1]))
      if (error) errors.push(`"${token}": ${error}`)
      else rounds = Number(roundsMatch[1])
    } else if (briefMatch?.[1]) {
      brief = briefMatch[1].toLowerCase()
    } else if (saveMatch?.[1]) {
      const mode = saveMatch[1].toLowerCase()
      if (isSaveMode(mode)) save = mode
      else errors.push(`"${token}": save must be one of ${SAVE_MODES.join(', ')}.`)
    } else if (seat) {
      seats.push(seat)
    } else if (preset) {
      for (const spec of preset) {
        const presetSeat = parseSeat(spec)
        if (presetSeat) seats.push(presetSeat)
        else errors.push(`Preset "${token}" has an invalid seat "${spec}".`)
      }
    } else if (/^[a-z]+:[a-z]+/i.test(token) && !token.includes('/')) {
      errors.push(`"${token}" is not a seat. Use model:effort, e.g. opus:xhigh.`)
    } else {
      break
    }

    rest = after
  }

  return { seats, rounds, brief, save, question: rest.trim(), errors }
}

export function roundsError(rounds: number): string | undefined {
  if (Number.isInteger(rounds) && rounds >= 1 && rounds <= MAX_ROUNDS) return undefined

  return `rounds must be a whole number from 1 to ${MAX_ROUNDS}.`
}

export function agentTypeName(seat: Pick<Seat, 'model' | 'effort' | 'skills'>): string {
  const base = `${seat.model}-${seat.effort}`
  if (seat.skills.length === 0) return base

  let hash = 5381
  for (const char of [...seat.skills].sort().join('+')) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0

  return `${base}-${hash.toString(36)}`
}

export const SEAT_SYSTEM_PROMPT = `You are one seat on a panel of AI agents working in the repository in your current directory. You have read-only tools. For git history and diffs use the git tool (status, diff, log, show, blame).

Investigate the code before you claim anything about it. Separate what you verified (cite file:line) from what you infer. Answer in the format the brief asks for. Do not ask questions back; state your assumptions and continue. Your final message is your whole answer: the coordinator reads only that.`

export function panelBrief(question: string, role: Role, brief?: string): string {
  if (role === 'contrarian') {
    return `Contrarian review. Other agents answer the same question separately; you will not see their answers.

Question:
${question}
${brief === undefined ? '' : `\nThe other seats review through this brief; aim your objections at what it would find or miss:\n${brief}\n`}
Attack the strongest assumptions behind the obvious answer. Trace failure cases. For each objection give concrete counterevidence and say whether it is a verified fact or a guess. If you cannot support a meaningful objection, answer PASS.`
  }

  if (brief !== undefined) {
    return `Independent panel round. Other agents work from the same brief separately; you will not see their answers.

Focus:
${question}

Brief:
${brief}

You start with no earlier conversation: the work under review is what Focus names. You are read-only: where the brief says to change or run something, recommend it instead. Answer in the format the brief asks for and cite the evidence you checked (file:line).`
  }

  return `Independent panel round. Other agents answer the same question separately; you will not see their answers.

Question:
${question}

Answer with:
1. Your answer or recommendation.
2. The evidence you checked (file:line).
3. Risks, and what you are unsure of.`
}

export function draftBrief(task: string): string {
  return `Independent planning round. Another agent drafts a plan from the same brief; you will not see it yet.

Task:
${task}

Write a complete plan: the steps, the files involved (verified paths), risks, and open decisions.`
}

export function challengeBrief(candidate: string, round: number, rounds: number): string {
  return `Ping-pong round ${round} of ${rounds}: challenge this candidate plan.

Find concrete errors, gaps and risks, each with evidence (file:line). Do not rewrite the plan. If nothing material is wrong, answer with PASS alone on the first line; that ends the rounds.

## Candidate plan

${candidate}`
}

export function isPass(answer: string): boolean {
  const firstLine = answer.trim().split('\n', 1)[0] ?? ''

  return /^[\s*_`#]*PASS[\s*_`.!]*$/.test(firstLine)
}

export function integrateBrief(candidate: string, challenge: string, round: number, rounds: number): string {
  return `Ping-pong round ${round} of ${rounds}: another agent challenged the candidate plan below.

Check each correction against the code and integrate only the ones the evidence supports. Reply with the full revised plan, then a section "Rejected corrections" that lists each correction you rejected and why.

## Candidate plan

${candidate}

## Challenge

${challenge}`
}

export function seatList(seats: Seat[]): string {
  return seats.map((seat, i) => `${i + 1}. ${seat.label} (${MODELS[seat.model]}, effort ${seat.effort})`).join('\n')
}

export function slugify(text: string, max = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, max).replace(/^-+|-+$/g, '') || 'untitled'
}

export function artifactOf(run: Pick<Run, 'kind' | 'phase' | 'round' | 'seats'>, index: number): { file: string; title: string } {
  const label = run.seats[index]?.label ?? ''
  if (run.kind === 'panel') return { file: `seat-${index + 1}-${slugify(label)}`, title: `Seat ${index + 1}: ${label}` }
  if (run.phase === 'drafting') {
    const side = index === 0 ? 'a' : 'b'

    return { file: `draft-${side}-${slugify(label)}`, title: `Draft ${side.toUpperCase()}: ${label}` }
  }
  if (run.phase === 'challenging') return { file: `round-${run.round}-challenge`, title: `Round ${run.round} challenge (${label})` }

  return { file: `round-${run.round}-plan`, title: `Round ${run.round} revised plan (${label})` }
}

export function soloBriefName(templateName: string): string | undefined {
  const lower = templateName.trim().toLowerCase()
  if (!lower.startsWith(SOLO_BRIEF_PREFIX)) return undefined

  return lower.slice(SOLO_BRIEF_PREFIX.length).split(/[\s:]/, 1)[0] || undefined
}

export function gitRefusal(command: string, args: readonly unknown[]): string | undefined {
  if (!(GIT_COMMANDS as readonly string[]).includes(command)) return `git ${command} is not available here. Use one of: ${GIT_COMMANDS.join(', ')}.`
  if (args.some(arg => typeof arg !== 'string')) return 'args must be a list of strings.'
  if (args.some(arg => /^--output(=|$)/.test(arg as string))) return '--output writes a file; this tool is read-only.'

  return undefined
}
