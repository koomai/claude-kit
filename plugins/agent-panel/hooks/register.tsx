import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Phase, Run, RunKind, SaveMode, Seat } from '../types'
import {
  EFFORTS,
  FALLBACK_PRESETS,
  GIT_COMMANDS,
  MAX_ROUNDS,
  MODELS,
  SAVE_MODES,
  SEAT_SYSTEM_PROMPT,
  SOLO_BRIEF_PREFIX,
  agentTypeName,
  artifactOf,
  challengeBrief,
  draftBrief,
  gitRefusal,
  integrateBrief,
  isPass,
  isSaveMode,
  panelBrief,
  parseArgs,
  roundsError,
  seatList,
  slugify,
  soloBriefName,
} from './seats'

type $ = EngineInterface

const PLUGIN = 'agent-panel'
const PANE = 'agent-panel'
const GIT_TOOL = 'mcp__agent-panel__git'
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', GIT_TOOL]
const GIT_OUTPUT_LIMIT = 60000
const DEFAULT_RUNS_DIR = '~/.claude/agent-panel/runs'

type Config = { save: SaveMode; soloBriefs: boolean; runsDir: string }
type BriefEntry = { name: string; source: string; summary: string }
type BriefFolder = { path: string; source: string }

function readConfig(options: PluginOptions): Config {
  const save = String(options.save ?? '')

  return {
    save: isSaveMode(save) ? save : 'files',
    soloBriefs: options.soloBriefs === true,
    runsDir: typeof options.runsDir === 'string' && options.runsDir !== '' ? options.runsDir : DEFAULT_RUNS_DIR,
  }
}

const runs = atom({ plugin: 'agent-panel', key: 'runs' } as const, [] as Run[])

const HELP_ARGS = ['', 'help', '--help']

const SEAT_OPTIONS = `  model        ${Object.keys(MODELS).join(', ')}
  effort       ${EFFORTS.join(', ')}
  +skill       preloads a skill into the seat, by the name /skills shows; repeat for more`

function presetLines(presets: Record<string, string[]>, seatCount?: number): string {
  return Object.entries(presets)
    .filter(([, seats]) => seatCount === undefined || seats.length === seatCount)
    .map(([name, seats]) => `  ${name.padEnd(12)} ${seats.join(' ')}`)
    .join('\n')
}

function briefLines(briefs: BriefEntry[]): string {
  if (briefs.length === 0) return '  (none found)'

  return briefs.map(brief => `  ${brief.name.padEnd(12)} ${brief.source.padEnd(9)} ${brief.summary.slice(0, 70)}`).join('\n')
}

const SAVE_OPTION = `  save=mode    ${SAVE_MODES.join(', ')}: where the answers are kept for this run, over the "Save answers" setting`

function panelUsage(presets: Record<string, string[]>, briefs: BriefEntry[]): string {
  return `Usage: /panel [seats or preset] [brief=name] [save=mode] -- <question>

Seats, space separated: model:effort[:contrarian][+skill]
${SEAT_OPTIONS}
  :contrarian  the seat attacks the obvious answer instead of answering
  brief=name   every seat reviews what you name through that brief
${SAVE_OPTION}

Presets (no seats: "quick")
${presetLines(presets)}

Briefs
${briefLines(briefs)}
  Add your own as .claude/agent-panel/briefs/<name>.md in the project or under your home folder,
  or as a Solo prompt template named ${SOLO_BRIEF_PREFIX}<name> with the "Solo briefs" setting on.

Examples
  /panel -- Is the retry in the queue worker safe?
  /panel deep -- Should we split this table before or after the migration?
  /panel opus:xhigh sonnet:high opus:high:contrarian -- Should we split this table?
  /panel sonnet:high+laravel-php-standards opus:high -- Is OrderService idiomatic?
  /panel review brief=bughunt -- the retry changes on this branch

/panel-view opens the pane. /pingpong help covers plan ping-pong. Settings are under /config.`
}

