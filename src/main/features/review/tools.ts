import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BOSS } from '../../../shared/domain/chat'
import type { Review } from '../../../shared/review'
import { type ReviewThread, threadAnchor, unresolvedThreads } from '../../../shared/review/review-threads'
import { blockingFindings, findingsLine, SECURITY_SEVERITIES } from '../../../shared/review/security'
import { ticketCode } from '../../../shared/ticket-id'
import { run, TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'

/** How a ticket's latest review round is shown to Employees, e.g. in `board_list`. */
export function reviewView({ chat }: Pick<McpCaller, 'chat'>, review: Review | null) {
  if (!review) return null
  const nameOf = (id: string) =>
    id === BOSS ? BOSS : (chat.people().find((p) => p.id === id)?.name ?? 'former employee')
  return {
    reviewer: nameOf(review.reviewerId),
    status: review.status,
    comments: review.comments,
    merge: review.merge,
    round: `${review.round} of ${review.roundLimit}`,
  }
}

/** One thread as an Employee reads it: where it is, who said what, and whether it is settled. */
function threadView(thread: ReviewThread, nameOf: (id: string) => string) {
  return {
    thread: thread.id,
    where: threadAnchor(thread),
    state: thread.state,
    round: thread.round,
    ...(thread.commit ? { commit: thread.commit } : {}),
    messages: thread.messages.map((message) => ({ from: nameOf(message.authorId), said: message.body })),
  }
}

/**
 * The review conversation, as the two agents hold it (T170).
 *
 * The reviewer opens threads on lines (`review_comment`), settles them (`review_resolve`) and ends
 * the round with a verdict (`review_submit`). The assignee answers them (`review_reply`) and says
 * when the fixes are pushed (`review_ready`), which starts the next round and wakes the reviewer.
 * Each side can only do its own half: a reviewer replying as the assignee is refused, and so is the
 * other way round.
 */
export function registerReviewTools(server: McpServer, caller: McpCaller): void {
  const { company, reviews, employee, chat } = caller
  const nameOf = (id: string) =>
    id === BOSS ? BOSS : (chat.people().find((p) => p.id === id)?.name ?? 'former employee')

  /** The round the caller is the reviewer of; throws in the words of whoever it is actually for. */
  function asReviewer(ticketId: number): Review {
    const review = reviews.of(ticketId)
    if (!review) throw new Error(`${ticketCode(company.key, ticketId)} has no review round yet`)
    if (review.reviewerId !== employee.id) {
      throw new Error(
        `The review of ${ticketCode(company.key, ticketId)} is ${nameOf(review.reviewerId)}’s, not yours. ` +
          'If you are its assignee, answer with review_reply and say you are done with review_ready.',
      )
    }
    if (review.status !== 'pending') {
      throw new Error(`The round on ${ticketCode(company.key, ticketId)} is closed; wait to be asked again.`)
    }
    return review
  }

  /** The thread the caller may answer: theirs to answer, never the round's reviewer. */
  function asAssignee(threadId: number): ReviewThread {
    const thread = reviews.thread(threadId)
    if (!thread) throw new Error(`There is no review thread ${threadId}`)
    const review = reviews.of(thread.ticketId)
    if (review && review.reviewerId === employee.id) {
      throw new Error(
        `You are the reviewer of ${ticketCode(company.key, thread.ticketId)}. review_reply is the assignee’s ` +
          'answer to you; say more with review_comment, or settle the thread with review_resolve.',
      )
    }
    if (reviews.assigneeOf(thread.ticketId) !== employee.id) {
      throw new Error(
        `${ticketCode(company.key, thread.ticketId)} is not yours, so its threads are not yours to answer`,
      )
    }
    return thread
  }

  server.registerTool(
    'review_comment',
    {
      description:
        'Open a thread on a line of a PR you are reviewing, or say more in one you opened. The thread is part ' +
        'of your round: the whole round goes on the real PR as one review when you call review_submit. ' +
        'A non-blocking thread is a note that will not stop the merge.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket you are reviewing. ${TICKET_ID_HELP}`),
        file: z.string().optional().describe('The file, as the diff names it. Leave out to comment on the PR itself.'),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('The line of the head the thread hangs under. Needed with a file.'),
        body: z.string().describe('What you want changed, or why you are asking.'),
        blocking: z
          .boolean()
          .optional()
          .describe('False leaves it as a note: you may approve with it still open. True (the default) blocks.'),
        thread: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('An existing thread to say more in, instead of opening one.'),
        repo: z.string().optional().describe('The repo the file is in; needed only when the ticket spans several.'),
      },
    },
    ({ ticket_id, file, line, body, blocking, thread, repo }) =>
      run(() => {
        const id = ticketNumber(ticket_id, company.key)
        asReviewer(id)
        if (thread !== undefined) {
          const said = reviews.replyInThread({ threadId: thread, body })
          // Saying a thread is only a note, or that it blocks after all, is part of saying more in it.
          const next =
            blocking === undefined ? said : reviews.setThreadState(thread, blocking ? 'open' : 'non_blocking')
          return { ...threadView(next, nameOf), next: 'Noted. Keep reviewing, then end the round with review_submit.' }
        }
        const opened = reviews.openThread({
          ticketId: id,
          ...(file !== undefined && { path: file }),
          ...(line !== undefined && { line }),
          ...(repo !== undefined && { repoId: repo }),
          body,
          ...(blocking !== undefined && { blocking }),
        })
        return {
          ...threadView(opened, nameOf),
          next:
            'The thread is open. It reaches the PR when you end the round with review_submit, together with ' +
            'everything else you said — one review, not a comment at a time.',
        }
      }),
  )

  server.registerTool(
    'review_resolve',
    {
      description:
        'Settle a thread of a review you are running: the assignee answered it and you are satisfied. ' +
        'A resolved thread collapses in the app and is resolved on the PR too. You cannot approve while a ' +
        'blocking thread is open, so resolve it or say it is a note.',
      inputSchema: {
        thread: z.number().int().positive().describe('The thread id, as review_comment and your wake-up print it.'),
        note: z
          .boolean()
          .optional()
          .describe('True leaves the thread open as a non-blocking note instead of resolving it.'),
      },
    },
    ({ thread, note }) =>
      run(() => {
        const found = reviews.thread(thread)
        if (!found) throw new Error(`There is no review thread ${thread}`)
        asReviewer(found.ticketId)
        const next = reviews.setThreadState(thread, note ? 'non_blocking' : 'resolved')
        return {
          ...threadView(next, nameOf),
          next: note
            ? 'Left open as a note. It will not block your approval.'
            : 'Resolved. When every blocking thread is settled, end the round with review_submit.',
        }
      }),
  )

  server.registerTool(
    'review_reply',
    {
      description:
        'Answer a review thread on your own ticket: say what you changed and name the commit, or push back and ' +
        'say why the code is right as it is. The reply lands in the same thread on the real PR. When you have ' +
        'answered them all and pushed, call review_ready.',
      inputSchema: {
        thread: z.number().int().positive().describe('The thread id, as your wake-up printed it.'),
        body: z.string().describe('What you did, or why you disagree.'),
        commit: z.string().optional().describe('The commit that fixed it, if one did.'),
      },
    },
    ({ thread, body, commit }) =>
      run(() => {
        const found = asAssignee(thread)
        const next = reviews.replyInThread({
          threadId: found.id,
          body,
          ...(commit !== undefined && { commit }),
        })
        const open = unresolvedThreads(reviews.threads(found.ticketId))
        return {
          ...threadView(next, nameOf),
          open: open.length,
          next:
            open.length > 0
              ? `${open.length} ${open.length === 1 ? 'thread is' : 'threads are'} still open: ` +
                `${open.map((t) => `#${t.id} ${threadAnchor(t)}`).join(', ')}. Answer those too, then push and call review_ready.`
              : 'Every thread has an answer. Push your commits, then call review_ready.',
        }
      }),
  )

  server.registerTool(
    'review_ready',
    {
      description:
        'Say your fixes are pushed and the ticket is ready to be looked at again. It goes back to Review, the ' +
        'next round starts, and your reviewer is woken once with every thread still open — never once per ' +
        'comment. Answer the threads with review_reply first.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`Your ticket. ${TICKET_ID_HELP}`),
        summary: z.string().optional().describe('What you changed, in a line; your reviewer reads it first.'),
      },
    },
    ({ ticket_id, summary }) =>
      run(() => {
        const id = ticketNumber(ticket_id, company.key)
        const review = reviews.ready({ ticketId: id, ...(summary !== undefined && { summary }) })
        return {
          ticket: ticketCode(company.key, id),
          round: `${review.round} of ${review.roundLimit}`,
          reviewer: nameOf(review.reviewerId),
          next:
            `${nameOf(review.reviewerId)} has been woken with the whole conversation. Wait: you will be told ` +
            'what they said. End your turn.',
        }
      }),
  )

  server.registerTool(
    'merge_retry',
    {
      description:
        'Ask the app to merge an approved ticket again after its merge failed — a conflict, or its base moved. ' +
        'Bring the branch up to date with its base and push first. It goes through the merge gate like the ' +
        'first merge did: the boss is asked when the autonomy level or a red CI says so. Never merge a PR yourself.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket whose merge failed. ${TICKET_ID_HELP}`),
      },
    },
    ({ ticket_id }) =>
      run(() => {
        const id = ticketNumber(ticket_id, company.key)
        const review = reviews.retryMerge(id)
        return {
          ticket: ticketCode(company.key, id),
          merge: review.merge,
          next:
            review.merge === 'waiting'
              ? 'The merge waits for the boss’s approval. End your turn; the outcome arrives in your inbox.'
              : 'The app is merging it now. End your turn; #prs says when it lands or why it did not.',
        }
      }),
  )

  server.registerTool(
    'review_submit',
    {
      description:
        'End your review round with a verdict. "changes" sends the ticket back to its assignee with every open ' +
        'thread; "approve" hands the PR to the boss, and needs every blocking thread resolved — notes may stay ' +
        'open. Your whole round goes on the real PR as one review. Review read-only: never edit, commit or push ' +
        'in the assignee’s worktrees.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket in review. ${TICKET_ID_HELP}`),
        verdict: z
          .enum(['approve', 'changes', 'request_changes'])
          .describe('"approve" or "changes". "request_changes" means the same as "changes".'),
        summary: z
          .string()
          .optional()
          .describe('What you think of the change as a whole. Required to ask for changes.'),
        comments: z.string().optional().describe('The older name for summary; either is read.'),
      },
    },
    ({ ticket_id, verdict, summary, comments }) =>
      run(() => {
        const id = ticketNumber(ticket_id, company.key)
        const said = summary ?? comments ?? ''
        const review = reviews.submit({
          ticketId: id,
          verdict: verdict === 'approve' ? 'approve' : 'request_changes',
          comments: said,
        })
        return {
          ticket: ticketCode(company.key, id),
          status: review.status,
          round: `${review.round} of ${review.roundLimit}`,
          next: nextAfterSubmit(review, ticketCode(company.key, id)),
        }
      }),
  )
}

