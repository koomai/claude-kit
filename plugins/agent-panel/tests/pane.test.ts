import { expect, test } from 'claude-code/testing'

import { activityOf, clip, fitChips, flow, formatDuration, formatTokens, isLive, meter, pingpongSteps, roundCells, runBadge, runTime, seatChips, seatTime, usageTokens } from '../hooks/pane'
import type { Run } from '../types'

const RUN: Run = { id: 'ab12cd', kind: 'pingpong', question: 'Plan it', seats: [], phase: 'drafting', round: 0, rounds: 2, challenges: [] }
const cells = (run: Partial<Run>) => pingpongSteps({ ...RUN, ...run }).map(step => `${step.label}:${step.cells.join('+')}`)

test('durations and token counts are written short', () => {
  expect([0, 8_400, 62_000, 3_840_000].map(formatDuration)).toEqual(['0s', '8s', '1m02s', '1h04m'])
  expect([850, 1_240, 28_300, 1_300_000].map(formatTokens)).toEqual(['850', '1.2k', '28k', '1.3M'])
  expect(usageTokens({ input_tokens: 4, output_tokens: 82, cache_read_input_tokens: 8670, model: 'claude-haiku-5-5' })).toBe(8756)
  expect(usageTokens(undefined)).toBe(0)
})

test('a meter fills in proportion and shows at least one cell for any time spent', () => {
  expect(meter(50, 100, 8)).toEqual({ on: '━━━━', off: '────' })
  expect(meter(1, 1000, 8).on).toBe('━')
  expect(meter(0, 100, 8)).toEqual({ on: '', off: '────────' })
  expect(meter(500, 100, 8).off).toBe('')
})

test('a working seat is timed from its start and a finished one by its turn', () => {
  expect(seatTime({ status: 'working', startedAt: 1_000 }, 4_000)).toBe(3_000)
  expect(seatTime({ status: 'done', startedAt: 1_000, durationMs: 2_500 }, 9_000)).toBe(2_500)
  expect(seatTime({ status: 'working', startedAt: 1_000, durationMs: 2_500 }, 4_000)).toBe(5_500)
  expect(seatTime({ status: 'starting' }, 9_000)).toBeUndefined()
  expect(runTime({ startedAt: 1_000 }, 5_000)).toBe(4_000)
  expect(runTime({ startedAt: 1_000, endedAt: 3_000 }, 5_000)).toBe(2_000)
})

test('a seat is drawn as its model, role and skills, with a skill found nowhere marked', () => {
  const chips = seatChips({ label: 'opus·high contrarian +cro +ads-creative', unknownSkills: ['ads-creative'] }, 'A')

  expect(chips.map(chip => `${chip.text}/${chip.tone}`)).toEqual(['A/quiet', 'opus·high/plain', 'contrarian/warn', '+cro/quiet', '+ads-creative?/warn'])
  expect(fitChips(chips, 22).map(chip => chip.text)).toEqual(['A', 'opus·high', 'contrarian'])
  expect(fitChips(chips, 18).map(chip => chip.text)).toEqual(['A', 'opus·high', 'contr…'])
})

test('the ping-pong track follows the run through drafts, merge and each round', () => {
  expect(cells({})).toEqual(['drafts:now', 'merge:todo', 'r1:todo+todo', 'r2:todo+todo'])
  expect(cells({ phase: 'merging' })).toEqual(['drafts:done', 'merge:now', 'r1:todo+todo', 'r2:todo+todo'])
  expect(cells({ phase: 'challenging', round: 1 })).toEqual(['drafts:done', 'merge:done', 'r1:now+todo', 'r2:todo+todo'])
  expect(cells({ phase: 'integrating', round: 2, challenges: ['a', 'b'] })).toEqual(['drafts:done', 'merge:done', 'r1:done+done', 'r2:done+now'])
  expect(cells({ phase: 'done', round: 2, challenges: ['a', 'b'] })).toEqual(['drafts:done', 'merge:done', 'r1:done+done', 'r2:done+done'])
})

test('the track shows a PASS that ended the rounds, and where a run failed', () => {
  expect(cells({ phase: 'done', round: 1, challenges: ['PASS'] })).toEqual(['drafts:done', 'merge:done', 'r1:done+skipped', 'r2:skipped+skipped'])
  expect(cells({ phase: 'failed' })).toEqual(['drafts:failed', 'merge:skipped', 'r1:skipped+skipped', 'r2:skipped+skipped'])
  expect(cells({ phase: 'failed', round: 1 })).toEqual(['drafts:done', 'merge:done', 'r1:failed+skipped', 'r2:skipped+skipped'])
  expect(cells({ phase: 'failed', round: 1, challenges: ['a'] })).toEqual(['drafts:done', 'merge:done', 'r1:done+failed', 'r2:skipped+skipped'])
})

