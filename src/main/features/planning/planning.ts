import type { DatabaseSync } from 'node:sqlite'
import type { AutonomyLevel } from '../../../shared/approvals'
import { READY, type Ticket } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, type Mentionable } from '../../../shared/domain/chat'
import type { TicketArea } from '../../../shared/domain/staff'
import {
  type Plan,
  type PlanDraft,
  type PlanQuestion,
  type PlanSubject,
  planApprover,
  unanswered,
} from '../../../shared/planning/planning'
import type { Migration } from '../../core'
import { ticketCodeIn } from '../../core'
import type { Chat } from '../chat'
import type { NewInboxItem } from '../inbox'
import { type ActingBoard, withoutWakes } from '../sessions'

/**
 * Planning (T171). A new ticket or epic starts in Planning with a plan at version 1, status
 * `drafting`, and the planner is woken. The planner asks its questions, drafts the plan, and asks
 * for Ready; the gate decides whether the boss approves it or the planner approves its own.
 *
 * Every version of a plan is kept: a replan writes the next one and the boss can still keep the
 * one that was approved.
 */
export const PLANNING_MIGRATION: Migration = {
  name: 'planning-plans-and-questions',
  sql: `
  CREATE TABLE plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER REFERENCES ticket (id) ON DELETE CASCADE,
    epic_id INTEGER REFERENCES epic (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    planner_id TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    approach TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '[]',
    repos TEXT NOT NULL DEFAULT '[]',
    subtasks TEXT NOT NULL DEFAULT '[]',
    risks TEXT NOT NULL DEFAULT '[]',
    open_questions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'drafting',
    approved_by TEXT,
    approved_at TEXT,
    replan_by TEXT,
    replan_reason TEXT,
    replan_changes TEXT NOT NULL DEFAULT '[]',
    channel_id TEXT NOT NULL DEFAULT 'general',
    thread_id INTEGER REFERENCES message (id),
    message_id INTEGER REFERENCES message (id),
    created_at TEXT NOT NULL,
    CHECK ((ticket_id IS NULL) <> (epic_id IS NULL))
  );
  CREATE INDEX plan_by_ticket ON plan (ticket_id, version);
  CREATE INDEX plan_by_epic ON plan (epic_id, version);
  CREATE TABLE plan_question (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plan (id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    text TEXT NOT NULL,
    answer TEXT,
    answered_by TEXT,
    answered_at TEXT,
    delegated INTEGER NOT NULL DEFAULT 0,
    message_id INTEGER REFERENCES message (id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX plan_question_by_plan ON plan_question (plan_id, number);
`,
}

/** The boss's side of planning: answering questions and deciding plans. */
export interface Planning {
  /** The newest version of a subject's plan, or null when it has none. */
  of(subject: PlanSubject): Plan | null
  /** The newest version of every plan in the Company, oldest subject first. */
  list(): Plan[]
  /** Every version of one subject's plan, oldest first. */
  versions(subject: PlanSubject): Plan[]
  /** The boss writes an answer under one question. The planner is woken once none is left open. */
  answer(questionId: number, text: string): Plan
  /** "Let <planner> decide": the question is handed back unanswered, and counts as answered. */
  delegate(questionId: number): Plan
  /** Approve plan → Ready. Under Managed it also lets an epic's tickets go Ready on their own. */
  approve(planId: number): Plan
  /** Ask for changes: the plan goes back to the planner with the boss's words. */
  requestChanges(planId: number, comments: string): Plan
  /** Keep v1: a replan is dropped and the approved version stands. */
  keep(planId: number): Plan
  /** Replan, as the boss: the same thing an engineer asks for with `plan_replan` (frame `hZrUN`). */
  replan(ticketId: number, reason: string, changes?: string[]): Plan
}