function pingpongUsage(presets: Record<string, string[]>): string {
  return `Usage: /pingpong [two seats or preset] [rounds=N] [save=mode] -- <task>

Two seats, space separated: model:effort[+skill]. The first challenges, the second integrates.
${SEAT_OPTIONS}
  rounds=N     challenge rounds, 1 to ${MAX_ROUNDS} (no rounds: 1); a challenger with nothing material to raise ends them early
${SAVE_OPTION}

Two-seat presets (no seats: "duo")
${presetLines(presets, 2)}

Examples
  /pingpong -- Plan the billing migration
  /pingpong opus:xhigh sonnet:high rounds=2 -- Plan the billing migration

/panel-view opens the pane. /panel help covers question panels. Settings are under /config.`
}

const registeredTypes = new Set<string>()

async function loadPresets($: $): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await $.fs.read(`${$.plugin.root}/presets.json`))
  } catch {
    return FALLBACK_PRESETS
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function solo($: $, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await $.mcp.call('solo', tool, args)
  const text = result.content.map(block => block.text ?? '').join('')
  if (result.isError) throw new Error(text || `Solo ${tool} failed`)

  return JSON.parse(text)
}

async function briefFolders($: $): Promise<BriefFolder[]> {
  const home = await $.env.get('HOME').catch(() => undefined)

  return [
    { path: '.claude/agent-panel/briefs', source: 'project' },
    ...(home === undefined ? [] : [{ path: `${home}/.claude/agent-panel/briefs`, source: 'user' }]),
  ]
}

async function readBriefFile($: $, folder: string, name: string): Promise<string | undefined> {
  try {
    return (await $.fs.read(`${folder}/${name}.md`)).trim() || undefined
  } catch {
    return undefined
  }
}

async function folderBriefs($: $, folder: BriefFolder): Promise<BriefEntry[]> {
  const entries = await $.fs.list(folder.path).catch(() => [])
  const names = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md')).map(entry => entry.name.slice(0, -3))

  return Promise.all(
    names.map(async name => ({
      name,
      source: folder.source,
      summary: ((await readBriefFile($, folder.path, name)) ?? '').split('\n', 1)[0] ?? '',
    })),
  )
}

async function soloBriefs($: $): Promise<(BriefEntry & { id: number })[]> {
  const templates = (await solo($, 'list_prompt_templates', { query: SOLO_BRIEF_PREFIX })) as { id: number; name: string; description?: string }[]

  return templates.flatMap(template => {
    const name = soloBriefName(template.name)

    return name === undefined ? [] : [{ id: template.id, name, source: 'solo', summary: template.description ?? '' }]
  })
}

async function loadSoloBrief($: $, name: string): Promise<string | undefined> {
  try {
    const match = (await soloBriefs($)).find(brief => brief.name === name)
    if (!match) return undefined
    const template = (await solo($, 'get_prompt_template', { template_id: match.id })) as { body?: string }

    return template.body?.trim() || undefined
  } catch {
    return undefined
  }
}

async function loadBrief($: $, name: string, config: Config): Promise<string | undefined> {
  for (const folder of await briefFolders($)) {
    const text = await readBriefFile($, folder.path, name)
    if (text !== undefined) return text
  }
  const fromSolo = config.soloBriefs ? await loadSoloBrief($, name) : undefined

  return fromSolo ?? readBriefFile($, `${$.plugin.root}/briefs`, name)
}

async function listBriefs($: $, config: Config): Promise<BriefEntry[]> {
  const own = await Promise.all((await briefFolders($)).map(folder => folderBriefs($, folder)))
  const fromSolo = config.soloBriefs ? await soloBriefs($).catch(() => []) : []
  const builtIn = await folderBriefs($, { path: `${$.plugin.root}/briefs`, source: 'built-in' })
  const seen = new Set<string>()

  return [...own.flat(), ...fromSolo, ...builtIn].filter(brief => !seen.has(brief.name) && seen.add(brief.name))
}

async function openRecord($: $, run: Run, save: SaveMode, config: Config): Promise<Partial<Run>> {
  const kind = run.kind === 'panel' ? 'Panel' : 'Ping-pong'
  const brief = run.brief === undefined ? '' : `, brief "${run.brief}"`
  const header = `${kind} ${run.id}${brief}\n\n${seatList(run.seats)}\n\n## ${run.kind === 'panel' ? 'Question' : 'Task'}\n\n${run.question}\n`
  const record: Partial<Run> = {}
  const notes: string[] = []

  if (save === 'files' || save === 'both') {
    try {
      const home = await $.env.get('HOME')
      const root = config.runsDir.startsWith('~') && home !== undefined ? `${home}${config.runsDir.slice(1)}` : config.runsDir
      const project = (await $.session.root()).split(/[\\/]/).filter(Boolean).pop() ?? 'project'
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      const dir = `${root}/${slugify(project)}/${day}-${run.id}-${slugify(run.question)}`
      await $.fs.write(`${dir}/question.md`, header)
      record.dir = dir
    } catch (error) {
      notes.push(`The answers are not being saved to files: ${reason(error)}`)
    }
  }

  if (save === 'solo' || save === 'both') {
    try {
      const name = `${kind} ${run.id}: ${run.question.replace(/\s+/g, ' ').slice(0, 60)}`
      const created = (await solo($, 'scratchpad_write', { name, content: header, tags: [PLUGIN, run.kind] })) as { scratchpad_id: number; revision: number }
      const numbered = `${created.scratchpad_id}. ${name}`
      const isRenamed = await solo($, 'scratchpad_rename', { scratchpad_id: created.scratchpad_id, name: numbered, expected_revision: created.revision }).then(
        () => true,
        () => false,
      )
      record.scratchpadId = created.scratchpad_id
      record.scratchpadTitle = isRenamed ? numbered : name
    } catch (error) {
      notes.push(`The answers are not being saved to a Solo scratchpad: ${reason(error)}`)
    }
  }

  if (notes.length > 0) record.saveNote = notes.join('\n')

  return record
}

async function saveArtifact($: $, run: Run, file: string, title: string, text: string): Promise<void> {
  const failures: string[] = []
  if (run.dir !== undefined) {
    await $.fs.write(`${run.dir}/${file}.md`, `# ${title}\n\n${text}\n`).catch(error => failures.push(`"${title}" was not written to a file: ${reason(error)}`))
  }
  if (run.scratchpadId !== undefined) {
    await solo($, 'scratchpad_append', { scratchpad_id: run.scratchpadId, content: `\n## ${title}\n\n${text}\n` }).catch(error =>
      failures.push(`"${title}" was not added to the Solo scratchpad: ${reason(error)}`),
    )
  }
  if (failures.length === 0) return

  await patchRun($, run.id, current => ({ ...current, saveNote: [current.saveNote, ...failures].filter(Boolean).join('\n') }))
}

function savedLines(run: Run): string[] {
  return [
    run.dir === undefined ? '' : `The answers are saved in ${run.dir}`,
    run.scratchpadTitle === undefined ? '' : `The answers are saved in the Solo scratchpad "${run.scratchpadTitle}"`,
    run.saveNote ?? '',
  ].filter(Boolean)
}

async function ensureAgentType($: $, seat: Seat): Promise<string> {
  const name = agentTypeName(seat)
  if (!registeredTypes.has(name)) {
    await $.agent.register({
      name,
      description: `Read-only panel seat on ${seat.model} at ${seat.effort} effort`,
      prompt: SEAT_SYSTEM_PROMPT,
      model: MODELS[seat.model],
      effort: seat.effort,
      tools: READ_ONLY_TOOLS,
      ...(seat.skills.length > 0 ? { skills: seat.skills } : {}),
    })
    registeredTypes.add(name)
  }

  return `${PLUGIN}:${name}`
}

async function patchRun($: $, id: string, fn: (run: Run) => Run): Promise<Run | undefined> {
  await update($, runs, list => list.map(run => (run.id === id ? fn(run) : run)))

  return (await read($, runs)).find(run => run.id === id)
}

async function patchSeat($: $, id: string, index: number, patch: Partial<Seat>): Promise<Run | undefined> {
  return patchRun($, id, run => ({
    ...run,
    seats: run.seats.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)),
  }))
}

