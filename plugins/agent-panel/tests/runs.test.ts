import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { helpLines } from '../hooks/help'

const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const BUILT_IN_BRIEF = 'Hunt for real bugs.\n\nFor each finding give severity.'
const USER_PRESETS = '/home/me/.claude/agent-panel/presets.json'
const PROJECT_PRESETS = '.claude/agent-panel/presets.json'
const ADS_SKILL = '---\nname: ads\ndescription: Paid advertising campaigns.\nallowed-tools: Bash\n---\n\n# Paid Ads\n\nBe a performance marketer.'

const BUILT_IN_DESIGN = '---\nname: Plain\nwebfonts: https://fonts.example/css2?family=A\naccent: #2a3fa8\nink: #18202c\n---\n\n## Writing\n\nLead with the point.\n\n## Illustrations\n\nDraw only structure.\n'
const USER_DESIGN = '/home/me/.claude/agent-panel/design.md'

function fakeEngine(on: On, files: Record<string, string> = {}) {
  const spawns: string[] = []
  const registers: string[] = []
  const store = { ...files }
  const local = (path: string) => (path.startsWith('/home/me/') || !path.includes('/.claude/') ? path : path.slice(path.indexOf('/.claude/') + 1))
  const isDir = (path: string) => Object.keys(store).some(key => key.startsWith(`${local(path)}/`))
  const writes: Record<string, string> = {}
  const git: string[][] = []
  const isOwnFolder = (path: string) => path.includes('/.claude/')

  on('agent.register', (_$, e) => {
    registers.push(JSON.stringify(e))
    return { value: { agent: `agent-panel:${e.name}` } }
  })
  on('command.list', () => ({
    value: [
      { name: 'help', description: '', source: 'builtin' },
      { name: 'house-style', description: '', source: 'user' },
    ],
  }))
  on('fs.exists', (_$, e) => ({ value: local(e.path) in store || isDir(e.path) }))
  on('fs.stat', (_$, e) => {
    if (!(local(e.path) in store) && !isDir(e.path)) throw new Error('ENOENT')
    return { value: { kind: isDir(e.path) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('agent.spawn', (_$, e) => {
    spawns.push(JSON.stringify(e))
    return { deny: 'no subagents in tests' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.root', () => ({ value: '/work/Feed App' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 11, 3) }))
  on('fs.write', (_$, e) => {
    writes[local(e.path)] = e.text
    store[local(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    if (local(e.path) in store) return { value: store[local(e.path)] ?? '' }
    if (/\/page\/design\.md$/.test(e.path)) return { value: BUILT_IN_DESIGN }
    if (/\/page\/(page\.css|page\.js|marked\.min\.js)$/.test(e.path)) return { value: `/* ${e.path.split('/').pop()} */` }
    if (isOwnFolder(e.path) || !e.path.endsWith('/briefs/bughunt.md')) throw new Error('ENOENT')
    return { value: BUILT_IN_BRIEF }
  })
  on('fs.list', (_$, e) => {
    if (isDir(e.path)) {
      const names = [...new Set(Object.keys(store).filter(key => key.startsWith(`${e.path}/`)).map(key => key.slice(e.path.length + 1).split('/')[0] ?? ''))]
      return { value: names.map(name => ({ name, kind: isDir(`${e.path}/${name}`) ? ('dir' as const) : ('file' as const), size: 1, mtimeMs: 0, isLink: false })) }
    }
    if (isOwnFolder(e.path) || !e.path.endsWith('/briefs')) throw new Error('ENOENT')
    return { value: [{ name: 'bughunt.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('process.run', (_$, e) => {
    git.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'diff --git a/x b/x', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { spawns, registers, writes, git, spawnOf: (label: string) => spawns.find(spawn => spawn.includes(label)) ?? '' }
}

test('a bare command prints its usage', async ($, on) => {
  fakeEngine(on)
  expect((await $.command.run({ ...COMMAND, command: 'panel', args: '' })).text).toContain('Usage: /panel')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: '  ' })).text).toContain('Usage: /pingpong')
})

test('help lists the options and presets without spawning', async ($, on) => {
  const fake = fakeEngine(on)
  const panel = (await $.command.run({ ...COMMAND, command: 'panel', args: 'help' })).text
  expect(panel).toContain('Usage: /panel')
  expect(panel).toContain('review')
  expect(panel).toContain('xhigh')

  const pingpong = (await $.command.run({ ...COMMAND, command: 'pingpong', args: ' --help ' })).text
  expect(pingpong).toContain('duo')
  expect(pingpong).not.toContain('review')
  expect(fake.spawns).toHaveLength(0)
})

test('bad seats and a three-seat ping-pong are refused before anything spawns', async ($, on) => {
  const fake = fakeEngine(on)
  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:ultra -- q' })).text).toContain('"opus:ultra" is not a seat')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'deep -- q' })).text).toContain('exactly two seats')
  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high' })).text).toContain('No question given')
  expect(fake.spawns).toHaveLength(0)
})

test('each seat spawns as the hidden agent type for its model and effort, and a refused spawn is reported', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:xhigh sonnet:low:contrarian -- Why is the feed slow?' })

  expect(fake.spawns).toHaveLength(2)
  expect(fake.spawns[0]).toContain('agent-panel:opus-xhigh')
  expect(fake.spawns[1]).toContain('agent-panel:sonnet-low')
  expect(fake.spawns[1]).toContain('PASS')
  expect(started.text).toContain('2. sonnet·low contrarian (claude-sonnet-5-5, effort low)')
  expect(started.text).toContain('did not start: (failed: no subagents in tests)')
})

test('ping-pong defaults to the duo preset and one round', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'pingpong', args: '-- Plan the billing move' })

  expect(started.text).toContain('1 round(s)')
  expect(fake.spawns[0]).toContain('agent-panel:opus-high')
  expect(fake.spawns[1]).toContain('agent-panel:sonnet-high')
})

test('a merge for an unknown run is refused', async ($, on) => {
  fakeEngine(on)
  const merged = await $.tool.call({ tool: 'mcp__agent-panel__pingpong_merge', runId: 'nope', plan: 'x' } as never)
  expect(merged.deny).toContain('No ping-pong run "nope"')
})

test('rounds outside 1 to 5 from the tool or the command are refused before anything spawns', async ($, on) => {
  const fake = fakeEngine(on)
  for (const rounds of [0, 6, 1.5]) {
    const refused = await $.tool.call({ tool: 'mcp__agent-panel__pingpong', task: 'Plan it', rounds } as never)
    expect(refused.deny).toContain('rounds must be a whole number from 1 to 5.')
  }
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'rounds=9 -- Plan it' })).text).toContain('"rounds=9": rounds must be')
  expect(fake.spawns).toHaveLength(0)
})

test('a brief reaches every seat, and an unknown one is refused with the known names', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'quick brief=bughunt -- the retry changes' })
  expect(started.text).toContain('brief "bughunt"')
  expect(fake.spawns).toHaveLength(3)
  expect(fake.spawns[0]).toContain('For each finding give severity.')
  expect(fake.spawns[0]).toContain('the retry changes')

  const written = Object.keys(fake.writes).length
  const refused = await $.command.run({ ...COMMAND, command: 'panel', args: 'brief=nope -- q' })
  expect(refused.text).toContain('No brief named "nope". Known briefs: bughunt.')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'brief=bughunt -- Plan it' })).text).toContain('brief= applies to /panel only.')
  expect(fake.spawns).toHaveLength(3)
  expect(Object.keys(fake.writes)).toHaveLength(written)
})

