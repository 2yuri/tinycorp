import { planningChannels } from '../../../shared/domain/channels'
import type { PlanSubject } from '../../../shared/planning/planning'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { PlanningFacade } from './wire'

export interface PlanningIpcOptions {
  ipc: IpcHandlerRegistry
  engine: PlanningFacade
  broadcastChanged(): void
}

/**
 * Lets the renderer read plans and decide them as the boss (T171): answering a question, letting
 * the planner decide it, approving a plan, asking for changes and keeping a version. Holds no state.
 */
export function registerPlanningIpc({ ipc, engine, broadcastChanged }: PlanningIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.planning.onChange(broadcastChanged)

  ipc.handle(planningChannels.list, () => attempt(() => engine.planning.list()))
  ipc.handle(planningChannels.versions, (_event, subject) =>
    attempt(() => engine.planning.versions(requireSubject(subject))),
  )
  ipc.handle(planningChannels.answer, (_event, questionId, text) =>
    attempt(() => engine.planning.answer(requireId(questionId, 'question'), requireText(text))),
  )
  ipc.handle(planningChannels.delegate, (_event, questionId) =>
    attempt(() => engine.planning.delegate(requireId(questionId, 'question'))),
  )
  ipc.handle(planningChannels.approve, (_event, planId) =>
    attempt(() => engine.planning.approve(requireId(planId, 'plan'))),
  )
  ipc.handle(planningChannels.requestChanges, (_event, planId, comments) =>
    attempt(() => engine.planning.requestChanges(requireId(planId, 'plan'), requireText(comments))),
  )
  ipc.handle(planningChannels.keep, (_event, planId) => attempt(() => engine.planning.keep(requireId(planId, 'plan'))))
  ipc.handle(planningChannels.replan, (_event, ticketId, reason) =>
    attempt(() => engine.planning.replan(requireId(ticketId, 'ticket'), requireText(reason))),
  )
}

function requireId(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`Missing ${what} id`)
  return value as number
}

function requireText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('That has to be text')
  return value
}

function requireSubject(value: unknown): PlanSubject {
  const subject = (value ?? {}) as Partial<PlanSubject>
  if (subject.kind !== 'ticket' && subject.kind !== 'epic') throw new Error('A plan is about a ticket or an epic')
  return { kind: subject.kind, id: requireId(subject.id, subject.kind) }
}
