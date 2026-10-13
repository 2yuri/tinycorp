import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DM_CHANNEL, dmRecord, dmTraffic, readDm } from './dm.mjs'
import { duoMcpConfig, VOICE_HINT } from './duo.mjs'
import { claudeArgs, readResult, runSession } from './session.mjs'

/**
 * The boss's side of a conversation, as `pnpm bench:tokens --mode boss` measures it (T261).
 *
 * **Why a mode of its own rather than `duo`.** The shape is the measurement, and Caveman's shape is
 * Employee → boss. A `duo` cell has two Employees and no boss in it, so every message in its
 * transcript is a colleague message, which is the one place this add-on is *forbidden* to reach:
 * measuring it there would price a rule on the messages it explicitly does not govern, which is the
 * mistake T197 exists to have stopped making. Isolating boss-facing messages inside a `duo` cell is
 * not possible either, because there are none. So `boss` is `duo`'s machinery with the other end of
 * the thread replaced: one Employee, and a boss whose every line is a fixed string.
 *
 * **The boss is scripted on purpose.** A model playing the boss would reply differently to a
 * fragment than to a paragraph, and the arms would then differ by their own input as well as by the
 * section under test. Every cell of every arm is asked the same questions, in the same order, in the
 * same words, so the only thing that moves between arms is what the Employee writes back.
 *
 * **What it measures.** The session's own tokens and cost, as every mode does; the prose the
 * Employee actually sent the boss, which is what the add-on is a claim about; and whether the
 * answers still carried the facts the boss asked for ({@link QUESTIONS}), which is the number that
 * stops a saving from being bought with an answer that says nothing.
 */

/** Who is in a `boss` cell. The boss is a name, not a session: nothing here starts a second agent. */
export const BOSS_NAME = 'boss'
export const EMPLOYEE_NAME = 'Ada'

/** The ticket a `boss` run works, one cell per arm. The same one `duo` uses, for the same reason. */
export const BOSS_TASKS = ['edit-comment']

/** The units of a boss run: the tickets themselves, shaped exactly as a solo run's are. */
export function bossUnits(tasks, ids = BOSS_TASKS) {
  return ids.map((id) => {
    const one = tasks.find((task) => task.id === id)
    if (!one) throw new Error(`the boss round names no task ${id}`)
    return one
  })
}

/**
 * What the boss asks, in order, one per message the Employee sends — and what each answer has to
 * carry to count as right.
 *
 * `wants` is a keyword check and never a judge: a regex over the Employee's reply, named so the
 * report can say which fact went missing rather than only that one did. They are deliberately the
 * three things this add-on must never shorten — a path, a count, and a straight yes or no — because
 * an arm that saves tokens by dropping those has not saved anything, and this column is the only
 * thing in the run that would notice.
 */
export const QUESTIONS = [
  {
    id: 'files',
    text: 'Which files are you changing? Give me the paths.',
    wants: [{ what: 'a file path', pattern: /[\w@./-]+\.(?:tsx?|jsx?|css|json)\b/ }],
  },
  {
    id: 'tests',
    text: 'Did the suite pass, and how many tests ran?',
    wants: [
      { what: 'a number of tests', pattern: /\d/ },
      { what: 'whether it passed', pattern: /pass|fail|green|red|✓|✗/i },
    ],
  },
  {
    id: 'blocked',
    text: 'Anything you need from me before I close this out?',
    wants: [],
  },
]

/**
 * How a boss message reaches the Employee: the app's `inboxPrompt` for a DM, with the voice clause
 * `voiceHint` really sends for anything the boss can read — word for word, and the same in both
 * arms, because it is the clause the add-on's own section has to settle (T261).
 */
export function bossWakePrompt(message) {
  return (
    `[company] DM from ${BOSS_NAME} in @${BOSS_NAME}: ${JSON.stringify(message.text)} ` +
    `(message ${message.id}) ${VOICE_HINT.plain} ` +
    `Reply through the company MCP server: chat_post to "@${BOSS_NAME}", or thread_reply to message ` +
    `${message.id}. Never answer in plain text.`
  )
}

/** What both Employees are told about how to talk, from `## How to reply` in the app's instructions. */
const HOW_TO_REPLY = [
  'Everything you say to the boss goes through the Company MCP server: `chat_post` to a channel or DM,',
  '`thread_reply` to answer in a thread. Never answer in plain text: nobody reads your terminal.',
  '',
  'Each wake arrives as one prompt while you are idle: `[company] <kind> from <who> in <where>: "<text>"`,',
  'then the voice to write in and how to reply. Handle it, reply through MCP, end your turn; the next item',
  'comes after.',
].join('\n')

/**
 * Who this Employee is, appended after the arm's own text and identical in both arms.
 *
 * It is told to report twice and to answer what it is asked, for the reason `duo`'s lead is told
 * the same: an unbounded "keep the boss posted" is a different number of messages per arm, and the
 * comparison would then be between two protocols rather than between two voices.
 *
 * It names no ticket, where `duo`'s helper prompt does: there the colleague never receives the
 * ticket and has to be told it, and here the one Employee is woken with it as its first prompt.
 * Repeating it in the system prompt would be the same bytes in both arms and a lie about what the
 * app sends.
 */