test('answers are saved to files by default, under the runs folder and the project', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low -- Why is the feed slow?' })

  const [path] = Object.keys(fake.writes)
  expect(path).toMatch(/^\/home\/me\/\.claude\/agent-panel\/runs\/feed-app\/2026-10-11-[0-9a-f]{6}-why-is-the-feed-slow\/question\.md$/)
  expect(fake.writes[path ?? '']).toContain('Why is the feed slow?')
  expect(started.text).toContain('The answers are saved in /home/me/.claude/agent-panel/runs/feed-app/')
})

test('the git tool runs read commands by argv and refuses the rest', async ($, on) => {
  const fake = fakeEngine(on)

  const diff = await $.tool.call({ tool: 'mcp__agent-panel__git', command: 'diff', args: ['HEAD~1', '--stat'] } as never)
  expect(diff.result).toContain('diff --git')
  expect(fake.git[0]).toEqual(['git', '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD~1', '--stat'])

  expect((await $.tool.call({ tool: 'mcp__agent-panel__git', command: 'push' } as never)).deny).toContain('git push is not available')
  expect((await $.tool.call({ tool: 'mcp__agent-panel__git', command: 'log', args: ['--output=x'] } as never)).deny).toContain('read-only')
  expect(fake.git).toHaveLength(1)
})