test('a run badge counts the seats in for a panel, names the round for ping-pong and times a finished run', () => {
  const seats = [
    { label: 'opus·high', model: 'opus', effort: 'high', role: 'panelist' as const, skills: [], status: 'done' as const },
    { label: 'haiku·low', model: 'haiku', effort: 'low', role: 'panelist' as const, skills: [], status: 'working' as const },
  ]

  expect(runBadge({ ...RUN, kind: 'panel', rounds: 1, seats, startedAt: 0 }, 65_000)).toEqual({ text: '◓ 1/2 in · 1m05s', tone: 'live' })
  expect(runBadge({ ...RUN, kind: 'panel', phase: 'discussing', round: 2, rounds: 3, seats, startedAt: 0 }, 4_000).text).toBe('◐ round 2/3 · 1/2 in · 4s')
  expect(runBadge({ ...RUN, phase: 'challenging', round: 1, startedAt: 0 }, 4_000).text).toBe('◐ round 1/2 · 4s')
  expect(runBadge({ ...RUN, phase: 'merging' }, 0).text).toBe('◆ merging')
  expect(runBadge({ ...RUN, phase: 'done', startedAt: 0, endedAt: 134_000 }, 900_000)).toEqual({ text: '✓ 2m14s', tone: 'good' })
  expect(runBadge({ ...RUN, phase: 'failed' }, 0)).toEqual({ text: '✗ failed', tone: 'bad' })
  expect([isLive({ phase: 'merging' }), isLive({ phase: 'done' }), isLive({ phase: 'failed' })]).toEqual([true, false, false])
})

test('a long line is cut to its room on one line', () => {
  expect(clip('Why is\n the feed   slow?', 40)).toBe('Why is the feed slow?')
  expect(clip('Why is the feed slow?', 10)).toBe('Why is th…')
  expect(clip('anything', 0)).toBe('')
})

test('a discussion draws one cell per seat per round: replied, no change, failed, working, and rounds still to come', () => {
  const seat = (status: 'starting' | 'working' | 'done' | 'failed') => ({ label: 'opus·high', model: 'opus', effort: 'high', role: 'panelist' as const, skills: [], status })
  const run = {
    ...RUN,
    kind: 'panel' as const,
    phase: 'discussing' as const,
    round: 3,
    rounds: 4,
    seats: [seat('working'), seat('done'), seat('failed')],
    transcript: [
      [{ state: 'answered' as const, text: 'a' }, { state: 'answered' as const, text: 'b' }, { state: 'answered' as const, text: 'c' }],
      [{ state: 'answered' as const, text: 'a2' }, { state: 'unchanged' as const, text: 'NO CHANGE' }, { state: 'failed' as const, text: '' }],
    ],
  }
  const drawn = (index: number) => roundCells(run, index, 0).map(cell => cell.text).join('')

  expect([drawn(0), drawn(1), drawn(2)]).toEqual(['●●◐·', '●=●·', '●✗✗·'])
  expect(roundCells({ ...run, rounds: 1 }, 0, 0)).toEqual([])
  const judged = { ...run, transcript: [run.transcript[0]!, [{ state: 'answered' as const, text: '', isMoved: true }, { state: 'answered' as const, text: '', isMoved: false }, { state: 'failed' as const, text: '' }]] }
  expect([0, 1].map(index => roundCells(judged, index, 0)[1]?.text)).toEqual(['◆', '○'])
  expect(roundCells({ ...run, phase: 'done' }, 0, 0).map(cell => cell.text).join('')).toBe('●●··')
})

test("a seat's current tool call is written as a few words", () => {
  expect(activityOf('Read', { file_path: '/repo/hooks/safety-guard.ts' })).toBe('read safety-guard.ts')
  expect(activityOf('Grep', { pattern: 'slow query' })).toBe('grep slow query')
  expect(activityOf('WebFetch', { url: 'https://example.com/a/b' })).toBe('fetch example.com')
  expect(activityOf('mcp__agent-panel__git', { command: 'diff' })).toBe('git diff')
  expect(activityOf('mcp__other__thing', {})).toBe('other__thing')
})

test('streamed text is wrapped to the pane with code and bold kept apart from the prose', () => {
  const lines = flow('The `rounds` mapper gives **two cells** per round.\n\n- first `a.ts:1`, then more\n- second', 30)

  expect(lines.map(line => line.map(span => span.text).join(''))).toEqual(['The rounds mapper gives two', 'cells per round.', '• first a.ts:1, then more', '• second'])
  expect(lines[0]?.map(span => `${span.isCode ? 'code' : span.isBold ? 'bold' : 'text'}:${span.text}`)).toEqual(['text:The', 'code: rounds', 'text: mapper gives', 'bold: two'])
  expect(flow('x'.repeat(25), 10).map(line => line[0]?.text.length)).toEqual([10, 10, 5])
  expect(flow('## Heading\ncontinues here', 40).map(line => line[0]?.text)).toEqual(['Heading continues here'])
  expect(flow('anything', 0)).toEqual([])
})
