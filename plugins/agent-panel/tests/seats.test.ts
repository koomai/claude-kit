import { expect, test } from 'claude-code/testing'

import {
  FALLBACK_PRESETS,
  agentTypeName,
  artifactOf,
  challengeBrief,
  clipAnswer,
  closeRound,
  collectedNote,
  costLine,
  excerptOf,
  gitHelperOptions,
  gitRefusal,
  ignoredSkillFeatures,
  integrateBrief,
  isFolderSkillName,
  isNoChange,
  isPass,
  movedIn,
  nearestNames,
  panelBrief,
  panelSynthesis,
  parseArgs,
  parseSeat,
  peerName,
  presetEntry,
  presetNameError,
  readPresetLayer,
  replyBrief,
  seatSpec,
  skillSummary,
  splitSections,
  splitSkill,
  standing,
  toolArgs,
  withSkills,
} from '../hooks/seats'
import type { Run, Seat } from '../types'

const EMPTY = { seats: [], skillDirs: [], presets: [], presetSkillDirs: [], notes: [], question: '', hasSeparator: false, errors: [] }

test('a seat carries model, effort, role and skills', () => {
  expect(parseSeat('opus:xhigh')).toEqual({ label: 'opus·xhigh', model: 'opus', effort: 'xhigh', role: 'panelist', skills: [], status: 'starting' })
  expect(parseSeat('Sonnet:HIGH:contrarian+laravel-php-standards')).toEqual({
    label: 'sonnet·high contrarian +laravel-php-standards',
    model: 'sonnet',
    effort: 'high',
    role: 'contrarian',
    skills: ['laravel-php-standards'],
    status: 'starting',
  })
  expect(parseSeat('opus:high+apps/web:deploy')?.skills).toEqual(['apps/web:deploy'])
  expect(parseSeat('opus:ultra')).toBe(undefined)
  expect(parseSeat('gpt:high')).toBe(undefined)
})

test('arguments split into seats, presets, rounds and the question', () => {
  const parsed = parseArgs('opus:xhigh sonnet:high rounds=3 -- Plan the  migration', FALLBACK_PRESETS)
  expect(parsed.seats.map(seat => seat.label)).toEqual(['opus·xhigh', 'sonnet·high'])
  expect(parsed.rounds).toBe(3)
  expect(parsed.question).toBe('Plan the  migration')
  expect(parsed.errors).toEqual([])

  expect(parseArgs('deep How should we cache feeds?', FALLBACK_PRESETS).seats).toHaveLength(3)
  expect(parseArgs('deep How should we cache feeds?', FALLBACK_PRESETS).question).toBe('How should we cache feeds?')
  expect(parseArgs('Why is the queue slow?', FALLBACK_PRESETS)).toEqual({ ...EMPTY, question: 'Why is the queue slow?' })
  expect(parseArgs('opus:ultra -- q', FALLBACK_PRESETS).errors).toHaveLength(1)
})

test('rounds outside 1 to 5 are reported, not adjusted', () => {
  for (const token of ['rounds=0', 'rounds=00', 'rounds=6']) {
    const parsed = parseArgs(`${token} opus:xhigh -- q`, FALLBACK_PRESETS)
    expect(parsed.errors).toEqual([`"${token}": rounds must be a whole number from 1 to 5.`])
    expect(parsed.rounds).toBe(undefined)
    expect(parsed.seats).toHaveLength(1)
  }
  expect(parseArgs('rounds=1 -- q', FALLBACK_PRESETS)).toEqual({ ...EMPTY, rounds: 1, question: 'q', hasSeparator: true })
})

test('agent type names separate skill sets and stay valid', () => {
  const plain = agentTypeName({ model: 'opus', effort: 'max', skills: [] })
  const skilled = agentTypeName({ model: 'opus', effort: 'max', skills: ['b', 'a'] })
  expect(plain).toBe('opus-max')
  expect(skilled).toBe(agentTypeName({ model: 'opus', effort: 'max', skills: ['a', 'b'] }))
  expect(skilled === plain).toBe(false)
  expect(/^[\w-]{1,64}$/.test(skilled)).toBe(true)
})

