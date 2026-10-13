import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { armSystemPrompt, armText } from './arms.mjs'

/**
 * One cell of `pnpm bench:tokens` (T190): a real headless Claude Code session in a real workspace,
 * and everything that has to be true about it afterwards for its numbers to mean anything.
 *
 * The session is started with `--setting-sources project,local`, which leaves the boss's own
 * `~/.claude` behind — their plugins, their hooks, their skills, their CLAUDE.md. That flag is the
 * fix for the bug that made ponytail's first agentic benchmark measure nothing, and a flag is a
 * claim until something checks it, so {@link isolationBreaches} reads the transcript the session
 * wrote and fails the cell when it shows a hook the arm did not declare, a skill from a plugin, or
 * another arm's text in the system prompt.
 */

/**
 * The models the bench takes by name, each pinned to an id rather than an alias: an alias moves
 * when a new model ships, and a results file that says `sonnet` would then name two different
 * runs. A name that is not here is passed to the CLI as written, and the id the CLI actually
 * billed is read back off the result and recorded beside every cell.
 */
export const MODELS = {
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-4-5-20251001',
}

/** How long one cell may take before it is killed and recorded as a timeout. */
export const CELL_TIMEOUT_MS = 900_000

/**
 * `RTK_DB_PATH` and RTK's telemetry switch, the same two the app sets on a hooked Session. The
 * ping stays off here for the reason it stays off there: reading a number is not consent to send
 * one, and a benchmark is even less of a person who was asked.
 */
const RTK_DB_ENV = 'RTK_DB_PATH'
const RTK_TELEMETRY_ENV = 'RTK_TELEMETRY_DISABLED'

/**
 * A command on `PATH`, resolved the way `src/main/platform/cli-command.ts` resolves a Provider's
 * CLI: every `PATH` entry crossed with every `PATHEXT` suffix, so `rtk` finds `rtk.exe` and
 * `claude` finds `claude.cmd` on Windows without a shell anywhere in the line.
 */
export function resolveCli(command, env = process.env, platform = process.platform) {
  if (command.includes('/') || command.includes('\\')) return existsSync(command) ? resolve(command) : null
  const dirs = (env['PATH'] ?? '').split(delimiter).filter(Boolean)
  const exts = platform === 'win32' ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext)
      try {
        if (!statSync(candidate).isFile()) continue
        if (platform !== 'win32') accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // Not there, or not runnable. Try the next one.
      }
    }
  }
  return null
}

/**
 * The arguments one leg of a cell starts `claude` with.
 *
 * - `--setting-sources project,local` is the isolation: the boss's own settings, hooks, plugins
 *   and skills are not loaded, and a fresh workspace has no project or local settings of its own,
 *   so the only settings in the session are the arm's.
 * - `--settings <file>` is additional to those sources rather than one of them, which is how the
 *   RTK arms get their hook without a `.claude/settings.json` appearing in the measured diff.
 * - `--strict-mcp-config` leaves the session the MCP servers of `--mcp-config` and no others; with
 *   no `--mcp-config` beside it, which is every mode but `duo`, it leaves the session none at all.
 * - `--session-id` is how the transcript is found afterwards without guessing, and `--resume` is
 *   how a second leg is the same session rather than a second one: one id, one transcript, one
 *   Employee carrying the conversation (T197).
 * - `--max-budget-usd` is the per-leg half of the cost guard: a leg that runs away stops.
 *
 * `extra` is appended after the arm's own text, never mixed into it, so the arm's system prompt is
 * still one contiguous string the isolation check can find whole.
 */
export function claudeArgs({
  prompt,
  model,
  arm,
  settingsFile,
  sessionId,
  budgetUsd,
  resume = false,
  extra = null,
  mcpConfigFile = null,
}) {
  const args = [
    '-p',
    prompt,
    '--model',
    MODELS[model] ?? model,
    '--output-format',
    'json',
    '--permission-mode',
    'bypassPermissions',
    '--setting-sources',
    'project,local',
    '--strict-mcp-config',
    resume ? '--resume' : '--session-id',
    sessionId,
    '--append-system-prompt',
    extra ? `${armSystemPrompt(arm)}\n\n${extra}` : armSystemPrompt(arm),
  ]
  if (settingsFile) args.push('--settings', settingsFile)
  if (mcpConfigFile) args.push('--mcp-config', mcpConfigFile)
  if (budgetUsd) args.push('--max-budget-usd', String(budgetUsd))
  return args
}

/**
 * The environment a cell runs in.
 *
 * `ANTHROPIC_API_KEY` is stripped rather than trusted to be absent: the bench spends the boss's
 * subscription, and a key inherited from a shell would quietly bill an account instead. The CLI is
 * refused outright when one is set (see `plan.mjs`); this is the second lock on the same door.
 */
export function cellEnv({ rtkDbPath = null, env = process.env } = {}) {
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _token, ...rest } = env
  if (!rtkDbPath) return rest
  return { ...rest, [RTK_DB_ENV]: rtkDbPath, [RTK_TELEMETRY_ENV]: '1' }
}

