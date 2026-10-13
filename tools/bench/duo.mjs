import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DM_CHANNEL, dmTraffic, readDm } from './dm.mjs'
import { claudeArgs, readResult, runSession } from './session.mjs'

/**
 * The two-Employee shape of `pnpm bench:tokens` (T197): two long-lived sessions working one ticket
 * between them, talking through a real DM thread, terse against plain.
 *
 * T190 priced the terse voice at +12% tokens and +3% cost and said in its own limitations what that
 * number was: the cost of *carrying* the rule, on a session that writes no DM at all. The rule is
 * about the DMs, so the only way to find out whether it pays for itself is to make there be some.
 *
 * Both Employees are resumed sessions, as TinyCorp's are, and neither of them is told the bench
 * exists. The lead is woken with the ticket; every DM either of them posts wakes the other with a
 * prompt the app's own `inboxPrompt` shape, including the clause that names the voice for that one
 * message — in TinyCorp the engine decides the voice from where the message goes and the model is
 * never left to judge its own audience (T180), so here the arm decides it and the wake says it.
 *
 * What the arms differ by is one section of the system prompt and nothing else: `dm-plain` carries
 * How you write, `dm-terse` carries How you write and Between Employees. The roles, the ticket, the
 * chat server, the wake prompts' shape and the workspace are identical.
 */

/** Who is in a `duo` cell. Two names, because a DM needs somebody at each end. */
export const ROLES = {
  lead: { role: 'lead', name: 'Ada', what: 'holds the ticket' },
  helper: { role: 'helper', name: 'Vega', what: 'knows the codebase, and reviews' },
}

/** The other one. */
export function peerOf(role) {
  return role === 'lead' ? ROLES.helper : ROLES.lead
}

/**
 * How many wakes a cell may spend before it stops.
 *
 * Five is the exchange the ticket describes — a question, its answer, the change is ready, the
 * review, the reply to the review — and a ceiling rather than a target: a cell that says everything
 * in three stops in three. It is a cost guard as much as a protocol, because every wake is a real
 * session turn on the boss's subscription.
 */
export const DUO_MAX_DELIVERIES = 5

/** The tickets a `duo` run works, one cell per ticket and arm. */
export const DUO_TASKS = ['edit-comment']

/** The units of a duo run: the tickets themselves, shaped exactly as a solo run's are. */
export function duoUnits(tasks, ids = DUO_TASKS) {
  return ids.map((id) => {
    const one = tasks.find((task) => task.id === id)
    if (!one) throw new Error(`the duo round names no task ${id}`)
    return one
  })
}

/**
 * The clause every wake prompt carries, from `voiceHint` in `src/shared/colleague-voice.ts`: the
 * voice to answer *that one message* in. Word for word, because it is the mechanism being measured
 * and a paraphrase of it would be a measurement of something the app does not send.
 */
export const VOICE_HINT = {
  terse:
    'Colleague DM → reply terse: fragments, no filler; code, paths, numbers and error text exact, ' +
    'and full sentences for a warning, a destructive step or a question they must answer.',
  plain: 'The boss can read this → plain words, full sentences.',
}

/**
 * How a DM reaches the other Employee: the app's `inboxPrompt` for a DM, with no hint — the label,
 * who it is from and where, the message JSON-quoted so the prompt stays on one line, the voice for
 * the answer, and how to reply.
 */
export function wakePrompt({ from, message, voice }) {
  return (
    `[company] DM from ${from} in @${from}: ${JSON.stringify(message.text)} ` +
    `(message ${message.id}) ${VOICE_HINT[voice]} ` +
    `Reply through the company MCP server: chat_post to "@${from}", or thread_reply to message ${message.id}. ` +
    'Never answer in plain text.'
  )
}

/** What both Employees are told about how to talk, from `## How to reply` in the app's instructions. */
const HOW_TO_REPLY = [
  'Everything you say to a colleague goes through the Company MCP server: `chat_post` to a channel or DM,',
  '`thread_reply` to answer in a thread. Never answer in plain text: nobody reads your terminal.',
  '',
  'Each wake arrives as one prompt while you are idle: `[company] <kind> from <who> in <where>: "<text>"`,',
  'then the voice to write in and how to reply. Handle it, reply through MCP, end your turn; the next item',
  'comes after.',
].join('\n')

/**
 * Who this Employee is, appended after the arm's own text and identical in both arms.
 *
 * The lead is told to do two things with the colleague and no more, because an unbounded "coordinate
 * with Vega" is a different amount of chat per arm and the comparison would then be between two
 * protocols rather than two voices. The helper is told not to write files: two sessions in one
 * checkout that both edit it would race, and in TinyCorp a reviewer reads a worktree it does not own.
 */