test('a folder skill reaches the seat as text on the plain agent type, and a session skill is preloaded by name', async ($, on) => {
  const fake = fakeEngine(on, { '/skills/mk/ads/SKILL.md': ADS_SKILL })

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low+ads haiku:medium+house-style skills=/skills/mk -- Critique the home page' })

  expect(fake.spawnOf('haiku·low +ads')).toContain('Be a performance marketer.')
  expect(fake.spawnOf('haiku·low +ads')).toContain('Base directory: /skills/mk/ads')
  expect(fake.spawnOf('haiku·low +ads')).toContain('"subagent_type":"agent-panel:haiku-low"')
  expect(fake.spawnOf('haiku·low +ads')).not.toContain('allowed-tools')
  expect(fake.spawnOf('haiku·medium +house-style')).not.toContain('Be a performance marketer.')
  expect(fake.registers.filter(spec => spec.includes('Be a performance marketer.'))).toHaveLength(0)
  expect(fake.registers.filter(spec => spec.includes('"skills":["house-style"]'))).toHaveLength(1)
  expect(started.text).toContain('Seat 1 +ads: /skills/mk/ads')
  expect(started.text).toContain('Seat 2 +house-style: session skill')
  expect(started.text).not.toContain('no skill')
})

test('folders from the Skill folders setting apply without skills=', { options: { skillDirs: '/skills/mk, /skills/other' } }, async ($, on) => {
  const fake = fakeEngine(on, { '/skills/mk/ads/SKILL.md': ADS_SKILL })

  await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low+ads -- q' })

  expect(fake.spawns[0]).toContain('Be a performance marketer.')
})

test('a skill found nowhere is warned about with the nearest names, and a path-like name never reads a folder', async ($, on) => {
  const fake = fakeEngine(on, { '/skills/mk/ad-creative/SKILL.md': ADS_SKILL, '/x/SKILL.md': 'OUTSIDE TEXT' })

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low+ads-creative haiku:low+../../x skills=/skills/mk -- q' })

  expect(started.text).toContain('Seat 1: no skill "ads-creative" in the skill folders or this session; the seat may run without it. Did you mean ad-creative?')
  expect(started.text).toContain('Seat 2: no skill "../../x"')
  expect(started.text).not.toContain('session skill')
  expect(fake.spawns).toHaveLength(2)
  expect(fake.spawns.join('')).not.toContain('OUTSIDE TEXT')
})

test('a preset is saved, listed, run, refused a second time without force, and deleted', async ($, on) => {
  const fake = fakeEngine(on, { '/skills/mk/ads/SKILL.md': ADS_SKILL })

  const saved = await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'save content-council skills=/skills/mk haiku:low+ads haiku:medium:contrarian' })
  expect(saved.text).toContain(`Saved preset "content-council" in ${USER_PRESETS}`)
  expect(JSON.parse(fake.writes[USER_PRESETS] ?? '{}')).toEqual({ 'content-council': { seats: ['haiku:low+ads', 'haiku:medium:contrarian'], skillDirs: ['/skills/mk'] } })

  const listed = (await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'list' })).text
  expect(listed).toContain('content-council')
  expect(listed).toContain('skills from /skills/mk')
  expect(listed).toMatch(/^Built-in presets\n  deep {13}opus:xhigh/)
  expect(listed).toContain(`Your presets  ~/.claude/agent-panel/presets.json\n  content-council  haiku:low +ads\n                   haiku:medium:contrarian`)
  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'show content-council' })).text).toContain('Seat 1 +ads: /skills/mk/ads')
  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'skills' })).text).toContain('Paid advertising campaigns. [not applied: allowed-tools]')

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'content-council -- Critique the home page' })
  expect(started.text).toContain('Preset "content-council" (user).')
  expect(fake.spawns).toHaveLength(2)
  expect(fake.spawnOf('haiku·low +ads')).toContain('Be a performance marketer.')

  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'save content-council haiku:low' })).text).toContain('Add force to replace it.')
  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'save content-council haiku:low force' })).text).toContain('Saved preset')
  expect(JSON.parse(fake.writes[USER_PRESETS] ?? '{}')).toEqual({ 'content-council': ['haiku:low'] })

  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'delete content-council' })).text).toContain('Deleted preset "content-council"')
  expect(JSON.parse(fake.writes[USER_PRESETS] ?? 'null')).toEqual({})
  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'delete quick' })).text).toContain('built-in preset')
})

