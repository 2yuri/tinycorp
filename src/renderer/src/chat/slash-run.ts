/**
 * The composer's side of the slash commands (decision 37). Every command does the very thing one of
 * the app's own buttons does — the same IPC call, the same opener — so a command can never drift
 * from the action it stands for. Pure but for the calls it is handed, so the rules are tested
 * without a DOM, the way `menu-commands.ts` is.
 */
import type { Approval } from '../../../shared/approvals'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { ApprovalApi, BoardApi, ChatApi, SessionApi } from '../../../shared/ipc'
import { parseSlash, type SlashCommand, type SlashOptions } from '../../../shared/providers/slash-commands'
import { resumeAllNote } from '../../../shared/session'
import { ticketCode } from '../../../shared/ticket-id'

/** What running one comes to: a line to show under the box, or a hint that nothing was posted. */
export type SlashOutcome = { ok: true; note: string | null } | { ok: false; hint: string }

export interface SlashDeps extends SlashOptions {
  /** The channel the command was typed in. */
  channelId: string
  /** The thread the command was typed in, or the open thread of the channel; null for neither. */
  threadId: number | null
  /** The epic the channel belongs to, or null (decision 37: `/ticket` is scoped to it). */
  epicId: number | null
  /** Every Approval of the Company by the id of its thread's root message, as the view reads them. */
  approvals: Map<number, Approval>
  /** Who holds intake, for `/goal`; null when nobody does. */
  intakeId: string | null
  /** The Company key a new ticket's id carries, `TC` in `TC-142`. */
  companyKey: string
  chat: Pick<ChatApi, 'post'>
  board: Pick<BoardApi, 'apply'>
  sessions: Pick<SessionApi, 'pauseAll' | 'resumeAll'>
  approvalApi: Pick<ApprovalApi, 'decide'>
  /** Shows a channel, as a `#channel` link does. */
  openChannel(channelId: string): void
  /** The hire flow on a role, as the office header's `Hire` opens it. */
  openHire(roleId: string): void
}

/**
 * Runs what the boss typed. The text has already been seen to be a command attempt
 * (`slashAttempt`): anything else is an ordinary message and never reaches here.
 */
export async function runSlash(text: string, deps: SlashDeps): Promise<SlashOutcome> {
  const parsed = parseSlash(text, deps)
  if (!parsed.ok) return parsed
  return carryOut(parsed.command, deps)
}

async function carryOut(command: SlashCommand, deps: SlashDeps): Promise<SlashOutcome> {
  switch (command.kind) {
    case 'dm':
      return dm(command.employeeId, command.text, deps)
    case 'goal':
      return goal(command.text, deps)
    case 'ticket':
      return ticket(command.title, deps)
    case 'approve':
      return decide(true, '', deps)
    case 'reject':
      return decide(false, command.reason, deps)
    case 'hire':
      deps.openHire(command.roleId)
      return { ok: true, note: null }
    case 'pause':
      return report(await deps.sessions.pauseAll(), 'Paused. Every Session is stopped until you resume.')
    case 'resume':
      return resume(deps)
  }
}

/**
 * `/resume`: the line under the box says what the resume came to (T217), not that it happened. A
 * pause that held nobody brings nobody back, and the boss reads that here rather than in the log.
 */
async function resume(deps: SlashDeps): Promise<SlashOutcome> {
  const resumed = await deps.sessions.resumeAll()
  if (!resumed.ok) return { ok: false, hint: resumed.error }
  return { ok: true, note: resumeAllNote(resumed.value) }
}

async function dm(employeeId: string, text: string, deps: SlashDeps): Promise<SlashOutcome> {
  const channelId = dmChannelId(BOSS, employeeId)
  if (text) {
    const posted = await deps.chat.post(channelId, text)
    if (!posted.ok) return { ok: false, hint: posted.error }
  }
  deps.openChannel(channelId)
  return { ok: true, note: null }
}

async function goal(text: string, deps: SlashDeps): Promise<SlashOutcome> {
  if (deps.intakeId === null) {
    return { ok: false, hint: 'Nobody holds intake yet. Hire someone who does, or DM the person you mean.' }
  }
  return dm(deps.intakeId, text, deps)
}

async function ticket(title: string, deps: SlashDeps): Promise<SlashOutcome> {
  const applied = await deps.board.apply({
    kind: 'createTicket',
    input: { title, column: 'todo', epicId: deps.epicId },
  })
  if (!applied.ok) return { ok: false, hint: applied.error }
  const created = applied.value.tickets
    .filter((t) => t.title === title)
    .reduce<number | null>((highest, t) => (highest === null || t.id > highest ? t.id : highest), null)
  const where = deps.epicId === null ? 'Todo' : 'Todo, in this epic'
  const named = created === null ? null : ticketCode(deps.companyKey, created)
  return { ok: true, note: named === null ? `Added to ${where}.` : `Created ${named} in ${where}.` }
}

async function decide(approve: boolean, reason: string, deps: SlashDeps): Promise<SlashOutcome> {
  const scope = approvalInScope(deps.approvals, deps.channelId, deps.threadId)
  if (!scope.ok) return scope
  const decided = await deps.approvalApi.decide(scope.approval.id, approve ? { approve } : { approve, reason })
  if (!decided.ok) return { ok: false, hint: decided.error }
  return {
    ok: true,
    note: approve ? `Approved: ${scope.approval.subject}` : `Sent back: ${scope.approval.subject}`,
  }
}

function report(result: { ok: true } | { ok: false; error: string }, note: string): SlashOutcome {
  return result.ok ? { ok: true, note } : { ok: false, hint: result.error }
}

/**
 * The approval `/approve` and `/reject` act on: the one this thread is about, else the only one
 * waiting in this channel. With none, or with a choice to make, nothing is decided and the boss is
 * told which it is.
 */
export function approvalInScope(
  approvals: Map<number, Approval>,
  channelId: string,
  threadId: number | null,
): { ok: true; approval: Approval } | { ok: false; hint: string } {
  if (threadId !== null) {
    const here = approvals.get(threadId)
    if (!here) return { ok: false, hint: 'This thread is not an approval. Open the one you mean.' }
    if (here.status !== 'pending') {
      return { ok: false, hint: `That one was already ${here.status === 'approved' ? 'approved' : 'sent back'}.` }
    }
    return { ok: true, approval: here }
  }
  const waiting = [...approvals.values()].filter((a) => a.status === 'pending' && a.channelId === channelId)
  if (waiting.length === 0) return { ok: false, hint: 'Nothing is waiting on you in this channel.' }
  if (waiting.length > 1) {
    return {
      ok: false,
      hint: `${waiting.length} approvals are waiting here. Open one and run the command in its thread.`,
    }
  }
  return { ok: true, approval: waiting[0]! }
}
