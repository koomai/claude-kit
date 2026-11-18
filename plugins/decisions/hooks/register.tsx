import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, Decision } from '../types'

const PANE = 'decisions'
const ALL = 'All'
const PLUGIN = 'decisions'
const POST_TOOL = 'mcp__decisions__post'
const RESOLVE_TOOL = 'mcp__decisions__resolve'

const decisions = atom({ plugin: 'decisions', key: 'decisions' } as const, [], {
  shape: 'decisions-1',
})
const tab = atom({ plugin: 'decisions', key: 'tab' } as const, ALL)
const revisions = atom({ plugin: 'decisions', key: 'revisions' } as const, {} as Record<string, number>)
const note = atom({ plugin: 'decisions', key: 'note' } as const, '')

const ASKS = ['ok', 'yesno', 'choice', 'text'] as const

const GUIDANCE = `## Decisions pane

The person sees open decisions in a pane beside the chat, where they answer and comment. Whenever a turn leaves questions for the person (anything you would otherwise list as "still waiting on you", confirmations to test, choices to make), post each one with the mcp__decisions__post tool instead of writing the list in your reply; one sentence saying how many you posted is enough. Give every decision a short stable id, reuse it when you ask the same thing again, and put related ones in the same group. When an answer arrives or a question no longer applies, close it with mcp__decisions__resolve. Answers come back as a prompt headed "Decisions from the pane".`

const POST_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short stable id, reused to update the same decision' },
          title: { type: 'string', description: 'The question or decision, one line' },
          recommendation: { type: 'string', description: 'Your recommendation or the context the person needs' },
          group: { type: 'string', description: 'Tab the decision sits under, such as "Music" or "Controls"' },
          ask: {
            type: 'string',
            enum: [...ASKS],
            description: 'ok: OK / Not OK. yesno: Yes / No. choice: one of `choices`. text: a written answer. Omit for an information row that only takes a comment.',
          },
          choices: { type: 'array', items: { type: 'string' }, description: 'The options when ask is choice' },
        },
        required: ['id', 'title'],
      },
    },
  },
  required: ['decisions'],
}

const RESOLVE_SCHEMA = {
  type: 'object',
  properties: { ids: { type: 'array', items: { type: 'string' } } },
  required: ['ids'],
}

type Posted = Pick<Decision, 'id' | 'title' | 'recommendation' | 'group' | 'ask' | 'choices'>

export const optionsFor = (decision: Decision): string[] => {
  if (decision.ask === 'ok') return ['OK', 'Not OK']
  if (decision.ask === 'yesno') return ['Yes', 'No']
  if (decision.ask === 'choice') return decision.choices ?? []

  return []
}

const groupOf = (decision: Decision) => decision.group?.trim() || 'Other'

const isAnswered = (decision: Decision) =>
  Boolean(decision.answer?.trim() || (decision.ask === undefined && decision.comment?.trim()))

const asPosted = (raw: unknown): Posted | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return undefined
  const ask = ASKS.find(one => one === value.ask) as Ask | undefined
  const choices = Array.isArray(value.choices)
    ? value.choices.filter((one): one is string => typeof one === 'string')
    : undefined

  return {
    id: value.id,
    title: value.title,
    recommendation: typeof value.recommendation === 'string' ? value.recommendation : undefined,
    group: typeof value.group === 'string' ? value.group : undefined,
    ask,
    choices,
  }
}

export const merge = (list: Decision[], posted: Posted[]): Decision[] => {
  const next = [...list]
  for (const one of posted) {
    const at = next.findIndex(existing => existing.id === one.id)
    const fresh: Decision = { ...one, status: 'open' }
    const kept = next[at]
    if (kept === undefined) {
      next.push(fresh)
      continue
    }
    const options = optionsFor(fresh)
    const isAnswerValid = fresh.ask === 'text' || options.includes(kept.answer ?? '')
    next[at] = { ...fresh, answer: isAnswerValid ? kept.answer : undefined, comment: kept.comment }
  }

  return next
}

