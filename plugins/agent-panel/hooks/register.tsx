import type { Elements, EngineInterface, PluginOptions, Register } from 'claude-code'

import type { FolderSkill, Phase, PresetMap, PresetSource, RoundEntry, Run, RunKind, Seat } from '../types'
import {
  EFFORTS,
  FALLBACK_PRESETS,
  GIT_COMMANDS,
  MAX_ROUNDS,
  MODELS,
  SEAT_SYSTEM_PROMPT,
  agentTypeName,
  answers,
  artifactOf,
  challengeBrief,
  closeRound,
  collectedNote,
  costLine,
  draftBrief,
  excerptOf,
  gitHelperOptions,
  gitRefusal,
  ignoredSkillFeatures,
  integrateBrief,
  isFolderSkillName,
  isPass,
  nearestNames,
  panelBrief,
  panelSynthesis,
  parseArgs,
  planAsk,
  presetEntry,
  presetNameError,
  readPresetLayer,
  replyBrief,
  roundsError,
  seatList,
  seatSpec,
  skillSummary,
  slugify,
  splitSkill,
  toolArgs,
  withSkills,
} from './seats'
import type { ToolInput } from './seats'
import { ROUND_LEGEND, activityOf, clip, fitChips, flow, formatDuration, formatTokens, isLive, meter, pingpongSteps, roundCells, runBadge, runTime, seatChips, seatColor, seatTime, spinner, usageTokens } from './pane'
import type { Span, StepState, Tone } from './pane'
import { pageData, pageFor, pageHtml, planData, readVerdict } from './page'
import type { AnyPage, PageAssets } from './page'
import { designCss, hashOf, layerDesign, readDesign } from './design'
import type { Design, DesignLayer, Guide } from './design'
import { historyEntry, historyScript, savedRun, sortHistory, withEntry } from './history'
import type { History } from './history'
import { helpLines } from './help'
import type { HelpTone } from './help'


const PLUGIN = 'agent-panel'
const PANE = 'agent-panel'
const GIT_TOOL = 'mcp__agent-panel__git'
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', GIT_TOOL]
const GIT_OUTPUT_LIMIT = 60000
const DEFAULT_RUNS_DIR = '~/.claude/agent-panel/runs'
const PRESETS_PATH = '.claude/agent-panel/presets.json'
const DESIGN_PATH = '.claude/agent-panel/design.md'

type Config = { runsDir: string; skillDirs: string[] }
type BriefEntry = { name: string; source: string; summary: string }
type BriefFolder = { path: string; source: string }

function readConfig(options: PluginOptions): Config {
  return {
    runsDir: typeof options.runsDir === 'string' && options.runsDir !== '' ? options.runsDir : DEFAULT_RUNS_DIR,
    skillDirs: typeof options.skillDirs === 'string' ? options.skillDirs.split(',').map(dir => dir.trim()).filter(Boolean) : [],
  }
}

const RUNS = { plugin: 'agent-panel', key: 'runs' } as const

async function readRuns($: EngineInterface): Promise<Run[]> {
  const held = await $.state.get(RUNS)

  return held.value ?? []
}

async function findRun($: EngineInterface, id: string): Promise<Run | undefined> {
  const list = await readRuns($)

  return list.find(one => one.id === id)
}

async function changeRuns($: EngineInterface, change: (list: Run[]) => Run[]): Promise<Run[]> {
  for (;;) {
    const held = await $.state.get(RUNS)
    const next = change(held.value ?? [])
    const written = await $.state.set(RUNS, next, { ifVersion: held.version })
    if (written.isSet) return next
  }
}

const HELP_ARGS = ['', 'help', '--help']
const PRESET_INPUT = { type: 'string', description: 'The name of one preset in place of seats: deep, quick, duo, review, or one the user saved with /panel-preset' }

const SEAT_OPTIONS = `  model        ${Object.keys(MODELS).join(', ')}
  effort       ${EFFORTS.join(', ')}
  +skill       loads a skill into the seat: a folder under skills= or the "Default skill folders" setting, else a session skill by the name /skills shows; repeat for more`

function presetLines(presets: PresetMap, seatCount?: number): string {
  return Object.entries(presets)
    .filter(([, preset]) => seatCount === undefined || preset.seats.length === seatCount)
    .map(([name, preset]) => clip(`  ${name.padEnd(16)} ${preset.source.padEnd(9)} ${preset.description ?? preset.seats.join(' ')}`, 100))
    .join('\n')
}

function presetHelp(presets: PresetMap): string {
  const hasSaved = Object.values(presets).some(preset => preset.source !== 'built-in')

  return [
    ...(hasSaved ? [] : ['  You have no saved presets yet.']),
    '  See yours:  /panel-preset list, or /panel-preset show <name> for one',
    '  Save one:   /panel-preset save <name> <seats> [scope=project], or as=<name> on any run',
    '  Remove one: /panel-preset delete <name> [scope=project]',
    `  Presets save to ~/${PRESETS_PATH}, for you in every project; scope=project saves to ${PRESETS_PATH} in this project, to share through git.`,
  ].join('\n')
}

function noticeLines(notices: string[]): string {
  return notices.length === 0 ? '' : `\nPreset files\n${notices.map(notice => `  ${notice}`).join('\n')}\n`
}

function briefLines(briefs: BriefEntry[]): string {
  if (briefs.length === 0) return '  (none found)'

  return briefs.map(brief => `  ${brief.name.padEnd(12)} ${brief.source.padEnd(9)} ${brief.summary.slice(0, 70)}`).join('\n')
}

const RUN_OPTIONS = `  skills=dir   folders of <skill>/SKILL.md for this run's +skill names, comma separated
  as=name      also saves this run's seats and options as a preset of that name`

function panelUsage(loaded: Loaded, briefs: BriefEntry[]): string {
  return `Usage: /panel [seats or preset] [rounds=N] [brief=name] [skills=dir] [as=name] -- <question>

Seats, space separated: model:effort[:contrarian][+skill]
${SEAT_OPTIONS}
  :contrarian  the seat attacks the obvious answer instead of answering
  brief=name   every seat reviews what you name through that brief
  rounds=N     rounds, 1 to ${MAX_ROUNDS} (no rounds: 1); round 1 is independent, in each later round every seat
               reads the others and replies; 2 is usual; a round where no seat changes anything ends it
${RUN_OPTIONS}

Presets (no seats: "quick")
${presetLines(loaded.presets)}
${presetHelp(loaded.presets)}
${noticeLines(loaded.notices)}
Briefs
${briefLines(briefs)}
  Add your own as .claude/agent-panel/briefs/<name>.md in the project or under your home folder.

Examples
  /panel -- Is the retry in the queue worker safe?
  /panel deep -- Should we split this table before or after the migration?
  /panel opus:xhigh sonnet:high opus:high:contrarian -- Should we split this table?
  /panel sonnet:high+laravel-php-standards opus:high -- Is OrderService idiomatic?
  /panel review brief=bughunt -- the retry changes on this branch
  /panel deep rounds=2 -- Should we split this table before or after the migration?

/panel-stop ends a run after its current round. /panel-view opens the pane. /pingpong help covers plan ping-pong. Settings are under /config.`
}

function pingpongUsage(loaded: Loaded): string {
  return `Usage: /pingpong [two seats or preset] [rounds=N] [skills=dir] [as=name] -- <task>

Two seats, space separated: model:effort[+skill]. The first challenges, the second integrates.
${SEAT_OPTIONS}
  rounds=N     challenge rounds, 1 to ${MAX_ROUNDS} (no rounds: 1); a challenger with nothing material to raise ends them early
${RUN_OPTIONS}

Two-seat presets (no seats: "duo")
${presetLines(loaded.presets, 2)}
${presetHelp(loaded.presets)}
${noticeLines(loaded.notices)}
Examples
  /pingpong -- Plan the billing migration
  /pingpong opus:xhigh sonnet:high rounds=2 -- Plan the billing migration

/panel-view opens the pane. /panel help covers question panels. Settings are under /config.`
}

const registeredTypes = new Set<string>()

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Loaded = { presets: PresetMap; builtIn: PresetMap; notices: string[] }
type JsonFile = { state: 'missing' } | { state: 'corrupt'; reason: string } | { state: 'ok'; value: unknown }
type Scope = 'user' | 'project'

async function readJsonFile($: EngineInterface, path: string): Promise<JsonFile> {
  if (!(await $.fs.exists(path).catch(() => false))) return { state: 'missing' }
  try {
    return { state: 'ok', value: JSON.parse(await $.fs.read(path)) }
  } catch (error) {
    return { state: 'corrupt', reason: reason(error) }
  }
}

async function homeDir($: EngineInterface): Promise<string | undefined> {
  return $.env.get('HOME').catch(() => undefined)
}

function expandHome(path: string, home: string | undefined): string {
  return home !== undefined && (path === '~' || path.startsWith('~/')) ? `${home}${path.slice(1)}` : path
}

async function presetsPath($: EngineInterface, scope: Scope): Promise<string | undefined> {
  if (scope === 'project') return PRESETS_PATH
  const home = await homeDir($)

  return home === undefined ? undefined : `${home}/${PRESETS_PATH}`
}

async function loadPresets($: EngineInterface): Promise<Loaded> {
  const shipped = await readJsonFile($, `${$.plugin.root}/presets.json`)
  const builtIn = shipped.state === 'ok' ? readPresetLayer(shipped.value, 'built-in').presets : FALLBACK_PRESETS
  const notices: string[] = []
  const presets: PresetMap = { ...builtIn }

  for (const source of ['user', 'project'] as const) {
    const path = await presetsPath($, source)
    const json: JsonFile = path === undefined ? { state: 'missing' } : await readJsonFile($, path)
    if (json.state === 'corrupt') notices.push(`${path} could not be read: ${json.reason}`)
    if (json.state !== 'ok') continue
    const layer = readPresetLayer(json.value, source, Object.keys(builtIn))
    notices.push(...layer.ignored.map(note => `${path}: ignored ${note}`))
    Object.assign(presets, layer.presets)
  }

  return { presets, builtIn, notices }
}

async function changePresets($: EngineInterface, scope: Scope, change: (file: Record<string, unknown>, path: string) => string | undefined): Promise<{ path: string } | { error: string }> {
  const path = await presetsPath($, scope)
  if (path === undefined) return { error: 'HOME is not set, so there is no user presets file.' }
  const json = await readJsonFile($, path)
  const isObject = json.state === 'ok' && typeof json.value === 'object' && json.value !== null && !Array.isArray(json.value)
  if (json.state === 'corrupt' || (json.state === 'ok' && !isObject)) {
    return { error: `${path} is not a JSON object of presets${json.state === 'corrupt' ? ` (${json.reason})` : ''}. It was left as it is; fix it by hand.` }
  }
  const file: Record<string, unknown> = json.state === 'ok' ? { ...(json.value as Record<string, unknown>) } : {}
  const refusal = change(file, path)
  if (refusal !== undefined) return { error: refusal }
  try {
    await $.fs.write(path, `${JSON.stringify(file, null, 2)}\n`)
  } catch (error) {
    return { error: `${path} could not be written: ${reason(error)}` }
  }

  return { path }
}