/** What the reviewer does now, which is nothing: the round is closed and somebody else has it. */
function nextAfterSubmit(review: Review, ticket: string): string {
  if (review.status === 'approved') {
    return (
      'Approved, and the PR is now the boss’s: the app asks to merge, and under the Company’s autonomy level ' +
      'that usually waits for them. It merges, removes the worktrees and moves the ticket to Done by itself. ' +
      'End your turn.'
    )
  }
  if (review.handoff === 'your_call') {
    return (
      `That was the last round the Company allows, so ${ticket} is the boss’s call now: both positions are in ` +
      'front of them and the ticket waits in review. Do not ask again. End your turn.'
    )
  }
  return (
    `${ticket} is back in doing and its assignee has every open thread. They will answer them and call ` +
    'review_ready, which wakes you with the whole conversation. End your turn.'
  )
}

/**
 * The security pass (T241), as the Security Employee runs it.
 *
 * It is not the round: the reviewer and the assignee argue the change as they always did, and this
 * Employee reads the same diff beside them. Each finding goes up as a review comment on the line it
 * is about with a concrete fix in it, and a `high` one still open holds the merge until its thread
 * is settled or the boss overrides the pass.
 */
export function registerSecurityTools(server: McpServer, caller: McpCaller): void {
  const { company, security } = caller
  const code = (ticketId: number) => ticketCode(company.key, ticketId)

  server.registerTool(
    'security_finding',
    {
      description:
        'File a security finding on the change you are reading. It goes on the PR as a review comment on that ' +
        'line. Rate it high, medium or low: high is exploitable as written, or a secret already in the history, ' +
        'and holds the merge; medium is a real weakness this change cannot be exploited through; low is worth ' +
        'saying and nothing more. Every finding carries the fix you would write — a finding with no fix is not ' +
        'one yet.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket you are reading. ${TICKET_ID_HELP}`),
        severity: z.enum(SECURITY_SEVERITIES).describe('high, medium or low.'),
        title: z.string().describe('What is wrong, in one line.'),
        fix: z.string().describe('The change you would make instead. Concrete: the code, not advice.'),
        detail: z.string().optional().describe('How it is reached and what it costs an attacker.'),
        file: z.string().optional().describe('The file, as the diff names it. Leave out for the PR itself.'),
        line: z.number().int().positive().optional().describe('The line it is on. Needed with a file.'),
        repo: z.string().optional().describe('The repo the file is in; needed only when the ticket spans several.'),
      },
    },
    ({ ticket_id, severity, title, fix, detail, file, line, repo }) =>
      run(() => {
        const id = ticketNumber(ticket_id, company.key)
        const finding = security.file({
          ticketId: id,
          severity,
          title,
          fix,
          ...(detail !== undefined && { detail }),
          ...(file !== undefined && { file }),
          ...(line !== undefined && { line }),
          ...(repo !== undefined && { repo }),
        })
        return {
          finding: finding.id,
          thread: finding.threadId,
          severity: finding.severity,
          where: finding.where,
          next:
            severity === 'high'
              ? `Filed. It holds the merge of ${code(id)} until its thread is settled or the boss overrides the ` +
                'pass. Keep reading, then end with security_submit.'
              : 'Filed. Keep reading, then end with security_submit.',
        }
      }),
  )

  server.registerTool(
    'security_resolve',
    {
      description:
        'Settle a finding of yours: the fix has landed and you have read it. A resolved high finding stops ' +
        'holding the merge.',
      inputSchema: {
        finding: z.number().int().positive().describe('The finding id, as security_finding printed it.'),
      },
    },
    ({ finding }) =>
      run(() => {
        const settled = security.resolve(finding)
        return { finding: settled.id, resolved: settled.resolved, next: 'Settled.' }
      }),
  )

  server.registerTool(
    'security_submit',
    {
      description:
        'End your security pass with a summary of what you read and what you found. With no high finding open ' +
        'the merge goes ahead from here; with one, it waits until the fix lands or the boss overrides you. ' +
        'Read-only: never edit, commit or push in the assignee’s worktrees.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket you read. ${TICKET_ID_HELP}`),
        summary: z.string().describe('What you threat modelled, what you read, and what you found.'),
      },
    },
    ({ ticket_id, summary }) =>
      run(() => {
        const id = ticketNumber(ticket_id, company.key)
        const pass = security.submit({ ticketId: id, summary })
        const blocking = blockingFindings(pass)
        return {
          ticket: code(id),
          state: pass.state,
          findings: findingsLine(pass) || 'none',
          next:
            blocking.length > 0
              ? `${blocking.length} high ${blocking.length === 1 ? 'finding is' : 'findings are'} open, so the ` +
                'merge waits. Its assignee answers them; you will be woken to settle them. End your turn.'
              : 'Nothing holds the merge. End your turn.',
        }
      }),
  )
}
