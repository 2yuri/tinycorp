import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ticketSubject } from '../../../shared/approvals/approval-subject'
import {
  type AttachmentSource,
  attachmentName,
  DEFAULT_ATTACHMENT_LIMITS,
  isImageAttachment,
  type OpenedAttachment,
} from '../../../shared/attachments'
import type { Column } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, type Mentionable } from '../../../shared/domain/chat'
import { extensionOf, sizeLabel } from '../../../shared/files/files'
import type { Plan } from '../../../shared/planning/planning'
import {
  asksTheAgent,
  asksTheBoss,
  canPass,
  evidenceBadge,
  TEST_MODE_LABEL,
  type TestAttachment,
  type TestMode,
  type TestResult,
  type TestRun,
  type TestRunState,
  type TestStep,
  type TestVerdict,
  testCounts,
} from '../../../shared/testing'
import type { Migration } from '../../core'
import { companyKeyOf, excludeCompanyDataFromGit, ticketCodeIn } from '../../core'
import type { Chat } from '../chat'
import { type CodeFlow, PRS_CHANNEL } from '../code'
import { IMAGE_TYPES } from '../files'
import type { NewInboxItem } from '../inbox'
import type { ActingBoard } from '../sessions'
import type { AppRuns } from './app-runs'
import { createTestingSettings, type TestingSettings } from './test-settings'

/**
 * Testing's migration step (T174): one run per ticket per attempt, its steps, and the files a step
 * carries. A run is never rewritten — a ticket that comes back from Doing gets attempt 2, so what
 * was tested the first time, and what failed, is still there to read.
 */
export const TEST_FLOW_MIGRATION: Migration = {
  name: 'testing-runs-steps-and-screenshots',
  sql: `
  CREATE TABLE test_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    attempt INTEGER NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    agent_id TEXT,
    agent_verdict TEXT,
    agent_summary TEXT NOT NULL DEFAULT '',
    checks TEXT NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE (ticket_id, attempt)
  );
  CREATE INDEX test_run_by_ticket ON test_run (ticket_id, id);
  CREATE TABLE test_step (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES test_run (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    criterion INTEGER,
    added_by TEXT,
    result TEXT NOT NULL DEFAULT 'pending',
    note TEXT NOT NULL DEFAULT '',
    tested_by TEXT,
    tested_at TEXT
  );
  CREATE INDEX test_step_by_run ON test_step (run_id, position, id);
  CREATE TABLE test_attachment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id INTEGER NOT NULL REFERENCES test_step (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX test_attachment_by_step ON test_attachment (step_id, id);
`,
}

/** The folder inside a Company that holds what testing captured, one folder per attempt. */
export const TESTING_FOLDER = 'testing'

/** What the boss does about a ticket in Testing. */
export interface Tests {
  /** A ticket's latest attempt, or null before its first. */
  of(ticketId: number): TestRun | null
  /** The latest attempt of every ticket that has one, by ticket id. */
  list(): TestRun[]
  /** Adds a step to the attempt under way, at the bottom of the script. */
  addStep(input: { ticketId: number; title: string; detail?: string }): TestRun
  /** Records a step as passed or failed, with the note whoever tested it wrote. */
  setStep(input: { stepId: number; result: TestResult; note?: string }): TestRun
  /** Keeps a screenshot beside a step: one the boss picked, pasted, or captured from the app. */
  attach(input: { stepId: number; source: AttachmentSource }): TestRun
  /** Where one of those files is on this Mac. */
  attachmentPath(id: number): string
  /** One of them read for the viewer: an image comes back as a data URL. */
  openAttachment(id: number): OpenedAttachment
  /** Pass testing → ready to merge. Refused while a step failed or is still to test. */
  pass(ticketId: number): TestRun
  /** Report bug → back to Doing: the bug thread to the assignee, and the ticket goes back. */
  reportBug(input: { ticketId: number; note?: string }): TestRun
}

/** What an Employee holding `test` does, over MCP. */
export interface EmployeeTests {
  /** The script it is to run, with the ticket, its worktrees and how to start the app. */
  plan(ticketId: number): TestRun
  addStep(input: { ticketId: number; title: string; detail?: string }): TestRun
  setStep(input: { stepId: number; result: TestResult; note?: string; attachments?: string[] }): TestRun
  /** Ends its pass: a verdict, a summary, and the checks it ran. */
  submit(input: { ticketId: number; verdict: TestVerdict; summary: string; checks?: string[] }): TestRun
}