export const compose = (open: Decision[], extra: string): string => {
  const lines = ['Decisions from the pane', '']
  open.forEach((decision, i) => {
    lines.push(`${i + 1}. [${groupOf(decision)}] ${decision.title} (id: ${decision.id})`)
    if (decision.recommendation) lines.push(`   Recommendation: ${decision.recommendation}`)
    if (decision.ask !== undefined) lines.push(`   Answer: ${decision.answer?.trim() || 'No answer'}`)
    if (decision.comment?.trim()) lines.push(`   Comment: ${decision.comment.trim()}`)
    lines.push('')
  })
  if (extra.trim()) lines.push('Anything else:', extra.trim(), '')

  return lines.join('\n').trimEnd()
}


type Revisions = Record<string, number>

export const tabKey = (name: string) => `tab:${name}`
export const optionKey = (id: string, at: number) => `opt:${id}:${at}`
export const fieldKey = (base: string, revs: Revisions) => `${base}#${revs[base] ?? 0}`
const baseOf = (key: string) => key.replace(/#\d+$/, '')

const answerBase = (id: string) => `ans:${id}`
const commentBase = (id: string) => `cmt:${id}`
const NOTE = 'note'

export const firstStop = (decision: Decision, revs: Revisions) => {
  if (optionsFor(decision).length > 0) return optionKey(decision.id, 0)
  if (decision.ask === 'text') return fieldKey(answerBase(decision.id), revs)

  return fieldKey(commentBase(decision.id), revs)
}

export const stopAfter = (shown: Decision[], id: string, revs: Revisions) => {
  const next = shown[shown.findIndex(one => one.id === id) + 1]

  return next ? firstStop(next, revs) : fieldKey(NOTE, revs)
}

const decisionStops = (decision: Decision, revs: Revisions) =>
  decision.ask === 'text'
    ? [fieldKey(answerBase(decision.id), revs)]
    : [...optionsFor(decision).map((_, at) => optionKey(decision.id, at)), fieldKey(commentBase(decision.id), revs)]

export const stopsOf = (tabs: string[], shown: Decision[], revs: Revisions, hasSent: boolean) => [
  ...tabs.map(tabKey),
  ...shown.flatMap(decision => decisionStops(decision, revs)),
  ...(tabs.length > 0 ? [fieldKey(NOTE, revs), 'send'] : []),
  ...(hasSent ? ['clear'] : []),
]

const view = async ($: EngineInterface) => {
  const list = await read($, decisions)
  const open = list.filter(one => one.status === 'open')
  const groups = [...new Set(open.map(groupOf))]
  const current = await read($, tab)
  const active = current === ALL || groups.includes(current) ? current : ALL
  const shown = active === ALL ? open : open.filter(one => groupOf(one) === active)
  const tabs = open.length > 0 ? [ALL, ...groups].slice(0, 9) : []
  const revs = await read($, revisions)
  const stops = stopsOf(tabs, shown, revs, list.length > open.length)

  return { list, open, active, shown, tabs, revs, stops }
}

const openPane = async ($: EngineInterface, focus?: true) => {
  const open = (await read($, decisions)).filter(one => one.status === 'open').length

  return $.ui.open({ id: PANE, title: open ? `Decisions ${open}` : 'Decisions', focus })
}

const patch = ($: EngineInterface, id: string, change: Partial<Decision>) =>
  update($, decisions, list => list.map(one => (one.id === id ? { ...one, ...change } : one)))

const submitted = new Set<string>()
let ring = ''

export const targetAfterField = (shown: Decision[], key: string, revs: Revisions) => {
  const base = baseOf(key)

  return base === NOTE ? 'send' : stopAfter(shown, base.slice(4), revs)
}

export const targetAfterPick = (id: string, revs: Revisions) => fieldKey(commentBase(id), revs)

export const ringTarget = (stops: string[], current: string) => (stops.includes(current) ? current : stops[0])

const focusOn = async ($: EngineInterface, key: string) => {
  const moved = await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'failed' }))
  if (!moved.deny) ring = key
}