/**
 * Runs one session to its end, or kills it at {@link CELL_TIMEOUT_MS}.
 *
 * stdout goes nowhere but a buffer we own and stderr likewise, and the child is put in its own
 * process group so a kill takes the agent's own children with it and nothing else — never a
 * blanket kill, which would take down the session running the bench.
 */
export function runSession({ claude, args, cwd, env, timeout = CELL_TIMEOUT_MS }) {
  return new Promise((done) => {
    const started = Date.now()
    const child = spawn(claude, args, { cwd, env, detached: process.platform !== 'win32' })
    let out = ''
    let err = ''
    let killed = false
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    const alarm = setTimeout(() => {
      killed = true
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
        else process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, timeout)
    child.on('close', (code) => {
      clearTimeout(alarm)
      done({ code, killed, ms: Date.now() - started, stdout: out, stderr: err.slice(-4000) })
    })
    child.on('error', (error) => {
      clearTimeout(alarm)
      done({ code: null, killed, ms: Date.now() - started, stdout: out, stderr: String(error) })
    })
  })
}

/**
 * The one number set this bench reports, read off the CLI's own result JSON.
 *
 * Cache reads are kept apart from fresh input rather than added into it: they are most of the
 * tokens a session moves and a fraction of its price, so a total that hides them makes a longer
 * system prompt look far more expensive than it is, and a cost that hides them makes it look free.
 */
export function readResult(stdout) {
  let json
  try {
    json = JSON.parse(stdout)
  } catch {
    return null
  }
  const usage = json.usage ?? {}
  const model = Object.keys(json.modelUsage ?? {})[0] ?? null
  return {
    ok: json.is_error === false && json.subtype === 'success',
    subtype: json.subtype ?? null,
    sessionId: json.session_id ?? null,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    costUsd: json.total_cost_usd ?? null,
    turns: json.num_turns ?? null,
    apiMs: json.duration_api_ms ?? null,
    permissionDenials: (json.permission_denials ?? []).length,
  }
}

/** Every token the session moved, cache included. The honest denominator for "how much did it read". */
export function totalTokens(result) {
  return result.inputTokens + result.outputTokens + result.cacheReadTokens + result.cacheWriteTokens
}

/**
 * Several legs of one cell, added up into the one result the report reads (T197).
 *
 * A cell is a unit of work, not a process: a long cell is six resumed legs and a duo cell is two
 * Employees woken a few times each, and what either of them cost is the sum. Turns add, time adds,
 * cost adds; `ok` holds only when every leg was ok, and the model id is the one they all ran on.
 * Null for nothing at all, which is how a cell whose first leg failed stays out of every median.
 */
export function sumResults(results) {
  const ran = results.filter(Boolean)
  if (ran.length === 0) return null
  const sum = (read) => ran.reduce((total, one) => total + (read(one) ?? 0), 0)
  return {
    ok: ran.length === results.length && ran.every((one) => one.ok),
    subtype: ran.find((one) => !one.ok)?.subtype ?? ran[0].subtype,
    sessionId: ran[0].sessionId,
    model: ran[0].model,
    inputTokens: sum((one) => one.inputTokens),
    outputTokens: sum((one) => one.outputTokens),
    cacheReadTokens: sum((one) => one.cacheReadTokens),
    cacheWriteTokens: sum((one) => one.cacheWriteTokens),
    costUsd: ran.every((one) => one.costUsd === null) ? null : sum((one) => one.costUsd),
    turns: sum((one) => one.turns),
    apiMs: sum((one) => one.apiMs),
    permissionDenials: sum((one) => one.permissionDenials),
  }
}

/** Where Claude Code keeps its transcripts. */
export function projectsDir(config = join(homedir(), '.claude')) {
  return join(config, 'projects')
}

/**
 * The transcript this session wrote, found by session id.
 *
 * The folder is named after the working directory, but after the platform's own realpath and with
 * a punctuation rule of Claude Code's own, so it is scanned for rather than spelled out: a rule
 * guessed here and changed there would silently turn the isolation check off, which is the one
 * thing this file exists to prevent.
 */
export function findTranscript(sessionId, config) {
  const root = projectsDir(config)
  if (!existsSync(root)) return null
  for (const dir of readdirSync(root)) {
    const candidate = join(root, dir, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** A transcript, read as the records it is. Unparseable lines are dropped, never guessed at. */
export function readTranscript(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const records = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // A half-written last line while the CLI was still flushing.
    }
  }
  return records
}

/** Every hook that fired in this session, by the name the transcript gives it. */
export function hooksFired(records) {
  const names = new Set()
  for (const record of records) {
    const attachment = record.attachment
    if (!attachment || !String(attachment.type ?? '').startsWith('hook_')) continue
    names.add(attachment.hookName ?? attachment.hookEvent ?? 'unknown')
  }
  return [...names].sort()
}

/** The skills this session was offered, by name. A plugin's skill is `plugin:skill`. */
export function skillsOffered(records) {
  const names = new Set()
  for (const record of records) {
    if (record.attachment?.type !== 'skill_listing') continue
    for (const line of String(record.attachment.content ?? '').split('\n')) {
      const found = /^-\s+([\w:-]+):/.exec(line)
      if (found) names.add(found[1])
    }
  }
  return [...names].sort()
}

/**
 * The MCP servers this session actually reached, by the name the tool call carries:
 * `mcp__company__chat_post` is the `company` server. A server nobody called does not appear, which
 * is the right answer — what matters is what the session used, not what it was offered.
 */
export function mcpServersUsed(records) {
  const names = new Set()
  for (const record of records) {
    const content = record.message?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const found = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(String(part?.name ?? ''))
      if (part?.type === 'tool_use' && found) names.add(found[1])
    }
  }
  return [...names].sort()
}

/** The system prompt the session actually ran with, as it recorded it. */
export function systemPrompt(records) {
  for (const record of records) {
    if (record.attachment?.type !== 'prompt_snapshot') continue
    const parts = record.attachment.systemPrompt
    if (Array.isArray(parts)) return parts.join('\n')
    if (typeof parts === 'string') return parts
  }
  return null
}

/**
 * What is wrong with this cell's isolation, in sentences, or an empty list when it is clean.
 *
 * Four questions, and each one is a way the ponytail bug comes back:
 *
 * 1. **A hook the arm did not declare.** This is the bug itself — a `SessionStart` hook from an
 *    installed plugin firing on the baseline, so the baseline was running the thing under test.
 * 2. **A skill from a plugin.** `--setting-sources project,local` should leave every one of the
 *    boss's installed plugins behind; a namespaced skill in the listing says it did not.
 * 3. **Another arm's text in the system prompt.** Prepending is done by us, so this only fails when
 *    the harness itself crosses two arms — which is worth catching before eighty cells, not after.
 *    An arm built on another one carries that one's text on purpose, and says so with `builtOn`.
 * 4. **An MCP server the arm does not declare.** Only a `duo` cell has one at all, and a session
 *    that reached anything else read a tool the arm it is being compared against did not have.
 * 5. **No transcript at all.** Then none of the questions above was asked, and a cell whose
 *    isolation was never checked is not a cell whose isolation passed.
 */
export function isolationBreaches({ arm, records, others = [] }) {
  if (!records) return ['no transcript was written, so this cell’s isolation could not be checked']
  const bad = []
  const declared = new Set(arm.declares)
  for (const name of hooksFired(records)) {
    if (!declared.has(name)) bad.push(`hook ${name} fired, which arm ${arm.id} does not declare`)
  }
  for (const skill of skillsOffered(records)) {
    if (skill.includes(':')) bad.push(`skill ${skill} came from a plugin, which no arm declares`)
  }
  const servers = new Set(arm.mcp ?? [])
  for (const name of mcpServersUsed(records)) {
    if (!servers.has(name)) bad.push(`MCP server ${name} was called, which arm ${arm.id} does not declare`)
  }
  const prompt = systemPrompt(records)
  if (prompt === null) {
    bad.push('the transcript recorded no system prompt, so the arm’s text could not be confirmed')
  } else {
    const mine = armSystemPrompt(arm)
    if (!prompt.includes(mine)) bad.push(`arm ${arm.id}'s own text is not in the system prompt it ran with`)
    const ours = armText(arm)
    for (const other of others) {
      if (other.id === arm.id) continue
      const text = armText(other)
      // An arm may carry another arm's text on purpose: `ponytail` and `rtk+ponytail` differ by the
      // hook alone, `dm-terse` is `dm-plain` plus one section, and both DM arms carry the app's
      // humanizer. Where one text is inside another, finding it proves nothing either way — so what
      // is checked is what could be evidence: a text this arm's own does not already contain.
      if (!text || ours?.includes(text)) continue
      if (prompt.includes(text)) bad.push(`arm ${other.id}'s text is in arm ${arm.id}'s system prompt`)
    }
  }
  return bad
}

/**
 * What RTK says it filtered out of this one cell, against this cell's own history file.
 *
 * Its own file per cell, so the number is this session's and not the machine's. Null is an answer
 * and the report prints it as one: an RTK that could not be read is not an RTK that saved nothing.
 */
export function rtkGain(rtkPath, dbPath) {
  if (!rtkPath || !existsSync(dbPath)) return null
  const out = spawnSync(rtkPath, ['gain', '--format', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, [RTK_DB_ENV]: dbPath, [RTK_TELEMETRY_ENV]: '1' },
  })
  if (out.status !== 0) return null
  return parseRtkGain(out.stdout)
}

/** `rtk gain --format json`, read. Anything that is not that JSON is null, never a guessed zero. */
export function parseRtkGain(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const summary = json?.summary
  if (!summary || typeof summary.total_input !== 'number') return null
  return {
    commands: summary.total_commands ?? 0,
    inputTokens: Math.round(summary.total_input),
    outputTokens: Math.round(summary.total_output ?? 0),
    savedTokens: Math.round(summary.total_saved ?? 0),
    cutPercent: Math.round((summary.avg_savings_pct ?? 0) * 10) / 10,
  }
}