/** One Company's Testing stage. */
export interface CompanyTests extends Tests {
  as(employeeId: string): EmployeeTests
  /**
   * Review approved the ticket: puts it in Testing and starts an attempt. Returns false when the
   * mode for its repos is `nobody`, which is the caller's sign to raise the merge gate as before.
   */
  enter(ticketId: number, approvedBy: string): boolean
  /** Why this ticket may not merge yet, in one sentence, or null when Testing is not in the way. */
  refusal(ticketId: number): string | null
  /** The Company's who-tests settings, and the per-repo overrides. */
  settings: TestingSettings
}

export interface TestFlowOptions {
  db: DatabaseSync
  chat: Chat
  /** The Company folder; screenshots live in `testing/<ticket>/<attempt>/` under it. */
  folder: string
  code: Pick<CodeFlow, 'of'>
  /** The board acting as `actorId`, so a move wakes whoever it concerns. */
  board(actorId: string): ActingBoard
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** Who holds `test` and is not the assignee, or null when nobody does. */
  tester(assigneeId: string): string | null
  /** A ticket's plan, for the acceptance criteria the script starts from (T171). */
  planOf(ticketId: number, epicId: number | null): Plan | null
  /** The ticket's running apps, which stop when it leaves Testing. */
  runs: Pick<AppRuns, 'stopTicket'>
  /** Testing passed: whatever was waiting on it may go ahead now. */
  onPassed(ticketId: number, byId: string): void
  onChange(): void
  /** Keeps the screenshots out of the repo when the Company folder sits in a checkout. */
  excludeFromGit?: (folder: string) => void
}

interface TicketRow {
  id: number
  title: string
  column_id: Column
  epic_id: number | null
  assignee_id: string | null
}

interface RunRow {
  id: number
  ticket_id: number
  attempt: number
  mode: TestMode
  state: TestRunState
  agent_id: string | null
  agent_verdict: TestVerdict | null
  agent_summary: string
  checks: string
  started_at: string
  finished_at: string | null
}

interface StepRow {
  id: number
  run_id: number
  title: string
  detail: string
  criterion: number | null
  added_by: string | null
  result: TestResult
  note: string
  tested_by: string | null
  tested_at: string | null
}

interface AttachmentRow {
  id: number
  step_id: number
  name: string
  size: number
  created_at: string
}