async function claimStep($: $, id: string, from: Phase, to: Phase, isReady: (run: Run) => boolean): Promise<Run | undefined> {
  const token = crypto.randomUUID()
  const run = await patchRun($, id, current =>
    current.phase === from && isReady(current) ? { ...current, phase: to, claim: token } : current,
  )

  return run?.claim === token ? run : undefined
}

async function spawnSeat($: $, run: Run, index: number, prompt: string): Promise<void> {
  const seat = run.seats[index]
  if (!seat) return
  try {
    const subagentType = await ensureAgentType($, seat)
    const spawned = await $.agent.spawn({ subagentType, prompt, description: `${run.kind} ${run.id}: ${seat.label}` })
    if (spawned.deny !== undefined || spawned.agentId === undefined) {
      await failSeat($, run.id, index, spawned.deny ?? 'the subagent did not start')
      return
    }
    await patchSeat($, run.id, index, { agentId: spawned.agentId, status: 'working' })
  } catch (error) {
    await failSeat($, run.id, index, error instanceof Error ? error.message : String(error))
  }
}

async function failSeat($: $, id: string, index: number, reason: string): Promise<void> {
  const run = await patchSeat($, id, index, { status: 'failed', answer: `(failed: ${reason})` })
  if (run) await advance($, run)
}