async function skillRoots($: EngineInterface, dirs: readonly string[]): Promise<string[]> {
  const home = await homeDir($)

  return [...new Set(dirs.map(dir => expandHome(dir.trim(), home)).filter(Boolean))]
}

async function findFolderSkill($: EngineInterface, roots: readonly string[], name: string): Promise<FolderSkill | undefined> {
  for (const root of roots) {
    const stat = await $.fs.stat(`${root}/${name}`, { resolve: true }).catch(() => undefined)
    const path = stat?.kind === 'dir' ? stat.realPath : undefined
    if (path !== undefined && (await $.fs.exists(`${path}/SKILL.md`).catch(() => false))) return { name, path }
  }

  return undefined
}

async function folderSkillNames($: EngineInterface, roots: readonly string[]): Promise<string[]> {
  const lists = await Promise.all(roots.map(root => $.fs.list(root).catch(() => [])))

  return lists.flat().filter(entry => entry.kind === 'dir' || entry.isLink).map(entry => entry.name)
}

async function sessionSkillNames($: EngineInterface): Promise<string[]> {
  const commands = await $.command.list().catch(() => [])

  return commands.filter(command => (command.source === 'user' || command.source === 'plugin') && command.plugin !== PLUGIN).map(command => command.name)
}

async function resolveSkills($: EngineInterface, seats: readonly Seat[], dirs: readonly string[]): Promise<{ seats: Seat[]; warnings: string[] }> {
  const roots = await skillRoots($, dirs)
  const warnings: string[] = []
  const resolved: Seat[] = []
  let known: string[] | undefined

  for (const [index, seat] of seats.entries()) {
    const folderSkills: FolderSkill[] = []
    const skills: string[] = []
    const unknownSkills: string[] = []
    for (const name of seat.skills) {
      const found = isFolderSkillName(name) ? await findFolderSkill($, roots, name) : undefined
      if (found) {
        folderSkills.push(found)
        continue
      }
      skills.push(name)
      if (known === undefined) {
        const sessionNames = await sessionSkillNames($)
        const folderNames = await folderSkillNames($, roots)
        known = [...sessionNames, ...folderNames]
      }
      if (known.includes(name)) continue
      unknownSkills.push(name)
      const near = nearestNames(name, known)
      warnings.push(`Seat ${index + 1}: no skill "${name}" in the skill folders or this session; the seat may run without it.${near.length > 0 ? ` Did you mean ${near.join(', ')}?` : ''}`)
    }
    resolved.push({ ...seat, skills, ...(folderSkills.length > 0 ? { folderSkills } : {}), ...(unknownSkills.length > 0 ? { unknownSkills } : {}) })
  }

  return { seats: resolved, warnings }
}

function skillLines(seats: readonly Seat[]): string[] {
  return seats.flatMap((seat, index) => [
    ...(seat.folderSkills ?? []).map(skill => `Seat ${index + 1} +${skill.name}: ${skill.path}`),
    ...seat.skills.filter(name => !seat.unknownSkills?.includes(name)).map(name => `Seat ${index + 1} +${name}: session skill`),
  ])
}

async function briefFolders($: EngineInterface): Promise<BriefFolder[]> {
  const home = await $.env.get('HOME').catch(() => undefined)

  return [
    { path: '.claude/agent-panel/briefs', source: 'project' },
    ...(home === undefined ? [] : [{ path: `${home}/.claude/agent-panel/briefs`, source: 'user' }]),
  ]
}

async function readBriefFile($: EngineInterface, folder: string, name: string): Promise<string | undefined> {
  try {
    return (await $.fs.read(`${folder}/${name}.md`)).trim() || undefined
  } catch {
    return undefined
  }
}

async function folderBriefs($: EngineInterface, folder: BriefFolder): Promise<BriefEntry[]> {
  const entries = await $.fs.list(folder.path).catch(() => [])
  const names = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md')).map(entry => entry.name.slice(0, -3))

  return Promise.all(
    names.map(async name => {
      const text = await readBriefFile($, folder.path, name)

      return { name, source: folder.source, summary: (text ?? '').split('\n', 1)[0] ?? '' }
    }),
  )
}

async function loadBrief($: EngineInterface, name: string): Promise<string | undefined> {
  for (const folder of await briefFolders($)) {
    const text = await readBriefFile($, folder.path, name)
    if (text !== undefined) return text
  }

  return readBriefFile($, `${$.plugin.root}/briefs`, name)
}

async function listBriefs($: EngineInterface): Promise<BriefEntry[]> {
  const folders = await briefFolders($)
  const own = await Promise.all(folders.map(folder => folderBriefs($, folder)))
  const builtIn = await folderBriefs($, { path: `${$.plugin.root}/briefs`, source: 'built-in' })
  const seen = new Set<string>()

  return [...own.flat(), ...builtIn].filter(brief => !seen.has(brief.name) && seen.add(brief.name))
}

async function openRecord($: EngineInterface, run: Run, config: Config): Promise<Partial<Run>> {
  const kind = run.kind === 'panel' ? 'Panel' : 'Ping-pong'
  const brief = run.brief === undefined ? '' : `, brief "${run.brief}"`
  const rounds = run.kind === 'panel' && run.rounds > 1 ? `, up to ${run.rounds} rounds` : ''
  const header = `${kind} ${run.id}${brief}${rounds}\n\n${[seatList(run.seats), ...skillLines(run.seats)].join('\n')}\n\n## ${run.kind === 'panel' ? 'Question' : 'Task'}\n\n${run.question}\n`
  const record: Partial<Run> = {}
  const notes: string[] = []

  try {
    const home = await $.env.get('HOME')
    const root = config.runsDir.startsWith('~') && home !== undefined ? `${home}${config.runsDir.slice(1)}` : config.runsDir
    const project = (await $.session.root()).split(/[\\/]/).filter(Boolean).pop() ?? 'project'
    const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
    const dir = `${root}/${slugify(project)}/${day}-${run.id}-${slugify(run.question)}`
    await $.fs.write(`${dir}/question.md`, header)
    record.dir = dir
    record.page = `${dir}/discussion.html`
  } catch (error) {
    notes.push(`The answers are not being saved to files: ${reason(error)}`)
  }

  if (notes.length > 0) record.saveNote = notes.join('\n')

  return record
}

async function saveArtifact($: EngineInterface, run: Run, file: string, title: string, text: string): Promise<void> {
  const failures: string[] = []
  if (run.dir !== undefined) {
    await $.fs.write(`${run.dir}/${file}.md`, `# ${title}\n\n${text}\n`).catch(error => failures.push(`"${title}" was not written to a file: ${reason(error)}`))
  }
  if (failures.length === 0) return

  await patchRun($, run.id, current => ({ ...current, saveNote: [current.saveNote, ...failures].filter(Boolean).join('\n') }))
}

function fileUrl(path: string): string {
  return `file://${encodeURI(path)}`
}

type PageFiles = { css: string; script: string; marked: string; design: string }
type DesignSource = { scope: Scope; path: string }

let pageFiles: Promise<PageFiles> | undefined
const pageQueue = new Map<string, Promise<void>>()

function loadPageFiles($: EngineInterface): Promise<PageFiles> {
  pageFiles ??= Promise.all(['page.css', 'page.js', 'marked.min.js', 'design.md'].map(name => $.fs.read(`${$.plugin.root}/page/${name}`))).then(([css = '', script = '', marked = '', design = '']) => ({ css, script, marked, design }))
  pageFiles.catch(() => {
    pageFiles = undefined
  })

  return pageFiles
}

async function designSources($: EngineInterface): Promise<DesignSource[]> {
  const home = await homeDir($)

  return [...(home === undefined ? [] : [{ scope: 'user' as const, path: `${home}/${DESIGN_PATH}` }]), { scope: 'project' as const, path: DESIGN_PATH }]
}

async function loadDesign($: EngineInterface): Promise<{ design: Design; changedBy: DesignSource[] }> {
  const files = await loadPageFiles($)
  const sources = await designSources($)
  const layers = await Promise.all(sources.map(source => $.fs.read(source.path).then(readDesign, (): DesignLayer | undefined => undefined)))

  return { design: layerDesign([readDesign(files.design), ...layers.flatMap(layer => (layer === undefined ? [] : [layer]))]), changedBy: sources.filter((_, i) => layers[i] !== undefined) }
}

function loadGuide($: EngineInterface): Promise<Guide | undefined> {
  return loadDesign($).then(
    loaded => loaded.design,
    () => undefined,
  )
}

async function loadPageAssets($: EngineInterface): Promise<PageAssets> {
  const [files, { design }] = await Promise.all([loadPageFiles($), loadDesign($)])

  return { css: designCss(design, files.css), script: files.script, marked: files.marked, fonts: design.webfonts }
}

async function designCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = '', where = 'user'] = args.trim().toLowerCase().split(/\s+/)
  const sources = await designSources($)
  const shipped = `${$.plugin.root}/page/design.md`
  const how = `A design file holds the page's colours, fonts and sizes, the writing and illustration rules given to the session that records a verdict, and extra CSS. A copy replaces only the keys and sections it contains.`

  if (verb === 'copy') {
    const target = sources.find(source => source.scope === where)
    if (target === undefined) return where === 'user' ? 'HOME is not set, so there is no user design file.' : `Copy to "user" or "project", not "${where}".`
    if (await $.fs.exists(target.path).catch(() => false)) return `${target.path} already exists and was left as it is.`
    try {
      const files = await loadPageFiles($)
      await $.fs.write(target.path, files.design)
    } catch (error) {
      return `${target.path} could not be written: ${reason(error)}`
    }

    return `Wrote ${target.path}. Edit it and delete what you do not want to change, so those parts keep following the built-in design. Saved pages are redrawn with it the next time a run starts, finishes or is opened from the pane.`
  }
  if (!HELP_ARGS.includes(verb)) return `Unknown option "${verb}". Use /panel-design or /panel-design copy [user|project].`

  try {
    const { design, changedBy } = await loadDesign($)
    const changes = changedBy.length === 0 ? 'No user or project design file changes it.' : `Changed by ${changedBy.map(source => `${source.path} (${source.scope})`).join(', then ')}.`

    return [`Page design: ${design.name || 'unnamed'}. Built in at ${shipped}. ${changes}`, how, `/panel-design copy writes a starter copy to ${sources.find(source => source.scope === 'user')?.path ?? `~/${DESIGN_PATH}`}; /panel-design copy project writes ${DESIGN_PATH} in this project.`].join('\n\n')
  } catch (error) {
    return `The page design could not be read: ${reason(error)}`
  }
}

