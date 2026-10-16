import { expect, test } from 'claude-code/testing'
import { helpLines, isHelp } from '../hooks/help'

const toned = (text: string) => helpLines(text).map(line => line.filter(span => span.tone !== undefined).map(span => `${span.tone}:${span.text}`))

test('help text is coloured by commands, options and headings', () => {
  const text = [
    'No brief named "x".',
    '',
    'Usage: /panel [seats or preset] [rounds=N] -- <question>',
    '',
    'Seats, space separated: model:effort[:contrarian][+skill]',
    '  model        opus, sonnet, haiku, fable',
    '  rounds=N     rounds, 1 to 5; see /config.',
    '',
    'Presets (no seats: "quick")',
    '  deep             built-in  opus:xhigh sonnet:high',
    '',
    '/panel-preset saves presets. Paths like ~/.claude/x and /private/tmp stay plain.',
  ].join('\n')

  expect(isHelp(text)).toBe(true)
  expect(isHelp('Panel 1a2b started')).toBe(false)
  expect(toned(text)).toEqual([
    ['error:No brief named "x".'],
    [],
    ['heading:Usage:', 'command:/panel', 'quiet:[', 'quiet:]', 'quiet:[', 'option:rounds=N', 'quiet:]', 'quiet:--'],
    [],
    ['heading:Seats, space separated:', 'option:model:effort', 'quiet:[', 'option::contrarian', 'quiet:]', 'quiet:[', 'option:+skill', 'quiet:]'],
    ['option:model'],
    ['option:rounds=N', 'command:/config'],
    [],
    ['heading:Presets (no seats: "quick")'],
    ['option:deep', 'quiet:built-in', 'option:opus:xhigh', 'option:sonnet:high'],
    [],
    ['command:/panel-preset'],
  ])
  expect(isHelp('agent-panel: Usage: /panel -- <question>')).toBe(true)
  expect(toned('agent-panel: Usage: /panel -- <question>')).toEqual([['quiet:agent-panel: ', 'heading:Usage:', 'command:/panel', 'quiet:--']])
  expect(helpLines(text)[11]?.map(span => span.text).join('')).toBe('/panel-preset saves presets. Paths like ~/.claude/x and /private/tmp stay plain.')
})