test('bad preset saves are refused and write nothing', async ($, on) => {
  const fake = fakeEngine(on)
  const save = async (args: string) => (await $.command.run({ ...COMMAND, command: 'panel-preset', args: `save ${args}` })).text

  expect(await save('Opus haiku:low')).toContain('"opus" is reserved.')
  expect(await save('x haiku:low')).toContain('a preset name is 2 to 31')
  expect(await save('team')).toContain('Give at least one seat.')
  expect(await save('team haiku:low and more')).toContain('"and more" is not a seat, a preset or an option.')
  expect(await save('team haiku:low brief=nope')).toContain('No brief named "nope".')
  expect(await save('team haiku:low skills=/repo scope=project')).toContain('A project preset cannot carry skill folders')
  expect(await save('quick haiku:low scope=project')).toContain('that is a built-in')
  expect(Object.keys(fake.writes)).toHaveLength(0)

  expect(await save('team haiku:low scope=project')).toContain(`Saved preset "team" in ${PROJECT_PRESETS}`)
})

test('a project file wins over the user file but cannot replace a built-in or supply skill folders', async ($, on) => {
  const fake = fakeEngine(on, {
    [USER_PRESETS]: JSON.stringify({ team: ['haiku:low'], Loud: ['haiku:low'] }),
    [PROJECT_PRESETS]: JSON.stringify({
      team: ['haiku:medium', 'haiku:low'],
      quick: ['haiku:max'],
      borrowed: { seats: ['haiku:low+ads'], skillDirs: ['/repo/skills'] },
    }),
    '/repo/skills/ads/SKILL.md': 'REPO TEXT',
  })

  const help = (await $.command.run({ ...COMMAND, command: 'panel', args: 'help' })).text
  expect(help).toContain('"quick": a project file cannot replace a built-in preset.')
  expect(help).toContain('"borrowed": skill folders in a project file are not used.')
  expect(help).toContain(`${USER_PRESETS}: ignored "Loud"`)

  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'team -- q' })).text).toContain('Preset "team" (project).')
  expect(fake.spawns).toHaveLength(2)

  await $.command.run({ ...COMMAND, command: 'panel', args: '-- q' })
  expect(fake.spawns[2]).toContain('agent-panel:sonnet-medium')
  expect(fake.spawns).toHaveLength(5)

  await $.command.run({ ...COMMAND, command: 'panel', args: 'borrowed -- q' })
  expect(fake.spawns[5]).not.toContain('REPO TEXT')
})

test('a presets file that does not parse is reported by path and never overwritten', async ($, on) => {
  const fake = fakeEngine(on, { [USER_PRESETS]: '{ "team": [' })

  const refused = (await $.command.run({ ...COMMAND, command: 'panel', args: 'team -- q' })).text
  expect(refused).toContain('"team" is not a preset or a seat. Known presets: deep, quick, duo, review.')
  expect(refused).toContain(`${USER_PRESETS} could not be read`)

  expect((await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'save team haiku:low' })).text).toContain('It was left as it is')
  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low as=team -- q' })).text).toContain('It was left as it is')
  expect(Object.keys(fake.writes)).toHaveLength(0)
  expect(fake.spawns).toHaveLength(0)
})