/** What one Employee can do about plans, over MCP. */
export interface EmployeePlanning {
  /** Posts the numbered questions in the planning thread and waits for the boss. */
  ask(subject: PlanSubject, questions: string[]): Plan
  /** Posts, or updates, the Plan card. */
  draft(subject: PlanSubject, draft: PlanDraft): Plan
  /** Moves the ticket to Ready, when the gate allows. Throws with why, when it does not. */
  ready(subject: PlanSubject): Plan
  /** Sends a ticket back to Planning with a reason and the changes proposed, and pauses its work. */
  replan(ticketId: number, reason: string, changes: string[]): Plan
  /** Why a ticket may not be claimed yet, or null when it may. */
  claimRefusal(ticketId: number): string | null
}

/** One Company's planning, with the hooks the engine calls when the board changes. */
export interface CompanyPlanning extends Planning {
  as(employeeId: string): EmployeePlanning
  /** A ticket was created by `actorId`: opens its plan and wakes the planner. */
  ticketCreated(ticket: Ticket, actorId: string): void
  /** An epic was created by `actorId`: opens its plan and wakes the planner. */
  epicCreated(epic: { id: number; title: string }, actorId: string): void
  /** Why `employeeId` may not claim `ticketId` yet, or null. */
  claimRefusal(ticketId: number): string | null
}

export interface PlanningOptions {
  db: DatabaseSync
  chat: Chat
  /** The board acting as `actorId`, so a move wakes whoever it concerns. */
  board(actorId: string): ActingBoard
  /** Who holds `plan` in this Company, or null when nobody does. */
  planner(): Mentionable | null
  /**
   * Who should take a ticket, and why someone should not (T239). A plan approved with nobody on the
   * ticket hands it to the Employee this answers with, so a Ready ticket has a holder to wake.
   */
  assignment: {
    assignee(ticket: TicketArea): { id: string; name: string } | null
    claimBlock(employeeId: string, ticket: TicketArea): string | null
  }
  /** The Company's repos, for the names an area and a repo filter are written against. */
  repos(): { id: string; name: string }[]
  /** The Company's autonomy level. */
  level(): AutonomyLevel
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  onChange(): void
}

interface PlanRow {
  id: number
  ticket_id: number | null
  epic_id: number | null
  version: number
  planner_id: string
  goal: string
  approach: string
  acceptance_criteria: string
  repos: string
  subtasks: string
  risks: string
  open_questions: string
  status: Plan['status']
  approved_by: string | null
  approved_at: string | null
  replan_by: string | null
  replan_reason: string | null
  replan_changes: string
  channel_id: string
  thread_id: number | null
  message_id: number | null
  created_at: string
}

interface QuestionRow {
  id: number
  plan_id: number
  number: number
  text: string
  answer: string | null
  answered_by: string | null
  answered_at: string | null
  delegated: number
  message_id: number | null
}

