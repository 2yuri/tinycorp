/** Types for `tools/bench/boss.mjs`: one Employee, one ticket, a scripted boss reading it (T261). */

import type { Arm } from './arms.mjs'
import type { DmMessage } from './dm.mjs'
import type { Task } from './plan.mjs'
import type { DmTraffic, MeasuredPart } from './report.mjs'

export const BOSS_NAME: string
export const EMPLOYEE_NAME: string
export const BOSS_TASKS: readonly string[]

/** One fact an answer has to carry, named so the report can say which one went missing. */
export interface Want {
  what: string
  pattern: RegExp
}

/** One thing the boss asks, and what the answer to it has to hold. */
export interface Question {
  id: string
  text: string
  wants: readonly Want[]
}

export const QUESTIONS: readonly Question[]

export function bossUnits(tasks: readonly Task[], ids?: readonly string[]): Task[]
export function bossRolePrompt(): string
export function bossWakePrompt(message: { id: number; text: string }): string

/** The next message from the Employee nobody has answered yet, and where the cursor lands. */
export function nextAsk(messages: readonly DmMessage[], cursor: number): { message: DmMessage; cursor: number } | null

/** Whether the boss got what they asked for, over every question that was actually put. */
export interface AnswersRight {
  asked: number
  checks: number
  held: number
  missing: string[]
}

export function answersRight(asked: readonly { question: Question; answer: string | null }[]): AnswersRight

export function runBossCell(options: {
  claude: string
  model: string
  arm: Arm
  settingsFile: string | null
  cwd: string
  env: NodeJS.ProcessEnv
  budgetUsd?: number | null
  dir: string
  task: Task
  sessionId: string
  questions?: readonly Question[]
}): Promise<{ sessionIds: string[]; parts: MeasuredPart[]; dm: DmTraffic; answers: AnswersRight }>
