import { expect, test } from 'claude-code/testing'

import { FALLBACK_PRESETS, agentTypeName, artifactOf, gitRefusal, isPass, panelBrief, parseArgs, parseSeat, soloBriefName } from '../hooks/seats'

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
  expect(parseArgs('Why is the queue slow?', FALLBACK_PRESETS)).toEqual({ seats: [], rounds: undefined, question: 'Why is the queue slow?', errors: [] })
  expect(parseArgs('opus:ultra -- q', FALLBACK_PRESETS).errors).toHaveLength(1)
})

test('rounds outside 1 to 5 are reported, not adjusted', () => {
  for (const token of ['rounds=0', 'rounds=00', 'rounds=6']) {
    const parsed = parseArgs(`${token} opus:xhigh -- q`, FALLBACK_PRESETS)
    expect(parsed.errors).toEqual([`"${token}": rounds must be a whole number from 1 to 5.`])
    expect(parsed.rounds).toBe(undefined)
    expect(parsed.seats).toHaveLength(1)
  }
  expect(parseArgs('rounds=1 -- q', FALLBACK_PRESETS)).toEqual({ seats: [], rounds: 1, question: 'q', errors: [] })
})

test('agent type names separate skill sets and stay valid', () => {
  const plain = agentTypeName({ model: 'opus', effort: 'max', skills: [] })
  const skilled = agentTypeName({ model: 'opus', effort: 'max', skills: ['b', 'a'] })
  expect(plain).toBe('opus-max')
  expect(skilled).toBe(agentTypeName({ model: 'opus', effort: 'max', skills: ['a', 'b'] }))
  expect(skilled === plain).toBe(false)
  expect(/^[\w-]{1,64}$/.test(skilled)).toBe(true)
})

test('brief= and save= are read as options, and a bad save mode is reported', () => {
  const parsed = parseArgs('review brief=BugHunt save=both -- the retry changes', FALLBACK_PRESETS)
  expect(parsed.brief).toBe('bughunt')
  expect(parsed.save).toBe('both')
  expect(parsed.seats).toHaveLength(3)
  expect(parsed.question).toBe('the retry changes')

  expect(parseArgs('save=cloud -- q', FALLBACK_PRESETS).errors).toEqual(['"save=cloud": save must be one of off, files, solo, both.'])
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

  expect(artifactOf({ kind: 'panel', phase: 'drafting', round: 0, seats }, 1)).toEqual({ file: 'seat-2-sonnet-high-contrarian', title: 'Seat 2: sonnet·high contrarian' })
  expect(artifactOf({ kind: 'pingpong', phase: 'drafting', round: 0, seats }, 0).file).toBe('draft-a-opus-xhigh')
  expect(artifactOf({ kind: 'pingpong', phase: 'challenging', round: 2, seats }, 0).file).toBe('round-2-challenge')
  expect(artifactOf({ kind: 'pingpong', phase: 'integrating', round: 2, seats }, 1).file).toBe('round-2-plan')
})

test('a Solo template is a brief only under the brief- prefix', () => {
  expect(soloBriefName('brief-pq - Performance and Queries')).toBe('pq')
  expect(soloBriefName('Brief-Bug-Hunt: correctness')).toBe('bug-hunt')
  expect(soloBriefName('PQ - Performance and Queries')).toBe(undefined)
  expect(soloBriefName('brief-')).toBe(undefined)
})

test('git is limited to read commands that cannot write a file', () => {
  expect(gitRefusal('diff', ['HEAD~2', '--', 'src'])).toBe(undefined)
  expect(gitRefusal('commit', [])).toContain('not available')
  expect(gitRefusal('show', ['--output', 'x'])).toContain('read-only')
  expect(gitRefusal('log', [3])).toContain('list of strings')
})
