export type Ask = 'ok' | 'yesno' | 'choice' | 'text'

export type Decision = {
  id: string
  title: string
  recommendation?: string
  group?: string
  ask?: Ask
  choices?: string[]
  answer?: string
  comment?: string
  status: 'open' | 'sent'
}

declare module 'claude-code' {
  interface PluginState {
    decisions: {
      decisions: Shaped<Decision[]>
      tab: string
      revisions: Record<string, number>
      note: string
    }
  }
}