type Launch = { seats: Seat[]; question: string; rounds: number; save: SaveMode; brief?: { name: string; text: string } }

async function startRun($: $, kind: RunKind, launch: Launch, config: Config): Promise<Run> {
  const { seats, question, rounds, brief } = launch
  const opened: Run = {
    id: crypto.randomUUID().slice(0, 6),
    kind,
    question,
    seats,
    phase: 'drafting',
    round: 0,
    rounds,
    challenges: [],
    ...(brief === undefined ? {} : { brief: brief.name }),
  }
  const run = { ...opened, ...(await openRecord($, opened, launch.save, config)) }
  await update($, runs, list => [...list, run].slice(-10))
  void $.ui.open({ id: PANE, title: 'Agent panel' })

  await Promise.all(
    seats.map((seat, index) =>
      spawnSeat($, run, index, kind === 'panel' ? panelBrief(question, seat.role, brief?.text) : draftBrief(question)),
    ),
  )
  $.ui.status(`${kind} ${run.id}: ${seats.length} agents working`)

  return (await read($, runs)).find(one => one.id === run.id) ?? run
}

function isSettled(seat: Seat): boolean {
  return seat.status === 'done' || seat.status === 'failed'
}

const answers = (run: Run) =>
  run.seats.map((seat, i) => `## Seat ${i + 1}: ${seat.label}${seat.role === 'contrarian' ? '' : ` (${seat.role})`}\n\n${seat.answer ?? '(no answer)'}`).join('\n\n')

async function finish($: $, run: Run, phase: Phase, text: string): Promise<void> {
  const saved = savedLines((await patchRun($, run.id, current => ({ ...current, phase }))) ?? run)
  $.ui.status(undefined)
  $.ui.toast(`${run.kind} ${run.id} ${phase === 'failed' ? 'failed' : 'finished'}`)
  const isReported = await submit($, saved.length === 0 ? text : `${text}\n\nEnd by telling me this:\n${saved.join('\n')}`)
  await patchRun($, run.id, current => ({ ...current, isReported }))
}

async function submit($: $, text: string): Promise<boolean> {
  try {
    await $.prompt.submit({ text })
    return true
  } catch {
    // A submit from the command or tool call that started the run is refused; that caller reports the failure itself.
    return false
  }
}

function finalPlan(run: Run, outcome: string, author: string): string {
  const log = run.challenges.map((challenge, i) => `### Round ${i + 1} challenge (${run.seats[0]?.label})\n\n${challenge}`).join('\n\n')

  return `Ping-pong ${run.id} ${outcome}

Task:
${run.question}

## Final plan (${author})

${run.candidate}

## Challenges

${log}

Present one coherent plan to me with the material disagreements, the decisions still open, the number of completed rounds, and the seats used:
${seatList(run.seats)}`
}

