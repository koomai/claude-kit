export type Role = 'panelist' | 'contrarian'
export type SeatStatus = 'starting' | 'working' | 'done' | 'failed'

export type Seat = {
  label: string
  model: string
  effort: string
  role: Role
  skills: string[]
  status: SeatStatus
  agentId?: string
  answer?: string
}

export type RunKind = 'panel' | 'pingpong'
export type SaveMode = 'off' | 'files' | 'solo' | 'both'
export type Phase = 'drafting' | 'merging' | 'challenging' | 'integrating' | 'done' | 'failed'

export type Run = {
  id: string
  kind: RunKind
  question: string
  seats: Seat[]
  phase: Phase
  round: number
  rounds: number
  candidate?: string
  challenges: string[]
  claim?: string
  isReported?: boolean
  brief?: string
  dir?: string
  scratchpadId?: number
  scratchpadTitle?: string
  saveNote?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-panel': { runs: Run[] }
  }
}
