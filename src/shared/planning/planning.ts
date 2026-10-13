import type { AutonomyLevel } from '../approvals'

/**
 * Planning (T171): before work is Ready, the holder of `plan` asks the boss what it needs to know,
 * in chat, and drafts a plan. Only an approved plan makes the ticket claimable.
 */

/**
 * `drafting` the planner is writing it, `waiting` it is drafted and waits on the boss, `approved`
 * it is the plan the ticket is worked to, `replan` someone asked for it to change after approval.
 */
export const PLAN_STATUSES = ['drafting', 'waiting', 'approved', 'replan'] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

/** What a plan is about: one ticket, or one epic whose tickets inherit its approval. */
export type PlanSubject = { kind: 'ticket'; id: number } | { kind: 'epic'; id: number }

/** A piece of work the plan proposes, which becomes a ticket subtask once the plan is approved. */
export interface PlanSubtask {
  title: string
  /** One of the ticket's repo ids, or null when it is tied to none. */
  repo: string | null
}

/** One numbered question the planner asked the boss, and the answer written under it. */
export interface PlanQuestion {
  id: number
  planId: number
  /** 1, 2, 3 — what the card draws in the circle. */
  number: number
  text: string
  /** What the boss wrote, or what the planner decided when `delegated`; null while unanswered. */
  answer: string | null
  /** `BOSS`, or the planner when the boss said "Let … decide". */
  answeredBy: string | null
  answeredAt: string | null
  /** True when the boss handed this one question to the planner. */
  delegated: boolean
  /** The chat message that carries the questions. */
  messageId: number | null
}

/** One version of the plan of a ticket or an epic. Versions are never edited: a change is `v2`. */
export interface Plan {
  id: number
  /** 1 for the first draft; a replan writes the next. */
  version: number
  ticketId: number | null
  epicId: number | null
  /** The Employee who holds `plan` and wrote it; empty before anybody did. */
  plannerId: string
  goal: string
  approach: string
  acceptanceCriteria: string[]
  /** Repo ids in scope. */
  repos: string[]
  subtasks: PlanSubtask[]
  risks: string[]
  /** What the plan still does not settle, shown as the card's open-question strip. */
  openQuestions: string[]
  status: PlanStatus
  /** `BOSS` when the boss approved, the planner when it approved its own. */
  approvedBy: string | null
  approvedAt: string | null
  /** Who asked for the replan that opened this version, and why; null on a first draft. */
  replanBy: string | null
  replanReason: string | null
  /** What the replan says changes, one line each (`+ Subtask · …`). */
  replanChanges: string[]
  /** Where its planning thread is: the epic's channel, or `general` for a ticket with no epic. */
  channelId: string
  /** The chat message the planning thread hangs from; null until the plan is announced. */
  threadId: number | null
  /** The message carrying the Plan card; null until it is drafted. */
  messageId: number | null
  createdAt: string
  questions: PlanQuestion[]
}

/** Who approves a plan under this autonomy level. */
export type PlanApprover = 'boss' | 'planner'

/**
 * The planning gate (T171). Supervised: the boss approves every ticket's plan. Managed: the boss
 * approves an epic's plan, and its tickets inherit it — a ticket under an epic whose plan is
 * approved goes Ready on its own, and a ticket with no such epic still asks. Autonomous: the
 * planner approves its own plan and posts it.
 */
export function planApprover(
  level: AutonomyLevel,
  subject: PlanSubject['kind'],
  facts: { epicPlanApproved?: boolean } = {},
): PlanApprover {
  if (level === 'autonomous') return 'planner'
  if (level === 'supervised') return 'boss'
  if (subject === 'epic') return 'boss'
  return facts.epicPlanApproved ? 'planner' : 'boss'
}

/** What a plan's questions still wait on: the ones with no answer, in order. */
export function unanswered(plan: Pick<Plan, 'questions'>): PlanQuestion[] {
  return plan.questions.filter((q) => q.answer === null)
}

/**
 * Every question is answered and the plan itself is not posted yet (frame `dvg9E`). This is the
 * state TI-6 read as approval: the ticks went green, nothing said the plan was still to come, and
 * the ticket sat in Planning (T233). It is neither approval nor a decision the boss owes.
 */
export function answersSent(plan: Pick<Plan, 'status' | 'questions' | 'messageId'>): boolean {
  if (plan.status !== 'drafting' || plan.messageId !== null) return false
  return plan.questions.length > 0 && unanswered(plan).length === 0
}

/** What the header of a board's Planning card says, and why (frames `Oumw5`, `dvg9E`). */
export type PlanChipTone = 'asking' | 'answered' | 'waiting' | 'drafting' | 'replan' | 'approved'

export interface PlanChip {
  tone: PlanChipTone
  text: string
}

/**
 * The chip on a card: `Nova is asking you · 1 question`, `Plan drafted · waiting on you`,
 * `Nova is drafting the plan`, or `✓ Plan approved` once it is Ready.
 */
export function planChip(plan: Plan, plannerName: string): PlanChip {
  const open = unanswered(plan).length
  if (plan.status === 'approved') return { tone: 'approved', text: 'Plan approved' }
  if (plan.status === 'replan') return { tone: 'replan', text: 'Replan requested · waiting on you' }
  // A drafted plan waits on the boss even where it left a question open: the planner assumed an
  // answer and said so on the card, so the card that waits is the plan, not the question (`Oumw5`).
  if (plan.status === 'waiting') return { tone: 'waiting', text: 'Plan drafted · waiting on you' }
  if (open > 0) {
    return { tone: 'asking', text: `${plannerName} is asking you · ${open} question${open === 1 ? '' : 's'}` }
  }
  if (answersSent(plan)) return { tone: 'answered', text: 'Answers sent · waiting for the plan' }
  return { tone: 'drafting', text: `${plannerName} is drafting the plan` }
}

/**
 * The one line that says what happens next, drawn on the ticket, the board card and the thread
 * (T233). Null once the plan is approved: nothing is next, the ticket is Ready.
 */
export function planNextStep(plan: Plan, plannerName: string): string | null {
  if (plan.status === 'approved') return null
  if (plan.status === 'waiting' || plan.status === 'replan') return 'Plan ready: approve or send back'
  if (unanswered(plan).length > 0) return 'Waiting on your answers'
  return `Waiting for the plan from ${plannerName}`
}

/** `Q 2/3`: how many of a Planning card's questions are answered; null when it asked none. */
export function questionCount(plan: Plan): string | null {
  if (plan.questions.length === 0) return null
  return `Q ${plan.questions.filter((q) => q.answer !== null).length}/${plan.questions.length}`
}

/** Whether the boss has something to decide about this plan right now. */
export function waitsOnBoss(plan: Plan): boolean {
  return plan.status === 'waiting' || plan.status === 'replan' || unanswered(plan).length > 0
}

/** The fields of a plan a planner writes, as `plan_draft` takes them. */
export interface PlanDraft {
  goal?: string
  approach?: string
  acceptanceCriteria?: string[]
  repos?: string[]
  subtasks?: PlanSubtask[]
  risks?: string[]
  openQuestions?: string[]
}
