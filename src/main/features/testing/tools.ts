import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BOSS } from '../../../shared/domain/chat'
import { type AppRun, type TestRun, testCounts } from '../../../shared/testing'
import { ticketCode } from '../../../shared/ticket-id'
import { run, TICKET_ID_HELP, ticketIdInput, ticketNumber } from '../../core'
import type { McpCaller } from '../../core/engine'

/**
 * `test_plan`, `test_run_app`, `test_step` and `test_submit` (T174): the QA agent's side of the
 * Testing stage, acting as the calling Employee.
 *
 * The script is the plan's acceptance criteria, which the agent reads, adds to, and then works
 * through **in the running app** — `test_run_app` starts the repo's own run command in the
 * ticket's worktree, and nothing else here starts a process. Its verdict either raises the merge
 * (QA agent mode), hands the ticket to the boss (Both), or sends it back to the assignee with the
 * step that failed.
 */
export function registerTestTools(server: McpServer, caller: McpCaller): void {
  const { company, chat, tests, appRuns, employee } = caller
  const idOf = (ticketId: number) => ticketCode(company.key, ticketId)
  const asTicketId = (input: number | string) => ticketNumber(input, company.key)

  const nameOf = (id: string | null) => {
    if (id === null) return null
    if (id === BOSS) return 'the boss'
    return chat.people().find((p) => p.id === id)?.name ?? 'former employee'
  }

  /** The script as the agent reads it: the steps, numbered, and what is left to do. */
  function runView(testRun: TestRun) {
    const counts = testCounts(testRun)
    return {
      ticket: idOf(testRun.ticketId),
      attempt: testRun.attempt,
      who_tests: testRun.mode,
      waiting_on: testRun.state === 'agent' ? nameOf(testRun.agentId) : testRun.state,
      passed: counts.passed,
      failed: counts.failed,
      to_test: counts.pending,
      steps: testRun.steps.map((step, index) => ({
        step: step.id,
        number: index + 1,
        what: step.title,
        how: step.detail || null,
        criterion: step.criterion,
        added_by: nameOf(step.addedBy),
        result: step.result,
        note: step.note || null,
        tested_by: nameOf(step.testedBy),
        screenshots: step.attachments.map((attachment) => attachment.name),
      })),
    }
  }

  function appView(app: AppRun) {
    return {
      repo: app.repoName,
      command: app.command,
      running_in: app.cwd,
      state: app.state,
      url: app.url,
      exit_code: app.exitCode,
      last_line: app.lastLine || null,
    }
  }

  server.registerTool(
    'test_plan',
    {
      description:
        'Read the test script of a ticket you are testing: every step, where it came from, and what is still ' +
        'to check. The steps are the plan’s acceptance criteria; pass `add` to append a step the plan never ' +
        'wrote, which is yours and is shown as yours.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket you are testing. ${TICKET_ID_HELP}`),
        add: z.string().optional().describe('A step to append: what to check, in one sentence.'),
        how: z.string().optional().describe('How to check the added step, when it is not obvious.'),
      },
    },
    ({ ticket_id, add, how }) =>
      run(() => {
        const ticketId = asTicketId(ticket_id)
        if (add === undefined) return runView(tests.plan(ticketId))
        return runView(tests.addStep({ ticketId, title: add, ...(how !== undefined && { detail: how }) }))
      }),
  )

  server.registerTool(
    'test_run_app',
    {
      description:
        'Start, or stop, the repo’s run command in the ticket’s worktree so you can test the change in the ' +
        'running app. Nothing starts it for you and nothing else may start it: this is the only way you get a ' +
        'running app, and you stop it when you are done. Its output comes back in `last_line`; the whole log is ' +
        'in the app beside the boss.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket you are testing. ${TICKET_ID_HELP}`),
        action: z.enum(['start', 'stop', 'status']).describe('`start`, `stop`, or `status` to see what is running.'),
        repo: z
          .string()
          .optional()
          .describe('The repo whose app to start; needed only when the ticket has more than one that can run.'),
      },
    },
    ({ ticket_id, action, repo }) =>
      run(() => {
        const ticketId = asTicketId(ticket_id)
        const runnable = appRuns.runnable(ticketId)
        if (runnable.length === 0) {
          throw new Error(
            `${idOf(ticketId)} has no repo with a run command, so there is no app to start. Test what you can ` +
              'from the worktree and say so in your summary.',
          )
        }
        if (action === 'status') return { apps: appRuns.of(ticketId).map(appView) }
        const wanted = repo?.trim().toLowerCase()
        const target = wanted
          ? runnable.find((r) => r.repoName.toLowerCase() === wanted || r.repoId === repo)
          : runnable[0]
        if (!target) {
          throw new Error(
            `${idOf(ticketId)} has no runnable repo called ${repo}. It can run: ` +
              `${runnable.map((r) => r.repoName).join(', ')}.`,
          )
        }
        if (runnable.length > 1 && !wanted) {
          throw new Error(
            `${idOf(ticketId)} can run ${runnable.map((r) => r.repoName).join(' and ')}: say which one with \`repo\`.`,
          )
        }
        const app =
          action === 'start'
            ? appRuns.start({ ticketId, repoId: target.repoId, actorId: employee.id })
            : appRuns.stop(ticketId, target.repoId)
        return appView(app)
      }),
  )

  server.registerTool(
    'test_step',
    {
      description:
        'Record one step of the script as passed or failed, with a note saying what you saw. A failed step is ' +
        'what the assignee is sent, so write it so they can see it again: what you did, what happened, what you ' +
        'expected. Attach the screenshots you took of it.',
      inputSchema: {
        step: z.number().int().positive().describe('The step’s id, from test_plan.'),
        result: z.enum(['pass', 'fail']).describe('What happened when you checked it.'),
        note: z.string().optional().describe('What you saw, in a sentence. Needed in practice on a fail.'),
        attachments: z
          .array(z.string())
          .optional()
          .describe('Paths of screenshots to keep beside the step: files in your worktree or a temp folder.'),
      },
    },
    ({ step, result, note, attachments }) =>
      run(() =>
        runView(
          tests.setStep({
            stepId: step,
            result,
            ...(note !== undefined && { note }),
            ...(attachments !== undefined && { attachments }),
          }),
        ),
      ),
  )

  server.registerTool(
    'test_submit',
    {
      description:
        'End your test of a ticket with a verdict. `pass` needs every step recorded and none failed: it raises ' +
        'the merge, or hands the ticket to the boss to confirm when the Company asks for both. `fail` opens the ' +
        'bug thread to the assignee with your failed steps, notes and screenshots, and sends the ticket back to ' +
        'Doing — one message, whatever failed. Then end your turn.',
      inputSchema: {
        ticket_id: ticketIdInput.describe(`The ticket you tested. ${TICKET_ID_HELP}`),
        verdict: z.enum(['pass', 'fail']).describe('`pass` or `fail`.'),
        summary: z.string().describe('What you tested and what you found, in a sentence or two.'),
        checks: z
          .array(z.string())
          .optional()
          .describe('The checks you ran beside the script, e.g. `typecheck`, `test · 142`.'),
      },
    },
    ({ ticket_id, verdict, summary, checks }) =>
      run(() => {
        const submitted = tests.submit({
          ticketId: asTicketId(ticket_id),
          verdict,
          summary,
          ...(checks !== undefined && { checks }),
        })
        return {
          ...runView(submitted),
          next:
            submitted.state === 'failed'
              ? 'The assignee has it back, with your note and screenshots. End your turn.'
              : submitted.state === 'you'
                ? 'The boss confirms it now. End your turn.'
                : 'Testing passed; the merge goes ahead. End your turn.',
        }
      }),
  )
}