const saveField = async ($: EngineInterface, key: string, text: string) => {
  const base = baseOf(key)
  if (base === NOTE) return update($, note, () => text)
  const id = base.slice(4)

  return patch($, id, base.startsWith('cmt:') ? { comment: text } : { answer: text })
}

const restoreRing = async ($: EngineInterface) => {
  if (!ring) return
  const { stops } = await view($)
  const target = ringTarget(stops, ring)
  if (target) await focusOn($, target)
}

const send = async ($: EngineInterface) => {
  const open = (await read($, decisions)).filter(one => one.status === 'open')
  if (open.length === 0) {
    $.ui.toast('No open decisions to send.')
    return
  }
  const sent = new Set(open.filter(isAnswered).map(one => one.id))
  void $.prompt.submit({ text: compose(open, await read($, note)) })
  await update($, decisions, list =>
    list.map(one => (sent.has(one.id) ? { ...one, status: 'sent' as const } : one)),
  )
  await update($, note, () => '')
  await openPane($)
  const { stops } = await view($)
  if (stops[0]) await focusOn($, stops[0])
}

const onFieldInput = async ($: EngineInterface, key: string, value: string) => {
  if (value === '' && submitted.has(key)) return
  submitted.delete(key)
  await saveField($, key, value)
}

const onFieldSubmit = async ($: EngineInterface, key: string, value: string) => {
  submitted.add(key)
  const base = baseOf(key)
  await update($, revisions, all => ({ ...all, [base]: (all[base] ?? 0) + 1 }))
  if (value !== '') await saveField($, key, value)
  const { shown, revs } = await view($)
  await focusOn($, targetAfterField(shown, key, revs))
}

const pickOption = async ($: EngineInterface, id: string, value: string) => {
  await patch($, id, { answer: value })
  await focusOn($, targetAfterPick(id, await read($, revisions)))
}

const showTab = async ($: EngineInterface, name: string) => {
  await update($, tab, () => name)
  await focusOn($, tabKey(name))
}

const clearSent = async ($: EngineInterface) => {
  await update($, decisions, all => all.filter(one => one.status === 'open'))
  const { stops } = await view($)
  if (stops[0]) await focusOn($, stops[0])
}

const servePost = async ($: EngineInterface, e: unknown) => {
  const raw = (e as { decisions?: unknown }).decisions
  const posted = (Array.isArray(raw) ? raw : []).map(asPosted).filter((one): one is Posted => one !== undefined)
  if (posted.length === 0) {
    return { deny: 'No valid decisions: each needs a string id and title.' }
  }
  await update($, decisions, list => merge(list, posted))
  const opened = await openPane($)
  await restoreRing($)
  const open = (await read($, decisions)).filter(one => one.status === 'open').length
  const where = opened.isPlaced ? 'in the pane' : 'waiting for the person to open the pane with /decisions'

  return { result: `Posted ${posted.length}; ${open} open, ${where}.` }
}