export function createPlanning(options: PlanningOptions): CompanyPlanning {
  const { db, chat, board, planner, level, deliver, onChange } = options
  const idOf = (ticketId: number) => ticketCodeIn(db, ticketId)

  function nameOf(id: string | null): string {
    if (id === null || id === '') return 'the planner'
    if (id === BOSS) return 'you'
    return chat.people().find((p) => p.id === id)?.name ?? 'former employee'
  }

  function isEmployee(id: string): boolean {
    return chat.people().some((p) => p.id === id)
  }

  function questionsOf(planId: number): PlanQuestion[] {
    const rows = db
      .prepare('SELECT * FROM plan_question WHERE plan_id = ? ORDER BY number, id')
      .all(planId) as unknown as QuestionRow[]
    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      number: row.number,
      text: row.text,
      answer: row.answer,
      answeredBy: row.answered_by,
      answeredAt: row.answered_at,
      delegated: row.delegated === 1,
      messageId: row.message_id,
    }))
  }

  function toPlan(row: PlanRow): Plan {
    const list = (json: string) => JSON.parse(json) as string[]
    return {
      id: row.id,
      version: row.version,
      ticketId: row.ticket_id,
      epicId: row.epic_id,
      plannerId: row.planner_id,
      goal: row.goal,
      approach: row.approach,
      acceptanceCriteria: list(row.acceptance_criteria),
      repos: list(row.repos),
      subtasks: JSON.parse(row.subtasks) as Plan['subtasks'],
      risks: list(row.risks),
      openQuestions: list(row.open_questions),
      status: row.status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      replanBy: row.replan_by,
      replanReason: row.replan_reason,
      replanChanges: list(row.replan_changes),
      channelId: row.channel_id,
      threadId: row.thread_id,
      messageId: row.message_id,
      createdAt: row.created_at,
      questions: questionsOf(row.id),
    }
  }

  function byId(id: number): Plan {
    const row = db.prepare('SELECT * FROM plan WHERE id = ?').get(id) as PlanRow | undefined
    if (!row) throw new Error(`There is no plan ${id}`)
    return toPlan(row)
  }

  /** The newest version of a subject's plan, or null. */
  function current(subject: PlanSubject): Plan | null {
    const row = db
      .prepare(
        subject.kind === 'ticket'
          ? 'SELECT * FROM plan WHERE ticket_id = ? ORDER BY version DESC LIMIT 1'
          : 'SELECT * FROM plan WHERE epic_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(subject.id) as PlanRow | undefined
    return row ? toPlan(row) : null
  }

  function requirePlan(subject: PlanSubject): Plan {
    const plan = current(subject)
    if (plan) return plan
    const what = subject.kind === 'ticket' ? idOf(subject.id) : `epic ${subject.id}`
    throw new Error(`${what} has no plan`)
  }

  function ticketRow(id: number): {
    id: number
    title: string
    epic_id: number | null
    assignee_id: string | null
    column_id: string
  } {
    const row = db.prepare('SELECT id, title, epic_id, assignee_id, column_id FROM ticket WHERE id = ?').get(id) as
      | { id: number; title: string; epic_id: number | null; assignee_id: string | null; column_id: string }
      | undefined
    if (!row) throw new Error(`There is no ticket ${idOf(id)}`)
    return row
  }

  /** Where the planning thread of a subject lives: its epic's channel, else `#general`. */
  function channelOf(epicId: number | null): string {
    if (epicId === null) return 'general'
    const row = db.prepare('SELECT channel_id FROM epic_channel WHERE epic_id = ?').get(epicId) as
      | { channel_id: string }
      | undefined
    return row?.channel_id ?? 'general'
  }

  function subjectName(plan: Plan): string {
    if (plan.ticketId !== null) {
      const row = db.prepare('SELECT title FROM ticket WHERE id = ?').get(plan.ticketId) as
        | { title: string }
        | undefined
      return `${idOf(plan.ticketId)} ${row?.title ?? ''}`.trim()
    }
    const row = db.prepare('SELECT title FROM epic WHERE id = ?').get(plan.epicId!) as { title: string } | undefined
    return `the epic ${JSON.stringify(row?.title ?? '')}`
  }

  /** Whether a ticket's epic has an approved plan, which is what Managed lets it inherit. */
  function epicPlanApproved(epicId: number | null): boolean {
    if (epicId === null) return false
    return current({ kind: 'epic', id: epicId })?.status === 'approved'
  }

  function approverOf(plan: Plan): 'boss' | 'planner' {
    const kind = plan.ticketId !== null ? 'ticket' : 'epic'
    const epicId = plan.ticketId !== null ? ticketRow(plan.ticketId).epic_id : null
    return planApprover(level(), kind, { epicPlanApproved: epicPlanApproved(epicId) })
  }

  /** Posts in the planning thread, as the Company itself or as the planner. */
  function say(plan: Plan, authorId: string, text: string, options: { toBoss?: boolean } = {}) {
    const message = plan.threadId
      ? chat.reply({ authorId, messageId: plan.threadId, text })
      : chat.post({ authorId, channelId: plan.channelId, text, ...(options.toBoss === true && { mentions: [BOSS] }) })
    return message
  }

  /**
   * Opens a plan at version 1 and announces it in the planning thread, as the frame's system line
   * reads it: `You created TC-142 … it starts in Planning`.
   */
  function open(subject: PlanSubject, epicId: number | null, title: string, createdBy: string): Plan {
    const channelId = channelOf(subject.kind === 'epic' ? subject.id : epicId)
    const what = subject.kind === 'ticket' ? `${idOf(subject.id)} · ${title}` : `the epic ${JSON.stringify(title)}`
    const message = withoutWakes(db, () =>
      chat.post({
        authorId: COMPANY_AUTHOR,
        channelId,
        text: `${createdBy === BOSS ? 'You' : nameOf(createdBy)} created ${what} — it starts in Planning.`,
      }),
    )
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO plan (ticket_id, epic_id, version, planner_id, channel_id, thread_id, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        subject.kind === 'ticket' ? subject.id : null,
        subject.kind === 'epic' ? subject.id : null,
        planner()?.id ?? '',
        channelId,
        message.id,
        message.createdAt,
      )
    onChange()
    return byId(Number(lastInsertRowid))
  }

  /** Wakes the planner with one prompt. Nothing happens when nobody holds `plan`. */
  function wakePlanner(plan: Plan, fromId: string, text: string, prompt: string): void {
    const who = plan.plannerId && isEmployee(plan.plannerId) ? plan.plannerId : planner()?.id
    if (!who || who === fromId) return
    deliver({
      employeeId: who,
      kind: 'planning',
      fromId,
      channelId: plan.channelId,
      threadId: plan.threadId,
      messageId: null,
      ticketId: plan.ticketId,
      text,
      prompt,
    })
  }

  /** How every planner prompt names what it is about, and how to answer it. */
  function planningPrompt(plan: Plan, body: string): string {
    const subject = plan.ticketId !== null ? `ticket ${idOf(plan.ticketId)}` : `epic ${plan.epicId}`
    return (
      `[company] planning ${subject}: ${body} ` +
      `Ask the boss what you need with plan_ask, draft the plan with plan_draft, and call plan_ready when it ` +
      'is settled. Talk through the company MCP server, never in plain text.'
    )
  }

  function setStatus(planId: number, status: Plan['status']): void {
    db.prepare('UPDATE plan SET status = ? WHERE id = ?').run(status, planId)
  }

  /** The plan's subtasks become the ticket's checklist, minus the ones already on it. */
  function applySubtasks(plan: Plan, actorId: string): void {
    if (plan.ticketId === null) return
    const acting = board(actorId)
    const ticket = acting.snapshot().tickets.find((t) => t.id === plan.ticketId)
    if (!ticket) return
    const already = new Set(ticket.subtasks.map((s) => s.title.trim().toLowerCase()))
    for (const subtask of plan.subtasks) {
      const title = subtask.title.trim()
      if (!title || already.has(title.toLowerCase())) continue
      // The subtask rule still applies: a repo the ticket does not touch is another ticket.
      const repo = subtask.repo !== null && ticket.repos.includes(subtask.repo) ? subtask.repo : null
      acting.createSubtask({ ticketId: plan.ticketId, title, repo })
      already.add(title.toLowerCase())
    }
  }

  /** What the ticket says about where its work lands: its repos, by name, and its labels (T239). */
  function areaOf(ticketId: number): TicketArea {
    const ticket = board(BOSS)
      .snapshot()
      .tickets.find((t) => t.id === ticketId)
    if (!ticket) return { repos: [] }
    const names = options.repos()
    return {
      repos: ticket.repos.map((id) => names.find((repo) => repo.id === id)?.name ?? id),
      labels: ticket.labels,
    }
  }

  /**
   * Marks the plan approved and, for a ticket, moves it to Ready with its checklist.
   *
   * A ticket nobody holds is handed to whoever should take it (T239): the engineer whose area the
   * work falls in, else any engineer who may work in its repos, and the lead only when no engineer
   * can. Before this, a Ready ticket with no assignee waited for somebody to notice it, which in a
   * monorepo meant the lead — the only one every repo filter let in.
   */
  function settle(plan: Plan, approverId: string): Plan {
    db.prepare('UPDATE plan SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?').run(
      'approved',
      approverId,
      new Date().toISOString(),
      plan.id,
    )
    const fresh = byId(plan.id)
    applySubtasks(fresh, approverId)
    if (fresh.ticketId !== null) {
      const row = ticketRow(fresh.ticketId)
      if (row.assignee_id === null) {
        const takes = options.assignment.assignee(areaOf(fresh.ticketId))
        if (takes) board(approverId).updateTicket(fresh.ticketId, { assigneeId: takes.id })
      }
      if (row.column_id === 'planning') board(approverId).moveTicket(fresh.ticketId, READY)
    }
    onChange()
    return byId(plan.id)
  }

  const planning: CompanyPlanning = {
    of: current,

    list() {
      const rows = db
        .prepare(
          `SELECT * FROM plan p WHERE p.version = (
             SELECT MAX(version) FROM plan o
             WHERE o.ticket_id IS p.ticket_id AND o.epic_id IS p.epic_id
           ) ORDER BY p.id`,
        )
        .all() as unknown as PlanRow[]
      return rows.map(toPlan)
    },

    versions(subject) {
      const rows = db
        .prepare(
          subject.kind === 'ticket'
            ? 'SELECT * FROM plan WHERE ticket_id = ? ORDER BY version'
            : 'SELECT * FROM plan WHERE epic_id = ? ORDER BY version',
        )
        .all(subject.id) as unknown as PlanRow[]
      return rows.map(toPlan)
    },

    answer(questionId, text) {
      const answer = text.trim()
      if (!answer) throw new Error('An answer cannot be empty')
      return recordAnswer(questionId, answer, BOSS, false)
    },

    delegate(questionId) {
      const row = db.prepare('SELECT plan_id FROM plan_question WHERE id = ?').get(questionId) as
        | { plan_id: number }
        | undefined
      if (!row) throw new Error(`There is no question ${questionId}`)
      const who = byId(row.plan_id).plannerId || ''
      return recordAnswer(questionId, `${nameOf(who || null)} decides.`, who || BOSS, true)
    },

    approve(planId) {
      const plan = byId(planId)
      if (plan.status === 'approved') throw new Error('That plan is already approved')
      const open = unanswered(plan)
      if (open.length > 0) {
        throw new Error(`Answer question ${open[0]!.number} first, or let the planner decide it`)
      }
      const settled = settle(plan, BOSS)
      say(
        settled,
        COMPANY_AUTHOR,
        `Plan v${settled.version} for ${subjectName(settled)} approved by the boss. ` +
          (settled.ticketId !== null ? `${idOf(settled.ticketId)} is Ready.` : 'Its tickets inherit it.'),
      )
      wakePlanner(
        settled,
        BOSS,
        `Plan approved for ${subjectName(settled)}`,
        planningPrompt(
          settled,
          `the boss approved plan v${settled.version}.` +
            (settled.ticketId !== null
              ? ` ${idOf(settled.ticketId)} is Ready and its subtasks are on it; an engineer can claim it now.`
              : ' Its tickets can be drafted and go Ready on their own under Managed.'),
        ),
      )
      return settled
    },

    requestChanges(planId, comments) {
      const reason = comments.trim()
      if (!reason) throw new Error('Say what to change')
      const plan = byId(planId)
      setStatus(plan.id, 'drafting')
      onChange()
      const fresh = byId(plan.id)
      say(fresh, BOSS, `Changes asked on the plan for ${subjectName(fresh)}: ${reason}`)
      wakePlanner(
        fresh,
        BOSS,
        `Changes asked on the plan for ${subjectName(fresh)}`,
        planningPrompt(fresh, `the boss asked for changes: ${JSON.stringify(reason)}.`),
      )
      return fresh
    },

    replan(ticketId, reason, changes = []) {
      return planning.as(BOSS).replan(ticketId, reason, changes)
    },

    keep(planId) {
      const plan = byId(planId)
      if (plan.status !== 'replan') throw new Error('That plan is not a replan')
      if (plan.version < 2) throw new Error('There is no earlier version to keep')
      db.prepare('DELETE FROM plan WHERE id = ?').run(plan.id)
      const kept = requirePlan(
        plan.ticketId !== null ? { kind: 'ticket', id: plan.ticketId } : { kind: 'epic', id: plan.epicId! },
      )
      if (kept.ticketId !== null && ticketRow(kept.ticketId).column_id === 'planning') {
        board(BOSS).moveTicket(kept.ticketId, READY)
      }
      onChange()
      say(kept, COMPANY_AUTHOR, `The boss kept plan v${kept.version} for ${subjectName(kept)}; the replan is dropped.`)
      wakePlanner(
        kept,
        BOSS,
        `Replan turned down for ${subjectName(kept)}`,
        planningPrompt(kept, `the boss kept plan v${kept.version}; work goes on as planned.`),
      )
      return kept
    },

    ticketCreated(ticket, actorId) {
      if (ticket.column !== 'planning') return
      if (current({ kind: 'ticket', id: ticket.id })) return
      const plan = open({ kind: 'ticket', id: ticket.id }, ticket.epicId, ticket.title, actorId)
      wakePlanner(
        plan,
        actorId,
        `Plan ${idOf(ticket.id)} ${ticket.title}`,
        planningPrompt(
          plan,
          `${idOf(ticket.id)} ${JSON.stringify(ticket.title)} was created and waits in Planning. ` +
            'Read it with board_list, then ask the boss whatever the plan turns on.',
        ),
      )
      return void 0
    },

    epicCreated(epic, actorId) {
      if (current({ kind: 'epic', id: epic.id })) return
      const plan = open({ kind: 'epic', id: epic.id }, epic.id, epic.title, actorId)
      wakePlanner(
        plan,
        actorId,
        `Plan the epic ${epic.title}`,
        planningPrompt(
          plan,
          `the epic ${JSON.stringify(epic.title)} was created and waits in Planning. ` +
            'Its tickets inherit its approved plan under Managed, so plan the epic before its tickets.',
        ),
      )
      return void 0
    },

    claimRefusal(ticketId) {
      const row = db.prepare('SELECT column_id FROM ticket WHERE id = ?').get(ticketId) as
        | { column_id: string }
        | undefined
      if (!row || row.column_id === READY) return null
      if (row.column_id !== 'planning') return null
      const plan = current({ kind: 'ticket', id: ticketId })
      const why =
        plan === null
          ? 'it has no plan yet'
          : plan.status === 'approved'
            ? 'its plan is approved but it has not reached Ready'
            : `its plan is ${plan.status === 'waiting' ? 'waiting on the boss' : `still being ${plan.status === 'replan' ? 'replanned' : 'drafted'}`}`
      return `${idOf(ticketId)} is in Planning, not Ready: ${why}. Engineers can’t claim it until its plan is approved.`
    },

    as(employeeId) {
      return {
        ask(subject, questions) {
          const asked = questions.map((q) => q.trim()).filter(Boolean)
          if (asked.length === 0) throw new Error('Ask at least one question')
          const plan = requirePlan(subject)
          if (plan.status === 'approved') throw new Error('That plan is already approved')
          db.prepare('UPDATE plan SET planner_id = ? WHERE id = ?').run(employeeId, plan.id)
          const start = plan.questions.length
          const text =
            `Before ${subjectName(plan)} goes to Ready, ${asked.length === 1 ? 'one question' : `${asked.length} questions`}. ` +
            'Answer inline — I’ll draft the plan from whatever you give me.\n' +
            asked.map((q, i) => `${start + i + 1}. ${q}`).join('\n')
          const message = chat.post({
            authorId: employeeId,
            channelId: plan.channelId,
            text,
            mentions: [BOSS],
          })
          const insert = db.prepare(
            'INSERT INTO plan_question (plan_id, number, text, message_id, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          asked.forEach((question, i) => {
            insert.run(plan.id, start + i + 1, question, message.id, message.createdAt)
          })
          setStatus(plan.id, 'drafting')
          onChange()
          return byId(plan.id)
        },

        draft(subject, draft) {
          const plan = requirePlan(subject)
          if (plan.status === 'approved') throw new Error('That plan is already approved; ask for a replan instead')
          const json = (value: unknown, fallback: string) => (value === undefined ? fallback : JSON.stringify(value))
          db.prepare(
            `UPDATE plan SET planner_id = ?, goal = ?, approach = ?, acceptance_criteria = ?, repos = ?,
               subtasks = ?, risks = ?, open_questions = ? WHERE id = ?`,
          ).run(
            employeeId,
            draft.goal ?? plan.goal,
            draft.approach ?? plan.approach,
            json(draft.acceptanceCriteria, JSON.stringify(plan.acceptanceCriteria)),
            json(draft.repos, JSON.stringify(plan.repos)),
            json(draft.subtasks, JSON.stringify(plan.subtasks)),
            json(draft.risks, JSON.stringify(plan.risks)),
            json(draft.openQuestions, JSON.stringify(plan.openQuestions)),
            plan.id,
          )
          const approver = approverOf(byId(plan.id))
          setStatus(plan.id, approver === 'boss' ? 'waiting' : 'drafting')
          // One card per version: the first draft posts it, a redraft edits the same row in place.
          if (plan.messageId === null) {
            const message = chat.post({
              authorId: employeeId,
              channelId: plan.channelId,
              text:
                approver === 'boss'
                  ? `Drafted the plan for ${subjectName(plan)}. Approve it and it goes to Ready.`
                  : `Drafted and approved the plan for ${subjectName(plan)} myself.`,
              ...(approver === 'boss' && { mentions: [BOSS] }),
            })
            db.prepare('UPDATE plan SET message_id = ? WHERE id = ?').run(message.id, plan.id)
          }
          onChange()
          return byId(plan.id)
        },

        ready(subject) {
          const plan = requirePlan(subject)
          if (plan.status === 'approved') {
            if (plan.ticketId !== null && ticketRow(plan.ticketId).column_id === 'planning') {
              board(employeeId).moveTicket(plan.ticketId, READY)
              onChange()
            }
            return byId(plan.id)
          }
          if (!plan.goal.trim()) throw new Error('Draft the plan with plan_draft before you ask for Ready')
          const open = unanswered(plan)
          if (open.length > 0) {
            throw new Error(
              `The boss has not answered question ${open.map((q) => q.number).join(', ')} yet; wait for the answers`,
            )
          }
          const approver = approverOf(plan)
          if (approver === 'boss') {
            setStatus(plan.id, 'waiting')
            onChange()
            throw new Error(
              `The boss approves this plan: it is waiting on them. ${plan.ticketId !== null ? idOf(plan.ticketId) : 'The epic'} stays in Planning until they do.`,
            )
          }
          const settled = settle(plan, employeeId)
          say(settled, employeeId, `Plan v${settled.version} for ${subjectName(settled)} is approved and posted.`)
          return settled
        },

        replan(ticketId, reason, changes) {
          const why = reason.trim()
          if (!why) throw new Error('Say why the plan has to change')
          const plan = requirePlan({ kind: 'ticket', id: ticketId })
          if (plan.status === 'replan') throw new Error(`A replan of ${idOf(ticketId)} is already waiting on the boss`)
          const { lastInsertRowid } = db
            .prepare(
              `INSERT INTO plan (ticket_id, epic_id, version, planner_id, goal, approach, acceptance_criteria,
                 repos, subtasks, risks, open_questions, status, replan_by, replan_reason, replan_changes,
                 channel_id, thread_id, created_at)
               VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'replan', ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              ticketId,
              plan.version + 1,
              plan.plannerId,
              plan.goal,
              plan.approach,
              JSON.stringify(plan.acceptanceCriteria),
              JSON.stringify(plan.repos),
              JSON.stringify(plan.subtasks),
              JSON.stringify(plan.risks),
              JSON.stringify(plan.openQuestions),
              employeeId,
              why,
              JSON.stringify(changes.map((c) => c.trim()).filter(Boolean)),
              plan.channelId,
              plan.threadId,
              new Date().toISOString(),
            )
          const next = byId(Number(lastInsertRowid))
          // The ticket goes back to Planning and keeps its assignee and worktrees: the work is
          // paused where it stands, not thrown away.
          const row = ticketRow(ticketId)
          if (row.column_id !== 'planning') board(employeeId).moveTicket(ticketId, 'planning')
          const card = chat.post({
            authorId: employeeId,
            channelId: next.channelId,
            text: `Replan requested on ${idOf(ticketId)}: ${why}`,
            mentions: [BOSS],
          })
          db.prepare('UPDATE plan SET message_id = ? WHERE id = ?').run(card.id, next.id)
          onChange()
          const fresh = byId(next.id)
          wakePlanner(
            fresh,
            employeeId,
            `Replan asked on ${idOf(ticketId)}`,
            planningPrompt(
              fresh,
              `${nameOf(employeeId)} asked for a replan of ${idOf(ticketId)}: ${JSON.stringify(why)}. ` +
                `It is back in Planning, paused, and v${fresh.version} waits on the boss.`,
            ),
          )
          return fresh
        },

        /**
         * Planning's own refusal first — a plan has to be approved before anything is claimed — and
         * then T239's: a planner does not take work an engineer can take. A ticket already handed to
         * them is theirs whatever the rule says: the boss's assignment settles it, and the rule is
         * only about who picks up what nobody holds.
         */
        claimRefusal(ticketId) {
          const refusal = planning.claimRefusal(ticketId)
          if (refusal) return refusal
          if (ticketRow(ticketId).assignee_id === employeeId) return null
          return options.assignment.claimBlock(employeeId, areaOf(ticketId))
        },
      }
    },
  }

  /** Writes one answer and, once nothing is left open, wakes the planner with all of them at once. */
  function recordAnswer(questionId: number, answer: string, answeredBy: string, delegated: boolean): Plan {
    const row = db.prepare('SELECT * FROM plan_question WHERE id = ?').get(questionId) as QuestionRow | undefined
    if (!row) throw new Error(`There is no question ${questionId}`)
    if (row.answer !== null) throw new Error('That question is already answered')
    db.prepare('UPDATE plan_question SET answer = ?, answered_by = ?, answered_at = ?, delegated = ? WHERE id = ?').run(
      answer,
      answeredBy,
      new Date().toISOString(),
      delegated ? 1 : 0,
      questionId,
    )
    onChange()
    const plan = byId(row.plan_id)
    if (unanswered(plan).length > 0) return plan
    const answers = plan.questions
      .map((q) => `${q.number}. ${q.text} — ${q.delegated ? 'the boss left this one to you' : q.answer}`)
      .join('\n')
    wakePlanner(
      plan,
      BOSS,
      `Answers for ${subjectName(plan)}`,
      planningPrompt(
        plan,
        `the boss answered every question at once:\n${answers}\nDraft the plan from them with plan_draft.`,
      ),
    )
    return plan
  }

  return planning
}