async function advance($: $, run: Run): Promise<void> {
  if (run.phase === 'drafting') {
    const claimed = await claimStep($, run.id, 'drafting', 'merging', current => current.seats.every(isSettled))
    if (!claimed) return

    if (claimed.kind === 'panel') {
      await finish($, claimed, 'done', `Panel ${claimed.id} is complete. Every seat answered the same question independently.

Question:
${claimed.question}

${answers(claimed)}

Check the claims against the code. Then give me a synthesis, not a transcript: supported conclusions, rejected claims, real disagreement, residual uncertainty, blind spots (what no seat examined), and the seats used:
${seatList(claimed.seats)}`)
      return
    }

    if (claimed.seats.some(seat => seat.status === 'failed')) {
      await finish($, claimed, 'failed', `Ping-pong ${claimed.id} stopped: a planner failed.\n\n${answers(claimed)}\n\nTell me what failed and stop.`)
      return
    }

    await submit($, `Ping-pong ${claimed.id}: both independent drafts are in.

Task:
${claimed.question}

${answers(claimed)}

Compare both drafts against the code and settle factual disagreements by inspection, not by vote. Merge them into one candidate plan. Then call the tool mcp__${PLUGIN}__pingpong_merge with runId "${claimed.id}" and the full candidate plan. Do not present the plan to me yet: ${claimed.rounds} challenge round(s) follow.`)
    return
  }

  const [challenger, integrator] = run.seats
  if (!challenger || !integrator) return

  if (run.phase === 'challenging') {
    const seat = challenger
    if (!isSettled(seat)) return
    if (seat.status === 'failed') {
      await finish($, run, 'failed', `Ping-pong ${run.id} stopped in round ${run.round}: the challenger failed. ${seat.answer}\n\nLast candidate plan:\n\n${run.candidate}\n\nShow me this candidate and say the rounds did not complete.`)
      return
    }
    if (isPass(seat.answer ?? '')) {
      const claimed = await claimStep($, run.id, 'challenging', 'done', () => true)
      if (!claimed) return
      const passed = await patchRun($, run.id, current => ({ ...current, challenges: [...current.challenges, seat.answer ?? ''] }))
      if (!passed) return
      const author = run.round === 1 ? 'your merge, unchanged' : `last integrated by ${integrator.label}`
      await finish($, passed, 'done', finalPlan(passed, `stopped early in round ${run.round} of ${run.rounds}: the challenger found nothing material, after ${run.round - 1} integrated round(s).`, author))
      return
    }
    const claimed = await claimStep($, run.id, 'challenging', 'integrating', () => true)
    if (!claimed) return
    const withChallenge = await patchRun($, run.id, current => ({ ...current, challenges: [...current.challenges, seat.answer ?? ''] }))
    if (withChallenge) {
      await spawnSeat($, withChallenge, 1, integrateBrief(withChallenge.candidate ?? '', seat.answer ?? '', run.round, run.rounds))
    }
    return
  }

  if (run.phase === 'integrating') {
    const seat = integrator
    if (!isSettled(seat)) return
    if (seat.status === 'failed') {
      await finish($, run, 'failed', `Ping-pong ${run.id} stopped in round ${run.round}: the integrator failed. ${seat.answer}\n\nLast candidate plan:\n\n${run.candidate}\n\nShow me this candidate and say round ${run.round} did not complete.`)
      return
    }
    const isLastRound = run.round >= run.rounds
    const claimed = await claimStep($, run.id, 'integrating', isLastRound ? 'done' : 'challenging', () => true)
    if (!claimed) return
    const next = await patchRun($, run.id, current => ({
      ...current,
      candidate: seat.answer,
      round: isLastRound ? current.round : current.round + 1,
    }))
    if (!next) return

    if (isLastRound) {
      await finish($, next, 'done', finalPlan(next, `completed ${next.round} of ${next.rounds} round(s).`, `last integrated by ${integrator.label}`))
      return
    }

    await spawnSeat($, next, 0, challengeBrief(next.candidate ?? '', next.round, next.rounds))
  }
}

function seatName(run: Run, index: number): string {
  const seat = run.seats[index]
  if (!seat) return ''
  if (run.kind === 'panel') return seat.label

  return `${index === 0 ? 'A' : 'B'} ${seat.label}`
}

function describePhase(run: Run): string {
  const where = run.isReported === false ? 'Its message could not be posted to the chat.' : 'Its message was posted to the chat.'
  switch (run.phase) {
    case 'drafting':
      return run.kind === 'panel' ? 'Agents are answering.' : 'A and B are each drafting a plan.'
    case 'merging':
      return 'Drafts are in. Claude is merging them into one plan.'
    case 'challenging':
      return `Round ${run.round} of ${run.rounds}: A is looking for problems in the plan.`
    case 'integrating':
      return `Round ${run.round} of ${run.rounds}: B is revising the plan.`
    case 'done':
      return `Finished. ${where}`
    case 'failed':
      return `Stopped. ${where}`
  }
}