test('brief= is read as an option', () => {
  const parsed = parseArgs('review brief=BugHunt -- the retry changes', FALLBACK_PRESETS)
  expect(parsed.brief).toBe('bughunt')
  expect(parsed.seats).toHaveLength(3)
  expect(parsed.question).toBe('the retry changes')
})

test('only PASS alone on the first line ends the rounds', () => {
  expect(isPass('PASS')).toBe(true)
  expect(isPass('  **PASS.**\n\nNothing material.')).toBe(true)
  expect(isPass('PASS on steps 1 to 3, but step 4 drops the index.')).toBe(false)
  expect(isPass('The plan would not pass review.\nPASS')).toBe(false)
  expect(isPass('')).toBe(false)
})

test('a brief replaces the answer format and tells a read-only seat what to review', () => {
  const brief = panelBrief('the retry changes', 'panelist', 'For each finding give severity.')
  expect(brief).toContain('Focus:\nthe retry changes')
  expect(brief).toContain('For each finding give severity.')
  expect(brief).toContain('recommend it instead')
  expect(brief).not.toContain('Answer with:')

  expect(panelBrief('q', 'contrarian', 'For each finding give severity.')).toContain('For each finding give severity.')
  expect(panelBrief('q', 'panelist')).toContain('Answer with:')
})

test('each saved answer is named for its place in the run', () => {
  const seats = [parseSeat('opus:xhigh'), parseSeat('sonnet:high:contrarian')].flatMap(seat => (seat ? [seat] : []))

  expect(artifactOf({ kind: 'panel', phase: 'drafting', round: 0, rounds: 1, seats }, 1)).toEqual({ file: 'seat-2-sonnet-high-contrarian', title: 'Seat 2: sonnet·high contrarian' })
  expect(artifactOf({ kind: 'pingpong', phase: 'drafting', round: 0, rounds: 2, seats }, 0).file).toBe('draft-a-opus-xhigh')
  expect(artifactOf({ kind: 'pingpong', phase: 'challenging', round: 2, rounds: 2, seats }, 0).file).toBe('round-2-challenge')
  expect(artifactOf({ kind: 'pingpong', phase: 'integrating', round: 2, rounds: 2, seats }, 1).file).toBe('round-2-plan')
})

test('git is limited to read commands that cannot write a file', () => {
  expect(gitRefusal('diff', ['HEAD~2', '--', 'src'])).toBe(undefined)
  expect(gitRefusal('commit', [])).toContain('not available')
  expect(gitRefusal('diff', ['--ext-diff'])).toContain('run other programs')
  expect(gitRefusal('log', ['-p', '--textconv'])).toContain('run other programs')
  expect(gitHelperOptions('diff')).toEqual(['--no-ext-diff', '--no-textconv'])
  expect(gitHelperOptions('blame')).toEqual(['--no-textconv'])
  expect(gitHelperOptions('status')).toEqual([])
  expect(gitRefusal('show', ['--output', 'x'])).toContain('read-only')
  expect(gitRefusal('log', [3])).toContain('list of strings')
})

test('a seat goes back to the text that makes it', () => {
  for (const spec of ['opus:xhigh', 'sonnet:high:contrarian+cro', 'haiku:low+ads+ad-creative']) {
    expect(seatSpec(parseSeat(spec) ?? { model: '', effort: '', role: 'panelist', skills: [] })).toBe(spec)
  }
})

test('as= and skills= are read as options, and skills= keeps its case', () => {
  const parsed = parseArgs('haiku:low as=content-council skills=/Users/Me/Skills,~/more -- q', FALLBACK_PRESETS)
  expect(parsed.as).toBe('content-council')
  expect(parsed.skillDirs).toEqual(['/Users/Me/Skills', '~/more'])
  expect(parsed.errors).toEqual([])
  expect(parseArgs('haiku:low as=Opus -- q', FALLBACK_PRESETS).errors).toEqual(['"as=Opus": a preset name is 2 to 31 lowercase letters, digits or hyphens, starting with a letter.'])
})

