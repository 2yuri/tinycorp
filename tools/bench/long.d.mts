/** Types for `tools/bench/long.mjs`: three tickets in one resumed session (T197). */

import type { Arm } from './arms.mjs'
import type { Leg, Task, Unit } from './plan.mjs'
import type { MeasuredPart } from './report.mjs'

/** A triple of tickets one long cell works, in order. */
export interface Triple {
  id: string
  size: string
  trap: string
  tasks: readonly string[]
}

export const LONG_TRIPLES: readonly [Triple, ...Triple[]]
export const CHECKPOINT_PROMPT: string

export function tripleTasks(triple: Triple, tasks: readonly Task[]): Task[]
export function longLegs(triple: Triple, tasks: readonly Task[]): Leg[]
export function longUnits(tasks: readonly Task[], triples?: readonly Triple[]): Unit[]

/** One long cell: every leg of one resumed session, in order, and where it stopped. */
export function runLongLegs(options: {
  legs: readonly Leg[]
  claude: string
  model: string
  arm: Arm
  settingsFile: string | null
  sessionId: string
  cwd: string
  env: NodeJS.ProcessEnv
  budgetUsd?: number | null
}): Promise<{ sessionIds: string[]; parts: MeasuredPart[] }>
