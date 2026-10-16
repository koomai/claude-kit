import type { Preset, PresetMap, PresetSource, Role, RoundEntry, RoundState, Run, Seat } from '../types'
import type { Guide } from './design'

export const MODELS: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
  fable: 'claude-fable-5-1',
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const MAX_ROUNDS = 5



export const GIT_COMMANDS = ['status', 'diff', 'log', 'show', 'blame'] as const


const SEAT = /^(opus|sonnet|haiku|fable):(low|medium|high|xhigh|max)(?::(panelist|contrarian))?((?:\+[\w:./-]+)*)$/i
const MISPLACED_SKILL = /^((?:opus|sonnet|haiku|fable):(?:low|medium|high|xhigh|max)):([\w./-]+)$/i

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

export function seatSpec(seat: Pick<Seat, 'model' | 'effort' | 'role' | 'skills'>): string {
  return `${seat.model}:${seat.effort}${seat.role === 'contrarian' ? ':contrarian' : ''}${seat.skills.map(skill => `+${skill}`).join('')}`
}

const PRESET_NAME = /^[a-z][a-z0-9-]{1,30}$/
const BRIEF_NAME = /^[\w.-]+$/
const FOLDER_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export const PRESET_COMMANDS = ['help', 'save', 'list', 'show', 'delete', 'skills'] as const

export function presetNameError(name: string): string | undefined {
  if (!PRESET_NAME.test(name)) return 'a preset name is 2 to 31 lowercase letters, digits or hyphens, starting with a letter.'
  if (Object.hasOwn(MODELS, name) || (PRESET_COMMANDS as readonly string[]).includes(name)) return `"${name}" is reserved.`

  return undefined
}

export function isFolderSkillName(name: string): boolean {
  return FOLDER_SKILL_NAME.test(name)
}

export type PresetLayer = { presets: PresetMap; ignored: string[] }

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function readPresetLayer(raw: unknown, source: PresetSource, builtInNames: readonly string[] = []): PresetLayer {
  const presets: PresetMap = {}
  const ignored: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { presets, ignored: ['the file is not a JSON object of presets'] }

  for (const [name, value] of Object.entries(raw)) {
    const entry: Record<string, unknown> = isStrings(value) ? { seats: value } : typeof value === 'object' && value !== null ? { ...value } : {}
    const { seats, skillDirs } = entry
    const nameError = presetNameError(name)
    const badSeat = isStrings(seats) ? seats.find(spec => parseSeat(spec) === undefined) : undefined
    if (nameError) {
      ignored.push(`"${name}": ${nameError}`)
    } else if (source === 'project' && builtInNames.includes(name)) {
      ignored.push(`"${name}": a project file cannot replace a built-in preset.`)
    } else if (!isStrings(seats) || seats.length === 0) {
      ignored.push(`"${name}": needs a list of seats.`)
    } else if (badSeat !== undefined) {
      ignored.push(`"${name}": "${badSeat}" is not a seat.`)
    } else {
      const hasFolders = isStrings(skillDirs) && skillDirs.length > 0
      if (source === 'project' && hasFolders) ignored.push(`"${name}": skill folders in a project file are not used.`)
      presets[name] = {
        seats,
        source,
        ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
        ...(typeof entry.brief === 'string' && BRIEF_NAME.test(entry.brief) ? { brief: entry.brief.toLowerCase() } : {}),
        ...(typeof entry.rounds === 'number' && roundsError(entry.rounds) === undefined ? { rounds: entry.rounds } : {}),
        ...(source !== 'project' && isStrings(skillDirs) && hasFolders ? { skillDirs } : {}),
      }
    }
  }

  return { presets, ignored }
}

export function presetEntry(preset: Omit<Preset, 'source'>): string[] | Omit<Preset, 'source'> {
  return Object.keys(preset).length === 1 ? preset.seats : preset
}

export const FALLBACK_PRESETS: PresetMap = readPresetLayer(
  {
    deep: ['opus:xhigh', 'opus:high', 'sonnet:high'],
    quick: ['sonnet:medium', 'sonnet:low', 'haiku:high'],
    duo: ['opus:high', 'sonnet:high'],
    review: ['opus:xhigh', 'sonnet:high', 'opus:high:contrarian'],
  },
  'built-in',
).presets