test('a skill in the role slot, and a lone unknown word before --, are errors that say what to type', () => {
  expect(parseArgs('sonnet:high:content-strategy -- q', FALLBACK_PRESETS).errors).toEqual(['"sonnet:high:content-strategy": after the effort comes :contrarian or +skill. Use sonnet:high+content-strategy.'])
  expect(parseArgs('content-counsil -- q', FALLBACK_PRESETS).errors).toEqual(['"content-counsil" is not a preset or a seat. Known presets: deep, quick, duo, review.'])
  expect(parseArgs('content strategy for the launch', FALLBACK_PRESETS)).toEqual({ ...EMPTY, question: 'content strategy for the launch' })
})

test('a question that starts with an Object.prototype name is a question', () => {
  for (const word of ['constructor', 'toString', '__proto__']) {
    expect(parseArgs(`${word} injection or setters?`, FALLBACK_PRESETS)).toEqual({ ...EMPTY, question: `${word} injection or setters?` })
  }
})

test('presets carry their brief, rounds and skill folders; the first preset to set one wins', () => {
  const { presets } = readPresetLayer(
    {
      copy: { seats: ['haiku:low+copywriting'], brief: 'Critique', rounds: 2, skillDirs: ['/mk'] },
      design: { seats: ['haiku:low+ui'], brief: 'audit', rounds: 4, skillDirs: ['/ds'] },
    },
    'user',
  )
  const parsed = parseArgs('copy design -- the home page', presets)
  expect(parsed.seats.map(seat => seat.label)).toEqual(['haiku·low +copywriting', 'haiku·low +ui'])
  expect(parsed.presets).toEqual(['copy', 'design'])
  expect(parsed.presetBrief).toBe('critique')
  expect(parsed.presetRounds).toBe(2)
  expect(parsed.presetSkillDirs).toEqual(['/mk', '/ds'])
  expect(parsed.notes).toHaveLength(2)
  expect(parsed.brief).toBe(undefined)
})

test('a preset layer keeps valid entries and says why it dropped the rest', () => {
  const layer = readPresetLayer(
    {
      team: ['haiku:low'],
      Loud: ['haiku:low'],
      opus: ['haiku:low'],
      empty: [],
      typo: ['haiku:lo'],
      quick: ['haiku:low'],
      borrowed: { seats: ['haiku:low'], skillDirs: ['/repo'], rounds: 9, description: 'From the repo' },
    },
    'project',
    ['quick'],
  )
  expect(layer.presets).toEqual({
    team: { seats: ['haiku:low'], source: 'project' },
    borrowed: { seats: ['haiku:low'], source: 'project', description: 'From the repo' },
  })
  expect(layer.ignored).toHaveLength(6)
  expect(readPresetLayer(['haiku:low'], 'user').ignored).toEqual(['the file is not a JSON object of presets'])
  expect(readPresetLayer({ quick: ['haiku:low'] }, 'user', ['quick']).presets.quick?.source).toBe('user')
})

test('a preset is written as a plain list unless it carries options', () => {
  expect(presetEntry({ seats: ['haiku:low'] })).toEqual(['haiku:low'])
  expect(presetEntry({ seats: ['haiku:low'], rounds: 2 })).toEqual({ seats: ['haiku:low'], rounds: 2 })
  expect(presetNameError('content-council')).toBe(undefined)
  expect(presetNameError('save')).toBe('"save" is reserved.')
})