export function createTestFlow({
  db,
  chat,
  folder,
  code,
  board,
  deliver,
  tester,
  planOf,
  runs,
  onPassed,
  onChange,
  excludeFromGit = excludeCompanyDataFromGit,
}: TestFlowOptions): CompanyTests {
  const settings = createTestingSettings(db, onChange)
  const root = folder ? join(resolve(folder), TESTING_FOLDER) : ''
  const limits = DEFAULT_ATTACHMENT_LIMITS
  let excluded = false

  function ticket(id: number): TicketRow | undefined {
    return db.prepare('SELECT id, title, column_id, epic_id, assignee_id FROM ticket WHERE id = ?').get(id) as
      | TicketRow
      | undefined
  }

  /** How every line here names a ticket: `TC-142` (decision 33). */
  const idOf = (ticketId: number) => ticketCodeIn(db, ticketId)

  function people(): Mentionable[] {
    return chat.people()
  }

  function nameOf(id: string | null): string {
    if (!id || id === BOSS) return BOSS
    return people().find((p) => p.id === id)?.name ?? 'former employee'
  }

  function subjectOf(row: TicketRow): string {
    return ticketSubject(companyKeyOf(db), row.id, row.title)
  }

  function attachmentsOf(stepId: number): TestAttachment[] {
    const rows = db
      .prepare('SELECT id, step_id, name, size, created_at FROM test_attachment WHERE step_id = ? ORDER BY id')
      .all(stepId) as unknown as AttachmentRow[]
    return rows.map((row) => ({
      id: row.id,
      stepId: row.step_id,
      name: row.name,
      size: row.size,
      createdAt: row.created_at,
    }))
  }

  function stepsOf(runId: number): TestStep[] {
    const rows = db
      .prepare('SELECT * FROM test_step WHERE run_id = ? ORDER BY position, id')
      .all(runId) as unknown as StepRow[]
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      title: row.title,
      detail: row.detail,
      criterion: row.criterion,
      addedBy: row.added_by,
      result: row.result,
      note: row.note,
      testedBy: row.tested_by,
      testedAt: row.tested_at,
      attachments: attachmentsOf(row.id),
    }))
  }

  function toRun(row: RunRow): TestRun {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      attempt: row.attempt,
      mode: row.mode,
      state: row.state,
      agentId: row.agent_id,
      agentVerdict: row.agent_verdict,
      agentSummary: row.agent_summary,
      checks: JSON.parse(row.checks) as string[],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      steps: stepsOf(row.id),
    }
  }

  function latest(ticketId: number): TestRun | null {
    const row = db.prepare('SELECT * FROM test_run WHERE ticket_id = ? ORDER BY attempt DESC LIMIT 1').get(ticketId) as
      | RunRow
      | undefined
    return row ? toRun(row) : null
  }

  function run(id: number): TestRun {
    return toRun(db.prepare('SELECT * FROM test_run WHERE id = ?').get(id) as unknown as RunRow)
  }

  function runOfStep(stepId: number): { run: TestRun; step: TestStep } {
    const row = db.prepare('SELECT run_id FROM test_step WHERE id = ?').get(stepId) as { run_id: number } | undefined
    if (!row) throw new Error(`There is no test step ${stepId}`)
    const found = run(row.run_id)
    return { run: found, step: found.steps.find((s) => s.id === stepId)! }
  }

  /** The attempt under way, which is the only one anybody may write to. */
  function open(ticketId: number): TestRun {
    const found = latest(ticketId)
    if (!found) throw new Error(`${idOf(ticketId)} has not been tested: it is not in Testing`)
    if (found.state === 'passed' || found.state === 'failed') {
      throw new Error(`Testing of ${idOf(ticketId)} is over; it is not waiting on anybody.`)
    }
    return found
  }

  function setState(id: number, state: TestRunState, finished = false): void {
    db.prepare('UPDATE test_run SET state = ?, finished_at = ? WHERE id = ?').run(
      state,
      finished ? new Date().toISOString() : null,
      id,
    )
  }

  function announce(text: string, mentions: string[] = []): void {
    chat.post({ authorId: COMPANY_AUTHOR, channelId: PRS_CHANNEL, text, mentions })
  }

  /** The acceptance criteria the script starts from: the ticket's plan, else its epic's (T171). */
  function criteriaOf(row: TicketRow): string[] {
    const plan = planOf(row.id, row.epic_id)
    return (plan?.acceptanceCriteria ?? []).map((line) => line.trim()).filter(Boolean)
  }

  function addStepRow(
    runId: number,
    input: { title: string; detail?: string; criterion?: number | null; addedBy?: string | null },
  ): void {
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('A step needs to say what to check')
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM test_step WHERE run_id = ?').get(runId) as { n: number }
    db.prepare(
      `INSERT INTO test_step (run_id, position, title, detail, criterion, added_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(runId, Number(n), title, String(input.detail ?? '').trim(), input.criterion ?? null, input.addedBy ?? null)
  }

  /** Where an attempt's screenshots live. */
  function folderOf(run: TestRun): string {
    if (!root) throw new Error('This Company has no folder to keep screenshots in')
    return join(root, String(run.ticketId), String(run.attempt))
  }

  function makeRoot(): void {
    if (!root) throw new Error('This Company has no folder to keep screenshots in')
    mkdirSync(root, { recursive: true })
    if (excluded) return
    excluded = true
    excludeFromGit(resolve(folder))
  }

  function attachmentRow(id: number): AttachmentRow {
    const row = db.prepare('SELECT id, step_id, name, size, created_at FROM test_attachment WHERE id = ?').get(id) as
      | AttachmentRow
      | undefined
    if (!row) throw new Error(`There is no test attachment ${id}`)
    return row
  }

  function pathOfAttachment(row: AttachmentRow): string {
    const { run } = runOfStep(row.step_id)
    return join(folderOf(run), row.name)
  }

  /** Writes one file beside a step and records it. Refuses the same things a chat attachment does. */
  function keep(stepId: number, source: AttachmentSource): void {
    const { run: found } = runOfStep(stepId)
    const given = attachmentName(source.name ?? ('path' in source ? source.path : ''))
    if (!given) throw new Error('A screenshot needs a file name')
    if (!limits.extensions.includes(extensionOf(given))) {
      throw new Error(`${given} is not a kind of file you can attach (${limits.extensions.join(', ')})`)
    }
    let bytes: Uint8Array
    if ('data' in source) bytes = source.data
    else {
      const from = resolve(source.path)
      if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`There is no file at ${source.path}`)
      bytes = readFileSync(from)
    }
    if (bytes.byteLength > limits.maxBytes) {
      throw new Error(
        `${given} is ${sizeLabel(bytes.byteLength)}, over the ${sizeLabel(limits.maxBytes)} a file may be`,
      )
    }
    makeRoot()
    const into = folderOf(found)
    mkdirSync(into, { recursive: true })
    const taken = new Set(attachmentsOf(stepId).map((a) => a.name))
    let name = given
    const dot = given.lastIndexOf('.')
    const stem = dot <= 0 ? given : given.slice(0, dot)
    const extension = dot <= 0 ? '' : given.slice(dot)
    for (let n = 2; taken.has(name); n++) name = `${stem}-${n}${extension}`
    writeFileSync(join(into, name), bytes)
    db.prepare('INSERT INTO test_attachment (step_id, name, size, created_at) VALUES (?, ?, ?, ?)').run(
      stepId,
      name,
      bytes.byteLength,
      new Date().toISOString(),
    )
  }

  /** The files of every failed step, as sources a chat message can carry. */
  function failedFiles(found: TestRun): AttachmentSource[] {
    return found.steps
      .filter((step) => step.result === 'fail')
      .flatMap((step) =>
        step.attachments.map((attachment) => ({
          name: attachment.name,
          path: join(folderOf(found), attachment.name),
        })),
      )
      .filter((source) => existsSync(source.path))
  }

  /** `step 3 of 4 · criterion 2 — <title>. "<note>"`, one line per failed step. */
  function failureLines(found: TestRun): string {
    const total = found.steps.length
    return found.steps
      .map((step, index) => ({ step, number: index + 1 }))
      .filter(({ step }) => step.result === 'fail')
      .map(({ step, number }) => {
        const criterion = step.criterion === null ? '' : ` · criterion ${step.criterion}`
        const note = step.note ? ` ${JSON.stringify(step.note)}` : ''
        return `step ${number} of ${total}${criterion} — ${step.title}.${note}`
      })
      .join(' ')
  }

  /**
   * A failed attempt (frame `YatUW`, card b): the bug thread to the assignee with the failed step,
   * the note and the screenshots, the ticket back in Doing, and the assignee woken **once** —
   * however many steps failed, this is one attempt and one wake.
   */
  function fail(found: TestRun, byId: string): TestRun {
    const row = ticket(found.ticketId)
    if (!row) throw new Error(`There is no ticket ${idOf(found.ticketId)}`)
    setState(found.id, 'failed', true)
    runs.stopTicket(row.id)
    const assignee = row.assignee_id
    const lines = failureLines(found)
    const who = nameOf(byId)
    const mention = assignee && assignee !== BOSS ? `@${nameOf(assignee)} ` : ''
    const counts = testCounts(found)
    // One message, not two: the bug thread *is* the announcement, so the assignee is told once and
    // #prs carries one line per failed attempt rather than a summary and a bug side by side.
    const message = chat.post({
      authorId: byId,
      channelId: PRS_CHANNEL,
      text:
        `${mention}${subjectOf(row)} failed testing at attempt ${found.attempt} ` +
        `(${counts.failed} of ${found.steps.length}): ${lines} It is back in doing.`,
      ...(assignee ? { mentions: [assignee] } : {}),
      attachments: failedFiles(found),
      testRunId: found.id,
    })
    if (ticket(row.id)?.column_id === 'testing') board(byId).moveTicket(row.id, 'doing')
    if (assignee && assignee !== byId && people().some((p) => p.id === assignee)) {
      const places = code
        .of(row.id)
        .worktrees.map((w) => `${w.branch} in ${w.path}`)
        .join('; ')
      deliver({
        employeeId: assignee,
        kind: 'testing',
        fromId: byId,
        channelId: PRS_CHANNEL,
        threadId: null,
        messageId: message.id,
        ticketId: row.id,
        text: `Testing failed on ${subjectOf(row)}`,
        prompt:
          `[company] ${who} tested your ticket ${idOf(row.id)} ${JSON.stringify(row.title)} before the merge and it ` +
          `failed: ${lines} ${idOf(row.id)} is back in doing. ` +
          (places ? `Fix it in your worktree (${places}), commit and push there. ` : '') +
          'Then call review_ready: review runs again, and when it approves the ticket goes back into testing for ' +
          'another attempt. Talk through the company MCP server, never in plain text.',
      })
    }
    onChange()
    return run(found.id)
  }

  /** Testing passed: the runs stop, it is said once, and whatever waited on it goes ahead. */
  function pass(found: TestRun, byId: string): TestRun {
    const row = ticket(found.ticketId)
    if (!row) throw new Error(`There is no ticket ${idOf(found.ticketId)}`)
    setState(found.id, 'passed', true)
    runs.stopTicket(row.id)
    announce(`${nameOf(byId)} passed testing on ${subjectOf(row)}: ${evidenceBadge(found)}. The merge can go ahead.`)
    onChange()
    onPassed(row.id, byId)
    return run(found.id)
  }

  /** The prompt the QA agent is woken with: what to verify, where, and how to see it running. */
  function agentPrompt(row: TicketRow, found: TestRun): string {
    const { worktrees, pullRequests } = code.of(row.id)
    const places = worktrees.map((w) => `${w.path} (branch ${w.branch})`).join('; ')
    const prs = pullRequests.map((p) => p.url).join(', ')
    const script = found.steps
      .map((step, index) => `${index + 1}. ${step.title}${step.detail ? ` — ${step.detail}` : ''}`)
      .join(' ')
    const apps = settings
      .settings()
      .repos.filter((repo) => worktrees.some((w) => w.repoId === repo.repoId) && repo.runCommand)
      .map((repo) => `${repo.runCommand}${repo.port === null ? '' : ` on port ${repo.port}`}`)
      .join('; ')
    return (
      `[company] test ticket ${idOf(row.id)} ${JSON.stringify(row.title)} before it merges. ` +
      `It is in testing, on its own worktrees: ${places || 'none'}.` +
      (prs ? ` Its PRs: ${prs}.` : '') +
      (script ? ` The script is ${found.steps.length} ${found.steps.length === 1 ? 'step' : 'steps'}: ${script}` : '') +
      ' Read it with test_plan, which is also how you add a step the script is missing. ' +
      (apps
        ? `Start the app with test_run_app (action "start"): ${apps}. Stop it when you are done. `
        : 'This ticket has no run command, so there is no app to start. ') +
      'Verify every criterion in the running app, not by reading the code: open it, do the thing, and look. ' +
      'If you hold a browser MCP server — playwright or another — drive the app with it and take a screenshot of ' +
      'each criterion; attach the file paths to the step. ' +
      'Record each step with test_step (step, result "pass" or "fail", a note, and attachments), then end with ' +
      'test_submit: a verdict, a summary, and the checks you ran. A fail sends the ticket back to its assignee ' +
      'with your note and screenshots, so say what you saw and how to see it again. ' +
      'Talk through the company MCP server, never in plain text.'
    )
  }

  /** Files the boss's turn: one message in `#prs` that names them, which is what the Inbox reads. */
  function askTheBoss(row: TicketRow, found: TestRun): void {
    const counts = testCounts(found)
    const agent = found.agentVerdict === 'pass' ? `${nameOf(found.agentId)} passed all ${counts.total}; ` : ''
    chat.post({
      authorId: COMPANY_AUTHOR,
      channelId: PRS_CHANNEL,
      text:
        `@${BOSS} test ${subjectOf(row)} · ${counts.total} ${counts.total === 1 ? 'step' : 'steps'}. ` +
        `${agent}the merge waits for your confirm.`,
      mentions: [BOSS],
      testRunId: found.id,
    })
  }

  const tests: CompanyTests = {
    settings,
    of: latest,

    list() {
      const rows = db
        .prepare(
          'SELECT * FROM test_run WHERE id IN (SELECT MAX(id) FROM test_run GROUP BY ticket_id) ORDER BY ticket_id',
        )
        .all() as unknown as RunRow[]
      return rows.map(toRun)
    },

    enter(ticketId, approvedBy) {
      const row = ticket(ticketId)
      if (!row) return false
      const asked = settings.ofTicket(ticketId)
      if (asked === 'nobody') return false
      const already = latest(ticketId)
      if (already && (already.state === 'agent' || already.state === 'you')) return true
      if (already?.state === 'passed') return false
      const agentId = asksTheAgent(asked) ? tester(row.assignee_id ?? BOSS) : null
      // A mode that asks for a QA agent in a Company that has none falls back to the boss rather
      // than to nobody: the stage the boss asked for still happens, and the app says why.
      const mode: TestMode = asksTheAgent(asked) && !agentId ? 'you' : asked
      const state: TestRunState = asksTheAgent(mode) ? 'agent' : 'you'
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM test_run WHERE ticket_id = ?').get(ticketId) as { n: number }
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO test_run (ticket_id, attempt, mode, state, agent_id, started_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ticketId, Number(n) + 1, mode, state, agentId, new Date().toISOString())
      const runId = Number(lastInsertRowid)
      criteriaOf(row).forEach((criterion, index) => {
        addStepRow(runId, { title: criterion, criterion: index + 1 })
      })
      const started = run(runId)
      if (row.column_id !== 'testing') board(approvedBy).moveTicket(ticketId, 'testing')
      const counts = testCounts(started)
      announce(
        `${subjectOf(row)} passed review and is in testing (${TEST_MODE_LABEL[mode].toLowerCase()}): ` +
          `${counts.total} ${counts.total === 1 ? 'step' : 'steps'} from the plan.` +
          (asksTheAgent(asked) && !agentId
            ? ' Nobody here holds the test capability, so this one is yours to test.'
            : ''),
      )
      if (agentId) {
        deliver({
          employeeId: agentId,
          kind: 'testing',
          fromId: approvedBy,
          channelId: PRS_CHANNEL,
          threadId: null,
          messageId: null,
          ticketId: row.id,
          text: `Test ${subjectOf(row)}`,
          prompt: agentPrompt(row, started),
        })
      } else askTheBoss(row, started)
      onChange()
      return true
    },

    refusal(ticketId) {
      const found = latest(ticketId)
      if (!found || found.state === 'passed') return null
      if (found.state === 'failed') {
        return `${idOf(ticketId)} failed testing and went back to Doing, so there is nothing to merge yet.`
      }
      const counts = testCounts(found)
      return (
        `${idOf(ticketId)} is in testing: the merge waits for testing to pass ` +
        `(${counts.passed} of ${counts.total} passed, ${counts.failed} failed, ${counts.pending} to test).`
      )
    },

    addStep({ ticketId, title, detail }) {
      const found = open(ticketId)
      addStepRow(found.id, { title, ...(detail !== undefined && { detail }), addedBy: BOSS })
      onChange()
      return run(found.id)
    },

    setStep({ stepId, result, note }) {
      const { run: found } = runOfStep(stepId)
      if (found.state === 'agent') {
        throw new Error(`${nameOf(found.agentId)} is testing ${idOf(found.ticketId)} now; it comes to you after that.`)
      }
      if (found.state !== 'you') throw new Error(`Testing of ${idOf(found.ticketId)} is over`)
      writeStep(stepId, result, note, BOSS)
      onChange()
      return run(found.id)
    },

    attach({ stepId, source }) {
      const { run: found } = runOfStep(stepId)
      keep(stepId, source)
      onChange()
      return run(found.id)
    },

    attachmentPath: (id) => pathOfAttachment(attachmentRow(id)),

    openAttachment(id) {
      const row = attachmentRow(id)
      const path = pathOfAttachment(row)
      const image = isImageAttachment(row) && row.size <= limits.maxBytes && existsSync(path)
      return {
        id: row.id,
        name: row.name,
        size: row.size,
        path,
        dataUrl: image
          ? `data:${IMAGE_TYPES[extensionOf(row.name)] ?? 'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`
          : null,
      }
    },

    pass(ticketId) {
      const found = open(ticketId)
      if (found.state !== 'you') {
        throw new Error(`${nameOf(found.agentId)} has not finished testing ${idOf(ticketId)} yet`)
      }
      if (!canPass(found)) {
        const counts = testCounts(found)
        throw new Error(
          `${idOf(ticketId)} cannot pass testing: ${counts.failed} failed and ${counts.pending} still to test.`,
        )
      }
      return pass(found, BOSS)
    },

    reportBug({ ticketId, note }) {
      const found = open(ticketId)
      if (found.state !== 'you') {
        throw new Error(`${nameOf(found.agentId)} is testing ${idOf(ticketId)} now; wait for its verdict.`)
      }
      // Reporting a bug with nothing marked failed is the boss saying "this one is broken" without
      // having said which step: the note becomes a step of its own, so the assignee still gets one.
      if (testCounts(found).failed === 0) {
        addStepRow(found.id, { title: note?.trim() || 'It does not work', addedBy: BOSS })
        const step = run(found.id).steps.at(-1)!
        writeStep(step.id, 'fail', note, BOSS)
      }
      return fail(run(found.id), BOSS)
    },

    as(employeeId) {
      /** The attempt this Employee was asked to test; throws in the words of whoever holds it. */
      function mine(ticketId: number): TestRun {
        const found = open(ticketId)
        if (found.agentId !== employeeId) {
          throw new Error(
            found.agentId
              ? `The testing of ${idOf(ticketId)} is ${nameOf(found.agentId)}’s, not yours`
              : `${idOf(ticketId)} is the boss’s to test, not yours`,
          )
        }
        if (found.state !== 'agent') {
          throw new Error(`You have already submitted your test of ${idOf(ticketId)}; it is with the boss now.`)
        }
        return found
      }

      return {
        plan: (ticketId) => mine(ticketId),

        addStep({ ticketId, title, detail }) {
          const found = mine(ticketId)
          addStepRow(found.id, { title, ...(detail !== undefined && { detail }), addedBy: employeeId })
          onChange()
          return run(found.id)
        },

        setStep({ stepId, result, note, attachments }) {
          const { run: found } = runOfStep(stepId)
          mine(found.ticketId)
          writeStep(stepId, result, note, employeeId)
          for (const path of attachments ?? []) keep(stepId, { path })
          onChange()
          return run(found.id)
        },

        submit({ ticketId, verdict, summary, checks }) {
          const found = mine(ticketId)
          if (verdict !== 'pass' && verdict !== 'fail') throw new Error('The verdict must be "pass" or "fail"')
          const text = String(summary ?? '').trim()
          if (!text) throw new Error('Say in a sentence what you tested and what you found')
          const counts = testCounts(found)
          if (verdict === 'pass' && counts.failed > 0) {
            throw new Error(
              `${counts.failed} of ${counts.total} steps are marked failed, so this is not a pass. ` +
                'Submit "fail", or re-test the step and record it as passing.',
            )
          }
          if (verdict === 'pass' && counts.pending > 0) {
            throw new Error(
              `${counts.pending} of ${counts.total} steps are still to test. Record each one with test_step first.`,
            )
          }
          db.prepare('UPDATE test_run SET agent_verdict = ?, agent_summary = ?, checks = ? WHERE id = ?').run(
            verdict,
            text,
            JSON.stringify((checks ?? []).map((check) => String(check).trim()).filter(Boolean)),
            found.id,
          )
          const row = ticket(ticketId)!
          const submitted = run(found.id)
          // The evidence card: what it verified, not just a verdict (frame `vKIwf`).
          chat.post({
            authorId: employeeId,
            channelId: PRS_CHANNEL,
            text: `Tested ${subjectOf(row)} on its worktree before merge. ${text}`,
            testRunId: found.id,
          })
          if (verdict === 'fail') return fail(submitted, employeeId)
          if (asksTheBoss(submitted.mode)) {
            setState(submitted.id, 'you')
            askTheBoss(row, run(found.id))
            onChange()
            return run(found.id)
          }
          return pass(submitted, employeeId)
        },
      }
    },
  }

  /** Writes one step's result. Shared by the boss's side and the agent's. */
  function writeStep(stepId: number, result: TestResult, note: string | undefined, byId: string): void {
    if (result !== 'pass' && result !== 'fail' && result !== 'pending') {
      throw new Error('A step is "pass", "fail" or "pending"')
    }
    db.prepare('UPDATE test_step SET result = ?, note = ?, tested_by = ?, tested_at = ? WHERE id = ?').run(
      result,
      note === undefined
        ? (db.prepare('SELECT note FROM test_step WHERE id = ?').get(stepId) as { note: string }).note
        : String(note),
      result === 'pending' ? null : byId,
      result === 'pending' ? null : new Date().toISOString(),
      stepId,
    )
  }

  return tests
}
