/** Types for `tools/bench/session.mjs`, one cell of `pnpm bench:tokens` and its isolation checks. */

import type { Arm } from './arms.mjs'

export const MODELS: Record<string, string>
export const CELL_TIMEOUT_MS: number

/** A command on `PATH`, crossed with `PATHEXT` on Windows. Null when nothing answers to it. */
export function resolveCli(command: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string | null

export interface CellRequest {
  prompt: string
  /** A key of {@link MODELS}, or a model id passed through as written. */
  model: string
  arm: Arm
  /** The arm's settings file, or null when the arm writes none. */
  settingsFile: string | null
  sessionId: string
  budgetUsd?: number | null
  /** `--resume` rather than `--session-id`: the same Employee, one leg later (T197). */
  resume?: boolean
  /** Text appended after the arm's own, never mixed into it: who this Employee is. */
  extra?: string | null
  /** The MCP servers this leg may reach, as a config file. Null leaves it none. */
  mcpConfigFile?: string | null
}

export function claudeArgs(request: CellRequest): string[]
export function cellEnv(options?: { rtkDbPath?: string | null; env?: NodeJS.ProcessEnv }): NodeJS.ProcessEnv

/** What one `claude` process did. `killed` means it hit the cell timeout. */
export interface SessionOutcome {
  code: number | null
  killed: boolean
  ms: number
  stdout: string
  stderr: string
}

export function runSession(options: {
  claude: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeout?: number
}): Promise<SessionOutcome>

/** The CLI's own result JSON, read. Cache tokens stay apart from fresh input. */
export interface CellResult {
  ok: boolean
  subtype: string | null
  sessionId: string | null
  /** The model id the CLI actually billed, not the name the bench asked for. */
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number | null
  turns: number | null
  apiMs: number | null
  permissionDenials: number
}

export function readResult(stdout: string): CellResult | null
export function totalTokens(result: CellResult): number
/** Several legs of one cell, added up. Null when not one of them was measured. */
export function sumResults(results: readonly (CellResult | null)[]): CellResult | null

export function projectsDir(config?: string): string
export function findTranscript(sessionId: string, config?: string): string | null

/** One line of a transcript. Only the fields the isolation checks read are named. */
export interface TranscriptRecord {
  type?: string
  message?: { content?: unknown }
  attachment?: {
    type?: string
    hookName?: string
    hookEvent?: string
    content?: string
    systemPrompt?: string[] | string
  }
}

export function readTranscript(file: string): TranscriptRecord[]
export function hooksFired(records: readonly TranscriptRecord[]): string[]
export function skillsOffered(records: readonly TranscriptRecord[]): string[]
export function mcpServersUsed(records: readonly TranscriptRecord[]): string[]
export function systemPrompt(records: readonly TranscriptRecord[]): string | null

/** What is wrong with a cell's isolation, in sentences. Empty means clean. */
export function isolationBreaches(options: {
  arm: Arm
  records: readonly TranscriptRecord[] | null
  others?: readonly Arm[]
}): string[]

/** What RTK filtered out of one cell, against that cell's own history file. */
export interface RtkGain {
  commands: number
  inputTokens: number
  outputTokens: number
  savedTokens: number
  cutPercent: number
}

export function rtkGain(rtkPath: string | null, dbPath: string): RtkGain | null
export function parseRtkGain(text: string): RtkGain | null
