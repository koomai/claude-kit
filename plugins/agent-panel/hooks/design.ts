import { splitSkill } from './seats'

export type Design = { name: string; webfonts: string; tokens: Record<string, string>; writing: string; illustrations: string; styles: string }
export type DesignLayer = Partial<Design>
export type Guide = Pick<Design, 'writing' | 'illustrations'>

const KEY_LINE = /^(?:--)?([a-z][\w-]*)[ \t]*:[ \t]*(.*)$/i
const BREAKS_OUT = /[;{}<>]/
const WEBFONTS = /^https:\/\/[^\s"'<>]+$/
const HEADING = /^##[ \t]+(.+?)[ \t]*$/
const FENCE = /```[\w-]*\r?\n([\s\S]*?)```/
const SECTIONS = ['writing', 'illustrations', 'styles'] as const

type SectionName = (typeof SECTIONS)[number]

const isSection = (name: string): name is SectionName => (SECTIONS as readonly string[]).includes(name)

export function readDesign(text: string): DesignLayer {
  const { frontmatter, body } = splitSkill(text)
  const layer: DesignLayer = {}
  const tokens: Record<string, string> = {}

  for (const line of frontmatter.split(/\r?\n/)) {
    const at = KEY_LINE.exec(line.trim())
    if (at?.[1] === undefined) continue
    const key = at[1].toLowerCase()
    const value = (at[2] ?? '').trim()
    if (key === 'name') layer.name = value
    else if (key === 'webfonts') layer.webfonts = WEBFONTS.test(value) ? value : ''
    else if (value !== '' && !BREAKS_OUT.test(value)) tokens[key] = value
  }
  if (Object.keys(tokens).length > 0) layer.tokens = tokens

  const sections: Partial<Record<SectionName, string[]>> = {}
  let current: SectionName | undefined
  for (const line of body.split(/\r?\n/)) {
    const name = (HEADING.exec(line)?.[1] ?? '').toLowerCase()
    if (isSection(name)) {
      current = name
      sections[current] = []
    } else if (current !== undefined) sections[current]?.push(line)
  }
  for (const name of SECTIONS) {
    const written = sections[name]?.join('\n').trim()
    if (written !== undefined) layer[name] = name === 'styles' ? (FENCE.exec(written)?.[1] ?? written).trim() : written
  }

  return layer
}

export function layerDesign(layers: readonly DesignLayer[]): Design {
  const design: Design = { name: '', webfonts: '', tokens: {}, writing: '', illustrations: '', styles: '' }
  for (const { tokens, ...rest } of layers) {
    Object.assign(design, rest)
    Object.assign(design.tokens, tokens)
  }

  return design
}

export function designCss(design: Design, sheet: string): string {
  const tokens = Object.entries(design.tokens).map(([key, value]) => `  --${key}: ${value};`)

  return [`:root {\n${tokens.join('\n')}\n}`, sheet.trim(), design.styles.replace(/<\/style/gi, '<\\/style')].filter(Boolean).join('\n\n')
}

export function hashOf(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0

  return hash.toString(36)
}
