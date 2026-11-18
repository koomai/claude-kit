import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Decision } from '../types'
import { ringTarget, stopAfter, stopsOf, targetAfterField, targetAfterPick } from './register'

const PANE = {
  plugin: 'decisions',
  component: 'Pane',
  requestId: 'decisions',
  props: {
    title: 'Decisions',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const POSTED = [
  { id: 'a', title: 'Yes or no?', group: 'G1', ask: 'yesno' },
  { id: 'b', title: 'Why?', group: 'G1', ask: 'text' },
  { id: 'c', title: 'For information', group: 'G2' },
  { id: 'd', title: 'Pick one', group: 'G2', ask: 'choice', choices: ['One', 'Two', 'Three'] },
]

const ALL_STOPS = [
  'tab:All', 'tab:G1', 'tab:G2',
  'opt:a:0', 'opt:a:1', 'cmt:a#0',
  'ans:b#0',
  'cmt:c#0',
  'opt:d:0', 'opt:d:1', 'opt:d:2', 'cmt:d#0',
  'note#0', 'send',
]

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Drawing = { findAll: (query: Record<string, never>) => Promise<{ key?: string }[]> }

const callTool = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never)

const stops = async (ui: Drawing) =>
  (await ui.findAll({}))
    .map(one => one.key ?? '')
    .filter(key => /^(tab:|opt:|ans:|cmt:|note#|send$|clear$)/.test(key))

const setup = async ($: Engine, on: On) => {
  const submitted: string[] = []
  on('command.register', () => ({ value: { command: 'decisions' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__decisions__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await callTool($, { tool: 'mcp__decisions__post', decisions: POSTED })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  return { ui, submitted }
}

test('layout: every decision is drawn in full, stops in spec order', async ($, on) => {
  const { ui } = await setup($, on)
  expect(await stops(ui)).toEqual(ALL_STOPS)
  await ui.unmount()
})

const DECISIONS: Decision[] = POSTED.map(one => ({ ...one, status: 'open' }) as Decision)
const NO_REVS = {}

test('rule 2: a tab draws only its decisions', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.press({ key: 'tab:G2' })
  expect(await stops(ui)).toEqual([
    'tab:All', 'tab:G1', 'tab:G2',
    'cmt:c#0',
    'opt:d:0', 'opt:d:1', 'opt:d:2', 'cmt:d#0',
    'note#0', 'send',
  ])
  await ui.unmount()
})

test('rule 3: an option sets the answer; the ring goes to its comment', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.press({ key: 'opt:a:0' })
  expect((await ui.find({ type: 'Text', text: /Yes or no\?/ }))?.text).toContain('● Yes or no? Yes')
  expect(targetAfterPick('a', NO_REVS)).toBe('cmt:a#0')
  await ui.unmount()
})

test('rules 4, 5 and 9: Enter in a field targets the next decision first stop', () => {
  expect(targetAfterField(DECISIONS, 'cmt:a#0', NO_REVS)).toBe('ans:b#0')
  expect(targetAfterField(DECISIONS, 'ans:b#0', NO_REVS)).toBe('cmt:c#0')
  expect(targetAfterField(DECISIONS, 'cmt:c#0', NO_REVS)).toBe('opt:d:0')
})

test('rule 6: after the last decision, Enter and Tab both reach Anything else', () => {
  expect(targetAfterField(DECISIONS, 'cmt:d#0', NO_REVS)).toBe('note#0')
  const order = stopsOf(['All'], DECISIONS, NO_REVS, false)
  expect(order[order.indexOf('cmt:d#0') + 1]).toBe('note#0')
})

test('rule 7: Enter in Anything else targets Send', () => {
  expect(targetAfterField(DECISIONS, 'note#3', { note: 3 })).toBe('send')
})

test('Enter targets follow the Tab order for every field', () => {
  const order = stopsOf(['All'], DECISIONS, NO_REVS, false)
  for (const key of order.filter(one => one.startsWith('cmt:') || one.startsWith('ans:'))) {
    const target = targetAfterField(DECISIONS, key, NO_REVS)
    const between = order.slice(order.indexOf(key) + 1, order.indexOf(target))
    expect(between).toEqual([])
  }
})

test('re-keyed fields keep their place in the order', () => {
  const revs = { 'cmt:a': 2, note: 1 }
  expect(stopAfter(DECISIONS, 'd', revs)).toBe('note#1')
  expect(targetAfterPick('a', revs)).toBe('cmt:a#2')
})

test('rule 12: the ring stays put, or goes to the first stop when its stop is gone', () => {
  const order = stopsOf(['All'], DECISIONS, NO_REVS, false)
  expect(ringTarget(order, 'cmt:d#0')).toBe('cmt:d#0')
  expect(ringTarget(order.filter(one => one !== 'cmt:c#0'), 'cmt:c#0')).toBe('tab:All')
})

test('Enter re-keys the field and it shows the saved text', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.input({ key: 'cmt:a#0', text: 'kept' })
  expect(await ui.find({ key: 'cmt:a#0' })).toBeUndefined()
  expect((await ui.find({ key: 'cmt:a#1' }))?.props.value).toBe('kept')
  expect((await ui.find({ type: 'Text', text: /Yes or no\?/ }))?.text).toContain('· comment')
  await ui.unmount()
})

test('rule 10: typing saves without Enter', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.input({ key: 'cmt:a#0', text: 'typed only', kind: 'change' })
  expect((await ui.find({ key: 'cmt:a#0' }))?.props.value).toBe('typed only')
  expect((await ui.find({ type: 'Text', text: /Yes or no\?/ }))?.text).toContain('· comment')
  await ui.unmount()
})

test('rule 8: Send submits and moves answered rows to Sent', async ($, on) => {
  const { ui, submitted } = await setup($, on)
  await ui.press({ key: 'opt:d:1' })
  await ui.input({ key: 'cmt:d#0', text: 'second is best' })
  await ui.input({ key: 'note#0', text: 'thanks' })
  await ui.press({ key: 'send' })

  const text = submitted[0] ?? ''
  expect(text).toContain('[G2] Pick one (id: d)')
  expect(text).toContain('Answer: Two')
  expect(text).toContain('Comment: second is best')
  expect(text).toContain('Answer: No answer')
  expect(text).toContain('Anything else:\nthanks')
  expect(await stops(ui)).not.toContain('opt:d:0')
  expect(await stops(ui)).toContain('clear')
  await ui.unmount()
})

test('posting the same id again keeps its answer', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.press({ key: 'opt:a:1' })
  await callTool($, {
    tool: 'mcp__decisions__post',
    decisions: [{ id: 'a', title: 'Yes or no, again?', group: 'G1', ask: 'yesno' }],
  })
  expect((await ui.find({ type: 'Text', text: /again/ }))?.text).toContain('No')
  expect(await stops(ui)).toEqual(ALL_STOPS)
  await ui.unmount()
})