export type ParsedArgs = {
  seats: Seat[]
  rounds?: number
  brief?: string
  as?: string
  skillDirs: string[]
  presets: string[]
  presetBrief?: string
  presetRounds?: number
  presetSkillDirs: string[]
  notes: string[]
  question: string
  hasSeparator: boolean
  errors: string[]
}

export function parseArgs(args: string, presets: PresetMap): ParsedArgs {
  const parsed: ParsedArgs = { seats: [], skillDirs: [], presets: [], presetSkillDirs: [], notes: [], question: '', hasSeparator: false, errors: [] }
  const { seats, errors, notes } = parsed
  let rest = args.trim()

  while (rest.length > 0) {
    const token = rest.split(/\s+/, 1)[0] ?? ''
    const after = rest.slice(token.length).trimStart()

    if (token === '--') {
      parsed.hasSeparator = true
      rest = after
      break
    }

    const roundsMatch = /^rounds=(\d+)$/i.exec(token)
    const briefMatch = /^brief=([\w.-]+)$/i.exec(token)
    const asMatch = /^as=(.+)$/i.exec(token)
    const skillsMatch = /^skills=(.+)$/i.exec(token)
    const misplaced = MISPLACED_SKILL.exec(token)
    const seat = parseSeat(token)
    const name = token.toLowerCase()

    if (roundsMatch) {
      const error = roundsError(Number(roundsMatch[1]))
      if (error) errors.push(`"${token}": ${error}`)
      else parsed.rounds = Number(roundsMatch[1])
    } else if (briefMatch?.[1]) {
      parsed.brief = briefMatch[1].toLowerCase()
    } else if (asMatch?.[1]) {
      const error = presetNameError(asMatch[1])
      if (error) errors.push(`"${token}": ${error}`)
      else parsed.as = asMatch[1]
    } else if (skillsMatch?.[1]) {
      parsed.skillDirs.push(...skillsMatch[1].split(',').filter(Boolean))
    } else if (seat) {
      seats.push(seat)
    } else if (Object.hasOwn(presets, name)) {
      const preset = presets[name] as Preset
      parsed.presets.push(name)
      seats.push(...preset.seats.flatMap(spec => parseSeat(spec) ?? []))
      parsed.presetSkillDirs.push(...(preset.skillDirs ?? []))
      if (preset.brief !== undefined && parsed.presetBrief === undefined) parsed.presetBrief = preset.brief
      else if (preset.brief !== undefined && preset.brief !== parsed.presetBrief) notes.push(`Preset "${name}" asks for brief "${preset.brief}"; "${parsed.presetBrief}" from an earlier preset is used.`)
      if (preset.rounds !== undefined && parsed.presetRounds === undefined) parsed.presetRounds = preset.rounds
      else if (preset.rounds !== undefined && preset.rounds !== parsed.presetRounds) notes.push(`Preset "${name}" asks for ${preset.rounds} round(s); ${parsed.presetRounds} from an earlier preset is used.`)
    } else if (misplaced?.[1] && misplaced[2]) {
      errors.push(`"${token}": after the effort comes :contrarian or +skill. Use ${misplaced[1]}+${misplaced[2]}.`)
    } else if (/^[a-z]+:[a-z]+/i.test(token) && !token.includes('/')) {
      errors.push(`"${token}" is not a seat. Use model:effort, e.g. opus:xhigh.`)
    } else if (after === '--' || after.startsWith('-- ')) {
      errors.push(`"${token}" is not a preset or a seat. Known presets: ${Object.keys(presets).join(', ')}.`)
    } else {
      break
    }

    rest = after
  }

  parsed.question = rest.trim()

  return parsed
}

export type ToolInput = { preset?: unknown; seats?: unknown; brief?: unknown }

