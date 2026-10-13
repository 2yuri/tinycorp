import { BOSS } from '../domain/chat'
import type { GatedAction } from './index'

/**
 * The kind of an Approval as its card titles it: `Hire · a Designer`. Shorter and in the boss's
 * words, where `ACTION_LABEL` is the verb an Employee asks with ("hire", "merge").
 */
export const APPROVAL_KIND_LABEL: Record<GatedAction, string> = {
  ticket_create: 'New ticket',
  ticket_reorder: 'Reorder the board',
  assign: 'Assign',
  start: 'Start work',
  open_pr: 'Open a PR',
  merge: 'Merge',
  hire: 'Hire',
  fire: 'Let go',
  switch_provider: 'Switch provider',
  process_change: 'Change the process',
  env_run: 'Run a command',
  other: 'Decide',
}

/** The Approve button's label per kind, in the thread panel and on the card. */
export const APPROVE_LABEL: Record<GatedAction, string> = {
  ticket_create: 'Approve the ticket',
  ticket_reorder: 'Approve the order',
  assign: 'Approve the assignment',
  start: 'Approve the start',
  open_pr: 'Approve PR',
  merge: 'Approve & merge',
  hire: 'Approve hire',
  fire: 'Approve firing',
  switch_provider: 'Approve the switch',
  process_change: 'Approve the change',
  env_run: 'Approve once',
  other: 'Approve',
}

/**
 * What an Approval asks the boss, as one question: `Open PR for TC-3?`. It is what a row says when
 * the requester wrote no sentence of their own, so an `open_pr` request reads as the decision it is
 * and never as a review of a pull request that does not exist yet (T233).
 */
const QUESTION: Record<GatedAction, (subject: string) => string> = {
  ticket_create: (s) => `Open a ticket for ${s}?`,
  ticket_reorder: (s) => `Reorder the board around ${s}?`,
  assign: (s) => `Assign ${s}?`,
  start: (s) => `Start work on ${s}?`,
  open_pr: (s) => `Open the PR for ${s}?`,
  merge: (s) => `Merge ${s}?`,
  hire: (s) => `Hire ${s}?`,
  fire: (s) => `Let ${s} go?`,
  switch_provider: (s) => `Switch provider for ${s}?`,
  process_change: (s) => `Change how we work: ${s}?`,
  env_run: (s) => `Run ${s}?`,
  other: (s) => `Your call on ${s}?`,
}

export function approvalQuestion(action: GatedAction, subject: string): string {
  return QUESTION[action](subject.trim() || 'it')
}

/** The sentence the app writes when the requester sent none; one human line, as the tool asks for. */
const SENTENCE: Record<GatedAction, (subject: string) => string> = {
  ticket_create: (s) => `I'd like to open a ticket for ${s}.`,
  ticket_reorder: (s) => `I'd like to reorder the board around ${s}.`,
  assign: (s) => `I'd like to put someone on ${s}.`,
  start: (s) => `I'd like to start work on ${s}.`,
  // Never "ready for review": the boss read that as a PR to review, before any PR existed (T233).
  open_pr: (s) => `${s} is done and pushed, so I'd like to open its pull request.`,
  merge: (s) => `${s} is ready to merge.`,
  hire: (s) => `I'd like to bring on ${s}.`,
  fire: (s) => `I'd like to let ${s} go.`,
  switch_provider: (s) => `I'd like to switch provider for ${s}.`,
  process_change: (s) => `I'd like to change how we work: ${s}.`,
  env_run: (s) => `I need to run ${s}.`,
  other: (s) => `I need your call on ${s}.`,
}

/**
 * The one line an approval request posts: the requester's own sentence, or a generated one.
 * `@boss` never appears in it — the request carries the boss as a mention instead (decision 42).
 */
export function approvalSentence(action: GatedAction, subject: string, summary?: string): string {
  const own = oneLine(summary ?? '')
  return own || SENTENCE[action](subject.trim() || 'it')
}

/** One line: whitespace collapsed, and any `@boss` the requester wrote stripped. */
function oneLine(text: string): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(new RegExp(`(^|\\s)@${BOSS}\\b[,:]?\\s*`, 'gi'), '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** What `approval_request` and the Employee instructions say about the summary sentence. */
export const APPROVAL_SUMMARY_RULE =
  'Write summary as one human sentence to the boss, the way you would say it in chat — no "@boss", ' +
  'no "Approval needed", no bullet points. The facts (ticket, PR, repo, checks, reason) go on the ' +
  'card the app draws under it, so the sentence only has to say what you want and why it matters.'