function prepare(kind: RunKind, args: string, presets: Record<string, string[]>, rounds?: number) {
  const parsed = parseArgs(args, presets)
  const seats = parsed.seats.length > 0 ? parsed.seats : parseArgs(kind === 'panel' ? 'quick' : 'duo', presets).seats
  const errors = [...parsed.errors]
  if (kind === 'pingpong' && seats.length !== 2) errors.push(`Ping-pong takes exactly two seats; got ${seats.length}.`)
  if (parsed.question.length === 0) errors.push(kind === 'panel' ? 'No question given.' : 'No task given.')
  if (kind === 'pingpong' && parsed.brief !== undefined) errors.push('brief= applies to /panel only.')
  const roundsProblem = rounds === undefined ? undefined : roundsError(rounds)
  if (roundsProblem) errors.push(roundsProblem)

  return {
    seats,
    question: parsed.question,
    rounds: rounds ?? parsed.rounds ?? 1,
    brief: parsed.brief,
    save: parsed.save,
    errors,
  }
}

async function usage($: $, kind: RunKind, config: Config): Promise<string> {
  const presets = await loadPresets($)

  return kind === 'panel' ? panelUsage(presets, await listBriefs($, config)) : pingpongUsage(presets)
}

async function launch($: $, kind: RunKind, args: string, config: Config, rounds?: number): Promise<{ errors: string[] } | { started: string }> {
  const prepared = prepare(kind, args, await loadPresets($), rounds)
  if (prepared.errors.length > 0) return { errors: prepared.errors }

  const text = prepared.brief === undefined ? undefined : await loadBrief($, prepared.brief, config)
  if (prepared.brief !== undefined && text === undefined) {
    const known = (await listBriefs($, config)).map(brief => brief.name).join(', ')

    return { errors: [`No brief named "${prepared.brief}". Known briefs: ${known || 'none'}.`] }
  }

  const run = await startRun($, kind, {
    seats: prepared.seats,
    question: prepared.question,
    rounds: kind === 'panel' ? 1 : prepared.rounds,
    save: prepared.save ?? config.save,
    ...(prepared.brief !== undefined && text !== undefined ? { brief: { name: prepared.brief, text } } : {}),
  }, config)

  return { started: describeStart(run) }
}

function describeStart(run: Run): string {
  const rounds = run.kind === 'pingpong' ? `, ${run.rounds} round(s)` : ''
  const failed = run.seats.filter(seat => seat.status === 'failed').map(seat => `${seat.label} did not start: ${seat.answer}`)
  const brief = run.brief === undefined ? '' : `, brief "${run.brief}"`

  return [`${run.kind === 'panel' ? 'Panel' : 'Ping-pong'} ${run.id} started${rounds}${brief}:`, seatList(run.seats), ...failed, ...savedLines(run), 'Results arrive as a new message when the agents finish.'].join('\n')
}

