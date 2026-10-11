import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const BUILT_IN_BRIEF = 'Hunt for real bugs.\n\nFor each finding give severity.'
const SOLO_TEMPLATES = [
  { id: 7, name: 'brief-pq - Performance and Queries', description: 'Costs that grow with data.' },
  { id: 8, name: 'orchestrator-playbook', description: 'Mentions brief-writing.' },
]

function fakeEngine(on: On) {
  const spawns: string[] = []
  const writes: Record<string, string> = {}
  const solo: { tool: string; args: Record<string, unknown> }[] = []
  const git: string[][] = []
  const isOwnFolder = (path: string) => path.startsWith('.claude') || path.startsWith('/home/me')
  const answer = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })

  on('agent.register', (_$, e) => ({ value: { agent: `agent-panel:${e.name}` } }))
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
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    if (isOwnFolder(e.path) || !e.path.endsWith('/briefs/bughunt.md')) throw new Error('ENOENT')
    return { value: BUILT_IN_BRIEF }
  })
  on('fs.list', (_$, e) => {
    if (isOwnFolder(e.path) || !e.path.endsWith('/briefs')) throw new Error('ENOENT')
    return { value: [{ name: 'bughunt.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('mcp.call', (_$, e) => {
    solo.push({ tool: e.tool, args: e.args })
    if (e.tool === 'list_prompt_templates') return answer(SOLO_TEMPLATES)
    if (e.tool === 'get_prompt_template') return answer({ id: 7, body: 'Review the work for costs that grow.' })
    if (e.tool === 'scratchpad_write') return answer({ created: true, scratchpad_id: 501, revision: 1 })
    return answer({ scratchpad_id: 501, revision: 2 })
  })
  on('process.run', (_$, e) => {
    git.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'diff --git a/x b/x', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { spawns, writes, solo, git }
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

  const started = await $.command.run({ ...COMMAND, command: 'pingpong', args: 'Plan the billing move' })

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

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'quick brief=bughunt save=off -- the retry changes' })
  expect(started.text).toContain('brief "bughunt"')
  expect(fake.spawns).toHaveLength(3)
  expect(fake.spawns[0]).toContain('For each finding give severity.')
  expect(fake.spawns[0]).toContain('the retry changes')

  const refused = await $.command.run({ ...COMMAND, command: 'panel', args: 'brief=nope save=off -- q' })
  expect(refused.text).toContain('No brief named "nope". Known briefs: bughunt.')
  expect((await $.command.run({ ...COMMAND, command: 'pingpong', args: 'brief=bughunt -- Plan it' })).text).toContain('brief= applies to /panel only.')
  expect(fake.spawns).toHaveLength(3)
  expect(Object.keys(fake.writes)).toHaveLength(0)
})

test('Solo templates named brief-<name> are briefs only when the setting is on', { options: { soloBriefs: true, save: 'off' } }, async ($, on) => {
  const fake = fakeEngine(on)

  const help = (await $.command.run({ ...COMMAND, command: 'panel', args: 'help' })).text
  expect(help).toContain('pq           solo')
  expect(help).not.toContain('orchestrator')

  await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low brief=pq -- the feed query' })
  expect(fake.spawns[0]).toContain('Review the work for costs that grow.')
  expect(fake.solo.map(call => call.tool)).toContain('get_prompt_template')
})

test('Solo is not asked for briefs with the setting off', { options: { save: 'off' } }, async ($, on) => {
  const fake = fakeEngine(on)

  expect((await $.command.run({ ...COMMAND, command: 'panel', args: 'brief=pq -- q' })).text).toContain('No brief named "pq"')
  expect(fake.solo).toHaveLength(0)
})

test('answers are saved to files by default, under the runs folder and the project', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'panel', args: 'haiku:low -- Why is the feed slow?' })

  const [path] = Object.keys(fake.writes)
  expect(path).toMatch(/^\/home\/me\/\.claude\/agent-panel\/runs\/feed-app\/2026-10-11-[0-9a-f]{6}-why-is-the-feed-slow\/question\.md$/)
  expect(fake.writes[path ?? '']).toContain('Why is the feed slow?')
  expect(started.text).toContain('The answers are saved in /home/me/.claude/agent-panel/runs/feed-app/')
  expect(fake.solo).toHaveLength(0)
})

test('save=solo opens a numbered scratchpad for the run and writes no files', async ($, on) => {
  const fake = fakeEngine(on)

  const started = await $.command.run({ ...COMMAND, command: 'pingpong', args: 'save=solo -- Plan the billing move' })

  expect(started.text).toContain('The answers are saved in the Solo scratchpad "501. Ping-pong ')
  expect(fake.solo.map(call => call.tool)).toEqual(['scratchpad_write', 'scratchpad_rename'])
  expect(fake.solo[0]?.args.tags).toEqual(['agent-panel', 'pingpong'])
  expect(Object.keys(fake.writes)).toHaveLength(0)
})

test('the git tool runs read commands by argv and refuses the rest', async ($, on) => {
  const fake = fakeEngine(on)

  const diff = await $.tool.call({ tool: 'mcp__agent-panel__git', command: 'diff', args: ['HEAD~1', '--stat'] } as never)
  expect(diff.result).toContain('diff --git')
  expect(fake.git[0]).toEqual(['git', '--no-pager', 'diff', 'HEAD~1', '--stat'])

  expect((await $.tool.call({ tool: 'mcp__agent-panel__git', command: 'push' } as never)).deny).toContain('git push is not available')
  expect((await $.tool.call({ tool: 'mcp__agent-panel__git', command: 'log', args: ['--output=x'] } as never)).deny).toContain('read-only')
  expect(fake.git).toHaveLength(1)
})