export function bossRolePrompt() {
  return [
    `You are ${EMPLOYEE_NAME}, an engineer at this Company, and this ticket is yours.`,
    '',
    `The boss is the person who gave it to you. Do these two things with them, and nothing else:`,
    '',
    `1. Before you write code, DM the boss with what you are about to do.`,
    `2. When the change is ready, DM the boss that it is, and what you changed.`,
    '',
    'Answer every DM the boss sends you. When they have nothing left to ask, stop.',
    '',
    HOW_TO_REPLY,
  ].join('\n')
}

/** The next message from the Employee nobody has answered yet, and where the cursor lands. */
export function nextAsk(messages, cursor) {
  for (let index = cursor; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.channelId === DM_CHANNEL && message.author === EMPLOYEE_NAME) {
      return { message, cursor: index + 1 }
    }
  }
  return null
}

/**
 * Whether the boss got what they asked for: every question that was put, and whether the reply it
 * drew carried each fact.
 *
 * A question nobody answered counts as wrong rather than as absent, which is the whole point: an
 * arm that answers less is not allowed to score better by being asked less.
 */
export function answersRight(asked) {
  const checks = asked.flatMap((one) =>
    one.question.wants.map((want) => ({
      question: one.question.id,
      what: want.what,
      held: typeof one.answer === 'string' && want.pattern.test(one.answer),
    })),
  )
  return {
    asked: asked.length,
    checks: checks.length,
    held: checks.filter((one) => one.held).length,
    missing: checks.filter((one) => !one.held).map((one) => `${one.question}: ${one.what}`),
  }
}

/**
 * One boss cell: the Employee is woken with the ticket, and from then on every message it sends the
 * boss draws the next scripted question, which wakes it again — until the questions run out or it
 * stops writing.
 *
 * A leg that produced no result JSON ends the cell, for the same reason it does in a duo cell: a
 * session with a hole in its measurement is not one this report can put in a median.
 */
export async function runBossCell({
  claude,
  model,
  arm,
  settingsFile,
  cwd,
  env,
  budgetUsd,
  dir,
  task,
  sessionId,
  questions = QUESTIONS,
}) {
  const dmFile = join(dir, 'dm.jsonl')
  writeFileSync(dmFile, '')
  const mcpConfigFile = join(dir, 'mcp-employee.json')
  writeFileSync(
    mcpConfigFile,
    `${JSON.stringify(duoMcpConfig({ me: EMPLOYEE_NAME, peer: BOSS_NAME, dmFile }), null, 2)}\n`,
  )
  const thread = () => (existsSync(dmFile) ? readDm(readFileSync(dmFile, 'utf8')) : [])

  const parts = []
  let started = false
  const leg = async (prompt) => {
    const outcome = await runSession({
      claude,
      args: claudeArgs({
        prompt,
        model,
        arm,
        settingsFile,
        sessionId,
        budgetUsd,
        resume: started,
        extra: bossRolePrompt(),
        mcpConfigFile,
      }),
      cwd,
      env,
    })
    started = true
    const result = readResult(outcome.stdout)
    const index = parts.length + 1
    parts.push({
      id: `employee-${index}`,
      role: 'employee',
      kind: index === 1 ? 'first' : 'wake',
      sessionId,
      ms: outcome.ms,
      result,
      error: result
        ? null
        : outcome.killed
          ? `leg ${index} timed out`
          : `leg ${index}: no result JSON (exit ${outcome.code}): ${outcome.stderr.slice(-300)}`,
    })
    return result
  }

  /**
   * The boss's own line, appended to the same thread the Employee reads and writes through its own
   * MCP server. One writer at a time, always: the Employee's session has ended its turn by the time
   * this runs.
   */
  const bossSays = (text) => {
    const record = dmRecord({ id: thread().length + 1, author: BOSS_NAME, channelId: DM_CHANNEL, text })
    appendFileSync(dmFile, `${JSON.stringify(record)}\n`)
    return record
  }

  const asked = []
  let ok = await leg(task.prompt)
  // Did it write to the boss at all? An Employee that never did is asked nothing, and the cell
  // says so in `deliveries` rather than in a median built out of questions nobody heard.
  let wrote = nextAsk(thread(), 0)
  let cursor = wrote?.cursor ?? 0
  for (const question of questions) {
    if (!ok || !wrote) break
    ok = await leg(bossWakePrompt(bossSays(question.text)))
    wrote = nextAsk(thread(), cursor)
    if (wrote) cursor = wrote.cursor
    // A question that drew no reply is recorded with a null answer, which counts as wrong: an arm
    // may not score better by answering less.
    asked.push({ question, answer: wrote?.message.text ?? null })
  }

  const messages = thread()
  return {
    sessionIds: [sessionId],
    parts,
    dm: {
      ...dmTraffic(messages.filter((one) => one.author === EMPLOYEE_NAME)),
      deliveries: asked.length,
      capped: asked.length >= questions.length,
    },
    answers: answersRight(asked),
  }
}