export const register: Register = (on, options) => {
  const config = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panel', description: 'Ask a panel of Claude agents (model:effort each) one question', argumentHint: '[seats|preset] -- <question> | help' })
    await $.command.register({ name: 'panel-view', description: 'Open the agent panel pane' })
    await $.command.register({ name: 'pingpong', description: 'Ping-pong plan with two Claude agents (model:effort each)', argumentHint: '[seats|preset] [rounds=N] -- <task> | help' })

    const seatSchema = { type: 'array', items: { type: 'string' }, description: 'Seats as model:effort[:contrarian][+skill], e.g. "opus:xhigh". Models: opus, sonnet, haiku, fable. Efforts: low, medium, high, xhigh, max.' }
    await $.tool.register({
      name: 'panel',
      description: 'Ask several read-only Claude subagents the same question independently, each at its own model and effort. Use when the user asks for an agent panel or several opinions. Write a self-contained question with the facts they need. Returns at once; the answers arrive later as a new message for you to synthesise.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, seats: seatSchema, preset: { type: 'string', description: 'A preset name from presets.json instead of seats' }, brief: { type: 'string', description: 'A review brief by name that every seat applies to the question, e.g. "bughunt", "security", "regression", "contracts"; the question then names what to review' } }, required: ['question'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'pingpong',
      description: 'Ping-pong planning: two read-only Claude subagents each draft a plan, you merge them, then each round the first challenges the plan and the second integrates the supported corrections. Use when the user asks for ping-pong planning. Write a self-contained task brief. Returns at once; the drafts arrive later as a new message.',
      inputSchema: { type: 'object', properties: { task: { type: 'string' }, seats: { ...seatSchema, minItems: 2, maxItems: 2 }, preset: { type: 'string' }, rounds: { type: 'number', minimum: 1, maximum: MAX_ROUNDS } }, required: ['task'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'pingpong_merge',
      description: 'Hand the merged candidate plan of a ping-pong run back to its agents to start the challenge rounds.',
      inputSchema: { type: 'object', properties: { runId: { type: 'string' }, plan: { type: 'string' } }, required: ['runId', 'plan'] },
      isDeferred: false,
    })

    await $.tool.register({
      name: 'git',
      description: 'Read-only git for agent-panel seats: status, diff, log, show or blame with its arguments as a list. No shell.',
      inputSchema: { type: 'object', properties: { command: { type: 'string', enum: [...GIT_COMMANDS] }, args: { type: 'array', items: { type: 'string' } } }, required: ['command'] },
    })

    await Promise.all(
      Object.keys(MODELS).flatMap(model =>
        EFFORTS.map(effort => ensureAgentType($, { label: '', model, effort, role: 'panelist', skills: [], status: 'starting' })),
      ),
    )

    return next(e)
  })

  on('agent.offer', ($, e, next) => (e.agent.startsWith(`${PLUGIN}:`) ? { isOffered: false } : next(e)))

  on('command.run', { command: 'panel' }, async ($, e) => {
    if (HELP_ARGS.includes(e.args.trim().toLowerCase())) return { text: await usage($, 'panel', config) }
    const launched = await launch($, 'panel', e.args, config)

    return { text: 'started' in launched ? launched.started : `${launched.errors.join('\n')}\n\n${await usage($, 'panel', config)}` }
  })

  on('command.run', { command: 'pingpong' }, async ($, e) => {
    if (HELP_ARGS.includes(e.args.trim().toLowerCase())) return { text: await usage($, 'pingpong', config) }
    const launched = await launch($, 'pingpong', e.args, config)

    return { text: 'started' in launched ? launched.started : `${launched.errors.join('\n')}\n\n${await usage($, 'pingpong', config)}` }
  })

  on('tool.call', { tool: 'mcp__agent-panel__panel' }, async ($, e) => {
    const input = e as unknown as { question: string; seats?: string[]; preset?: string; brief?: string }
    const brief = input.brief === undefined ? '' : `brief=${input.brief}`
    const launched = await launch($, 'panel', `${input.preset ?? ''} ${(input.seats ?? []).join(' ')} ${brief} -- ${input.question}`, config)

    return 'started' in launched ? { result: launched.started } : { deny: launched.errors.join('\n') }
  })

  on('tool.call', { tool: 'mcp__agent-panel__pingpong' }, async ($, e) => {
    const input = e as unknown as { task: string; seats?: string[]; preset?: string; rounds?: number }
    const launched = await launch($, 'pingpong', `${input.preset ?? ''} ${(input.seats ?? []).join(' ')} -- ${input.task}`, config, input.rounds)

    return 'started' in launched ? { result: launched.started } : { deny: launched.errors.join('\n') }
  })

  on('tool.call', { tool: 'mcp__agent-panel__git' }, async ($, e) => {
    const input = e as unknown as { command: string; args?: string[] }
    const args = input.args ?? []
    const refusal = gitRefusal(input.command, args)
    if (refusal !== undefined) return { deny: refusal }

    const ran = await $.process.run(['git', '--no-pager', input.command, ...args])
    if (ran.exitCode !== 0) return { result: `git exited ${ran.exitCode}: ${ran.stderr.trim()}` }
    if (ran.stdout.length > GIT_OUTPUT_LIMIT) return { result: `${ran.stdout.slice(0, GIT_OUTPUT_LIMIT)}\n(cut at ${GIT_OUTPUT_LIMIT} characters; narrow the command)` }

    return { result: ran.stdout || '(no output)' }
  })

  on('tool.call', { tool: 'mcp__agent-panel__pingpong_merge' }, async ($, e) => {
    const input = e as unknown as { runId: string; plan: string }
    const run = (await read($, runs)).find(one => one.id === input.runId)
    if (!run || run.kind !== 'pingpong') return { deny: `No ping-pong run "${input.runId}".` }

    const claimed = await claimStep($, run.id, 'merging', 'challenging', () => true)
    if (!claimed) return { deny: `Ping-pong ${run.id} is ${run.phase}, not waiting for a merge.` }

    const started = await patchRun($, run.id, current => ({ ...current, candidate: input.plan, round: 1 }))
    if (started) {
      await saveArtifact($, started, 'candidate', 'Merged candidate plan', input.plan)
      await spawnSeat($, started, 0, challengeBrief(input.plan, 1, started.rounds))
    }
    const after = (await read($, runs)).find(one => one.id === run.id)
    if (after?.phase === 'failed') {
      await patchRun($, run.id, current => ({ ...current, isReported: true }))
      return { result: `Ping-pong ${run.id} stopped: ${run.seats[0]?.label} could not start. ${after.seats[0]?.answer ?? ''} Tell the user the rounds did not run.` }
    }
    $.ui.status(`pingpong ${run.id}: round 1 of ${run.rounds}`)

    return { result: `Candidate handed to ${run.seats[0]?.label} to challenge. ${run.rounds} round(s); the final plan arrives as a new message.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) return result

    const list = await read($, runs)
    for (const run of list) {
      const index = run.seats.findIndex(seat => seat.agentId === e.agentId && seat.status === 'working')
      if (index === -1) continue

      const isAnswered = e.reason === 'answer' && e.answer.trim() !== ''
      const updated = await patchSeat($, run.id, index, isAnswered
        ? { status: 'done', answer: e.answer }
        : { status: 'failed', answer: `(failed: ${e.reason === 'answer' ? 'empty answer' : e.reason})` })
      if (updated && isAnswered) {
        const artifact = artifactOf(run, index)
        await saveArtifact($, updated, artifact.file, artifact.title, e.answer)
      }
      if (updated) await advance($, updated)
    }

    return result
  })

  on('command.run', { command: 'panel-view' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent panel' })
    return { text: 'Agent panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, runs)
    const width = Math.max(20, (e.viewport?.columns ?? 60) - 4)
    const clip = (text: string) => (text.length > width ? `${text.slice(0, width - 1)}…` : text)

    if (list.length === 0) return <Text dimColor>No panels yet. Try /panel or /pingpong.</Text>

    return (
      <Box flexDirection="column">
        {[...list].reverse().slice(0, 4).map(run => (
          <Box flexDirection="column" marginBottom={1} key={run.id}>
            <Text bold>
              {run.kind} {run.id} · {run.kind === 'pingpong' && run.round > 0 ? `round ${run.round}/${run.rounds} · ` : ''}
              {run.phase}
            </Text>
            <Text dimColor>{clip(run.question.replace(/\s+/g, ' '))}</Text>
            <Text color={run.phase === 'failed' ? 'red' : undefined}>{describePhase(run)}</Text>
            {run.scratchpadTitle === undefined ? null : <Text dimColor>{clip(`saved: ${run.scratchpadTitle}`)}</Text>}
            {run.dir === undefined ? null : <Text dimColor>{clip(`saved: …/${run.dir.split('/').slice(-2).join('/')}`)}</Text>}
            {run.seats.map((seat, i) => (
              <Box flexDirection="column" key={`${run.id}-${i}`}>
                <Text dimColor={seat.status === 'done'} color={seat.status === 'failed' ? 'red' : undefined}>
                  {seat.status === 'working' ? '●' : seat.status === 'done' ? '✓' : seat.status === 'failed' ? '✗' : '○'} {seatName(run, i)} {seat.status}
                </Text>
                {seat.status === 'failed' ? <Text color="red">{`  ${clip(seat.answer ?? '')}`}</Text> : null}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