export function rolePrompt(role, { task }) {
  const me = ROLES[role]
  const peer = peerOf(role)
  const who =
    role === 'lead'
      ? [
          `You are ${me.name}, an engineer at this Company, and this ticket is yours.`,
          '',
          `${peer.name} is a colleague. ${peer.name} wrote much of this app and reviews your change.`,
          `Do these two things with ${peer.name}, and nothing else:`,
          '',
          `1. Before you write code, DM ${peer.name} with what you need to know to place the change.`,
          `2. When the change is ready, DM ${peer.name} that it is, and what to look at.`,
          '',
          `Answer every DM ${peer.name} sends you. When the review is in and you have nothing left to ask, stop.`,
        ]
      : [
          `You are ${me.name}, an engineer at this Company. You know this codebase; you wrote much of it.`,
          '',
          `${peer.name} is working a ticket in this same checkout and will DM you. The ticket is not yours:`,
          'do not create, edit or delete a file, and do not run the app. You read the code and',
          `\`git --no-pager diff\`, you answer what ${peer.name} asks, and you review the change when`,
          `${peer.name} says it is ready.`,
          '',
          `The ticket ${peer.name} holds is: ${task.prompt}`,
        ]
  return [...who, '', HOW_TO_REPLY].join('\n')
}

/**
 * The chat server one Employee is started with: this repo's `dm-mcp.mjs`, under the name the app
 * uses, with who it is acting as in its environment.
 *
 * `process.execPath` rather than `node`, so the server runs under the same Node the bench does and
 * no `PATH` is consulted on any platform.
 */
export function duoMcpConfig({ me, peer, dmFile, here = import.meta.dirname }) {
  return {
    mcpServers: {
      company: {
        command: process.execPath,
        args: [join(here, 'dm-mcp.mjs')],
        env: { BENCH_DM_ME: me, BENCH_DM_PEER: peer, BENCH_DM_FILE: dmFile },
      },
    },
  }
}

/** The next DM nobody has been woken with yet, and where the cursor lands once it has been. */
export function nextDelivery(messages, cursor) {
  for (let index = cursor; index < messages.length; index += 1) {
    if (messages[index].channelId === DM_CHANNEL) return { message: messages[index], cursor: index + 1 }
  }
  return null
}

/**
 * One duo cell: the lead is woken with the ticket, and from then on every DM wakes whoever it was
 * sent to, until the thread goes quiet or the cell runs out of wakes.
 *
 * A leg that produced no result JSON ends the cell, for the same reason it does in a long cell: a
 * session with a hole in its measurement is not a session this report can put in a median.
 */
export async function runDuoCell({
  claude,
  model,
  arm,
  settingsFile,
  cwd,
  env,
  budgetUsd,
  dir,
  task,
  sessionIds,
  maxDeliveries = DUO_MAX_DELIVERIES,
}) {
  const dmFile = join(dir, 'dm.jsonl')
  writeFileSync(dmFile, '')
  const configs = Object.fromEntries(
    Object.keys(ROLES).map((role) => {
      const file = join(dir, `mcp-${role}.json`)
      const config = duoMcpConfig({ me: ROLES[role].name, peer: peerOf(role).name, dmFile })
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
      return [role, file]
    }),
  )
  const thread = () => (existsSync(dmFile) ? readDm(readFileSync(dmFile, 'utf8')) : [])

  const parts = []
  const started = new Set()
  const leg = async (role, prompt) => {
    const outcome = await runSession({
      claude,
      args: claudeArgs({
        prompt,
        model,
        arm,
        settingsFile,
        sessionId: sessionIds[role],
        budgetUsd,
        resume: started.has(role),
        extra: rolePrompt(role, { task }),
        mcpConfigFile: configs[role],
      }),
      cwd,
      env,
    })
    started.add(role)
    const result = readResult(outcome.stdout)
    const index = parts.filter((part) => part.role === role).length + 1
    parts.push({
      id: `${role}-${index}`,
      role,
      kind: index === 1 ? 'first' : 'wake',
      sessionId: sessionIds[role],
      ms: outcome.ms,
      result,
      error: result
        ? null
        : outcome.killed
          ? `${role} leg ${index} timed out`
          : `${role} leg ${index}: no result JSON (exit ${outcome.code}): ${outcome.stderr.slice(-300)}`,
    })
    return result
  }

  let deliveries = 0
  let ok = await leg('lead', task.prompt)
  let cursor = 0
  while (ok && deliveries < maxDeliveries) {
    const next = nextDelivery(thread(), cursor)
    if (!next) break
    cursor = next.cursor
    const to = next.message.author === ROLES.lead.name ? 'helper' : 'lead'
    ok = await leg(to, wakePrompt({ from: next.message.author, message: next.message, voice: arm.voice }))
    deliveries += 1
  }

  const messages = thread()
  return {
    sessionIds: Object.keys(ROLES).map((role) => sessionIds[role]),
    parts,
    dm: { ...dmTraffic(messages), deliveries, capped: deliveries >= maxDeliveries },
  }
}