test('tool input becomes arguments only from a preset name, seats, and a brief name', () => {
  expect(toolArgs({ preset: 'Quick', seats: ['opus:high'], brief: 'bughunt' })).toEqual({ args: 'Quick opus:high brief=bughunt' })
  expect(toolArgs({})).toEqual({ args: '' })
  for (const input of [{ seats: ['as=x'] }, { seats: 'opus:high' }, { preset: 'a b' }, { preset: 'skills=/' }, { brief: 'x -- y' }]) {
    expect('error' in toolArgs(input)).toBe(true)
  }
})

test('a skill file splits into frontmatter and body, with a summary and the engine features it relies on', () => {
  const { frontmatter, body } = splitSkill('---\nname: ads\ndescription: "Paid ads on any platform."\ncontext: fork\n---\n\n# Paid Ads\n\nRun !`date` in ${CLAUDE_SKILL_DIR}.\n')
  expect(body).toBe('# Paid Ads\n\nRun !`date` in ${CLAUDE_SKILL_DIR}.')
  expect(skillSummary(frontmatter)).toBe('Paid ads on any platform.')
  expect(ignoredSkillFeatures(frontmatter, body)).toEqual(['context', '${CLAUDE_SKILL_DIR}', 'command injection'])
  expect(skillSummary('name: x\ndescription: >\n  Folded over\n  two lines.')).toBe('Folded over')
  expect(splitSkill('# No frontmatter')).toEqual({ frontmatter: '', body: '# No frontmatter' })
})

test('only a single path segment is a folder skill name', () => {
  expect(isFolderSkillName('ad-creative')).toBe(true)
  for (const name of ['../x', 'a/b', 'plugin:skill', '.hidden', 'a.b']) expect(isFolderSkillName(name)).toBe(false)
})

test('nearest names find a typo and stay quiet otherwise', () => {
  const names = ['ads', 'ad-creative', 'content-strategy', 'copywriting', 'marketing-skills:cro']
  expect(nearestNames('cro', names)).toEqual(['marketing-skills:cro'])
  expect(nearestNames('ads-creative', names)).toEqual(['ad-creative'])
  expect(nearestNames('conte-strategy', names)).toEqual(['content-strategy'])
  expect(nearestNames('laravel-php-standards', names)).toEqual([])
})

test('skill text comes before the task, under the rules for a read-only seat', () => {
  expect(withSkills('Critique the page.', [])).toBe('Critique the page.')
  const prompt = withSkills('Critique the page.', [{ name: 'ads', path: '/mk/ads', body: '# Paid Ads' }])
  expect(prompt.indexOf('# Paid Ads') < prompt.indexOf('## Your task\n\nCritique the page.')).toBe(true)
  expect(prompt).toContain('Base directory: /mk/ads')
  expect(prompt).toContain('recommend it instead; you are read-only')
})

const seatOf = (spec: string, patch: Partial<Seat> = {}): Seat => ({ ...parseSeat(spec)!, status: 'done', ...patch })
const panelOf = (patch: Partial<Run>): Run => ({ id: 'ab12cd', kind: 'panel', question: 'Why is the feed slow?', seats: [], phase: 'drafting', round: 1, rounds: 3, challenges: [], ...patch })
const TRIO = [seatOf('opus:high+ads', { answer: 'Index it.', agentId: 'a1' }), seatOf('sonnet:high:contrarian', { answer: 'The cache is cold.', agentId: 'a2' }), seatOf('haiku:low', { answer: 'Both.', agentId: 'a3' })]

test('a NO CHANGE line, in any case, in a short answer marks an unchanged seat', () => {
  expect(['NO CHANGE', 'no change.', '**No Change**', 'Warning: review flagged nothing.\nNO CHANGE'].map(isNoChange)).toEqual([true, true, true, true])
  expect(isNoChange('No change to my view, but seat 2 is wrong about the cache.')).toBe(false)
  expect(isNoChange(`NO CHANGE\n${'Seat 2 misreads the query plan. '.repeat(20)}`)).toBe(false)
})

