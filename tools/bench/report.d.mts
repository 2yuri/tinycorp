/** Types for `tools/bench/report.mjs`: what a `pnpm bench:tokens` run may say about itself. */

import type { AnswersRight } from './boss.mjs'
import type { DiffStat, TestOutcome } from './fixture.mjs'
import type { CellResult, RtkGain } from './session.mjs'

export function median(values: readonly number[]): number | null
export function quartiles(values: readonly number[]): { q1: number | null; q3: number | null }
export function iqr(values: readonly number[]): number | null
/** `value` as a percentage of `baseline`. Above 100 means the arm spent more. */
export function percentOf(value: number | null, baseline: number | null): number | null
export function deltaLabel(percent: number | null): string
export function tokens(value: number | null): string
export function usd(value: number | null): string

/** One `claude` process of a cell: a leg of a long session, or one Employee's wake. */
export interface MeasuredPart {
  id: string
  kind: string
  /** `lead` or `helper` in a `duo` cell; absent in the others. */
  role?: string
  task?: string
  sessionId: string
  ms: number
  result: CellResult | null
  tokensTotal: number | null
  error?: string | null
}

/** How much prose one cell's DM thread carried, per author and in all. */
export interface DmTraffic {
  messages: number
  chars: number
  words: number
  estTokens: number
  elsewhere: number
  byAuthor: Record<string, { messages: number; chars: number; words: number; estTokens: number }>
  deliveries: number
  capped: boolean
}

/** One measured cell, as the JSONL records it and the report reads it. */
export interface MeasuredCell {
  id: string
  /** Which shape of run this cell came from. Absent in T190's own files, which were all `solo`. */
  mode?: string
  task: string
  arm: string
  run: number
  ms: number
  result: CellResult | null
  tokensTotal: number | null
  /** Every session this cell started: one for a long cell, two for a duo one. */
  sessionIds?: readonly string[]
  /** Every `claude` process this cell took, in order. */
  parts?: readonly MeasuredPart[]
  /** The DM thread of a `duo` cell, or the Employee's half of a `boss` one. Null elsewhere. */
  dm?: DmTraffic | null
  /** Whether the boss's questions were answered, in a `boss` cell. Null elsewhere. */
  answers?: AnswersRight | null
  diff: DiffStat | null
  tests: TestOutcome | null
  rtk: RtkGain | null
  /** Empty when the cell's isolation held. */
  breaches: string[]
  error?: string | null
}

/** Whether a `duo` cell's ticket landed: green suite, code in the diff, both Employees writing. */
export function landed(cell: MeasuredCell): boolean

/** A median and a spread, for one measure of one group of cells. */
export interface Spread {
  median: number | null
  iqr: number | null
}

export interface ArmSummary {
  n: number
  ran: number
  failed: number
  totalTokens: Spread
  outputTokens: Spread
  cacheReadTokens: Spread
  costUsd: Spread
  seconds: Spread
  linesAdded: Spread
  linesRemoved: Spread
  testsPassed: number
  testsRun: number
  turns: Spread
  rtkSaved: { median: number | null; commands: number | null } | null
  rtkCutPercent: number | null
}

export function summarise(cells: readonly MeasuredCell[]): ArmSummary

/** Everything the report says about the run itself. */
export interface RunFacts {
  /** Which shape of run: `solo`, `long` or `duo`. */
  mode?: string
  /** What one cell of it works, for the per-unit heading. */
  unit?: string
  /** One line saying what a cell is. */
  shape?: string
  /** The arm every percentage is a percentage of. `baseline` when it is not said. */
  baseArm?: string
  model: string
  n: number
  date: string
  fixture: string
  commit: string
  /** The command line that produced this file, so it can be run again. */
  command: string
  jsonl: string
  claudeVersion: string
  rtkVersion: string | null
  limitations: readonly string[]
}

export function renderReport(options: {
  run: RunFacts
  cells: readonly MeasuredCell[]
  arms: readonly string[]
  tasks: readonly { id: string; size: string; trap: string }[]
}): string