async function putPage($: EngineInterface, dir: string, data: AnyPage): Promise<void> {
  const assets = await loadPageAssets($)
  await $.fs.write(`${dir}/discussion.json`, `${JSON.stringify(data, null, 1)}\n`)
  await $.fs.write(`${dir}/discussion.html`, pageHtml(data, assets, 'local'))
  await $.fs.write(`${dir}/discussion.rev.js`, `window.__panelRev&&window.__panelRev(${data.rev})\n`)
}

async function writePageNow($: EngineInterface, id: string): Promise<void> {
  const run = await findRun($, id)
  if (!run || run.dir === undefined || run.page === undefined || run.isReported === true) return
  try {
    await putPage($, run.dir, pageFor(run, await $.clock.now()))
  } catch (error) {
    await patchRun($, id, current => {
      const { page: _page, ...kept } = current

      return { ...kept, saveNote: [current.saveNote, `The discussion page was not written: ${reason(error)}`].filter(Boolean).join('\n') }
    })
  }
}

function writePage($: EngineInterface, id: string): Promise<void> {
  const next = (pageQueue.get(id) ?? Promise.resolve()).then(() => writePageNow($, id))
  pageQueue.set(id, next)

  return next
}

async function savedPage($: EngineInterface, dir: string): Promise<AnyPage | undefined> {
  const listed = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
  const texts = await Promise.all(listed.map(entry => $.fs.read(`${dir}/${entry.name}`).catch(() => '')))
  const written = listed.find(entry => entry.name === 'question.md')?.mtimeMs ?? 0
  const day = Date.parse(dir.slice(dir.lastIndexOf('/') + 1, dir.lastIndexOf('/') + 11))
  const run = savedRun(Object.fromEntries(listed.map((entry, i) => [entry.name, texts[i] ?? ''])), written > 0 ? written : Number.isNaN(day) ? undefined : day)

  return run === undefined ? undefined : pageFor(run, await $.clock.now())
}

async function scanHistory($: EngineInterface, root: string, stamp: string): Promise<History> {
  const assets = await loadPageAssets($)
  const folders = (await $.fs.list(root)).filter(entry => entry.kind === 'dir')
  const entries = await Promise.all(
    folders.map(async ({ name }) => {
      const dir = `${root}/${name}`
      try {
        if (await $.fs.exists(`${dir}/discussion.json`)) {
          const kept = JSON.parse(await $.fs.read(`${dir}/discussion.json`)) as AnyPage
          await $.fs.write(`${dir}/discussion.html`, pageHtml(kept, assets, 'local'))

          return [historyEntry(kept, name)]
        }
        const rebuilt = await savedPage($, dir)
        if (rebuilt === undefined) return []
        await putPage($, dir, rebuilt)

        return [historyEntry(rebuilt, name)]
      } catch {
        return []
      }
    }),
  )

  return { stamp, runs: sortHistory(entries.flat()) }
}

let historyQueue: Promise<void> = Promise.resolve()

async function syncHistoryNow($: EngineInterface, id: string): Promise<void> {
  const run = await findRun($, id)
  if (!run || run.dir === undefined || run.page === undefined) return
  const root = run.dir.slice(0, run.dir.lastIndexOf('/'))
  const assets = await loadPageAssets($)
  const version = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).then(text => String((JSON.parse(text) as { version?: unknown }).version), () => '')
  const stamp = [version, hashOf(assets.css + assets.fonts + assets.script)].join(':')
  const kept = await $.fs.read(`${root}/history.json`).then(text => JSON.parse(text) as History, () => undefined)
  const data = JSON.parse(await $.fs.read(`${run.dir}/discussion.json`)) as AnyPage
  const history = kept?.stamp === stamp ? withEntry(kept, historyEntry(data, run.dir.slice(root.length + 1))) : await scanHistory($, root, stamp)
  await $.fs.write(`${root}/history.json`, `${JSON.stringify(history, null, 1)}\n`)
  await $.fs.write(`${root}/history.js`, historyScript(history))
}

function syncHistory($: EngineInterface, id: string): Promise<void> {
  historyQueue = historyQueue.then(() => syncHistoryNow($, id)).catch(() => undefined)

  return historyQueue
}

