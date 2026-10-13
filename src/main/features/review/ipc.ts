import { reviewChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { NewReviewComment } from '../../../shared/review/review-diff'
import { type NewReviewThread, THREAD_STATES, type ThreadState } from '../../../shared/review/review-threads'
import { SECURITY_SCOPES, type SecurityScope } from '../../../shared/review/security'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { ReviewFacade } from './facade'

export interface ReviewIpcOptions {
  ipc: IpcHandlerRegistry
  engine: ReviewFacade
  broadcastChanged(): void
}

/** Lets the renderer read review rounds, and approve (merge) or request changes as the boss. Holds no state. */
export function registerReviewIpc({ ipc, engine, broadcastChanged }: ReviewIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.reviews.onChange(broadcastChanged)

  ipc.handle(reviewChannels.list, () => attempt(() => engine.reviews.list()))
  ipc.handle(reviewChannels.approve, (_event, ticketId, comments) =>
    attempt(() => engine.reviews.approve(requireTicketId(ticketId), optionalText(comments))),
  )
  ipc.handle(reviewChannels.requestChanges, (_event, ticketId, comments) =>
    attempt(() => engine.reviews.requestChanges(requireTicketId(ticketId), optionalText(comments) ?? '')),
  )
  ipc.handle(reviewChannels.diff, async (_event, ticketId) => {
    try {
      return { ok: true, value: await engine.reviews.diff(requireTicketId(ticketId)) } satisfies Result<unknown>
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Result<unknown>
    }
  })
  ipc.handle(reviewChannels.fileSides, async (_event, ticketId, repoId, path) => {
    try {
      const value = await engine.reviews.fileSides({
        ticketId: requireTicketId(ticketId),
        repoId: requireText(repoId, 'repository'),
        path: requireText(path, 'file path'),
      })
      return { ok: true, value } satisfies Result<unknown>
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Result<unknown>
    }
  })
  ipc.handle(reviewChannels.comments, (_event, ticketId) =>
    attempt(() => engine.reviews.comments(requireTicketId(ticketId))),
  )
  ipc.handle(reviewChannels.comment, (_event, input) => attempt(() => engine.reviews.comment(requireComment(input))))
  ipc.handle(reviewChannels.threads, (_event, ticketId) =>
    attempt(() => engine.reviews.threads(requireTicketId(ticketId))),
  )
  ipc.handle(reviewChannels.openThread, (_event, input) =>
    attempt(() => engine.reviews.openThread(requireThread(input))),
  )
  ipc.handle(reviewChannels.replyInThread, (_event, threadId, body) =>
    attempt(() => engine.reviews.replyInThread({ threadId: requireThreadId(threadId), body: requireBody(body) })),
  )
  ipc.handle(reviewChannels.setThreadState, (_event, threadId, state) =>
    attempt(() => engine.reviews.setThreadState(requireThreadId(threadId), requireState(state))),
  )
  ipc.handle(reviewChannels.threadsOnForge, (_event, ticketId) =>
    attempt(() => engine.reviews.threadsOnForge(requireTicketId(ticketId))),
  )
  ipc.handle(reviewChannels.roundLimit, () => attempt(() => engine.reviews.roundLimit()))
  ipc.handle(reviewChannels.setRoundLimit, (_event, rounds) =>
    attempt(() => engine.reviews.setRoundLimit(requireRounds(rounds))),
  )
  ipc.handle(reviewChannels.securityPasses, () => attempt(() => engine.security.list()))
  ipc.handle(reviewChannels.securityOverride, (_event, ticketId, reason) =>
    attempt(() => engine.security.override(requireTicketId(ticketId), optionalText(reason) ?? '')),
  )
  ipc.handle(reviewChannels.securityScope, () => attempt(() => engine.security.scope()))
  ipc.handle(reviewChannels.setSecurityScope, (_event, scope) =>
    attempt(() => engine.security.setScope(requireScope(scope))),
  )
}

/** One of the renderer's strings, checked before it reaches the engine. */
function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Missing ${what}`)
  return value
}

/** The renderer's security scope, checked before it reaches the engine. */
function requireScope(value: unknown): SecurityScope {
  const found = SECURITY_SCOPES.find((scope) => scope === value)
  if (!found) throw new Error(`A security scope is one of ${SECURITY_SCOPES.join(', ')}`)
  return found
}

/** The renderer's new thread, checked before it reaches the engine. */
function requireThread(value: unknown): NewReviewThread {
  const input = (value ?? {}) as Partial<NewReviewThread>
  if (typeof input.body !== 'string') throw new Error('A thread needs some text')
  if (input.path !== undefined && typeof input.path !== 'string') throw new Error('Missing file path')
  if (input.path !== undefined && (!Number.isInteger(input.line) || (input.line as number) < 1)) {
    throw new Error('Missing line')
  }
  return {
    ticketId: requireTicketId(input.ticketId),
    body: input.body,
    ...(input.repoId !== undefined && { repoId: String(input.repoId) }),
    ...(input.path !== undefined && { path: input.path, line: input.line as number }),
    ...(input.blocking !== undefined && { blocking: Boolean(input.blocking) }),
  }
}

function requireThreadId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('Missing thread id')
  return value as number
}

function requireBody(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Comments must be text')
  return value
}

function requireState(value: unknown): ThreadState {
  if (!THREAD_STATES.includes(value as ThreadState)) throw new Error(`Unknown thread state: ${String(value)}`)
  return value as ThreadState
}

function requireRounds(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('The round limit is a whole number from 1')
  return value as number
}

/** The renderer's line comment, checked before it reaches the engine. */
function requireComment(value: unknown): NewReviewComment {
  const input = (value ?? {}) as Partial<NewReviewComment>
  if (typeof input.repoId !== 'string' || !input.repoId) throw new Error('Missing repo id')
  if (typeof input.path !== 'string' || !input.path) throw new Error('Missing file path')
  if (!Number.isInteger(input.line) || (input.line as number) < 1) throw new Error('Missing line')
  if (typeof input.body !== 'string') throw new Error('Comments must be text')
  return {
    ticketId: requireTicketId(input.ticketId),
    repoId: input.repoId,
    path: input.path,
    line: input.line as number,
    body: input.body,
  }
}

function requireTicketId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('Missing ticket id')
  return value as number
}

function optionalText(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== 'string') throw new Error('Comments must be text')
  return value
}