test('as= saves the seats of a run that passes every check, and only then', async ($, on) => {
  const fake = fakeEngine(on)
  const panel = async (args: string) => (await $.command.run({ ...COMMAND, command: 'panel', args })).text

  expect(await panel('as=mini -- q')).toContain('as= needs seats or a preset on the line to save.')
  expect(await panel('haiku:low as=mini brief=nope -- q')).toContain('No brief named "nope"')
  expect(await panel('haiku:low as=quick -- q')).toContain('A preset named "quick" exists.')
  expect(Object.keys(fake.writes)).toHaveLength(0)

  expect(await panel('haiku:low haiku:medium:contrarian brief=bughunt as=mini -- q')).toContain(`Saved as preset "mini" in ${USER_PRESETS}.`)
  expect(JSON.parse(fake.writes[USER_PRESETS] ?? '{}')).toEqual({ mini: { seats: ['haiku:low', 'haiku:medium:contrarian'], brief: 'bughunt' } })
  expect(fake.spawns).toHaveLength(2)
  expect(await panel('haiku:low as=mini -- q')).toContain('A preset named "mini" exists.')
})

test('a preset supplies the brief to /panel and the rounds to /pingpong, and the command line wins', async ($, on) => {
  fakeEngine(on, { [USER_PRESETS]: JSON.stringify({ rev: { seats: ['haiku:low', 'haiku:medium'], brief: 'bughunt', rounds: 3 } }) })

  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'rev -- the retry changes' })).text).toContain('brief "bughunt"')

  const pingpong = (await $.command.run({ ...COMMAND, command: 'pingpong', args: 'rev -- Plan it' })).text
  expect(pingpong).toContain('3 round(s)')
  expect(pingpong).toContain('Brief "bughunt" from the preset is not used: briefs apply to /panel only.')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'rev rounds=2 -- Plan it' })).text).toContain('2 round(s)')
})

test('the tools take fields, not options, and an unknown preset is denied with the known names', async ($, on) => {
  const fake = fakeEngine(on)
  const panel = async (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__agent-panel__panel', question: 'q', ...input } as never)

  expect((await panel({ seats: ['haiku:low', 'as=sneaky'] })).deny).toContain('"as=sneaky" is not a seat.')
  expect((await panel({ preset: 'skills=/' })).deny).toContain('preset must be the name of one preset.')
  expect((await panel({ preset: 'quick as=sneaky' })).deny).toContain('preset must be the name of one preset.')
  expect((await panel({ preset: 'nope' })).deny).toContain('"nope" is not a preset or a seat. Known presets: deep, quick, duo, review.')
  expect((await $.tool.call({ tool: 'mcp__agent-panel__pingpong', task: 't', seats: ['haiku:low', 'rounds=5'] } as never)).deny).toContain('"rounds=5" is not a seat.')
  expect(Object.keys(fake.writes)).toHaveLength(0)
  expect(fake.spawns).toHaveLength(0)

  expect((await panel({ seats: ['haiku:low'] })).result).toContain('started')
})

test('the pane draws a card per run with its seats, on every surface', async ($, on) => {
  fakeEngine(on)
  await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:xhigh sonnet:low:contrarian -- Why is the feed slow?' })
  await $.command.run({ ...COMMAND, command: 'pingpong', args: '-- Plan the billing migration' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-panel',
      surface,
      component: 'Pane',
      requestId: 'agent-panel',
      props: { title: 'Agent panel', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })

    expect(await ui.find({ type: 'Text', text: /pingpong/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✗ failed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /opus·high/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Why is the feed slow\?/ })).toBeDefined()
    await ui.unmount()
  }
})

test('help and every other command output draw in colour', async ($, on) => {
  fakeEngine(on)
  on('ui.render', { component: 'CommandOutput' }, () => ({ type: 'Text', props: {}, children: ['engine row'] }))
  const help = (await $.command.run({ ...COMMAND, command: 'panel', args: 'help' })).text ?? ''

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-panel', surface, component: 'CommandOutput', props: { command: 'panel', args: 'help', text: help, isErrored: false } })
    const props = async (text: string) => (await ui.findAll({ type: 'Text', text: new RegExp(`^${text}$`) })).map(found => found.props)
    expect(await props('/panel-preset')).toContainEqual(expect.objectContaining({ color: 'claude' }))
    expect(await props('rounds=N')).toContainEqual(expect.objectContaining({ color: 'suggestion' }))
    expect(await props('Examples')).toContainEqual(expect.objectContaining({ bold: true }))
    await ui.unmount()
  }

  const listed = (await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'list' })).text ?? ''
  const list = await $.ui.mount({ plugin: 'agent-panel', surface: 'terminal', component: 'CommandOutput', props: { command: 'panel-preset', args: 'list', text: listed, isErrored: false } })
  expect((await list.findAll({ type: 'Text', text: /^Built-in presets$/ })).map(found => found.props)).toContainEqual(expect.objectContaining({ bold: true }))
  expect((await list.findAll({ type: 'Text', text: /^opus:xhigh$/ })).map(found => found.props)).toContainEqual(expect.objectContaining({ color: 'suggestion' }))
  await list.unmount()
})