test('a long answer is cut from the middle and says how much is gone', () => {
  const cut = clipAnswer(`${'a'.repeat(600)}${'b'.repeat(400)}`, 100)

  expect(clipAnswer('short', 100)).toBe('short')
  expect(cut.startsWith('a'.repeat(60))).toBe(true)
  expect(cut.endsWith('b'.repeat(40))).toBe(true)
  expect(cut).toContain('[... 900 of 1000 characters cut from the middle ...]')
})

test('a peer is named by seat number, role and skills, never by model', () => {
  expect(peerName(seatOf('opus:xhigh'), 0)).toBe('Seat 1')
  expect(peerName(seatOf('opus:xhigh:contrarian+cro', { skills: [], folderSkills: [{ name: 'cro', path: '/s/cro' }] }), 2)).toBe('Seat 3 (contrarian: argues against the obvious answer by role, +cro)')
  expect(peerName(seatOf('sonnet:high+ads+typo', { unknownSkills: ['typo'] }), 1)).toBe('Seat 2 (+ads)')
})

test("a finished seat's task notification is named by its panel and seat, and any other notification is left alone", () => {
  const runs = [panelOf({ id: 'ff00aa', seats: [seatOf('haiku:low')] }), panelOf({ seats: TRIO })]

  expect(collectedNote(runs, '<task-notification>\n<task-id>a2</task-id>\n<status>completed</status>')).toBe("panel ab12cd has seat 2's reply.")
  expect(collectedNote(runs, '<task-notification>\n<task-id>a22</task-id>')).toBeUndefined()
  expect(collectedNote([], '<task-id>a2</task-id>')).toBeUndefined()
  expect(collectedNote([{ ...panelOf({ seats: TRIO }), kind: 'pingpong' }], '<task-id>a1</task-id>')).toBe("ping-pong ab12cd has seat A's reply.")
})

test('closing round 1 of 1 ends the run, and fewer than two answers ends a discussion before it starts', () => {
  const single = closeRound(panelOf({ rounds: 1, seats: TRIO }))
  const alone = closeRound(panelOf({ seats: [TRIO[0]!, seatOf('haiku:low', { status: 'failed', answer: '(failed: error)' })] }))

  expect([single.phase, single.outcome, single.transcript?.[0]?.map(entry => entry.state)]).toEqual(['done', undefined, ['answered', 'answered', 'answered']])
  expect([alone.phase, alone.outcome]).toEqual(['done', 'the discussion did not run: fewer than two seats answered'])
})

test('closing a round opens the next and resets only the seats that go again, keeping the agent a seat can be woken by', () => {
  const next = closeRound(panelOf({ seats: [TRIO[0]!, TRIO[1]!, seatOf('haiku:low', { status: 'failed', answer: '(failed: error)', agentId: 'a3' })] }))

  expect([next.phase, next.round]).toEqual(['discussing', 2])
  expect(next.seats.map(seat => [seat.status, seat.agentId, seat.answer])).toEqual([['starting', 'a1', undefined], ['starting', 'a2', undefined], ['failed', 'a3', '(failed: error)']])
  expect(standing(next.transcript ?? [], 0)).toEqual({ round: 1, text: 'Index it.' })
  expect(standing(next.transcript ?? [], 2)).toBeUndefined()
})

