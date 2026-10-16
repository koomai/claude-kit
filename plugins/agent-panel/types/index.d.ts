export type Role = 'panelist' | 'contrarian'
export type SeatStatus = 'starting' | 'working' | 'done' | 'failed'

export type Seat = {
  label: string
  model: string
  effort: string
  role: Role
  skills: string[]
  folderSkills?: FolderSkill[]
  unknownSkills?: string[]
  status: SeatStatus
  agentId?: string
  answer?: string
  startedAt?: number
  durationMs?: number
  tokens?: number
  steps?: number
  activity?: string
  isInterrupted?: boolean
}

export type FolderSkill = { name: string; path: string }

export type PresetSource = 'project' | 'user' | 'built-in'

export type Preset = {
  seats: string[]
  source: PresetSource
  description?: string
  brief?: string
  rounds?: number
  skillDirs?: string[]
}

export type PresetMap = Record<string, Preset>

export type RunKind = 'panel' | 'pingpong'
export type SaveMode = 'off' | 'files' | 'solo' | 'both'
export type Phase = 'drafting' | 'discussing' | 'merging' | 'challenging' | 'integrating' | 'done' | 'failed'
export type RoundState = 'answered' | 'unchanged' | 'failed' | 'interrupted' | 'absent'
export type RoundEntry = { state: RoundState; text: string; isMoved?: boolean }

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
  drafts?: string[]
  plans?: string[]
  claim?: string
  isReported?: boolean
  brief?: string
  dir?: string
  page?: string
  scratchpadId?: number
  scratchpadTitle?: string
  saveNote?: string
  notes?: string[]
  warnings?: string[]
  startedAt?: number
  endedAt?: number
  transcript?: RoundEntry[][]
  briefText?: string
  outcome?: string
  isStopping?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-panel': { runs: Run[] }
  }
}