test('a panel takes rounds from the command, states the cost, and opens no reply round when no seat answered', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high sonnet:high:contrarian rounds=3 -- Why is the feed slow?' })

  expect(started.text).toContain('started, up to 3 rounds:')
  expect(started.text).toContain('2 seats × 3 rounds = up to 6 agent runs')
  expect(started.text).toContain('Results arrive as a new message after the last round.')
  expect(fake.spawns).toHaveLength(2)
  expect(fake.spawns[0]).toContain('panel')
  expect(fake.spawns[0]).not.toContain('Panel discussion')
})

test('a panel without rounds starts as before', async ($, on) => {
  fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high sonnet:high -- Why is the feed slow?' })

  expect(started.text).not.toContain('rounds')
  expect(started.text).toContain('Results arrive as a new message when the agents finish.')
})

test('rounds on a one-seat panel are refused when typed and dropped with a note from a preset', async ($, on) => {
  const fake = fakeEngine(on, { [USER_PRESETS]: JSON.stringify({ solo: { seats: ['opus:high'], rounds: 2 }, pair: { seats: ['opus:high', 'sonnet:high'], rounds: 2 } }) })

  const typed = await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high rounds=2 -- Why?' })
  expect(typed.text).toContain('A discussion needs at least two seats; got 1.')
  expect(fake.spawns).toHaveLength(0)

  const alone = await $.command.run({ ...COMMAND, command: 'panel', args: 'solo -- Why?' })
  expect(alone.text).toContain('a discussion needs at least two seats: this runs one round.')
  expect(alone.text).not.toContain('up to')

  const pair = await $.command.run({ ...COMMAND, command: 'panel', args: 'pair -- Why?' })
  expect(pair.text).toContain('started, up to 2 rounds:')
  expect(pair.text).toContain('2 rounds come from the preset; rounds=1 on the command runs it without the discussion.')

  const single = await $.command.run({ ...COMMAND, command: 'panel', args: 'pair rounds=1 -- Why?' })
  expect(single.text).not.toContain('up to')
})

test('the panel tool takes rounds as a field and refuses values outside 1 to 5', async ($, on) => {
  const fake = fakeEngine(on)

  const refused = await $.tool.call({ tool: 'mcp__agent-panel__panel', question: 'Why?', seats: ['opus:high', 'sonnet:high'], rounds: 9 })
  expect(JSON.stringify(refused)).toContain('rounds must be a whole number from 1 to 5.')
  expect(fake.spawns).toHaveLength(0)

  const started = await $.tool.call({ tool: 'mcp__agent-panel__panel', question: 'Why?', seats: ['opus:high', 'sonnet:high'], rounds: 2 })
  expect(JSON.stringify(started)).toContain('up to 2 rounds')
})

test('panel help lists rounds= and how to manage presets, and /panel-stop with nothing running says so', async ($, on) => {
  fakeEngine(on)

  const help = (await $.command.run({ ...COMMAND, command: 'panel', args: 'help' })).text ?? ''
  expect(help).toContain('rounds=N     rounds, 1 to 5')
  expect(help).toContain('You have no saved presets yet.\n  See yours:  /panel-preset list')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'help' })).text).toContain('Remove one: /panel-preset delete <name>')
  expect((await $.command.run({ ...COMMAND, command: 'panel-stop', args: '' })).text).toBe('No run is in progress.')
  expect((await $.command.run({ ...COMMAND, command: 'panel-stop', args: 'zz' })).text).toBe('No run "zz" is in progress.')
})

test('a typo or a question without -- starts nothing and shows the help', async ($, on) => {
  const fake = fakeEngine(on)

  const typo = (await $.command.run({ ...COMMAND, command: 'panel', args: 'hep' })).text ?? ''
  expect(typo).toContain('"hep" is not a seat, a preset or an option. Nothing started.')
  expect(typo).toContain('Usage: /panel')
  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'deep why is the feed slow?' })).text).toContain('Nothing started: put -- before the question, as in /panel -- why is the feed slow?')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'Plan the billing move' })).text).toContain('put -- before the task, as in /pingpong -- Plan the billing move')
  expect(fake.spawns).toEqual([])
})