test('a reply round of NO CHANGE alone ends the discussion, one real reply keeps it going, and a failed reply is asked again fresh', () => {
  const first = closeRound(panelOf({ seats: TRIO }))
  const reply = (answers: (string | undefined)[]) => ({ ...first, seats: first.seats.map((seat, i) => (answers[i] === undefined ? { ...seat, status: 'failed' as const, answer: '(failed: error)' } : { ...seat, status: 'done' as const, answer: answers[i] })) })

  const quiet = closeRound(reply(['NO CHANGE', 'PASS', 'no change']))
  expect([quiet.phase, quiet.outcome]).toEqual(['done', 'stopped early in round 2 of 3: no seat changed its answer'])
  expect(standing(quiet.transcript ?? [], 1)).toEqual({ round: 1, text: 'The cache is cold.' })

  const moving = closeRound(reply(['NO CHANGE', 'Seat 1 is right about the index.', undefined]))
  expect([moving.phase, moving.round]).toEqual(['discussing', 3])
  expect(moving.transcript?.[1]?.map(entry => entry.state)).toEqual(['unchanged', 'answered', 'failed'])
  expect(moving.seats.map(seat => [seat.status, seat.agentId])).toEqual([['starting', 'a1'], ['starting', 'a2'], ['starting', undefined]])

  const silent = closeRound(reply([undefined, undefined, undefined]))
  expect(silent.outcome).toBe('stopped in round 2 of 3: no seat replied')

  const last = closeRound({ ...moving, seats: moving.seats.map(seat => ({ ...seat, status: 'done' as const, answer: 'Final.' })) })
  expect([last.phase, last.outcome]).toEqual(['done', 'completed 3 of 3 rounds'])
})

test('an interrupted seat or a stop request ends a discussion after the round, and a one-round panel is unaffected', () => {
  const interrupted = [TRIO[0]!, { ...TRIO[1]!, status: 'failed' as const, answer: '(failed: aborted)', isInterrupted: true }, TRIO[2]!]

  expect(closeRound(panelOf({ seats: interrupted })).outcome).toBe('stopped in round 1 of 3: seat 2 was interrupted')
  expect(closeRound(panelOf({ seats: TRIO, isStopping: true })).outcome).toBe('stopped after round 1 of 3 as you asked')
  expect(closeRound(panelOf({ rounds: 1, seats: interrupted })).outcome).toBeUndefined()
  expect(closeRound(panelOf({ round: 0, rounds: 1, seats: TRIO })).round).toBe(1)
})

test('a fresh reply prompt carries the question, the seat\'s own answer and the others\' latest answers, without model names', () => {
  const run = closeRound(panelOf({ seats: TRIO, briefText: 'Hunt for real bugs.' }))
  const prompt = replyBrief(run, 0, false)

  expect(prompt).toContain('Panel discussion, round 2 of 3. You are seat 1. In round 1 every seat answered the question below')
  expect(prompt).toContain('Question:\nWhy is the feed slow?')
  expect(prompt).toContain('The seats work from this brief:\nHunt for real bugs.')
  expect(prompt).toContain('## Your answer so far (seat 1, round 1)\n\nIndex it.')
  expect(prompt).toContain('### Seat 2 (contrarian: argues against the obvious answer by role), round 1\n\nThe cache is cold.')
  expect(prompt).toContain('### Seat 3, round 1\n\nBoth.')
  expect(prompt).toContain('in the format the brief asks for')
  expect(prompt).not.toMatch(/opus|sonnet|haiku/)
})

test('a woken seat gets only the others\' answers, and a contrarian is told to attack the consensus and that PASS is no answer', () => {
  const run = closeRound(panelOf({ seats: TRIO }))
  const woken = replyBrief(run, 0, true)
  const contrarian = replyBrief(run, 1, true)

  expect(woken).toContain('Your latest full answer, earlier in this conversation, is your position until you change it here.')
  expect(woken).not.toContain('Index it.')
  expect(woken).not.toContain('Question:')
  expect(woken).toContain('### Seat 3, round 1\n\nBoth.')
  expect(contrarian).toContain('You are seat 2, the contrarian.')
  expect(contrarian).toContain('You hold no position and you join none.')
  expect(contrarian).toContain('PASS is not an answer in this round.')
  expect(contrarian).not.toContain('Position now')
})

