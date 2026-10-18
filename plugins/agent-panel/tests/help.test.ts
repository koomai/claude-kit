import { expect, test } from 'claude-code/testing'
import { helpLines } from '../hooks/help'

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
  expect(toned('agent-panel: Usage: /panel -- <question>')).toEqual([['quiet:agent-panel: ', 'heading:Usage:', 'command:/panel', 'quiet:--']])
  expect(helpLines(text)[11]?.map(span => span.text).join('')).toBe('/panel-preset saves presets. Paths like ~/.claude/x and /private/tmp stay plain.')
})

test('list, show, skills and start output is coloured like help', () => {
  const listed = ['Presets', '  deep             built-in  opus:xhigh sonnet:high', '    Deep review', '    ! Seat 1: no skill "x"'].join('\n')
  expect(toned(listed)).toEqual([['heading:Presets'], ['option:deep', 'quiet:built-in', 'option:opus:xhigh', 'option:sonnet:high'], [], ['warning:    ! Seat 1: no skill "x"']])

  const shown = ['Preset "deep" in /home/me/code/plugins/agent-panel/presets.json:', '  deep             built-in  opus:xhigh', '1. opus·xhigh (claude-opus-5-5, effort xhigh)'].join('\n')
  expect(toned(shown)[0]?.[0]).toBe('heading:Preset "deep" in /home/me/code/plugins/agent-panel/presets.json:')
  expect(toned(shown)[2]).toEqual(['quiet:1.', 'option:opus·xhigh'])

  expect(toned(['/home/me/skills (2)', '  ads                      Writes ads'].join('\n'))).toEqual([['heading:/home/me/skills (2)'], ['option:ads']])
  expect(toned(['Panel 1a2b started:', '1. haiku·low (claude-haiku-5-5, effort low)'].join('\n'))).toEqual([['heading:Panel 1a2b started:'], ['quiet:1.', 'option:haiku·low']])
})