const serveResolve = async ($: EngineInterface, e: unknown) => {
  const raw = (e as { ids?: unknown }).ids
  const ids = new Set((Array.isArray(raw) ? raw : []).filter((one): one is string => typeof one === 'string'))
  await update($, decisions, list => list.filter(one => !ids.has(one.id)))
  await openPane($)
  await restoreRing($)

  return { result: `Resolved ${ids.size}.` }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'decisions',
      description: 'Show the open decisions of this session in a pane',
    })
    await $.tool.register({
      name: 'post',
      description:
        'Posts decisions or questions for the person to the Decisions pane beside the chat, where they answer and comment. A decision with an id already posted is updated in place.',
      inputSchema: POST_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'resolve',
      description:
        'Removes decisions from the Decisions pane by id, once their answers have arrived or they no longer apply.',
      inputSchema: RESOLVE_SCHEMA,
      isDeferred: false,
    })
    const hasOpen = (await read($, decisions)).some(one => one.status === 'open')
    if (hasOpen) void openPane($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [...composed.sections, { id: `${PLUGIN}:guidance`, text: GUIDANCE, scope: 'session' as const }],
    }
  })

  on('command.run', { command: 'decisions' }, async $ => {
    const opened = await openPane($, true)
    if (!opened.isPlaced) return { text: `The decisions pane could not open: ${opened.reason}` }

    return { text: 'Decisions pane opened with the keyboard in it. Esc returns to the prompt.' }
  })

  on('tool.call', { tool: POST_TOOL }, ($, e) => servePost($, e)).catch(() => ({
    deny: 'The decisions pane failed to save these decisions; list them in your reply instead.',
  }))

  on('tool.call', { tool: RESOLVE_TOOL }, ($, e) => serveResolve($, e)).catch(() => ({
    deny: 'The decisions pane failed to resolve these decisions.',
  }))

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (!moved.deny) ring = e.element ?? ''

    return moved
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const { list, open, active, shown, tabs, revs } = await view($)
    const sentCount = list.length - open.length
    const width = Math.max(20, e.props.bodyColumns)
    const noteKey = fieldKey(NOTE, revs)

    return (
      <Box flexDirection="column" width={width}>
        {tabs.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {tabs.map((name, i) => (
              <Button
                key={tabKey(name)}
                hotkey={String(i + 1)}
                variant={name === active ? 'primary' : 'secondary'}
                onPress={() => showTab($, name)}
              >
                {name} {name === ALL ? open.length : open.filter(one => groupOf(one) === name).length}
              </Button>
            ))}
          </Box>
        )}

        {open.length === 0 && <Text dimColor>No open decisions.</Text>}

        {shown.map(decision => {
          const options = optionsFor(decision)
          const answer = decision.answer?.trim()
          const answerKey = fieldKey(answerBase(decision.id), revs)
          const commentKey = fieldKey(commentBase(decision.id), revs)

          return (
            <Box key={`box:${decision.id}`} flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end">
                <Text bold>
                  {isAnswered(decision) ? '● ' : '○ '}
                  {decision.title}
                </Text>
                {answer && decision.ask !== 'text' && <Text color="success"> {answer}</Text>}
                {decision.ask !== 'text' && decision.comment?.trim() && <Text dimColor> · comment</Text>}
              </Text>
              <Box flexDirection="column" paddingLeft={2}>
                {decision.recommendation && <Text dimColor>{decision.recommendation}</Text>}
                {options.length > 0 && (
                  <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                    {options.map((value, at) => (
                      <Button
                        key={optionKey(decision.id, at)}
                        variant={value === answer ? 'primary' : 'secondary'}
                        onPress={() => pickOption($, decision.id, value)}
                      >
                        {value}
                      </Button>
                    ))}
                  </Box>
                )}
                {decision.ask === 'text' ? (
                  <Input
                    key={answerKey}
                    label="Answer"
                    rows={2}
                    value={decision.answer ?? ''}
                    submitLabel="save"
                    onInput={value => onFieldInput($, answerKey, value)}
                    onSubmit={value => onFieldSubmit($, answerKey, value)}
                  />
                ) : (
                  <Input
                    key={commentKey}
                    label="Comment"
                    placeholder="optional"
                    value={decision.comment ?? ''}
                    submitLabel="save"
                    onInput={value => onFieldInput($, commentKey, value)}
                    onSubmit={value => onFieldSubmit($, commentKey, value)}
                  />
                )}
              </Box>
            </Box>
          )
        })}

        {open.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Input
              key={noteKey}
              label="Anything else"
              value={await read($, note)}
              submitLabel="save"
              onInput={value => onFieldInput($, noteKey, value)}
              onSubmit={value => onFieldSubmit($, noteKey, value)}
            />
          </Box>
        )}

        <Box flexDirection="row" columnGap={2} marginTop={1}>
          {open.length > 0 && (
            <Button key="send" hotkey="s" variant="primary" onPress={() => send($)}>
              Send answers ({open.filter(isAnswered).length}/{open.length})
            </Button>
          )}
          {sentCount > 0 && (
            <Button key="clear" hotkey="x" onPress={() => clearSent($)}>
              Clear sent ({sentCount})
            </Button>
          )}
        </Box>
      </Box>
    )
  })
}