test('a reply prompt shows a seat that failed by its last answer, names one that never answered, and notes an unchanged one', () => {
  const first = closeRound(panelOf({ seats: [...TRIO, seatOf('haiku:low', { status: 'failed', answer: '(failed: error)' })] }))
  const second = closeRound({ ...first, seats: first.seats.map((seat, i) => (i === 1 ? { ...seat, status: 'done' as const, answer: 'NO CHANGE' } : i === 2 ? { ...seat, status: 'failed' as const, answer: '(failed: error)' } : i === 0 ? { ...seat, status: 'done' as const, answer: 'Index and warm it.' } : seat)) })
  const prompt = replyBrief(second, 0, false)

  expect(prompt).toContain('## Your answer so far (seat 1, round 2)\n\nIndex and warm it.')
  expect(prompt).toContain('### Seat 2 (contrarian: argues against the obvious answer by role), round 1; unchanged in round 2\n\nThe cache is cold.')
  expect(prompt).toContain('### Seat 3: did not reply in round 2; this is its round 1 answer\n\nBoth.')
  expect(prompt).toContain('Seat 4 did not answer and is not in the discussion.')
})

test('a one-round synthesis prompt is the one panels had, and a discussion\'s carries every round and how it ended', () => {
  const single = panelSynthesis(closeRound(panelOf({ rounds: 1, seats: TRIO })))
  expect(single).toContain('Panel ab12cd is complete. Every seat answered the same question independently.')
  expect(single).toContain('## Seat 1: opus·high +ads (panelist)\n\nIndex it.')
  expect(single).toContain('supported conclusions, rejected claims, real disagreement, residual uncertainty, blind spots (what no seat examined), and the seats used:\n1. opus·high +ads (claude-opus-5-5, effort high)')

  const first = closeRound(panelOf({ seats: TRIO }))
  const done = closeRound({ ...first, seats: first.seats.map((seat, i) => ({ ...seat, status: 'done' as const, answer: i === 0 ? 'NO CHANGE' : i === 1 ? 'no change' : 'NO CHANGE' })) })
  const prompt = panelSynthesis(done)

  expect(prompt).toContain('Panel ab12cd is complete: 2 round(s) across 3 seats. stopped early in round 2 of 3: no seat changed its answer')
  expect(prompt).toContain('Seat 2 sonnet·high contrarian: answered, no change')
  expect(prompt).toContain('## Round 1: independent answers\n\n### Seat 1: opus·high +ads\n\nIndex it.')
  expect(prompt).toContain('## Round 2: replies\n\nSeat 1: no change.')
  expect(prompt).toContain('position changes: which seat moved, from what to what')
})

test('synthesis answers share one budget, and a cut says where the whole text is', () => {
  const long = TRIO.map(seat => ({ ...seat, answer: 'x'.repeat(90_000) }))
  const first = closeRound(panelOf({ rounds: 2, seats: long, dir: '/runs/x' }))
  const done = closeRound({ ...first, seats: first.seats.map(seat => ({ ...seat, status: 'done' as const, answer: 'y'.repeat(90_000) })) })
  const prompt = panelSynthesis(done)

  expect(prompt.length).toBeLessThan(160_000)
  expect(prompt).toContain('Answers cut for size are whole in /runs/x.')
  expect(prompt).toContain('characters cut from the middle')
})

test('the cost line multiplies seats by rounds, and a multi-round panel names its files by round', () => {
  const seats = [seatOf('opus:xhigh'), seatOf('sonnet:high:contrarian')]

  expect(costLine(4, 3)).toContain('4 seats × 3 rounds = up to 12 agent runs. Rounds 2 to 3 are reply rounds')
  expect(costLine(2, 2)).toContain('Round 2 is a reply round')
  expect(artifactOf({ kind: 'panel', phase: 'discussing', round: 2, rounds: 3, seats }, 1)).toEqual({ file: 'round-2-seat-2-sonnet-high-contrarian', title: 'Round 2, seat 2: sonnet·high contrarian' })
  expect(artifactOf({ kind: 'panel', phase: 'drafting', round: 1, rounds: 3, seats }, 0).file).toBe('round-1-seat-1-opus-xhigh')
})

