import { claudeArgs, readResult, runSession } from './session.mjs'

/**
 * The long-session shape of `pnpm bench:tokens` (T197): one Employee, three tickets in a row in the
 * same checkout, and the fixture's own suite, `git diff` and `git log` between them.
 *
 * T190 measured RTK on a cold one-ticket session and found it cost 26% more tokens than doing
 * nothing, on 385 filtered commands across 32 cells. That is the wrong workload for it, and the
 * results file said so in its own limitations: a session that opens a repo once reads through Read,
 * Grep and Glob, which no `PreToolUse:Bash` hook ever sees. RTK filters command output, so the
 * session that can answer the question is the one that runs commands — a suite and a growing
 * `git diff`, over and over, for hours. This is that session, as small as it can be and still be it.
 *
 * A cell here is one `--session-id` resumed through six legs, not six sessions: the Employee carries
 * the whole conversation, the system prompt is paid once, and what a checkpoint costs is what it
 * costs on top of everything already in the context window. That is TinyCorp's Employee, and it is
 * the case the first round could not price.
 */

/**
 * The three tickets one long cell works, in order.
 *
 * Small ones, and three of them rather than eight, because the budget is real: T190's own medians
 * put these three at about a dollar of subscription usage in three separate cold sessions, and a
 * long cell is that plus what carrying the context costs. They also touch three different places —
 * a heading, the discussions list, the users table — so the second and third ticket read code the
 * first one did not, which is what makes the diff between checkpoints grow.
 */
export const LONG_TRIPLES = [
  {
    id: 'three-in-a-row',
    size: 'three tickets, one session',
    trap: 'none',
    tasks: ['discussion-count', 'search-discussions', 'sort-users'],
  },
]

/**
 * What the Employee is asked between two tickets, and the only place this mode differs from three
 * separate cells: the suite, the whole diff so far, and the log, read through the same Bash tool
 * RTK's hook sits on.
 *
 * `--no-pager` because a pager in a headless session waits forever, and the whole diff rather than
 * `--stat` because the bytes are the point: a `--stat` is four lines and filtering four lines saves
 * nothing. Red is fixed here rather than carried, because a real Employee fixes it and because a
 * ticket started on a red suite measures the mess and not the arm.
 */
export const CHECKPOINT_PROMPT = [
  'Checkpoint before the next ticket. Run all three, and read what they say:',
  '',
  '- `npx vitest run` — the whole suite, not one file.',
  '- `git --no-pager diff` — everything you have changed so far.',
  '- `git --no-pager log --oneline -20` — where the repo is.',
  '',
  'If the suite is red, fix it before you answer. Then tell me in two lines: is it green, and what does',
  'the work so far add up to?',
].join('\n')

/** One triple's tickets, resolved against the task files, or throws naming the one that is missing. */
export function tripleTasks(triple, tasks) {
  return triple.tasks.map((id) => {
    const one = tasks.find((task) => task.id === id)
    if (!one) throw new Error(`the long triple ${triple.id} names no task ${id}`)
    return one
  })
}

/**
 * The legs of one long cell: ticket, checkpoint, ticket, checkpoint, ticket, checkpoint.
 *
 * A checkpoint after the last ticket as well as between them, so all three tickets are measured the
 * same way — the third one's diff is read like the other two, and the suite has the last word.
 */
export function longLegs(triple, tasks) {
  const legs = []
  for (const [index, task] of tripleTasks(triple, tasks).entries()) {
    legs.push({ id: `t${index + 1}`, kind: 'ticket', task: task.id, prompt: task.prompt })
    legs.push({ id: `c${index + 1}`, kind: 'checkpoint', task: task.id, prompt: CHECKPOINT_PROMPT })
  }
  return legs
}

/**
 * The units of a long run: one per triple, shaped like a task so the plan, the cell ids and the
 * report's per-unit table treat it as one.
 */
export function longUnits(tasks, triples = LONG_TRIPLES) {
  return triples.map((triple) => ({
    id: triple.id,
    size: triple.size,
    trap: triple.trap,
    tasks: triple.tasks,
    legs: longLegs(triple, tasks),
    /** The first thing the session is told. The rest arrives leg by leg. */
    prompt: longLegs(triple, tasks)[0].prompt,
  }))
}

/**
 * One long cell, leg by leg, in one resumed session.
 *
 * The first leg starts the session with `--session-id`; every leg after resumes it, so there is one
 * transcript for the whole cell and the isolation check reads it once. A leg that produced no result
 * JSON ends the cell there: the rest of a session whose measurement has a hole in it is not a
 * session this report can put in a median.
 */
export async function runLongLegs({ legs, claude, model, arm, settingsFile, sessionId, cwd, env, budgetUsd }) {
  const parts = []
  for (const [index, leg] of legs.entries()) {
    const outcome = await runSession({
      claude,
      args: claudeArgs({
        prompt: leg.prompt,
        model,
        arm,
        settingsFile,
        sessionId,
        budgetUsd,
        resume: index > 0,
      }),
      cwd,
      env,
    })
    const result = readResult(outcome.stdout)
    parts.push({
      id: leg.id,
      kind: leg.kind,
      task: leg.task,
      sessionId,
      ms: outcome.ms,
      result,
      error: result
        ? null
        : outcome.killed
          ? `leg ${leg.id} timed out`
          : `leg ${leg.id}: no result JSON (exit ${outcome.code}): ${outcome.stderr.slice(-300)}`,
    })
    if (!result) break
  }
  return { sessionIds: [sessionId], parts }
}