export function toolArgs(input: ToolInput): { args: string } | { error: string } {
  const { preset, seats = [], brief } = input
  if (preset !== undefined && (typeof preset !== 'string' || !PRESET_NAME.test(preset.toLowerCase()))) return { error: 'preset must be the name of one preset.' }
  if (!isStrings(seats)) return { error: 'seats must be a list of strings.' }
  const badSeat = seats.find(spec => parseSeat(spec) === undefined)
  if (badSeat !== undefined) return { error: `"${badSeat}" is not a seat. Use model:effort[:contrarian][+skill], e.g. opus:xhigh.` }
  if (brief !== undefined && (typeof brief !== 'string' || !BRIEF_NAME.test(brief))) return { error: 'brief must be the name of one brief.' }

  return { args: [preset ?? '', ...seats, brief === undefined ? '' : `brief=${brief}`].filter(Boolean).join(' ') }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function splitSkill(text: string): { frontmatter: string; body: string } {
  const match = FRONTMATTER.exec(text)

  return match ? { frontmatter: match[1] ?? '', body: text.slice(match[0].length).trim() } : { frontmatter: '', body: text.trim() }
}

export function skillSummary(frontmatter: string): string {
  const lines = frontmatter.split(/\r?\n/)
  const at = lines.findIndex(line => line.startsWith('description:'))
  if (at === -1) return ''
  const inline = (lines[at] ?? '').replace(/^description:\s*/, '').replace(/^[>|][+-]?\s*$/, '')
  const value = inline !== '' ? inline : (lines.slice(at + 1).find(line => line.trim() !== '' && /^\s/.test(line)) ?? '')

  return value.trim().replace(/^["']|["']$/g, '')
}

const ENGINE_ONLY_KEYS = ['allowed-tools', 'context', 'disable-model-invocation']

export function ignoredSkillFeatures(frontmatter: string, body: string): string[] {
  return [
    ...ENGINE_ONLY_KEYS.filter(key => new RegExp(`^${key}:`, 'm').test(frontmatter)),
    ...(body.includes('${CLAUDE_SKILL_DIR}') ? ['${CLAUDE_SKILL_DIR}'] : []),
    ...(/!`[^`]+`/.test(body) ? ['command injection'] : []),
  ]
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }

  return row[b.length] ?? 0
}

export function nearestNames(name: string, candidates: readonly string[], max = 3): string[] {
  const limit = Math.max(2, Math.floor(name.length / 3))

  return candidates
    .map(candidate => ({ candidate, distance: candidate.endsWith(`:${name}`) ? 0 : editDistance(name.toLowerCase(), candidate.toLowerCase()) }))
    .filter(scored => scored.distance <= limit)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max)
    .map(scored => scored.candidate)
}

const SKILL_RULES = `You carry the skills below. Their discipline governs this answer and overrides the code-centric defaults where they conflict: cite file:line only for claims about files, and name the skill behind each point. Where a skill says to ask the user, state your assumption instead. Where a skill says to write files or run commands, recommend it instead; you are read-only.`

export function withSkills(prompt: string, skills: readonly { name: string; path: string; body: string }[]): string {
  if (skills.length === 0) return prompt
  const blocks = skills.map(skill => `## Skill: ${skill.name}\n\nBase directory: ${skill.path}\nFiles the skill refers to, such as references/, may exist under it; open them with Read.\n\n${skill.body}`)

  return `${SKILL_RULES}\n\n${blocks.join('\n\n')}\n\n## Your task\n\n${prompt}`
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

Check each correction against the code or files it cites and integrate only the ones the evidence supports. Reply with the full revised plan, then a section "Rejected corrections" that lists each correction you rejected and why.

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

export function artifactOf(run: Pick<Run, 'kind' | 'phase' | 'round' | 'rounds' | 'seats'>, index: number): { file: string; title: string } {
  const label = run.seats[index]?.label ?? ''
  if (run.kind === 'panel' && run.rounds > 1) {
    const round = Math.max(run.round, 1)

    return { file: `round-${round}-seat-${index + 1}-${slugify(label)}`, title: `Round ${round}, seat ${index + 1}: ${label}` }
  }
  if (run.kind === 'panel') return { file: `seat-${index + 1}-${slugify(label)}`, title: `Seat ${index + 1}: ${label}` }
  if (run.phase === 'drafting') {
    const side = index === 0 ? 'a' : 'b'

    return { file: `draft-${side}-${slugify(label)}`, title: `Draft ${side.toUpperCase()}: ${label}` }
  }
  if (run.phase === 'challenging') return { file: `round-${run.round}-challenge`, title: `Round ${run.round} challenge (${label})` }

  return { file: `round-${run.round}-plan`, title: `Round ${run.round} revised plan (${label})` }
}

export function gitRefusal(command: string, args: readonly unknown[]): string | undefined {
  if (!(GIT_COMMANDS as readonly string[]).includes(command)) return `git ${command} is not available here. Use one of: ${GIT_COMMANDS.join(', ')}.`
  if (args.some(arg => typeof arg !== 'string')) return 'args must be a list of strings.'
  if (args.some(arg => /^--output(=|$)/.test(arg as string))) return '--output writes a file; this tool is read-only.'

  return undefined
}

const NO_CHANGE_LINE = /^[\s*_`#]*NO CHANGE[\s*_`.!]*$/i
const NO_CHANGE_MAX = 300
const PEER_ANSWER_MAX = 30_000
const PEER_BUDGET = 120_000
const SYNTHESIS_BUDGET = 150_000

const FIRST_SECTION = /^[\s>*_#-]*1[.)]?[\s*_]*(?:changed|withdrawn)\b/i
const SECOND_SECTION = /^[\s>*_#-]*2[.)]?[\s*_]*\S/

export function movedIn(reply: string): boolean | undefined {
  const lines = reply.split('\n')
  const start = lines.findIndex(line => FIRST_SECTION.test(line))
  if (start === -1) return undefined
  const end = lines.findIndex((line, i) => i > start && SECOND_SECTION.test(line))
  const body = [(lines[start] ?? '').replace(FIRST_SECTION, ''), ...lines.slice(start + 1, end === -1 ? undefined : end)].join(' ').replace(/^[\s\-*_>:.]+/, '')
  if (body === '') return undefined

  return !/^(?:nothing|none|no change|n\/a)\b/i.test(body)
}

export type SectionKind = 'stance' | 'change' | 'dispute' | 'missed' | 'support'
export type Section = { label: string; kind: SectionKind; body: string }

const SECTION_HEAD = /^(\*\*)?\s*(?:(\d+)[.)]\s*)?(\*\*)?\s*([A-Z][^:*\n]{1,60}?):(\*\*)?\s*(.*)$/

export function sectionKind(label: string): SectionKind {
  if (/^(position now|answer|recommendation|obvious pick)/i.test(label)) return 'stance'
  if (/^(changed|withdrawn)/i.test(label)) return 'change'
  if (/(disputed|objection)/i.test(label)) return 'dispute'
  if (/^missed/i.test(label)) return 'missed'

  return 'support'
}

function dedent(lines: readonly string[]): string[] {
  const indents = lines.filter(line => line.trim() !== '').map(line => line.length - line.trimStart().length)
  const cut = indents.length === 0 ? 0 : Math.min(...indents)

  return lines.map(line => line.slice(cut))
}

function bareHead(line: string): string | undefined {
  const inner = /^#{1,6}\s+(.+)$/.exec(line)?.[1] ?? /^\*\*(.+)\*\*:?$/.exec(line.trimEnd())?.[1]
  const label = inner?.replace(/\*\*/g, '').replace(/^\d+[.)]\s*/, '').replace(/:$/, '').trim() ?? ''

  return /^[A-Z][^:]{1,60}$/.test(label) && !/[.!?]$/.test(label) ? label : undefined
}

export function splitSections(answer: string): { lead: string; sections: Section[] } {
  const lead: string[] = []
  const found: { label: string; first: string; rest: string[] }[] = []

  for (const line of answer.split('\n')) {
    const match = /^\S/.test(line) ? SECTION_HEAD.exec(line) : null
    const label = match?.[4]?.trim() ?? ''
    const isHead = match !== null && (match[2] !== undefined || line.startsWith('**')) && !/^Seats? \d/.test(label)
    const bare = isHead ? undefined : bareHead(line)
    if (isHead) {
      const isLeftOpen = (match[1] !== undefined || match[3] !== undefined) && match[5] === undefined
      found.push({ label, first: `${isLeftOpen ? '**' : ''}${match[6] ?? ''}`, rest: [] })
    } else if (bare !== undefined) found.push({ label: bare, first: '', rest: [] })
    else (found.at(-1)?.rest ?? lead).push(line)
  }

  return {
    lead: lead.join('\n').trim(),
    sections: found.map(({ label, first, rest }) => ({ label, kind: sectionKind(label), body: [first, ...dedent(rest)].join('\n').trim() })),
  }
}

export function excerptOf(answer: string, isReply: boolean): { label: string; text: string } | undefined {
  if (answer.trim() === '' || (isReply && (isNoChange(answer) || isPass(answer)))) return undefined
  const { sections } = splitSections(answer)
  const stance = isReply ? sections.findLast(section => section.kind === 'stance') : sections.find(section => section.kind === 'stance')
  const picked = (isReply && movedIn(answer) === true ? sections.find(section => section.kind === 'change') : undefined) ?? stance ?? sections[0]

  return picked === undefined || picked.body === '' ? { label: '', text: answer.trim() } : { label: picked.label, text: picked.body }
}

export function isNoChange(answer: string): boolean {
  const text = answer.trim()

  return text.length <= NO_CHANGE_MAX && text.split('\n').some(line => NO_CHANGE_LINE.test(line))
}

export function clipAnswer(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.6)
  const tail = max - head

  return `${text.slice(0, head)}\n\n[... ${text.length - max} of ${text.length} characters cut from the middle ...]\n\n${text.slice(text.length - tail)}`
}

export function standing(transcript: readonly (readonly RoundEntry[])[], index: number): { round: number; text: string } | undefined {
  for (let round = transcript.length; round >= 1; round -= 1) {
    const entry = transcript[round - 1]?.[index]
    if (entry?.state === 'answered') return { round, text: entry.text }
  }

  return undefined
}

export function seatSkills(seat: Pick<Seat, 'skills' | 'folderSkills' | 'unknownSkills'>): string[] {
  const unknown = new Set(seat.unknownSkills ?? [])

  return [...(seat.folderSkills ?? []).map(skill => skill.name), ...seat.skills.filter(name => !unknown.has(name))]
}

export function peerName(seat: Pick<Seat, 'role' | 'skills' | 'folderSkills' | 'unknownSkills'>, index: number): string {
  const notes = [seat.role === 'contrarian' ? 'contrarian: argues against the obvious answer by role' : '', seatSkills(seat).map(name => `+${name}`).join(' ')].filter(Boolean)

  return notes.length === 0 ? `Seat ${index + 1}` : `Seat ${index + 1} (${notes.join(', ')})`
}

export function collectedNote(runs: readonly Pick<Run, 'id' | 'seats'>[], notification: string): string | undefined {
  for (const run of runs) {
    const index = run.seats.findIndex(seat => seat.agentId !== undefined && notification.includes(`<task-id>${seat.agentId}</task-id>`))
    if (index !== -1) return `panel ${run.id} has seat ${index + 1}'s reply.`
  }

  return undefined
}

type Discussion = Pick<Run,'question' | 'seats' | 'round' | 'rounds' | 'transcript' | 'briefText'>

export function closedEntry(run: Pick<Run, 'kind' | 'round' | 'rounds' | 'transcript'>, seat: Seat, index: number): RoundEntry {
  const round = Math.max(run.round, 1)
  const text = seat.answer ?? ''
  if (round > 1 && standing(run.transcript ?? [], index) === undefined) return { state: 'absent', text: '' }
  if (seat.isInterrupted === true) return { state: 'interrupted', text }
  if (seat.status !== 'done') return { state: 'failed', text }
  if (round > 1 && (isNoChange(text) || isPass(text))) return { state: 'unchanged', text }
  const isMoved = round > 1 ? movedIn(text) : undefined

  return { state: 'answered', text, ...(isMoved === undefined ? {} : { isMoved }) }
}

function roundOutcome(run: Pick<Run, 'rounds' | 'isStopping'>, round: number, transcript: readonly RoundEntry[][]): string | undefined {
  const entries = transcript[round - 1] ?? []
  const interrupted = entries.findIndex(entry => entry.state === 'interrupted')
  const answered = entries.filter((_, index) => standing(transcript, index) !== undefined).length
  if (round < run.rounds && interrupted !== -1) return `stopped in round ${round} of ${run.rounds}: seat ${interrupted + 1} was interrupted`
  if (round < run.rounds && run.isStopping === true) return `stopped after round ${round} of ${run.rounds} as you asked`
  if (answered < 2) return 'the discussion did not run: fewer than two seats answered'
  if (round >= run.rounds) return `completed ${round} of ${run.rounds} rounds`
  if (round >= 2 && !entries.some(entry => entry.state === 'answered')) {
    return entries.some(entry => entry.state === 'unchanged') ? `stopped early in round ${round} of ${run.rounds}: no seat changed its answer` : `stopped in round ${round} of ${run.rounds}: no seat replied`
  }

  return undefined
}

function seatForNextRound(seat: Seat, entry: RoundEntry | undefined, hasStanding: boolean): Seat {
  if (!hasStanding) return seat
  const { answer: _answer, isInterrupted: _isInterrupted, agentId, ...kept } = seat
  const isResumable = agentId !== undefined && (entry?.state === 'answered' || entry?.state === 'unchanged')

  return { ...kept, status: 'starting', ...(isResumable ? { agentId } : {}) }
}

export function closeRound(run: Run): Run {
  const round = Math.max(run.round, 1)
  const transcript = [...(run.transcript ?? []), run.seats.map((seat, index) => closedEntry(run, seat, index))]
  if (run.rounds <= 1) return { ...run, round, transcript, phase: 'done' }

  const outcome = roundOutcome(run, round, transcript)
  if (outcome !== undefined) return { ...run, round, transcript, phase: 'done', outcome }

  return {
    ...run,
    transcript,
    phase: 'discussing',
    round: round + 1,
    seats: run.seats.map((seat, index) => seatForNextRound(seat, transcript[round - 1]?.[index], standing(transcript, index) !== undefined)),
  }
}

function peerBlocks(run: Discussion, index: number): string {
  const transcript = run.transcript ?? []
  const last = transcript.length
  const peers = run.seats.map((seat, i) => ({ seat, i, held: standing(transcript, i) })).filter(peer => peer.i !== index)
  const max = Math.min(PEER_ANSWER_MAX, Math.floor(PEER_BUDGET / Math.max(1, peers.filter(peer => peer.held !== undefined).length)))

  return peers
    .map(({ seat, i, held }) => {
      if (held === undefined) return `Seat ${i + 1} did not answer and is not in the discussion.`
      if (seat.role === 'contrarian' && isPass(held.text)) return `### Seat ${i + 1} (contrarian) raised no objection in round ${held.round}`
      const state = transcript[last - 1]?.[i]?.state
      const where =
        held.round === last
          ? `, round ${held.round}`
          : state === 'unchanged'
            ? `, round ${held.round}; unchanged in round ${last}`
            : `: did not reply in round ${last}; this is its round ${held.round} answer`

      return `### ${peerName(seat, i)}${where}\n\n${clipAnswer(held.text, max)}`
    })
    .join('\n\n')
}

const PANELIST_REPLY = (brief: boolean) => `Hold your position or move it on evidence, never on numbers. That another seat disagrees, or that most seats agree with each other, is not a reason to change. A fact you checked or an argument you cannot answer is. Before you accept or reject a claim about a file, a page or a source, open it. A position kept and defended is worth as much as one changed.

Reply with these four sections and nothing else:

1. Changed: each point of your answer you now change, the seat whose argument moved you, and what you checked that confirms it. "Nothing" if none.
2. Still disputed: each claim by another seat that you reject. Name the seat, quote the claim, give your counter-evidence, say whether it is a verified fact or a judgement, and say what finding would settle it. Include objections to your answer that you do not accept, and why.
3. Missed: what no answer covers, yours included, that bears on the question.
4. Position now: your full answer as it stands after this round, complete enough to read without the earlier rounds${brief ? ', in the format the brief asks for' : ''}.

Do not list agreements, summarise the other answers or thank anyone. Refer to seats by number.

If you change nothing, dispute nothing you have not already disputed, and have nothing to add, answer NO CHANGE alone and write nothing else. Your earlier answer then stands. A round in which no seat changes anything ends the discussion.`

const CONTRARIAN_REPLY = `You hold no position and you join none. Your target this round is what the other seats now agree on, and the reasons seats gave for changing their answers.

1. Withdrawn: each of your objections that another seat answered with evidence you checked, and what answered it. "None" if none. Never withdraw an objection because it was outvoted or ignored.
2. Standing objections: each objection that survives, restated against the answers as they now stand, with counterevidence, marked verified fact or guess.
3. New objections: attack the strongest point the other seats share, and any change of position made without evidence. Trace the failure case.
4. What would settle it: for each standing or new objection, the check that would prove it right or wrong.

PASS is not an answer in this round. If your objections stand exactly as stated and you have none to add or withdraw, answer NO CHANGE alone and write nothing else.`

export function replyBrief(run: Discussion, index: number, isContinued: boolean): string {
  const seat = run.seats[index]
  const isContrarian = seat?.role === 'contrarian'
  const own = standing(run.transcript ?? [], index)
  const who = `You are seat ${index + 1}${isContrarian ? ', the contrarian' : ''}.`
  const others = `## The other seats\n\n${peerBlocks(run, index)}`
  const reply = `## Your reply\n\n${isContrarian ? CONTRARIAN_REPLY : PANELIST_REPLY(run.briefText !== undefined)}`

  if (isContinued) {
    const mine = isContrarian
      ? 'Your latest objections, earlier in this conversation, stand until you withdraw them here.'
      : 'Your latest full answer, earlier in this conversation, is your position until you change it here.'

    return `Panel discussion, round ${run.round} of ${run.rounds}. ${who} Every seat answered the question you were given without seeing the others. In this round each seat reads the others' latest answers and replies. ${mine}\n\n${others}\n\n${reply}`
  }

  const mine = isContrarian
    ? 'You have no memory of the earlier rounds: your latest objections are below, and they stand until you withdraw them here.'
    : 'You have no memory of the earlier rounds: your latest answer is below, and it is your position until you change it here.'
  const brief = run.briefText === undefined ? '' : `\nThe seats work from this brief:\n${run.briefText}\n`

  return `Panel discussion, round ${run.round} of ${run.rounds}. ${who} In round 1 every seat answered the question below without seeing the others. In this round each seat reads the others' latest answers and replies. ${mine}

Question:
${run.question}
${brief}
## Your answer so far (seat ${index + 1}, round ${own?.round ?? 1})

${own?.text ?? '(none)'}

${others}

${reply}`
}

export function answers(run: Pick<Run, 'seats'>): string {
  return run.seats.map((seat, i) => `## Seat ${i + 1}: ${seat.label}${seat.role === 'contrarian' ? '' : ` (${seat.role})`}\n\n${seat.answer ?? '(no answer)'}`).join('\n\n')
}

const DID: Record<RoundState, string> = { answered: 'replied', unchanged: 'no change', failed: 'failed', interrupted: 'interrupted', absent: 'not asked' }

function roundSection(run: Pick<Run, 'seats'>, entries: readonly RoundEntry[], round: number, max: number): string {
  const blocks = entries.map((entry, i) => {
    const label = run.seats[i]?.label ?? ''
    if (entry.state === 'answered') return `### Seat ${i + 1}: ${label}\n\n${clipAnswer(entry.text, max)}`
    if (entry.state === 'absent') return ''
    if (entry.state === 'unchanged') return `Seat ${i + 1}: no change.${entry.text.trim().includes('\n') ? `\n${entry.text.trim()}` : ''}`

    return `Seat ${i + 1}: ${entry.state}. ${entry.text}`.trim()
  })

  return `## Round ${round}: ${round === 1 ? 'independent answers' : 'replies'}\n\n${blocks.filter(Boolean).join('\n\n')}`
}

const FIGURES_FIELD = 'figures: optional illustrations, each an inline SVG with a caption, drawn to the rules under Figures below'

const houseRules = (guide: Guide | undefined) => [guide?.writing ?? '', guide?.illustrations ? `Figures:\n${guide.illustrations}` : ''].filter(Boolean).map(rule => `\n\n${rule}`).join('')

function verdictAsk(run: Pick<Run, 'id' | 'rounds'>, guide?: Guide): string {
  const isDiscussion = run.rounds > 1
  const fields = [
    'headline: the bottom line in one or two sentences',
    `conclusions: the supported conclusions${isDiscussion ? ', each with basis "independent" (held in round 1, before the seats read each other) or "discussion" (reached after)' : ''}`,
    isDiscussion ? 'changes: which seat moved, from what to what, on whose argument, and whether the evidence holds' : '',
    'rejected: the rejected claims',
    `disagreements: real disagreement${isDiscussion ? ' that survived the discussion' : ''}, each side's best evidence, and what would settle it`,
    'uncertainty: residual uncertainty',
    `blindSpots: what no seat examined${isDiscussion ? ' in any round' : ''}`,
    isDiscussion ? 'ending: how the discussion ended, and any seat that failed or dropped out and in which round' : '',
    'checks: a short note on any single answer whose claim you verified or refuted, by round and seat',
    guide?.illustrations ? FIGURES_FIELD : '',
  ]

  return `Then record your synthesis with the mcp__agent-panel__verdict tool, runId "${run.id}". It goes on the discussion page, which is where I will read it, so write every field as plain sentences that make sense without the transcript:
${fields.filter(Boolean).map(line => `- ${line}`).join('\n')}${houseRules(guide)}

After the tool call, give me only the headline, the supported conclusions in one line each, and the link the tool returns. If the tool is not available, give me the whole synthesis here instead.`
}

export function planAsk(run: Pick<Run, 'id'>, guide?: Guide): string {
  const fields = [
    'headline: what the plan does and whether it is ready to act on, in one or two sentences',
    'conclusions: the plan in brief, its main steps in one line each',
    'changes: what each challenge round changed in the plan, with rounds set to e.g. "Round 1"',
    'rejected: the corrections the integrator rejected, and any you think it should have taken',
    "disagreements: material disagreements between the agents that remain, each side's best evidence, and what would settle it",
    'uncertainty: the decisions still open, each as a question I can answer',
    'blindSpots: what neither agent examined',
    'ending: how the rounds ended and how many completed',
    'checks: a short note on any challenge or revision whose claim you verified or refuted, by round, with seat 1 for the challenger and seat 2 for the integrator',
    'plan: the full corrected plan, only if your checks changed the final plan; leave it out otherwise',
    guide?.illustrations ? FIGURES_FIELD : '',
  ]

  return `Check the final plan against the code or files it cites. Then record your read of it with the mcp__agent-panel__verdict tool, runId "${run.id}". It goes on the plan page, which already shows the final plan with every draft, challenge and revision, and which is where I will read it. Do not repeat the plan; write every field as plain sentences that make sense on their own:
${fields.filter(Boolean).map(line => `- ${line}`).join('\n')}${houseRules(guide)}

After the tool call, give me only the headline, the plan in brief, the decisions still open, and the link the tool returns. If the tool is not available, present the whole plan here instead.`
}

export function panelSynthesis(run: Run, guide?: Guide): string {
  if (run.rounds <= 1) {
    return `Panel ${run.id} is complete. Every seat answered the same question independently.

Question:
${run.question}

${answers(run)}

Check the claims against the code or files they cite. ${
      run.page === undefined
        ? `Then give me a synthesis, not a transcript: supported conclusions, rejected claims, real disagreement, residual uncertainty, blind spots (what no seat examined), and the seats used:
${seatList(run.seats)}`
        : verdictAsk(run, guide)
    }`
  }

  const transcript = run.transcript ?? []
  const max = Math.min(PEER_ANSWER_MAX, Math.floor(SYNTHESIS_BUDGET / Math.max(1, run.seats.length * transcript.length)))
  const isCut = transcript.some(entries => entries.some(entry => entry.state === 'answered' && entry.text.length > max))
  const whole = run.dir !== undefined ? `in ${run.dir}` : 'not saved'
  const didIn = (entry: RoundEntry | undefined, round: number) => {
    if (entry?.state !== 'answered') return DID[entry?.state ?? 'absent']
    if (round === 0) return 'answered'

    return entry.isMoved === undefined ? 'replied' : entry.isMoved ? 'moved' : 'held'
  }
  const did = run.seats.map((seat, i) => `Seat ${i + 1} ${seat.label}: ${transcript.map((entries, r) => didIn(entries[i], r)).join(', ')}`)

  return `Panel ${run.id} is complete: ${transcript.length} round(s) across ${run.seats.length} seats. ${run.outcome ?? ''}

Round 1 answers were written independently. In each later round every seat read the others' latest answers and replied. NO CHANGE means the seat kept its previous answer; moved and held are read from the first section of a reply, so check them.${isCut ? ` Answers cut for size are whole ${whole}.` : ''}

Question:
${run.question}

## What each seat did

${did.join('\n')}

${transcript.map((entries, r) => roundSection(run, entries, r + 1, max)).join('\n\n')}

Check the claims against the code or files they cite, and check the evidence behind every change of position. A seat that moved without evidence it checked conformed, and its new position adds no support. Agreement the seats reached independently in round 1 counts for more than agreement that appeared after they read each other. The contrarian seat argues against the consensus by role: weigh its objections by their evidence, not as a vote.

${
    run.page === undefined
      ? `Then give me a synthesis, not a transcript:
- supported conclusions, each marked as held independently in round 1 or reached in discussion
- position changes: which seat moved, from what to what, on whose argument, and whether the evidence holds
- rejected claims
- real disagreement that survived the discussion, with each side's best evidence and what would settle it
- residual uncertainty
- blind spots (what no seat examined in any round)
- how the discussion ended, and any seat that failed or dropped out and in which round
- the seats used:
${seatList(run.seats)}`
      : verdictAsk(run, guide)
  }`
}

export function costLine(seatCount: number, rounds: number): string {
  const replies = rounds === 2 ? 'Round 2 is a reply round' : `Rounds 2 to ${rounds} are reply rounds`

  return `${seatCount} seats × ${rounds} rounds = up to ${seatCount * rounds} agent runs. ${replies}: each seat reads the other answers and replies. A round in which no seat changes anything may end the discussion early; /panel-stop ends it after the current round.`
}