test('a reply is read as moved or held from its first section, and left unjudged without one', () => {
  expect(movedIn('**1. Changed**\n\n- Nothing in the position changes. Seat 3 adds an example.\n\n**2. Still disputed**\n- Seat 2: wrong.')).toBe(false)
  expect(movedIn('1. **Changed:** Nothing. I checked seat 3.\n2. **Still disputed:** none')).toBe(false)
  expect(movedIn('**1. Withdrawn**\n\nNone. Seat 2 agrees with me.\n\n**2. Standing objections**')).toBe(false)
  expect(movedIn('**1. Changed**\n\n- The fix in my answer changes. Seat 3 is right.\n\n**2. Still disputed**')).toBe(true)
  expect(movedIn('I agree with seat 2.')).toBeUndefined()
})

test('closing a reply round records which seats moved, and the synthesis says so', () => {
  const first = closeRound(panelOf({ rounds: 2, seats: TRIO }))
  const replies = ['1. Changed: the index point. Seat 2 moved me.\n2. Still disputed: none', '1. Withdrawn: None.\n2. Standing objections: all', 'I agree.']
  const done = closeRound({ ...first, seats: first.seats.map((seat, i) => ({ ...seat, status: 'done' as const, answer: replies[i] })) })

  expect(done.transcript?.[1]?.map(entry => entry.isMoved)).toEqual([true, false, undefined])
  expect(panelSynthesis(done)).toContain('Seat 1 opus·high +ads: answered, moved\nSeat 2 sonnet·high contrarian: answered, held\nSeat 3 haiku·low: answered, replied')
})

const REPLY = `1. Changed: Seat 3 is right about the cold cache.

2. Still disputed:
   - **Seat 2:** "index it" is not enough.

**3. Missed:** nobody ran the tests.

4. Position now: Index it and warm the cache (feed.ts:12).`

test('an answer is split into its labelled sections whatever way the seat marked them', () => {
  const { lead, sections } = splitSections(REPLY)

  expect(lead).toBe('')
  expect(sections.map(section => `${section.label}/${section.kind}`)).toEqual(['Changed/change', 'Still disputed/dispute', 'Missed/missed', 'Position now/stance'])
  expect(sections[1]?.body).toBe('- **Seat 2:** "index it" is not enough.')
  expect(splitSections('1. **Recommendation: index it.** It is the join.').sections[0]).toEqual({ label: 'Recommendation', kind: 'stance', body: '**index it.** It is the join.' })
  expect(splitSections('Just prose.\nSources: a.ts').sections).toEqual([])
})

test("a seat's excerpt is what changed when it moved, and otherwise where it stands", () => {
  expect(excerptOf(REPLY, true)).toEqual({ label: 'Changed', text: "Seat 3 is right about the cold cache." })
  expect(excerptOf(REPLY.replace('Seat 3 is right about the cold cache.', 'Nothing.'), true)?.label).toBe('Position now')
  expect(excerptOf('1. **Answer:** Index it.\n\n2. **Evidence:** the plan.', false)).toEqual({ label: 'Answer', text: 'Index it.' })
  expect(excerptOf('NO CHANGE', true)).toBeUndefined()
  expect(excerptOf('Plain words.', false)).toEqual({ label: '', text: 'Plain words.' })
})

test('a continued ping-pong seat is told how the plan relates to its own work, and a fresh one is not', () => {
  expect(challengeBrief('PLAN', 1, 2)).not.toContain('Your draft')
  expect(challengeBrief('PLAN', 1, 2, true)).toContain("Your draft and the other agent's were merged into the candidate below")
  expect(challengeBrief('PLAN', 2, 2, true)).toContain('raise a rejected correction again only with new evidence')
  expect(integrateBrief('PLAN', 'FIX', 1, 2)).not.toContain('your')
  expect(integrateBrief('PLAN', 'FIX', 1, 2, true)).toContain("It merges your draft with that agent's draft.")
  expect(integrateBrief('PLAN', 'FIX', 2, 2, true)).toContain('It is your last revision.')
})
