export type HelpTone = 'heading' | 'command' | 'option' | 'quiet' | 'error'
export type HelpSpan = { text: string; tone?: HelpTone }

const INLINE = /(?<=^|[\s(])\/[a-z][\w-]*(?=[\s.,;:)]|$)|\b[a-z][\w-]*=[^\s\],;)]*|\b[a-z]+:[a-z]+(?::[a-z]+)*(?:\+[\w-]+)*|(?<=\[)[:+][a-z][\w-]*|(?<=^|\s)--(?=\s|$)|[[\]]/g
const ROW = /^( {2})(\S+)( {2,})(?:(built-in|user|project)( +))?(.*)$/
const HEADING_PREFIX = /^([^:]{1,30}): /
const USAGE = /^([\w-]+: )?Usage: /

export function isHelp(text: string): boolean {
  return text.split('\n').some(line => USAGE.test(line))
}

function inline(text: string, tone?: HelpTone): HelpSpan[] {
  const spans: HelpSpan[] = []
  let from = 0
  for (const hit of text.matchAll(INLINE)) {
    const token = hit[0]
    if (hit.index > from) spans.push({ text: text.slice(from, hit.index), tone })
    spans.push({ text: token, tone: token.startsWith('/') ? 'command' : token === '--' || token === '[' || token === ']' ? 'quiet' : 'option' })
    from = hit.index + token.length
  }
  if (from < text.length) spans.push({ text: text.slice(from), tone })

  return spans
}

function heading(line: string, next: string | undefined): HelpSpan[] | undefined {
  if (line === '' || /^[\s/]/.test(line) || !next?.startsWith(' ')) return undefined
  if (line.length <= 40) return [{ text: line, tone: 'heading' }]
  const prefix = HEADING_PREFIX.exec(line)?.[1]

  return prefix === undefined ? undefined : [{ text: `${prefix}:`, tone: 'heading' }, ...inline(line.slice(prefix.length + 1))]
}

export function helpLines(text: string): HelpSpan[][] {
  const lines = text.split('\n')
  const usageAt = lines.findIndex(line => USAGE.test(line))

  return lines.map((line, index) => {
    if (index < usageAt) return line === '' ? [] : [{ text: line, tone: 'error' }]
    if (index === usageAt) {
      const label = USAGE.exec(line)?.[1] ?? ''

      return [...(label === '' ? [] : [{ text: label, tone: 'quiet' as const }]), { text: 'Usage:', tone: 'heading' }, ...inline(line.slice(label.length + 'Usage:'.length))]
    }
    const titled = heading(line, lines[index + 1])
    if (titled !== undefined) return titled
    const row = ROW.exec(line)
    if (row === null) return line === '' ? [] : inline(line)
    const [, indent = '', name = '', gap = '', source, sourceGap = '', rest = ''] = row

    return [
      { text: indent },
      { text: name, tone: 'option' },
      { text: gap },
      ...(source === undefined ? [] : [{ text: source, tone: 'quiet' as const }, { text: sourceGap }]),
      ...inline(rest),
    ]
  })
}