test('a panel writes its discussion page from the start, the verdict tool adds the synthesis, and the pane opens it', async ($, on) => {
  const fake = fakeEngine(on)
  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high sonnet:high -- Why is the feed slow?' })
  const id = /Panel (\w{6}) started/.exec(started.text ?? '')?.[1] ?? ''
  const page = Object.keys(fake.writes).find(path => path.endsWith('/discussion.html')) ?? ''
  const verdict = (input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__agent-panel__verdict', ...input } as never) as Promise<{ deny?: string; result?: string }>

  expect(started.text).toContain('The discussion page is file:///home/me/.claude/agent-panel/runs/feed-app/')
  expect(fake.writes[page]).toContain('Why is the feed slow?')
  expect(fake.writes[page]).toContain('/* marked.min.js */')
  expect(fake.writes[page.replace('.html', '.rev.js')]).toContain('__panelRev')

  expect((await verdict({ runId: id })).deny).toContain('needs a headline')
  expect((await verdict({ runId: 'nope00', headline: 'x' })).deny).toContain('No panel or ping-pong run "nope00".')
  const added = await verdict({ runId: id, headline: 'The join is the cost.', conclusions: [{ text: 'Index it.' }], checks: [{ round: '1', seat: 2, text: 'Confirmed.' }] })
  expect(added.result).toContain('The verdict is on the discussion page: file:///home/me/')
  expect(fake.writes[page]).toContain('The join is the cost.')
  expect(fake.writes[page]).not.toContain('data-poll')
  expect(fake.writes[page.replace('.html', '.artifact.html')]).toContain('cdnjs.cloudflare.com')
  expect(fake.writes[page.replace('.html', '.artifact.html')]).not.toContain('id="history"')
  expect(fake.writes[page]).toContain('<aside class="history" id="history"')
  const index = fake.writes[page.replace(/[^/]+\/discussion\.html$/, 'history.js')] ?? ''
  expect(index.startsWith('window.__panelHistory&&window.__panelHistory([')).toBe(true)
  expect(index).toContain(`"id":"${id}","kind":"panel","folder":"2026-10-11-${id}-why-is-the-feed-slow"`)
  expect(index).toContain('"headline":"The join is the cost."')

  const ui = await $.ui.mount({
    plugin: 'agent-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-panel',
    props: { title: 'Agent panel', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await ui.press({ key: `open-${id}` })
  expect(fake.git.at(-1)).toEqual(['open', page])
  await ui.unmount()
})

test('a ping-pong run writes a plan page, and the verdict tool adds the summary to it', async ($, on) => {
  const fake = fakeEngine(on)
  const started = await $.command.run({ ...COMMAND, command: 'pingpong', args: '-- Plan the billing move' })
  const id = /Ping-pong (\w{6}) started/.exec(started.text ?? '')?.[1] ?? ''
  const page = Object.keys(fake.writes).find(path => path.endsWith('/discussion.html')) ?? ''

  expect(started.text).toContain('The plan page is file:///home/me/.claude/agent-panel/runs/feed-app/')
  expect(fake.writes[page]).toContain('<title>Ping-pong ')
  expect(fake.writes[page]).toContain('Stopped before the merge: a draft failed.')
  expect(fake.writes[page]).toContain('This agent failed here. (failed: no subagents in tests)')
  expect(fake.writes[page]).not.toContain('id="plan"')

  const added = (await $.tool.call({ tool: 'mcp__agent-panel__verdict', runId: id, headline: 'Nothing was planned.', uncertainty: ['Run it again?'] } as never)) as { result?: string }
  expect(added.result).toContain('The summary is on the plan page: file:///home/me/')
  expect(fake.writes[page]).toContain('Decisions still open')
  expect(fake.writes[page]).toContain('Run it again?')
})

test('a user design file restyles the page, a figure is cleaned on its way in, and /panel-design reports and copies the design', async ($, on) => {
  const fake = fakeEngine(on, { [USER_DESIGN]: '---\naccent: #b4005a\n---\n\n## Styles\n\n```css\n.headline { font-weight: 400; }\n```\n' })
  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high -- Why is the feed slow?' })
  const id = /Panel (\w{6}) started/.exec(started.text ?? '')?.[1] ?? ''
  const page = Object.keys(fake.writes).find(path => path.endsWith('/discussion.html')) ?? ''
  const design = (args: string) => $.command.run({ ...COMMAND, command: 'panel-design', args }).then(ran => ran.text ?? '')

  expect(fake.writes[page]).toContain(':root {\n  --accent: #b4005a;\n  --ink: #18202c;\n}')
  expect(fake.writes[page]).toContain('.headline { font-weight: 400; }\n</style>')
  expect(fake.writes[page]).toContain('<link rel="stylesheet" href="https://fonts.example/css2?family=A">')

  await $.tool.call({ tool: 'mcp__agent-panel__verdict', runId: id, headline: 'The join.', figures: [{ svg: '<svg viewBox="0 0 720 80"><script>alert(1)</script><rect id="a" width="10" height="10" onclick="x()"/></svg>', caption: 'Shows it.' }] } as never)
  expect(fake.writes[page]).toContain('<div class="figure-art"><svg viewBox="0 0 720 80"><rect id="figure-1-a" width="10" height="10"/></svg></div>')

  expect(await design('')).toContain(`Page design: Plain. Built in at `)
  expect(await design('')).toContain(`Changed by ${USER_DESIGN} (user).`)
  expect(await design('copy')).toBe(`${USER_DESIGN} already exists and was left as it is.`)
  expect(await design('copy team')).toBe('Copy to "user" or "project", not "team".')
  expect(await design('paint')).toContain('Unknown option "paint".')
  expect(await design('copy project')).toContain('Wrote .claude/agent-panel/design.md.')
  expect(fake.writes['.claude/agent-panel/design.md']).toBe(BUILT_IN_DESIGN)
})

test('the first run in a project builds pages and a history for the runs already saved there', async ($, on) => {
  const old = '/home/me/.claude/agent-panel/runs/feed-app/2026-10-09-aa11bb-why-so-slow'
  const fake = fakeEngine(on, {
    [`${old}/question.md`]: 'Panel aa11bb\n\n1. opus·high (claude-opus-5-5, effort high)\n2. sonnet·high contrarian (claude-sonnet-5-5, effort high)\n\n## Question\n\nWhy so slow?\n',
    [`${old}/seat-1-opus-high.md`]: '# Seat 1: opus·high\n\nThe join.\n',
    '/home/me/.claude/agent-panel/runs/feed-app/notes/readme.md': 'not a run',
  })
  await $.command.run({ ...COMMAND, command: 'panel', args: 'opus:high -- Is it the cache?' })
  const index = fake.writes['/home/me/.claude/agent-panel/runs/feed-app/history.js'] ?? ''

  expect(fake.writes[`${old}/discussion.html`]).toContain('<title>Panel aa11bb</title>')
  expect(fake.writes[`${old}/discussion.html`]).toContain('Rebuilt from the saved answers.')
  expect(JSON.parse(fake.writes[`${old}/discussion.json`] ?? '{}').messages.map((message: { state: string }) => message.state)).toEqual(['answered', 'failed'])
  expect(index).toContain('"id":"aa11bb"')
  expect(index.indexOf('Is it the cache?')).toBeLessThan(index.indexOf('Why so slow?'))
  expect(index).not.toContain('notes')
})

test('a preset with a long name keeps its columns in the help, so its name is coloured', async ($, on) => {
  fakeEngine(on)
  await $.command.run({ ...COMMAND, command: 'panel-preset', args: 'save plu-word-of-mouth haiku:low haiku:medium' })
  const help = (await $.command.run({ ...COMMAND, command: 'panel', args: 'help' })).text ?? ''
  const line = help.split('\n').find(row => row.includes('plu-word-of-mouth')) ?? ''

  expect(line).toMatch(/^ {2}plu-word-of-mouth {2,}user {6}haiku:low haiku:medium$/)
  expect(helpLines(line)[0]?.filter(span => span.tone !== undefined).map(span => `${span.tone}:${span.text}`)).toEqual(['option:plu-word-of-mouth', 'quiet:user', 'option:haiku:low', 'option:haiku:medium'])
})
