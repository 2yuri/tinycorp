/**
 * Approvals, as both processes name them (decision 30): how much the boss delegates, which actions
 * a level gates, and what one Approval is. The engine is `src/main/features/approvals`.
 */

import type { ApprovalPullRequest } from './approval-subject'

/** How much the boss delegates. `managed` is the default of every Company. */
export const AUTONOMY_LEVELS = ['supervised', 'managed', 'autonomous'] as const
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]
export const DEFAULT_AUTONOMY: AutonomyLevel = 'managed'

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  supervised: 'Supervised',
  managed: 'Managed',
  autonomous: 'Autonomous',
}

/**
 * Actions the autonomy gate knows. `other` is anything an Employee wants the boss to decide
 * that is not in the table; it always asks.
 */
export const GATED_ACTIONS = [
  'ticket_create',
  'ticket_reorder',
  'assign',
  'start',
  'open_pr',
  'merge',
  'hire',
  'fire',
  'switch_provider',
  'process_change',
  'env_run',
  'other',
] as const
export type GatedAction = (typeof GATED_ACTIONS)[number]

/**
 * What an Employee may ask for with `approval_request`. `env_run` is not one of them: an
 * Environment that asks before every use raises its own card, from the tool that runs the command,
 * so there is nothing for an Employee to request by hand (T176).
 */
export const REQUESTABLE_ACTIONS = GATED_ACTIONS.filter((action) => action !== 'env_run') as Exclude<
  GatedAction,
  'env_run'
>[]

export const ACTION_LABEL: Record<GatedAction, string> = {
  ticket_create: 'create a ticket',
  ticket_reorder: 'reorder tickets',
  assign: 'assign a ticket',
  start: 'start work',
  open_pr: 'open a PR',
  merge: 'merge',
  hire: 'hire',
  fire: 'fire',
  switch_provider: 'switch provider',
  process_change: 'change the process',
  env_run: 'run a command with an environment',
  other: 'decide',
}

/** Facts that make an Autonomous Company ask anyway. Absent means false. */
export interface GateConditions {
  /** CI is failing on the PR being opened or merged. */
  ciRed?: boolean
  /** A limit is exceeded: WIP, budget, or the review round limit the agents argued past (T170). */
  limitExceeded?: boolean
  /** Hiring would go above the maximum headcount. */
  aboveHeadcount?: boolean
}

/** `free`: go ahead. `ask`: create an Approval and wait for the boss. */
export type Gate = 'free' | 'ask'

/** The autonomy gate table of the spec. */
export function gate(level: AutonomyLevel, action: GatedAction, conditions: GateConditions = {}): Gate {
  switch (action) {
    case 'ticket_create':
    case 'ticket_reorder':
      return 'free'
    case 'assign':
    case 'start':
      return level === 'supervised' ? 'ask' : 'free'
    case 'open_pr':
    case 'merge':
      if (level !== 'autonomous') return 'ask'
      return conditions.ciRed || conditions.limitExceeded ? 'ask' : 'free'
    case 'hire':
      if (level !== 'autonomous') return 'ask'
      return conditions.aboveHeadcount ? 'ask' : 'free'
    case 'process_change':
      return level === 'autonomous' ? 'free' : 'ask'
    case 'fire':
    case 'switch_provider':
    case 'other':
      return 'ask'
    // The environment decides, not the level: `env_run` only ever reaches the gate when the
    // environment it names is one that asks before every use (T176), and then it always asks.
    case 'env_run':
      return 'ask'
  }
}

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return AUTONOMY_LEVELS.includes(value as AutonomyLevel)
}

export function isGatedAction(value: unknown): value is GatedAction {
  return GATED_ACTIONS.includes(value as GatedAction)
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

/** A gated action waiting for, or decided by, the boss. Its chat thread is where it is discussed. */
export interface Approval {
  id: number
  action: GatedAction
  /** The Employee who asked. */
  requesterId: string
  /** What the action is about, e.g. `#12 Login page`; the engine writes it when the Approval names a ticket. */
  subject: string
  /** The ticket it is about, e.g. the one to merge; null when it is not about a ticket. */
  ticketId: number | null
  /** The PR it is about, when the requester named one. */
  pullRequest: ApprovalPullRequest | null
  /** Why the Employee asks, in their words. */
  reason: string
  status: ApprovalStatus
  /** The boss's reason; required on rejection, optional on approval. */
  decisionReason: string | null
  channelId: string
  /** The root message of the approval's chat thread. */
  messageId: number
  createdAt: string
  decidedAt: string | null
}

export interface ApprovalInput {
  requesterId: string
  action: GatedAction
  /**
   * The one human sentence the request posts in chat. The app writes one when it is missing,
   * and the facts go on the Approval's card (decision 42).
   */
  summary?: string
  /** What it is about, in words. Ignored when a ticket or PR is named: the engine writes the subject. */
  subject?: string
  /** The ticket it is about. Required, or `pullRequest`, for `open_pr` and `merge`. */
  ticketId?: number
  /** The PR it is about; its ticket is found from it. */
  pullRequest?: ApprovalPullRequest
  reason?: string
  conditions?: GateConditions
}

/** What a request came to: free under the current level, or an Approval to wait for. */
export type ApprovalOutcome =
  | { gate: 'free'; level: AutonomyLevel }
  | { gate: 'ask'; level: AutonomyLevel; approval: Approval }

export interface ApprovalDecision {
  approve: boolean
  reason?: string
}