async function restorePage($: EngineInterface, run: Run): Promise<void> {
  if (run.dir === undefined) return
  const dir = run.dir
  if (run.kind === 'pingpong') {
    const saved = (file: string) => $.fs.read(`${dir}/${file}.md`).then(text => text.replace(/^# .*\n+/, '').trim(), () => '')
    const drafts = await Promise.all(run.seats.map((_, index) => saved(artifactOf({ ...run, phase: 'drafting' }, index).file)))
    const revised = await Promise.all(run.challenges.map((_, i) => saved(artifactOf({ ...run, phase: 'integrating', round: i + 1 }, 1).file)))
    const plans = [await saved('candidate'), ...revised]
    const kept = plans.findIndex(plan => plan === '')
    await putPage($, dir, planData({ ...run, drafts, plans: kept === -1 ? plans : plans.slice(0, kept) }, await $.clock.now()))
    return
  }
  const filled = (entries: readonly RoundEntry[], r: number) =>
    Promise.all(
      entries.map(async (entry, index): Promise<RoundEntry> => {
        if (entry.text !== '' || entry.state === 'absent') return entry
        const saved = await $.fs.read(`${dir}/${artifactOf({ ...run, round: r + 1 }, index).file}.md`).catch(() => '')

        return { ...entry, text: saved.replace(/^# .*\n+/, '').trim() }
      }),
    )
  const transcript = run.transcript === undefined ? undefined : await Promise.all(run.transcript.map(filled))
  await putPage($, dir, pageData({ ...run, ...(transcript === undefined ? {} : { transcript }) }, await $.clock.now()))
}

async function openRun($: EngineInterface, id: string): Promise<void> {
  const run = await findRun($, id)
  if (!run || run.dir === undefined) return
  const page = `${run.dir}/discussion.html`
  if (!isLive(run) && !(await $.fs.exists(page))) await restorePage($, run).catch(() => undefined)
  const target = (await $.fs.exists(page)) ? page : run.dir
  if (target === page) await syncHistory($, id)
  for (const opener of ['open', 'xdg-open']) {
    const ran = await $.process.run([opener, target]).catch(() => undefined)
    if (ran?.exitCode === 0) return
  }
  $.ui.toast(`Could not open ${target}`)
}

function savedLines(run: Run): string[] {
  return [
    run.dir === undefined ? '' : `The answers are saved in ${run.dir}`,
    run.page === undefined ? '' : `The ${run.kind === 'panel' ? 'discussion' : 'plan'} page is ${fileUrl(run.page)}`,
    run.saveNote ?? '',
  ].filter(Boolean)
}

async function ensureAgentType($: EngineInterface, seat: Seat): Promise<string> {
  const name = agentTypeName(seat)
  if (!registeredTypes.has(name)) {
    await $.agent.register({
      name: name,
      description: `Read-only panel seat on ${seat.model} at ${seat.effort} effort`,
      prompt: SEAT_SYSTEM_PROMPT,
      model: MODELS[seat.model],
      effort: seat.effort,
      tools: READ_ONLY_TOOLS,
      skills: seat.skills,
    })
    registeredTypes.add(name)
  }

  return `${PLUGIN}:${name}`
}

async function patchRun($: EngineInterface, id: string, fn: (run: Run) => Run): Promise<Run | undefined> {
  const written = await changeRuns($, list => list.map(run => (run.id === id ? fn(run) : run)))

  return written.find(run => run.id === id)
}

async function patchSeat($: EngineInterface, id: string, index: number, patch: Partial<Seat>): Promise<Run | undefined> {
  return patchRun($, id, run => ({
    ...run,
    seats: run.seats.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)),
  }))
}

async function claimStep($: EngineInterface, id: string, from: Phase, to: Phase, isReady: (run: Run) => boolean): Promise<Run | undefined> {
  const token = crypto.randomUUID()
  const run = await patchRun($, id, current =>
    current.phase === from && isReady(current) ? { ...current, phase: to, claim: token } : current,
  )

  return run?.claim === token ? run : undefined
}

async function claimRound($: EngineInterface, id: string, round: number): Promise<Run | undefined> {
  const token = crypto.randomUUID()
  const run = await patchRun($, id, current =>
    current.kind === 'panel' && (current.phase === 'drafting' || current.phase === 'discussing') && Math.max(current.round, 1) === round && current.seats.every(isSettled)
      ? { ...closeRound(current), claim: token }
      : current,
  )

  return run?.claim === token ? run : undefined
}

async function spawnSeat($: EngineInterface, run: Run, index: number, prompt: string): Promise<void> {
  const seat = run.seats[index]
  if (!seat) return
  try {
    const subagentType = await ensureAgentType($, seat)
    const skills = await Promise.all((seat.folderSkills ?? []).map(async skill => ({ ...skill, body: splitSkill(await $.fs.read(`${skill.path}/SKILL.md`)).body })))
    const spawned = await $.agent.spawn({ subagentType, prompt: withSkills(prompt, skills), description: `${run.kind} ${run.id}${run.kind === 'panel' && run.rounds > 1 ? ` round ${run.round}` : ''}: ${seat.label}` })
    if (spawned.deny !== undefined || spawned.agentId === undefined) {
      await failSeat($, run.id, index, spawned.deny ?? 'the subagent did not start')
      return
    }
    await patchSeat($, run.id, index, { agentId: spawned.agentId, status: 'working', startedAt: await $.clock.now() })
    startTicker($)
  } catch (error) {
    await failSeat($, run.id, index, error instanceof Error ? error.message : String(error))
  }
}

async function failSeat($: EngineInterface, id: string, index: number, reason: string): Promise<void> {
  const run = await patchSeat($, id, index, { status: 'failed', answer: `(failed: ${reason})` })
  await writePage($, id)
  if (run) await advance($, run)
}

async function continueSeat($: EngineInterface, run: Run, index: number, agentId: string, text: string): Promise<boolean> {
  await patchSeat($, run.id, index, { status: 'working', startedAt: await $.clock.now() })
  resuming += 1
  const sent = await $.session.send({ to: { agentId }, text }).catch(() => ({ isDelivered: false }))
  resuming -= 1
  if (sent.isDelivered) {
    startTicker($)
    return true
  }
  await patchSeat($, run.id, index, { status: 'starting' })

  return false
}

async function askSeat($: EngineInterface, run: Run, index: number, brief: (isContinued: boolean) => string): Promise<void> {
  const agentId = run.seats[index]?.agentId
  if (agentId !== undefined) {
    const isContinued = await continueSeat($, run, index, agentId, brief(true))
    if (isContinued) return
  }
  await spawnSeat($, run, index, brief(false))
}

type Launch = { seats: Seat[]; question: string; rounds: number; brief?: { name: string; text: string }; notes: string[]; warnings: string[] }

async function startRun($: EngineInterface, kind: RunKind, launch: Launch, config: Config): Promise<Run> {
  const { seats, question, rounds, brief } = launch
  const opened: Run = {
    id: crypto.randomUUID().slice(0, 6),
    kind,
    question,
    seats,
    phase: 'drafting',
    round: kind === 'panel' ? 1 : 0,
    rounds,
    challenges: [],
    startedAt: await $.clock.now(),
    ...(brief === undefined ? {} : { brief: brief.name, briefText: brief.text }),
    ...(launch.notes.length === 0 ? {} : { notes: launch.notes }),
    ...(launch.warnings.length === 0 ? {} : { warnings: launch.warnings }),
  }
  const record = await openRecord($, opened, config)
  const run = { ...opened, ...record }
  await changeRuns($, list => [...list, run].slice(-10))
  await writePage($, run.id)
  void $.ui.open({ id: PANE, title: 'Agent panel' })
  $.ui.status(`${kind} ${run.id}: ${rounds > 1 && kind === 'panel' ? `round 1 of ${rounds}, ` : ''}${seats.length} agents working`)

  await Promise.all(
    seats.map((seat, index) =>
      spawnSeat($, run, index, kind === 'panel' ? panelBrief(question, seat.role, brief?.text) : draftBrief(question)),
    ),
  )
  await writePage($, run.id)
  await syncHistory($, run.id)

  const current = await findRun($, run.id)

  return current ?? run
}

function isSettled(seat: Seat): boolean {
  return seat.status === 'done' || seat.status === 'failed'
}

async function finish($: EngineInterface, run: Run, phase: Phase, text: string, outcome?: string): Promise<void> {
  const endedAt = await $.clock.now()
  const ended = await patchRun($, run.id, current => ({ ...current, phase, endedAt, ...(outcome === undefined ? {} : { outcome }) }))
  const saved = savedLines(ended ?? run)
  await writePage($, run.id)
  await syncHistory($, run.id)
  const list = await readRuns($)
  if (!list.some(isLive)) stopTicker()
  $.ui.status(undefined)
  $.ui.toast(`${run.kind} ${run.id} ${phase === 'failed' ? 'failed' : 'finished'}`)
  const isReported = await submit($, saved.length === 0 ? text : `${text}\n\nEnd by telling me this:\n${saved.join('\n')}`)
  await patchRun($, run.id, current => {
    const { briefText: _briefText, drafts: _drafts, plans: _plans, ...kept } = current
    if (!isReported) return { ...current, isReported }

    return { ...kept, isReported, ...(current.transcript === undefined ? {} : { transcript: current.transcript.map(entries => entries.map(entry => ({ ...entry, text: '' }))) }) }
  })
}

async function submit($: EngineInterface, text: string): Promise<boolean> {
  try {
    await $.prompt.submit({ text })
    return true
  } catch {
    // A submit from the command or tool call that started the run is refused; that caller reports the failure itself.
    return false
  }
}

function finalPlan(run: Run, outcome: string, author: string, guide: Guide | undefined): string {
  const log = run.challenges.map((challenge, i) => `### Round ${i + 1} challenge (${run.seats[0]?.label})\n\n${challenge}`).join('\n\n')

  return `Ping-pong ${run.id} ${outcome}

Task:
${run.question}

## Final plan (${author})

${run.candidate}

## Challenges

${log}

${
    run.page === undefined
      ? `Present one coherent plan to me with the material disagreements, the decisions still open, the number of completed rounds, and the seats used:
${seatList(run.seats)}`
      : planAsk(run, guide)
  }`
}

async function advancePanel($: EngineInterface, run: Run): Promise<void> {
  const claimed = await claimRound($, run.id, Math.max(run.round, 1))
  if (!claimed) return
  if (claimed.phase !== 'discussing') {
    await finish($, claimed, 'done', panelSynthesis(claimed, await loadGuide($)))
    return
  }

  const asked = claimed.seats.flatMap((seat, index) => (seat.status === 'starting' ? [index] : []))
  $.ui.status(`panel ${claimed.id}: round ${claimed.round} of ${claimed.rounds}, ${asked.length} agents replying`)
  await writePage($, claimed.id)
  await Promise.all(asked.map(index => askSeat($, claimed, index, isContinued => replyBrief(claimed, index, isContinued))))
  await writePage($, claimed.id)
}

async function advance($: EngineInterface, run: Run): Promise<void> {
  if (run.kind === 'panel') {
    await advancePanel($, run)
    return
  }

  if (run.phase === 'drafting') {
    const claimed = await claimStep($, run.id, 'drafting', 'merging', current => current.seats.every(isSettled))
    if (!claimed) return

    if (claimed.seats.some(seat => seat.status === 'failed')) {
      await finish($, claimed, 'failed', `Ping-pong ${claimed.id} stopped: a planner failed.\n\n${answers(claimed)}\n\nTell me what failed and stop.`, 'Stopped before the merge: a draft failed.')
      return
    }

    await patchRun($, run.id, current => ({ ...current, drafts: current.seats.map(seat => seat.answer ?? '') }))
    await writePage($, run.id)
    await submit($, `Ping-pong ${claimed.id}: both independent drafts are in.

Task:
${claimed.question}

${answers(claimed)}

Compare both drafts against the code or files they cite and settle factual disagreements by inspection, not by vote. Merge them into one candidate plan. Then call the tool mcp__${PLUGIN}__pingpong_merge with runId "${claimed.id}" and the full candidate plan. Do not present the plan to me yet: ${claimed.rounds} challenge round(s) follow.`)
    return
  }

  const [challenger, integrator] = run.seats
  if (!challenger || !integrator) return

  if (run.phase === 'challenging') {
    const seat = challenger
    if (!isSettled(seat)) return
    if (seat.status === 'failed') {
      await finish($, run, 'failed', `Ping-pong ${run.id} stopped in round ${run.round}: the challenger failed. ${seat.answer}\n\nLast candidate plan:\n\n${run.candidate}\n\nShow me this candidate and say the rounds did not complete.`, `Stopped in round ${run.round} of ${run.rounds}: the challenger failed.`)
      return
    }
    if (isPass(seat.answer ?? '')) {
      const claimed = await claimStep($, run.id, 'challenging', 'done', () => true)
      if (!claimed) return
      const passed = await patchRun($, run.id, current => ({ ...current, challenges: [...current.challenges, seat.answer ?? ''] }))
      if (!passed) return
      const author = run.round === 1 ? 'your merge, unchanged' : `last integrated by ${integrator.label}`
      await finish($, passed, 'done', finalPlan(passed, `stopped early in round ${run.round} of ${run.rounds}: the challenger found nothing material, after ${run.round - 1} integrated round(s).`, author, await loadGuide($)), `Stopped early in round ${run.round} of ${run.rounds}: the challenger found nothing material.`)
      return
    }
    const claimed = await claimStep($, run.id, 'challenging', 'integrating', () => true)
    if (!claimed) return
    const withChallenge = await patchRun($, run.id, current => ({ ...current, challenges: [...current.challenges, seat.answer ?? ''] }))
    if (withChallenge) {
      await askSeat($, withChallenge, 1, isContinued => integrateBrief(withChallenge.candidate ?? '', seat.answer ?? '', run.round, run.rounds, isContinued))
    }
    await writePage($, run.id)
    return
  }

  if (run.phase === 'integrating') {
    const seat = integrator
    if (!isSettled(seat)) return
    if (seat.status === 'failed') {
      await finish($, run, 'failed', `Ping-pong ${run.id} stopped in round ${run.round}: the integrator failed. ${seat.answer}\n\nLast candidate plan:\n\n${run.candidate}\n\nShow me this candidate and say round ${run.round} did not complete.`, `Stopped in round ${run.round} of ${run.rounds}: the integrator failed.`)
      return
    }
    const isLastRound = run.round >= run.rounds
    const claimed = await claimStep($, run.id, 'integrating', isLastRound ? 'done' : 'challenging', () => true)
    if (!claimed) return
    const next = await patchRun($, run.id, current => ({
      ...current,
      candidate: seat.answer,
      plans: [...(current.plans ?? []), seat.answer ?? ''],
      round: isLastRound ? current.round : current.round + 1,
    }))
    if (!next) return

    if (isLastRound) {
      await finish($, next, 'done', finalPlan(next, `completed ${next.round} of ${next.rounds} round(s).`, `last integrated by ${integrator.label}`, await loadGuide($)), `Completed ${next.round} of ${next.rounds} ${next.rounds === 1 ? 'round' : 'rounds'}.`)
      return
    }

    await askSeat($, next, 0, isContinued => challengeBrief(next.candidate ?? '', next.round, next.rounds, isContinued))
    await writePage($, run.id)
  }
}

function describePhase(run: Run): string {
  const where = run.isReported === false ? 'Its message could not be posted to the chat.' : 'Its message was posted to the chat.'
  switch (run.phase) {
    case 'drafting':
      if (run.kind === 'pingpong') return 'A and B are each drafting a plan.'
      return run.rounds > 1 ? `Round 1 of ${run.rounds}: agents are answering independently.` : 'Agents are answering.'
    case 'discussing':
      return `Round ${run.round} of ${run.rounds}: agents are replying to each other.`
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

function presetFrom(seats: readonly Seat[], brief: string | undefined, rounds: number | undefined, skillDirs: readonly string[]) {
  return presetEntry({
    seats: seats.map(seatSpec),
    ...(brief === undefined ? {} : { brief }),
    ...(rounds === undefined ? {} : { rounds }),
    ...(skillDirs.length === 0 ? {} : { skillDirs: [...new Set(skillDirs)] }),
  })
}

function separatorError(kind: RunKind, question: string): string {
  const what = kind === 'panel' ? 'question' : 'task'
  if (!/\s/.test(question)) return `"${question}" is not a seat, a preset or an option. Nothing started.`

  return `Nothing started: put -- before the ${what}, as in /${kind} -- ${question}`
}

function prepare(kind: RunKind, args: string, loaded: Loaded, rounds?: number) {
  const parsed = parseArgs(args, loaded.presets)
  const seats = parsed.seats.length > 0 ? parsed.seats : parseArgs(kind === 'panel' ? 'quick' : 'duo', loaded.builtIn).seats
  const errors = [...parsed.errors]
  const notes = [...parsed.presets.map(name => `Preset "${name}" (${loaded.presets[name]?.source}).`), ...parsed.notes]
  if (kind === 'pingpong' && seats.length !== 2) errors.push(`Ping-pong takes exactly two seats; got ${seats.length}.`)
  if (parsed.question.length === 0) errors.push(kind === 'panel' ? 'No question given.' : 'No task given.')
  if (parsed.question.length > 0 && !parsed.hasSeparator) errors.push(separatorError(kind, parsed.question))
  if (kind === 'pingpong' && parsed.brief !== undefined) errors.push('brief= applies to /panel only.')
  if (kind === 'pingpong' && parsed.brief === undefined && parsed.presetBrief !== undefined) notes.push(`Brief "${parsed.presetBrief}" from the preset is not used: briefs apply to /panel only.`)
  const roundsProblem = rounds === undefined ? undefined : roundsError(rounds)
  if (roundsProblem) errors.push(roundsProblem)
  if (parsed.as !== undefined && parsed.seats.length === 0) errors.push('as= needs seats or a preset on the line to save.')
  if (parsed.as !== undefined && Object.hasOwn(loaded.presets, parsed.as)) errors.push(`A preset named "${parsed.as}" exists. To replace it: /panel-preset save ${parsed.as} <seats> force`)
  const brief = parsed.brief ?? (kind === 'panel' ? parsed.presetBrief : undefined)
  const typedRounds = rounds ?? parsed.rounds
  const chosenRounds = typedRounds ?? parsed.presetRounds
  const isDiscussion = kind === 'panel' && (chosenRounds ?? 1) > 1
  const isAlone = isDiscussion && seats.length < 2
  if (isAlone && typedRounds !== undefined) errors.push(`A discussion needs at least two seats; got ${seats.length}.`)
  if (isAlone && typedRounds === undefined) notes.push(`The preset asks for ${chosenRounds} rounds, but a discussion needs at least two seats: this runs one round.`)
  if (isDiscussion && !isAlone && typedRounds === undefined) notes.push(`${chosenRounds} rounds come from the preset; rounds=1 on the command runs it without the discussion.`)
  const skillDirs = [...parsed.skillDirs, ...parsed.presetSkillDirs]

  return {
    seats,
    question: parsed.question,
    rounds: isAlone ? 1 : (chosenRounds ?? 1),
    brief,
    skillDirs,
    preset: parsed.as === undefined ? undefined : { name: parsed.as, entry: presetFrom(parsed.seats, brief, chosenRounds, skillDirs) },
    notes,
    errors,
  }
}

async function usage($: EngineInterface, kind: RunKind, config: Config): Promise<string> {
  const loaded = await loadPresets($)

  return kind === 'panel' ? panelUsage(loaded, await listBriefs($)) : pingpongUsage(loaded)
}

async function launch($: EngineInterface, kind: RunKind, args: string, config: Config, rounds?: number): Promise<{ errors: string[] } | { started: string }> {
  const loaded = await loadPresets($)
  const prepared = prepare(kind, args, loaded, rounds)
  if (prepared.errors.length > 0) return { errors: [...prepared.errors, ...loaded.notices] }

  const text = prepared.brief === undefined ? undefined : await loadBrief($, prepared.brief)
  if (prepared.brief !== undefined && text === undefined) {
    const briefs = await listBriefs($)
    const known = briefs.map(brief => brief.name).join(', ')

    return { errors: [`No brief named "${prepared.brief}". Known briefs: ${known || 'none'}.`] }
  }

  const resolved = await resolveSkills($, prepared.seats, [...prepared.skillDirs, ...config.skillDirs])
  const notes = [...prepared.notes]
  if (prepared.preset !== undefined) {
    const { name, entry } = prepared.preset
    const saved = await changePresets($, 'user', file => {
      file[name] = entry

      return undefined
    })
    if ('error' in saved) return { errors: [saved.error] }
    notes.push(`Saved as preset "${name}" in ${saved.path}.`)
  }

  const run = await startRun($, kind, {
    seats: resolved.seats,
    question: prepared.question,
    rounds: prepared.rounds,
    ...(prepared.brief !== undefined && text !== undefined ? { brief: { name: prepared.brief, text } } : {}),
    notes,
    warnings: resolved.warnings,
  }, config)

  return { started: describeStart(run) }
}

function describeStart(run: Run): string {
  const isDiscussion = run.kind === 'panel' && run.rounds > 1
  const rounds = run.kind === 'pingpong' ? `, ${run.rounds} round(s)` : isDiscussion ? `, up to ${run.rounds} rounds` : ''
  const failed = run.seats.filter(seat => seat.status === 'failed').map(seat => `${seat.label} did not start: ${seat.answer}`)
  const brief = run.brief === undefined ? '' : `, brief "${run.brief}"`

  return [
    `${run.kind === 'panel' ? 'Panel' : 'Ping-pong'} ${run.id} started${rounds}${brief}:`,
    seatList(run.seats),
    ...skillLines(run.seats),
    ...(run.notes ?? []),
    ...(run.warnings ?? []),
    ...failed,
    ...(isDiscussion ? [costLine(run.seats.length, run.rounds)] : []),
    ...savedLines(run),
    isDiscussion ? 'Results arrive as a new message after the last round.' : 'Results arrive as a new message when the agents finish.',
  ].join('\n')
}

const PRESET_USAGE = `Usage: /panel-preset save <name> <seats or presets> [brief=name] [rounds=N] [skills=dir[,dir]] [scope=project] [force]
       /panel-preset list
       /panel-preset show <name>
       /panel-preset delete <name> [scope=project]
       /panel-preset skills [filter]

A preset is a named set of seats: run it as /panel <name> -- <question> or /pingpong <name> -- <task>.
  save       writes to ~/${PRESETS_PATH}; scope=project writes to ${PRESETS_PATH} in this project
  skills=    folders of <skill>/SKILL.md the preset's +skill names load from, ahead of the "Default skill folders" setting and the session's skills
  brief=     the brief /panel uses with this preset; brief= on the command still wins
  rounds=    under /panel the total rounds, the first independent; under /pingpong the challenge rounds; rounds= on the command still wins
  force      replaces a preset of the same name in that file
  skills     lists what the "Default skill folders" setting and your presets' folders offer

A project file cannot replace a built-in preset or carry skill folders. as=<name> on /panel or /pingpong saves the seats of a run.

Example
  /panel-preset save content-council skills=~/skills/marketing sonnet:high+ads+ad-creative sonnet:high+copywriting opus:high:contrarian+cro
  /panel content-council -- Critique the home page redesign`

const PRESET_INDENT = ' '.repeat(19)
const PRESET_GROUPS: { source: PresetSource; title: string; empty?: string }[] = [
  { source: 'built-in', title: 'Built-in presets' },
  { source: 'user', title: `Your presets  ~/${PRESETS_PATH}`, empty: '  none yet: /panel-preset save <name> <seats>' },
  { source: 'project', title: `Project presets  ${PRESETS_PATH}` },
]

function presetDetail(name: string, preset: PresetMap[string], warnings: readonly string[] = []): string {
  const seats = preset.seats.map(spec => spec.replaceAll('+', ' +'))
  const options = [preset.brief === undefined ? '' : `brief=${preset.brief}`, preset.rounds === undefined ? '' : `rounds=${preset.rounds}`].filter(Boolean)
  const dirs = preset.skillDirs ?? []
  const oneLine = [...seats, ...options].join(' ')
  if (preset.description === undefined && dirs.length === 0 && warnings.length === 0 && !oneLine.includes('+') && oneLine.length <= 60) return `  ${name.padEnd(16)} ${oneLine}`
  const [first = '', ...rest] = preset.description === undefined ? seats : [preset.description, ...seats]

  return [
    `  ${name.padEnd(16)} ${first}`,
    ...rest.map(line => `${PRESET_INDENT}${line}`),
    ...(options.length === 0 ? [] : [`${PRESET_INDENT}${options.join(' ')}`]),
    ...dirs.map((dir, i) => `${PRESET_INDENT}${i === 0 ? 'skills from ' : ' '.repeat(12)}${dir}`),
    ...warnings.map(warning => `${PRESET_INDENT}! ${warning}`),
  ].join('\n')
}

async function listPresets($: EngineInterface, config: Config): Promise<string> {
  const loaded = await loadPresets($)
  const blocks = await Promise.all(
    Object.entries(loaded.presets).map(async ([name, preset]) => {
      const seats = preset.seats.flatMap(spec => parseArgs(spec, {}).seats)
      const { warnings } = seats.some(seat => seat.skills.length > 0) ? await resolveSkills($, seats, [...(preset.skillDirs ?? []), ...config.skillDirs]) : { warnings: [] }

      return { source: preset.source, text: presetDetail(name, preset, warnings) }
    }),
  )
  const groups = PRESET_GROUPS.flatMap(group => {
    const texts = blocks.filter(block => block.source === group.source).map(block => block.text)
    if (texts.length === 0 && group.empty === undefined) return []

    return [`${group.title}\n${texts.length === 0 ? group.empty : texts.join(texts.some(text => text.includes('\n')) ? '\n\n' : '\n')}`]
  })

  return `${groups.join('\n\n')}\n${noticeLines(loaded.notices)}`.trimEnd()
}

async function showPreset($: EngineInterface, name: string, config: Config): Promise<string> {
  const loaded = await loadPresets($)
  const preset = Object.hasOwn(loaded.presets, name) ? loaded.presets[name] : undefined
  if (preset === undefined) return `No preset named "${name}". Known presets: ${Object.keys(loaded.presets).join(', ')}.${noticeLines(loaded.notices)}`
  const resolved = await resolveSkills($, preset.seats.flatMap(spec => parseArgs(spec, {}).seats), [...(preset.skillDirs ?? []), ...config.skillDirs])
  const path = preset.source === 'built-in' ? `${$.plugin.root}/presets.json` : await presetsPath($, preset.source)

  const skills = skillLines(resolved.seats)

  return [`Preset "${name}" in ${path}:`, presetDetail(name, preset, resolved.warnings), ...(skills.length === 0 ? [] : ['', ...skills])].join('\n')
}

function scopeOf(words: readonly string[]): Scope | undefined {
  const word = words.find(one => /^scope=/i.test(one))
  const scope = word === undefined ? 'user' : word.slice(6).toLowerCase()

  return scope === 'user' || scope === 'project' ? scope : undefined
}

async function deletePreset($: EngineInterface, name: string, words: readonly string[]): Promise<string> {
  const scope = scopeOf(words)
  if (scope === undefined) return 'scope must be user or project.'
  const loaded = await loadPresets($)
  const deleted = await changePresets($, scope, (file, path) => {
    if (Object.hasOwn(file, name)) {
      delete file[name]

      return undefined
    }
    const source = Object.hasOwn(loaded.presets, name) ? loaded.presets[name]?.source : undefined
    if (source === 'built-in') return `"${name}" is a built-in preset; it can be replaced by a preset of the same name but not deleted.`

    return `No preset "${name}" in ${path}.${source === undefined || source === scope ? '' : ` It is in the ${source} file: add scope=${source}.`}`
  })

  return 'error' in deleted ? deleted.error : `Deleted preset "${name}" from ${deleted.path}.`
}

async function savePreset($: EngineInterface, name: string, words: readonly string[], config: Config): Promise<string> {
  const scope = scopeOf(words)
  const isForced = words.some(word => word.toLowerCase() === 'force')
  const loaded = await loadPresets($)
  const parsed = parseArgs(words.filter(word => word.toLowerCase() !== 'force' && !/^scope=/i.test(word)).join(' '), loaded.presets)
  const brief = parsed.brief ?? parsed.presetBrief
  const skillDirs = [...parsed.skillDirs, ...parsed.presetSkillDirs]
  const nameError = presetNameError(name)
  const errors = [...parsed.errors]
  if (nameError) errors.push(`"${name}": ${nameError}`)
  if (scope === undefined) errors.push('scope must be user or project.')
  if (parsed.question !== '') errors.push(`"${parsed.question}" is not a seat, a preset or an option.`)
  if (parsed.seats.length === 0) errors.push('Give at least one seat.')
  if (parsed.as !== undefined) errors.push('as= belongs on /panel and /pingpong.')
  if (scope === 'project' && skillDirs.length > 0) errors.push('A project preset cannot carry skill folders, since a repository could then feed its own text to the seats. Put the folder in the "Default skill folders" setting, or save without scope=project.')
  if (scope === 'project' && Object.hasOwn(loaded.builtIn, name)) errors.push(`A project preset cannot be named "${name}": that is a built-in.`)
  const briefText = brief === undefined ? undefined : await loadBrief($, brief)
  if (brief !== undefined && briefText === undefined) errors.push(`No brief named "${brief}".`)
  if (errors.length > 0 || scope === undefined) return `${errors.join('\n')}\n\n${PRESET_USAGE}`

  const saved = await changePresets($, scope, (file, path) => {
    if (Object.hasOwn(file, name) && !isForced) return `"${name}" is already in ${path}. Add force to replace it.`
    file[name] = presetFrom(parsed.seats, brief, parsed.rounds ?? parsed.presetRounds, skillDirs)

    return undefined
  })
  if ('error' in saved) return saved.error

  const resolved = await resolveSkills($, parsed.seats, [...skillDirs, ...config.skillDirs])
  const other = Object.hasOwn(loaded.presets, name) ? loaded.presets[name]?.source : undefined
  const shadow =
    other === 'built-in' ? [`It is used in place of the built-in "${name}" when you name it; a command with no seats still runs the built-in.`]
    : other === 'project' && scope === 'user' ? [`The project preset "${name}" still wins in this project.`]
    : other === 'user' && scope === 'project' ? [`It is used in place of your user preset "${name}" in this project.`]
    : []

  return [`Saved preset "${name}" in ${saved.path}:`, seatList(resolved.seats), ...skillLines(resolved.seats), ...parsed.notes, ...shadow, ...resolved.warnings].join('\n')
}

async function listSkills($: EngineInterface, filter: string, config: Config): Promise<string> {
  const loaded = await loadPresets($)
  const roots = await skillRoots($, [...config.skillDirs, ...Object.values(loaded.presets).flatMap(preset => preset.skillDirs ?? [])])
  if (roots.length === 0) return 'No skill folders are set. Add one to the "Default skill folders" setting under /config, or pass skills=<folder> to /panel-preset save.'

  const blocks = await Promise.all(
    roots.map(async root => {
      const names = await folderSkillNames($, [root])
      const found = await Promise.all(
        names.sort().map(async name => {
          const text = await $.fs.read(`${root}/${name}/SKILL.md`).catch(() => undefined)
          if (text === undefined) return undefined
          const { frontmatter, body } = splitSkill(text)
          const ignored = ignoredSkillFeatures(frontmatter, body)

          return { name, summary: skillSummary(frontmatter), ignored }
        }),
      )
      const shown = found.flatMap(skill => (skill === undefined || !`${skill.name} ${skill.summary}`.toLowerCase().includes(filter) ? [] : [skill]))
      const lines = shown.map(skill => `  ${skill.name.padEnd(24)} ${skill.summary.slice(0, 70)}${skill.ignored.length > 0 ? ` [not applied: ${skill.ignored.join(', ')}]` : ''}`)

      return `${root} (${shown.length})\n${lines.join('\n') || '  (none)'}`
    }),
  )

  return blocks.join('\n\n')
}

async function presetCommand($: EngineInterface, args: string, config: Config): Promise<string> {
  const [sub = 'help', name = '', ...words] = args.trim().split(/\s+/).filter(Boolean)
  switch (sub.toLowerCase()) {
    case 'list':
      return listPresets($, config)
    case 'show':
      return showPreset($, name.toLowerCase(), config)
    case 'delete':
      return deletePreset($, name.toLowerCase(), words)
    case 'skills':
      return listSkills($, name.toLowerCase(), config)
    case 'save':
      return savePreset($, name.toLowerCase(), words, config)
    default:
      return PRESET_USAGE
  }
}

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const BAR = 8
const TOKEN_WIDTH = 10
const TONE_COLOR: Record<Tone, string | undefined> = { live: 'claude', good: 'success', bad: 'error', warn: 'warning', quiet: undefined, plain: undefined }
const HELP_STYLE: Record<HelpTone, { color?: string; bold?: boolean; dimColor?: boolean }> = { heading: { bold: true }, command: { color: 'claude' }, option: { color: 'suggestion' }, quiet: { dimColor: true }, error: { color: 'error' }, warning: { color: 'warning' } }
const STEP_GLYPH: Record<StepState, string> = { done: '●', now: '◐', todo: '○', skipped: '·', failed: '✗' }
const STEP_TONE: Record<StepState, Tone> = { done: 'good', now: 'live', todo: 'quiet', skipped: 'quiet', failed: 'bad' }
const SEAT_GLYPH: Record<Seat['status'], string> = { starting: '○', working: '◐', done: '✓', failed: '✗' }
const SEAT_TONE: Record<Seat['status'], Tone> = { starting: 'quiet', working: 'live', done: 'good', failed: 'bad' }

const STREAM_MAX = 6000
const TEXT_SIZES = [undefined, 0, 2, 5, 10] as const
const streams = new Map<string, { text: string; isThinking: boolean }>()
const liveTokens = new Map<string, number>()
let textSize = 0
let ticker: { cancel: () => void } | undefined

function startTicker($: EngineInterface): void {
  ticker ??= $.clock.every(250, () => $.ui.invalidate('ui.render'))
}

function noteStream(agentId: string, kind: 'text' | 'thinking', text: string, isFirstText: boolean): void {
  const current = streams.get(agentId) ?? { text: '', isThinking: false }
  if (kind === 'thinking') streams.set(agentId, { ...current, isThinking: true })
  else streams.set(agentId, { text: `${isFirstText ? '' : current.text}${text}`.slice(-STREAM_MAX), isThinking: false })
}

function cycleTextSize($: EngineInterface): void {
  textSize = (textSize + 1) % TEXT_SIZES.length
  $.ui.invalidate('ui.render')
}

function drawText({ Box, Text }: Kit, id: string, lines: readonly Span[][], color: string, isDim: boolean, cursor?: string) {
  return lines.map((line, row) => (
    <Box key={`${id}-${row}`}>
      <Text color={color}>┃ </Text>
      {line.map((span, i) => (
        <Text bold={span.isBold} color={span.isCode ? 'suggestion' : undefined} dimColor={isDim && !span.isCode} key={`${id}-${row}-${i}`}>
          {span.text}
        </Text>
      ))}
      {cursor !== undefined && row === lines.length - 1 ? <Text color={color}>{cursor}</Text> : null}
    </Box>
  ))
}

function seatText(run: Run, seat: Seat, width: number, rows: number, now: number): { lines: Span[][]; isDim: boolean; cursor?: string } | undefined {
  if (rows <= 0) return undefined
  if (seat.status === 'working') {
    const stream = seat.agentId === undefined ? undefined : streams.get(seat.agentId)
    const cursor = Math.floor(now / 500) % 2 === 0 ? '▌' : ' '
    if (stream && stream.text.trim() !== '') return { lines: flow(stream.text, width - 1).slice(-rows), isDim: false, cursor }

    return stream?.isThinking ? { lines: [[{ text: 'thinking', isCode: false, isBold: false }]], isDim: true, cursor } : undefined
  }
  if (seat.status !== 'done' || run.kind !== 'panel') return undefined
  const excerpt = excerptOf(seat.answer ?? '', run.round > 1)
  if (!excerpt) return seat.answer === undefined ? undefined : { lines: [[{ text: 'kept its earlier answer', isCode: false, isBold: false }]], isDim: true }
  const all = flow(`${excerpt.label === '' ? '' : `**${excerpt.label}** `}${excerpt.text}`, width)
  const shown = all.slice(0, Math.min(rows, 3))
  if (all.length > shown.length) shown.push([{ text: '…', isCode: false, isBold: false }])

  return { lines: shown, isDim: true }
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = undefined
}

function drawCommandOutput({ Box, Text }: Kit, text: string) {
  return (
    <Box flexDirection="column">
      {helpLines(text).map((line, row) => (
        <Text key={`help-${row}`}>
          {line.length === 0 ? ' ' : line.map((span, i) => <Text key={`help-${row}-${i}`} {...(span.tone === undefined ? {} : HELP_STYLE[span.tone])}>{span.text}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

function drawSteps({ Box, Text }: Kit, run: Run, now: number) {
  return (
    <Box flexWrap="wrap">
      {pingpongSteps(run).map((step, i) => (
        <Box key={`${run.id}-${step.label}`}>
          {i === 0 ? null : <Text dimColor> ─ </Text>}
          <Text dimColor>{`${step.label} `}</Text>
          {step.cells.map((cell, c) => (
            <Text color={TONE_COLOR[STEP_TONE[cell]]} dimColor={STEP_TONE[cell] === 'quiet'} key={`${run.id}-${step.label}-${c}`}>
              {cell === 'now' ? spinner(now) : STEP_GLYPH[cell]}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function drawSeat(kit: Kit, run: Run, index: number, now: number, inner: number, scale: number, rows: number) {
  const { Box, Text } = kit
  const seat = run.seats[index]
  if (!seat) return null
  const tone = SEAT_TONE[seat.status]
  const time = seatTime(seat, now)
  const cells = roundCells(run, index, now)
  const nameWidth = Math.max(8, inner - 5 - BAR - 7 - (cells.length === 0 ? 0 : cells.length + 1))
  const color = seatColor(index)
  const tokens = (seat.tokens ?? 0) + (seat.status === 'working' && seat.agentId !== undefined ? (liveTokens.get(seat.agentId) ?? 0) : 0)
  const spent = inner >= 50 && tokens > 0 ? formatTokens(tokens) : ''
  const textWidth = inner - (spent === '' ? 0 : TOKEN_WIDTH)
  const text = seatText(run, seat, textWidth - 2, rows, now)
  const doing = seat.status === 'working' && seat.activity ? [{ text: seat.activity, tone: 'live' as const }] : []
  const chips = fitChips([...seatChips(seat), ...doing], nameWidth)
  const bar = meter(time ?? 0, scale, BAR)

  return (
    <Box flexDirection="column" key={`${run.id}-seat-${index}`}>
      <Box>
        <Box width={2}>
          <Text color={TONE_COLOR[tone]} dimColor={tone === 'quiet'}>{seat.status === 'working' ? spinner(now) : SEAT_GLYPH[seat.status]}</Text>
        </Box>
        <Box width={2}>
          <Text bold color={color}>{run.kind === 'pingpong' ? (index === 0 ? 'A' : 'B') : String(index + 1)}</Text>
        </Box>
        <Box width={nameWidth + 1} columnGap={1}>
          {chips.map((chip, c) => (
            <Text bold={chip.isBold === true} color={TONE_COLOR[chip.tone]} dimColor={chip.tone === 'quiet'} key={`${run.id}-${index}-${c}`}>
              {chip.text}
            </Text>
          ))}
        </Box>
        {cells.map((cell, c) => (
          <Text color={TONE_COLOR[cell.tone]} dimColor={cell.tone === 'quiet'} key={`${run.id}-${index}-round-${c}`}>
            {cell.text}
          </Text>
        ))}
        {cells.length === 0 ? null : <Text> </Text>}
        <Text color={TONE_COLOR[tone]}>{bar.on}</Text>
        <Text dimColor>{bar.off}</Text>
        <Text dimColor={seat.status !== 'working'}>{(time === undefined ? '' : formatDuration(time)).padStart(7)}</Text>
      </Box>
      <Box>
        <Box flexDirection="column" width={textWidth}>
          {seat.status === 'failed' ? <Text color="error">{`  ${clip(seat.answer ?? '', textWidth - 2)}`}</Text> : null}
          {text === undefined ? null : drawText(kit, `${run.id}-text-${index}`, text.lines, color, text.isDim, text.cursor)}
        </Box>
        {spent === '' ? null : <Text dimColor>{`${spent} tok`.padStart(TOKEN_WIDTH)}</Text>}
      </Box>
    </Box>
  )
}

function drawCard(kit: Kit, run: Run, now: number, width: number, rows: number, onOpen: () => void) {
  const { Box, Text, Button } = kit
  const inner = width - 4
  const badge = runBadge(run, now)
  const live = isLive(run)
  const scale = Math.max(1, ...run.seats.map(seat => seatTime(seat, now) ?? 0))
  const note = live ? describePhase(run) : run.isReported === false ? 'The result could not be posted to the chat.' : run.outcome

  return (
    <Box borderColor={live ? 'claude' : run.phase === 'failed' ? 'error' : 'subtle'} borderDimColor={!live} borderStyle="round" flexDirection="column" key={`card-${run.id}`} paddingX={1} width={width}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold>{run.kind === 'panel' ? '◈ panel' : '⇄ pingpong'}</Text>
          <Text dimColor>{` ${run.id}`}</Text>
        </Box>
        <Text bold={live} color={TONE_COLOR[badge.tone]}>{badge.text}</Text>
      </Box>
      <Text dimColor>{clip(run.question, inner)}</Text>
      {run.kind === 'pingpong' ? drawSteps(kit, run, now) : null}
      {run.seats.map((_, index) => drawSeat(kit, run, index, now, inner, scale, rows))}
      {note === undefined ? null : <Text color={!live && run.isReported === false ? 'warning' : undefined} dimColor={live || run.isReported !== false} italic>{clip(note, inner)}</Text>}
      {run.kind === 'panel' && run.rounds > 1 ? <Text dimColor>{clip(ROUND_LEGEND, inner)}</Text> : null}
      {run.dir === undefined ? null : (
        <Button key={`open-${run.id}`} onPress={onOpen} plain>
          <Text bold color="suggestion">↗ </Text>
          <Text bold color="suggestion" underline>{run.page === undefined ? 'Open the answers folder' : run.kind === 'panel' ? 'Open the discussion page' : 'Open the plan page'}</Text>
        </Button>
      )}
      {run.saveNote === undefined ? null : <Text color="warning">{clip(`⚠ ${run.saveNote}`, inner)}</Text>}
    </Box>
  )
}

function drawLine({ Box, Text, Button }: Kit, run: Run, now: number, width: number, onOpen: () => void) {
  const time = runTime(run, now)
  const clock = time === undefined ? '' : ` ${formatDuration(time)}`
  const head = ` ${run.kind} `
  const room = width - 3 - head.length - run.id.length - 1 - run.seats.length - clock.length - 2 - (run.dir === undefined ? 0 : 2)
  const row = [
    <Text color={run.phase === 'failed' ? 'error' : 'success'} key={`line-${run.id}-mark`}>{` ${run.phase === 'failed' ? '✗' : '✓'}`}</Text>,
    <Text key={`line-${run.id}-kind`}>{head}</Text>,
    <Text dimColor key={`line-${run.id}-id`}>{`${run.id} `}</Text>,
    ...run.seats.map((seat, index) => (
      <Text color={TONE_COLOR[SEAT_TONE[seat.status]]} dimColor={seat.status === 'starting'} key={`line-${run.id}-${index}`}>●</Text>
    )),
    <Text dimColor key={`line-${run.id}-what`}>{`${clock}  ${clip(run.question, room)}`}</Text>,
  ]
  if (run.dir === undefined) return <Box key={`line-${run.id}`}>{row}</Box>

  return (
    <Button key={`line-${run.id}`} label={`Open ${run.kind} ${run.id}`} onPress={onOpen} plain>
      {row}
      <Text color="suggestion"> ↗</Text>
    </Button>
  )
}

async function noteActivity($: EngineInterface, agentId: string, activity: string): Promise<void> {
  const isSeat = (seat: Seat) => seat.agentId === agentId && seat.status === 'working'
  const list = await readRuns($)
  if (!list.some(run => isLive(run) && run.seats.some(isSeat))) return

  await changeRuns($, list => list.map(run => ({ ...run, seats: run.seats.map(seat => (isSeat(seat) ? { ...seat, steps: (seat.steps ?? 0) + 1, activity } : seat)) })))
}

// The engine resumes a finished seat only while its agent type is offered, and the types are otherwise hidden from the main model.
let resuming = 0

async function stopRun($: EngineInterface, id: string): Promise<string> {
  const list = await readRuns($)
  const live = [...list].reverse().filter(isLive)
  const run = id === '' ? live[0] : live.find(one => one.id === id)
  if (!run) return id === '' ? 'No run is in progress.' : `No run "${id}" is in progress.`

  if (run.kind === 'panel') {
    await patchRun($, run.id, current => ({ ...current, isStopping: true }))

    return run.rounds > 1 ? `Panel ${run.id} ends after round ${Math.max(run.round, 1)}; its seats finish that round first.` : `Panel ${run.id} has one round and ends when its seats finish.`
  }
  await patchRun($, run.id, current => ({ ...current, rounds: Math.max(current.round, 1) }))

  return `Ping-pong ${run.id} ends after round ${Math.max(run.round, 1)}.`
}

export const register: Register = (on, options) => {
  const config = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panel', description: 'Ask a panel of Claude agents (model:effort each) one question', argumentHint: '[seats|preset] [rounds=N] -- <question> | help' })
    await $.command.register({ name: 'panel-view', description: 'Open the agent panel pane' })
    await $.command.register({ name: 'panel-design', description: 'Show where the page design comes from, or write a copy to change', argumentHint: '[copy [user|project]]' })
    await $.command.register({ name: 'panel-stop', description: 'End a panel or ping-pong run after its current round', argumentHint: '[run id]' })
    await $.command.register({ name: 'panel-preset', description: 'Save, list and delete agent panel presets', argumentHint: 'save <name> <seats> | list | show <name> | delete <name> | skills [filter] | help' })
    await $.command.register({ name: 'pingpong', description: 'Ping-pong plan with two Claude agents (model:effort each)', argumentHint: '[seats|preset] [rounds=N] -- <task> | help' })

    const seatSchema = { type: 'array', items: { type: 'string' }, description: 'Seats as model:effort[:contrarian][+skill], e.g. "opus:xhigh". Models: opus, sonnet, haiku, fable. Efforts: low, medium, high, xhigh, max.' }
    await $.tool.register({
      name: 'panel',
      description: 'Ask several read-only Claude subagents the same question independently, each at its own model and effort. Use when the user asks for an agent panel or several opinions. Write a self-contained question with the facts they need. Set rounds above 1 only when the user asks for a discussion or debate: every extra round runs every seat again, each reading the others and replying. Returns at once; the answers arrive later as a new message for you to synthesise.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, seats: seatSchema, preset: PRESET_INPUT, rounds: { type: 'number', minimum: 1, maximum: MAX_ROUNDS }, brief: { type: 'string', description: 'A review brief by name that every seat applies to the question, e.g. "bughunt", "security", "regression", "contracts"; the question then names what to review' } }, required: ['question'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'pingpong',
      description: 'Ping-pong planning: two read-only Claude subagents each draft a plan, you merge them, then each round the first challenges the plan and the second integrates the supported corrections. Use when the user asks for ping-pong planning. Write a self-contained task brief. Returns at once; the drafts arrive later as a new message.',
      inputSchema: { type: 'object', properties: { task: { type: 'string' }, seats: { ...seatSchema, minItems: 2, maxItems: 2 }, preset: PRESET_INPUT, rounds: { type: 'number', minimum: 1, maximum: MAX_ROUNDS } }, required: ['task'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'pingpong_merge',
      description: 'Hand the merged candidate plan of a ping-pong run back to its agents to start the challenge rounds.',
      inputSchema: { type: 'object', properties: { runId: { type: 'string' }, plan: { type: 'string' } }, required: ['runId', 'plan'] },
      isDeferred: false,
    })

    const lines = { type: 'array', items: { type: 'string' } }
    await $.tool.register({
      name: 'verdict',
      description: "Record your synthesis of a finished agent panel, or your read of a finished ping-pong plan, on its page. Call it once, after checking the claims, when a run's results ask for it. Every text field takes plain sentences with inline Markdown.",
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          headline: { type: 'string', description: 'The bottom line in one or two sentences' },
          author: { type: 'string', description: 'Your model name, e.g. Claude Opus 5.5' },
          conclusions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, detail: { type: 'string', description: 'The evidence, in a sentence or two' }, basis: { type: 'string', enum: ['independent', 'discussion'] } }, required: ['text'] } },
          changes: { type: 'array', items: { type: 'object', properties: { seat: { type: 'number' }, rounds: { type: 'string', description: 'e.g. "Round 2"' }, text: { type: 'string', description: 'From what to what, and on whose argument' }, holds: { type: 'string', description: 'Whether the evidence behind the move holds' } }, required: ['text'] } },
          rejected: lines,
          disagreements: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'The question in dispute' }, sides: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, evidence: { type: 'string' } }, required: ['who', 'evidence'] } }, settle: { type: 'string', description: 'What would settle it' } }, required: ['text'] } },
          uncertainty: lines,
          blindSpots: lines,
          ending: { type: 'string' },
          checks: { type: 'array', items: { type: 'object', properties: { round: { type: 'number' }, seat: { type: 'number' }, text: { type: 'string' } }, required: ['round', 'seat', 'text'] } },
          plan: { type: 'string', description: 'Ping-pong only: the full corrected plan in Markdown, when your checks changed the final plan' },
          figures: { type: 'array', description: 'Optional illustrations, only when the request for this verdict gives rules for them', items: { type: 'object', properties: { svg: { type: 'string', description: 'One <svg> element with a viewBox' }, caption: { type: 'string', description: 'One sentence that states what the figure shows' } }, required: ['svg', 'caption'] } },
        },
        required: ['runId', 'headline'],
      },
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

  on('agent.offer', ($, e, next) => {
    if (e.agent.startsWith(`${PLUGIN}:`) && resuming === 0) return { isOffered: false }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'task-notification') return next(e)
    const list = await readRuns($)
    const note = collectedNote(list, e.text)

    if (note === undefined) return next(e)

    return { drop: note }
  })

  on('command.run', { command: 'panel-stop' }, async ($, e) => ({ text: await stopRun($, e.args.trim()) }))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) await noteActivity($, e.agentId, activityOf(e.tool, e as unknown as Record<string, unknown>)).catch(() => undefined)

    return next(e)
  })

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
    const input = e as unknown as ToolInput & { question: string; rounds?: number }
    const built = toolArgs(input)
    if ('error' in built) return { deny: built.error }
    const launched = await launch($, 'panel', `${built.args} -- ${input.question}`, config, input.rounds)

    if ('started' in launched) return { result: launched.started }

    return { deny: launched.errors.join('\n') }
  })

  on('tool.call', { tool: 'mcp__agent-panel__pingpong' }, async ($, e) => {
    const input = e as unknown as ToolInput & { task: string; rounds?: number }
    const built = toolArgs({ preset: input.preset, seats: input.seats })
    if ('error' in built) return { deny: built.error }
    const launched = await launch($, 'pingpong', `${built.args} -- ${input.task}`, config, input.rounds)

    if ('started' in launched) return { result: launched.started }

    return { deny: launched.errors.join('\n') }
  })

  on('tool.call', { tool: 'mcp__agent-panel__git' }, async ($, e) => {
    const input = e as unknown as { command: string; args?: string[] }
    const args = input.args ?? []
    const refusal = gitRefusal(input.command, args)
    if (refusal !== undefined) return { deny: refusal }

    const ran = await $.process.run(['git', '--no-pager', input.command, ...gitHelperOptions(input.command), ...args])
    if (ran.exitCode !== 0) return { result: `git exited ${ran.exitCode}: ${ran.stderr.trim()}` }
    if (ran.stdout.length > GIT_OUTPUT_LIMIT) return { result: `${ran.stdout.slice(0, GIT_OUTPUT_LIMIT)}\n(cut at ${GIT_OUTPUT_LIMIT} characters; narrow the command)` }

    return { result: ran.stdout || '(no output)' }
  })

  on('tool.call', { tool: 'mcp__agent-panel__verdict' }, async ($, e) => {
    const runId = String((e as unknown as { runId?: unknown }).runId ?? '')
    const run = await findRun($, runId)
    if (!run) return { deny: `No panel or ping-pong run "${runId}".` }
    if (run.dir === undefined || run.page === undefined) return { deny: `Run ${run.id} has no page because its answers were not saved to files. Give the ${run.kind === 'panel' ? 'synthesis' : 'plan'} in the chat instead.` }
    const verdict = readVerdict(e)
    if ('error' in verdict) return { deny: verdict.error }

    try {
      const data = { ...(JSON.parse(await $.fs.read(`${run.dir}/discussion.json`)) as AnyPage), verdict, rev: await $.clock.now() }
      await putPage($, run.dir, data)
      await $.fs.write(`${run.dir}/discussion.artifact.html`, pageHtml(data, await loadPageAssets($), 'artifact'))
      await syncHistory($, run.id)
    } catch (error) {
      return { deny: `The verdict was not added to the page: ${reason(error)}. Give the ${run.kind === 'panel' ? 'synthesis' : 'plan'} in the chat instead.` }
    }

    return { result: `${run.kind === 'panel' ? 'The verdict is on the discussion page' : 'The summary is on the plan page'}: ${fileUrl(run.page)}\nGive the user that link. Publish ${run.dir}/discussion.artifact.html with the Artifact tool only if the user asks for a claude.ai link.` }
  })

  on('tool.call', { tool: 'mcp__agent-panel__pingpong_merge' }, async ($, e) => {
    const input = e as unknown as { runId: string; plan: string }
    const run = await findRun($, input.runId)
    if (!run || run.kind !== 'pingpong') return { deny: `No ping-pong run "${input.runId}".` }

    const claimed = await claimStep($, run.id, 'merging', 'challenging', () => true)
    if (!claimed) return { deny: `Ping-pong ${run.id} is ${run.phase}, not waiting for a merge.` }

    const started = await patchRun($, run.id, current => ({ ...current, candidate: input.plan, plans: [input.plan], round: 1 }))
    if (started) {
      await saveArtifact($, started, 'candidate', 'Merged candidate plan', input.plan)
      await askSeat($, started, 0, isContinued => challengeBrief(input.plan, 1, started.rounds, isContinued))
      await writePage($, run.id)
    }
    const after = await findRun($, run.id)
    if (after?.phase === 'failed') {
      await patchRun($, run.id, current => ({ ...current, isReported: true }))
      return { result: `Ping-pong ${run.id} stopped: ${run.seats[0]?.label} could not start. ${after.seats[0]?.answer ?? ''} Tell the user the rounds did not run.` }
    }
    $.ui.status(`pingpong ${run.id}: round 1 of ${run.rounds}`)

    return { result: `Candidate handed to ${run.seats[0]?.label} to challenge. ${run.rounds} round(s); the final plan arrives as a new message.` }
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (agentId === undefined) return yield* next(e)
    const stream = next(e)
    let isFirstText = true
    for await (const chunk of stream) {
      if (chunk.kind === 'text' || chunk.kind === 'thinking') {
        noteStream(agentId, chunk.kind, chunk.text, isFirstText && chunk.kind === 'text')
        if (chunk.kind === 'text') isFirstText = false
      }
      yield chunk
    }
    const result = await stream.result
    liveTokens.set(agentId, (liveTokens.get(agentId) ?? 0) + usageTokens(result.usage))

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) return result
    streams.delete(e.agentId)
    const counted = liveTokens.get(e.agentId) ?? 0
    liveTokens.delete(e.agentId)

    const list = await readRuns($)
    for (const run of list) {
      const index = run.seats.findIndex(seat => seat.agentId === e.agentId && seat.status === 'working')
      if (index === -1) continue

      const isAnswered = e.reason === 'answer' && e.answer.trim() !== ''
      const spent = { durationMs: (run.seats[index]?.durationMs ?? 0) + e.durationMs, tokens: (run.seats[index]?.tokens ?? 0) + (usageTokens(e.usage) || counted), activity: '' }
      const updated = await patchSeat($, run.id, index, isAnswered
        ? { status: 'done', answer: e.answer, ...spent }
        : { status: 'failed', answer: `(failed: ${e.reason === 'answer' ? 'empty answer' : e.reason})`, ...spent, ...(e.reason === 'aborted' ? { isInterrupted: true } : {}) })
      if (updated && isAnswered) {
        const artifact = artifactOf(run, index)
        await saveArtifact($, updated, artifact.file, artifact.title, e.answer)
      }
      const advanceWritesPage = run.kind === 'pingpong' && run.phase !== 'drafting'
      if (!advanceWritesPage) await writePage($, run.id)
      if (updated) await advance($, updated)
    }

    return result
  })

  on('command.run', { command: 'panel-preset' }, async ($, e) => ({ text: await presetCommand($, e.args, config) }))

  on('command.run', { command: 'panel-design' }, async ($, e) => ({ text: await designCommand($, e.args) }))

  on('command.run', { command: 'panel-view' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent panel' })
    return { text: 'Agent panel opened.' }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'panel' } }, ($, e) => drawCommandOutput($.ui.resolve(e), e.props.text))
  on('ui.render', { component: 'CommandOutput', props: { command: 'pingpong' } }, ($, e) => drawCommandOutput($.ui.resolve(e), e.props.text))
  on('ui.render', { component: 'CommandOutput', props: { command: 'panel-preset' } }, ($, e) => drawCommandOutput($.ui.resolve(e), e.props.text))
  on('ui.render', { component: 'CommandOutput', props: { command: 'panel-design' } }, ($, e) => drawCommandOutput($.ui.resolve(e), e.props.text))
  on('ui.render', { component: 'CommandOutput', props: { command: 'panel-stop' } }, ($, e) => drawCommandOutput($.ui.resolve(e), e.props.text))
  on('ui.render', { component: 'CommandOutput', props: { command: 'panel-view' } }, ($, e) => drawCommandOutput($.ui.resolve(e), e.props.text))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const all = await readRuns($)
    const list = [...all].reverse()
    if (!list.some(isLive)) stopTicker()
    if (list.length === 0) return <Text dimColor>No panels yet. Try /panel or /pingpong.</Text>

    const now = await $.clock.now()
    const width = Math.max(36, e.props.bodyColumns)
    const size = TEXT_SIZES[textSize]
    const rows = size ?? (e.props.placement === 'dock' ? 5 : 2)
    const cards = list.filter((run, i) => isLive(run) || i === 0).slice(0, 4)
    const earlier = list.filter(run => !cards.includes(run))
    const counts = [
      { text: `${spinner(now)} ${list.filter(isLive).length} live`, tone: 'live' as const, count: list.filter(isLive).length },
      { text: `✓ ${list.filter(run => run.phase === 'done').length} done`, tone: 'good' as const, count: list.filter(run => run.phase === 'done').length },
      { text: `✗ ${list.filter(run => run.phase === 'failed').length} failed`, tone: 'bad' as const, count: list.filter(run => run.phase === 'failed').length },
    ].filter(one => one.count > 0)

    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between" paddingX={1}>
          <Box columnGap={2}>
            {counts.map(one => (
              <Text color={TONE_COLOR[one.tone]} key={one.tone}>{one.text}</Text>
            ))}
          </Box>
          <Button key="text-size" onPress={() => cycleTextSize($)} plain>
            <Text color="suggestion">{`≡ text ${size === undefined ? 'auto' : size === 0 ? 'off' : `${size} lines`}`}</Text>
          </Button>
        </Box>
        {cards.map(run => drawCard(kit, run, now, width, isLive(run) ? rows : Math.min(rows, 2), () => void openRun($, run.id)))}
        {earlier.length === 0 ? null : <Text dimColor>{` earlier`}</Text>}
        {earlier.map(run => drawLine(kit, run, now, width, () => void openRun($, run.id)))}
      </Box>
    )
  })
}
