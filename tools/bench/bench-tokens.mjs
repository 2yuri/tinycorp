import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARMS, armSettings } from './arms.mjs'
import { runBossCell } from './boss.mjs'
import { runDuoCell } from './duo.mjs'
import {
  BENCH_TMP,
  diffStat,
  fixtureOf,
  installFingerprint,
  makeWorkspace,
  prepareFixture,
  runFixtureTests,
} from './fixture.mjs'
import { runLongLegs } from './long.mjs'
import {
  chosenArms,
  chosenTasks,
  estimate,
  modeOf,
  overBudget,
  parseArgs,
  planCells,
  RESULTS_DIR,
  readTasks,
  refusal,
  resultsName,
  runDate,
  unitsOf,
} from './plan.mjs'
import { renderReport } from './report.mjs'
import {
  cellEnv,
  claudeArgs,
  findTranscript,
  isolationBreaches,
  readResult,
  readTranscript,
  resolveCli,
  rtkGain,
  runSession,
  sumResults,
  totalTokens,
} from './session.mjs'

/**
 * `pnpm bench:tokens` (T190): what RTK, the terse voice and the ponytail ladder actually cost or
 * save, measured before anything claims either.
 *
 * ```
 * pnpm bench:tokens --dry-run                 # the plan and what it will spend
 * pnpm bench:tokens --yes --n 2               # a real run, Sonnet, every arm
 * pnpm bench:tokens --yes --arms baseline,rtk --tasks csv-export --n 1
 * pnpm bench:tokens --mode long --yes --n 3 --budget 20   # RTK on a session that runs commands
 * pnpm bench:tokens --mode duo  --yes --n 3 --budget 12   # the terse voice on real DMs
 * ```
 *
 * It spends the boss's subscription, one fresh Claude Code session per cell, and writes a results
 * file and the raw JSONL beside it. `docs/bench-tokens.md` is the guide; the rules it holds to are
 * in `report.mjs` (a median and an IQR, and a loss is never rounded into a win) and in
 * `session.mjs` (a cell whose isolation was not checked is not a cell that passed).
 */

const BUDGET_PER_CELL_USD = 3

function say(text) {
  process.stdout.write(`${text}\n`)
}

function versionOf(path, args = ['--version']) {
  if (!path) return null
  const out = spawnSync(path, args, { encoding: 'utf8' })
  return out.status === 0 ? out.stdout.trim().split('\n')[0] : null
}

/**
 * The one shape of a cell that was the whole of T190: one session, one ticket, cold.
 *
 * It is written as a runner beside the other two rather than inlined, so all three modes hand back
 * the same thing — the sessions they started and a part per `claude` process — and everything after
 * them, the diff, the suite, `rtk gain` and the isolation checks, is one path and not three.
 */
async function runSolo({ cell, claude, model, settingsFile, sessionId, cwd, env, budgetUsd }) {
  const outcome = await runSession({
    claude,
    args: claudeArgs({ prompt: cell.task.prompt, model, arm: cell.arm, settingsFile, sessionId, budgetUsd }),
    cwd,
    env,
  })
  const result = readResult(outcome.stdout)
  return {
    sessionIds: [sessionId],
    parts: [
      {
        id: 'only',
        kind: 'ticket',
        task: cell.task.id,
        sessionId,
        ms: outcome.ms,
        result,
        error: result
          ? null
          : outcome.killed
            ? 'timed out'
            : `no result JSON (exit ${outcome.code}): ${outcome.stderr.slice(-300)}`,
      },
    ],
  }
}

/**
 * One cell, start to finish: a fresh workspace, the sessions its mode calls for, then every
 * measurement taken off what they left behind. It never throws; a cell that failed is a row in the
 * report, not the end of a run that has already spent an hour.
 *
 * A cell is a unit of work and not a process (T197): `solo` is one session, `long` is one session
 * resumed through six legs, `duo` is two Employees woken a few times each. What is measured is the
 * same either way — the sum over its legs, and the one workspace they all worked in.
 */
async function runCell({ cell, mode, fixture, claude, rtkPath, model, dir, keep }) {
  const work = join(dir, 'work')
  const settings = armSettings(cell.arm, { rtkPath })
  const settingsFile = settings ? join(dir, 'settings.json') : null
  const dbPath = join(dir, 'rtk.db')
  const measured = {
    id: cell.id,
    mode: mode.id,
    task: cell.task.id,
    arm: cell.arm.id,
    run: cell.run,
    sessionId: null,
    sessionIds: [],
    ms: 0,
    result: null,
    tokensTotal: null,
    parts: [],
    dm: null,
    answers: null,
    diff: null,
    tests: null,
    rtk: null,
    breaches: [],
    error: null,
  }
  try {
    makeWorkspace(fixture, work)
    if (settingsFile) writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`)
    const before = installFingerprint(fixture)
    const shared = {
      claude,
      model,
      arm: cell.arm,
      settingsFile,
      cwd: work,
      env: cellEnv({ rtkDbPath: cell.arm.rtk ? dbPath : null }),
      budgetUsd: BUDGET_PER_CELL_USD,
    }
    const ran =
      mode.id === 'long'
        ? await runLongLegs({ ...shared, legs: cell.task.legs, sessionId: randomUUID() })
        : mode.id === 'duo'
          ? await runDuoCell({
              ...shared,
              dir,
              task: cell.task,
              sessionIds: { lead: randomUUID(), helper: randomUUID() },
            })
          : mode.id === 'boss'
            ? await runBossCell({ ...shared, dir, task: cell.task, sessionId: randomUUID() })
            : await runSolo({ ...shared, cell, sessionId: randomUUID() })
    measured.sessionIds = ran.sessionIds
    measured.sessionId = ran.sessionIds[0] ?? null
    measured.parts = ran.parts.map((part) => ({
      ...part,
      tokensTotal: part.result ? totalTokens(part.result) : null,
    }))
    measured.dm = ran.dm ?? null
    measured.answers = ran.answers ?? null
    measured.ms = measured.parts.reduce((total, part) => total + part.ms, 0)
    measured.error = measured.parts.find((part) => part.error)?.error ?? null
    // Every leg or nothing: a cell one of whose legs was never measured is not a cell whose total
    // can be added up, and a partial sum in a median is worse than a missing row.
    const results = measured.parts.map((part) => part.result)
    measured.result = results.some((one) => !one) ? null : sumResults(results)
    if (measured.result) measured.tokensTotal = totalTokens(measured.result)
    measured.diff = diffStat(work)
    measured.tests = runFixtureTests(fixture, work)
    if (cell.arm.rtk) measured.rtk = rtkGain(rtkPath, dbPath)
    measured.breaches = cellBreaches(measured, cell.arm)
    // The one thing a cell shares with the next one is the installed `node_modules` it links to.
    if (installFingerprint(fixture) !== before) {
      measured.breaches.push('this cell changed the shared node_modules; every cell after it is suspect')
    }
  } catch (error) {
    measured.error = String(error?.message ?? error)
  }
  if (!keep) rmSync(work, { recursive: true, force: true })
  return measured
}

/**
 * Every session of one cell, checked against its own transcript. Two Employees are two transcripts,
 * and a breach in one of them is named with the Employee it belongs to — a run that says only
 * "a hook fired" leaves somebody grepping eighty files for which session it was.
 */
function cellBreaches(measured, arm) {
  const bad = []
  for (const sessionId of measured.sessionIds) {
    const transcript = findTranscript(sessionId)
    const who = measured.parts.find((part) => part.sessionId === sessionId)?.role
    for (const line of isolationBreaches({
      arm,
      records: transcript ? readTranscript(transcript) : null,
      others: ARMS,
    })) {
      bad.push(who && measured.sessionIds.length > 1 ? `${who}: ${line}` : line)
    }
  }
  return bad
}

/** Runs `cells` `workers` at a time, reporting each as it lands. Order out matches order in. */
async function runPool(cells, workers, run) {
  const done = new Array(cells.length)
  let next = 0
  const worker = async () => {
    while (next < cells.length) {
      const index = next++
      done[index] = await run(cells[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, cells.length) }, worker))
  return done
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.rescore) return rescore(options, argv)
  const mode = modeOf(options.mode)
  const fixture = fixtureOf(options.fixture)
  const arms = chosenArms(options.arms, mode)
  const tasks = chosenTasks(unitsOf(mode, readTasks()), options.tasks)
  const cells = planCells({ tasks, arms, n: options.n })
  const guess = estimate(cells, mode)

  const no = refusal(options)
  const claude = resolveCli('claude')
  const rtkPath = resolveCli('rtk')

  say(`mode      ${mode.id} — ${mode.what}`)
  say(`fixture   ${fixture.name} @ ${fixture.commit.slice(0, 12)}`)
  say(`model     ${options.model}`)
  say(`arms      ${arms.map((arm) => arm.id).join(', ')}`)
  say(`${mode.unit.padEnd(9)} ${tasks.map((task) => task.id).join(', ')}`)
  say(`cells     ${guess.cells} (${tasks.length} × ${arms.length} × n=${options.n}), ${options.workers} at a time`)
  say(
    `estimate  ~${(guess.tokens / 1_000_000).toFixed(1)}M tokens, ~$${guess.costUsd.toFixed(2)} of subscription usage`,
  )
  say(`          (~$${mode.costPerCellUsd.toFixed(2)} a cell, a guess from this bench's own results files)`)
  say(
    `budget    ${options.budgetUsd ? `$${options.budgetUsd.toFixed(2)}, and it stops rather than passing it` : 'no cap on the run; pass --budget <usd> for one'}`,
  )
  say(`claude    ${claude ?? 'NOT FOUND on PATH'}`)
  say(`rtk       ${rtkPath ?? 'NOT FOUND on PATH'}`)
  for (const arm of arms) say(`  ${arm.id.padEnd(13)} ${arm.what}`)

  if (no) {
    say('')
    say(no)
    return options.dryRun ? 0 : 1
  }
  if (options.dryRun) {
    say('')
    say('Dry run: nothing was spent. Add --yes to run it.')
    return 0
  }
  if (!claude) {
    say('claude is not on PATH.')
    return 1
  }
  if (arms.some((arm) => arm.rtk) && !rtkPath) {
    say('An arm needs rtk and it is not on PATH. Install it, or run with --arms without the rtk ones.')
    return 1
  }

  say('')
  const prepared = prepareFixture(fixture, { onStep: (step) => say(`prepare   ${step}`) })
  // A red fixture makes the per-cell `tests green` column meaningless, and finding that out after
  // eighty sessions costs the whole run. It is the last free question, so it is asked first.
  say('prepare   running the fixture’s own suite once, before anything is spent')
  const green = runFixtureTests(fixture, prepared)
  if (!green.passed) {
    say(`The fixture's own tests are red before any agent touched it:\n${green.output.slice(-1500)}`)
    return 1
  }

  const stamp = new Date()
  const runDir = join(BENCH_TMP, 'runs', stamp.toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runDir, { recursive: true })
  const jsonl = join(runDir, 'cells.jsonl')
  say(`workspaces ${runDir}`)
  say('')

  let spentUsd = 0
  let stopped = null
  const measured = (
    await runPool(cells, options.workers, async (cell, index) => {
      const over = overBudget({ budgetUsd: options.budgetUsd, spentUsd, nextUsd: mode.costPerCellUsd })
      if (over) {
        stopped = over
        return null
      }
      const dir = join(runDir, cell.id)
      mkdirSync(dir, { recursive: true })
      const one = await runCell({ cell, mode, fixture, claude, rtkPath, model: options.model, dir, keep: options.keep })
      spentUsd += one.result?.costUsd ?? 0
      appendFileSync(jsonl, `${JSON.stringify(one)}\n`)
      const head = `[${String(index + 1).padStart(3)}/${cells.length}] ${cell.id}`
      const body = one.result
        ? `${(one.tokensTotal / 1000).toFixed(0)}K tok, $${one.result.costUsd?.toFixed(3)}, ${(one.ms / 1000).toFixed(0)}s, ${one.parts.length} leg(s), +${one.diff?.added ?? '?'} lines, tests ${one.tests?.passed ? 'green' : 'red'}${one.dm ? `, ${one.dm.messages} DM(s)` : ''}`
        : `FAILED: ${one.error}`
      say(
        `${head}  ${body}${one.breaches.length ? `  ⚠ ${one.breaches.length} isolation breach(es)` : ''}  [$${spentUsd.toFixed(2)} so far]`,
      )
      return one
    })
  ).filter(Boolean)
  if (stopped) say(`\nstopped   ${stopped} ${cells.length - measured.length} cell(s) were not run.`)

  const out = write({
    options,
    mode,
    fixture,
    cells: measured,
    arms,
    tasks,
    date: stamp,
    jsonl,
    command: `pnpm bench:tokens ${argv.join(' ')}`,
    claude,
    rtkPath,
    stopped,
  })
  say('')
  say(`report    ${out}`)
  return 0
}

/**
 * One cell as the committed JSONL keeps it.
 *
 * The only thing dropped is a *green* suite's own output: the run folder keeps every byte, and
 * eighty copies of a passing vitest summary is a third of a megabyte of nothing anyone will read.
 * A red one is kept in full, because that is the row someone will come back to.
 */
function published(cell) {
  if (!cell.tests?.passed) return cell
  return { ...cell, tests: { ...cell.tests, output: '' } }
}

/** The results file and the raw JSONL beside it. The one path both a run and a rescore take. */
function write({ options, mode, fixture, cells, arms, tasks, date, jsonl, command, claude, rtkPath, stopped = null }) {
  const report = renderReport({
    run: {
      mode: mode.id,
      unit: mode.unit,
      shape: mode.what,
      // Everything is a percentage of `baseline` where there is one, and of the first arm otherwise
      // — a `duo` run has no `baseline`, and `dm-plain` is what `dm-terse` is being compared to.
      baseArm: (arms.find((arm) => arm.id === 'baseline') ?? arms[0])?.id ?? 'baseline',
      model: options.model,
      n: options.n,
      date: date.toISOString().slice(0, 10),
      fixture: fixture.name,
      commit: fixture.commit,
      command,
      jsonl,
      claudeVersion: versionOf(claude) ?? 'unknown',
      rtkVersion: versionOf(rtkPath),
      limitations: limitations({ options, mode, fixture, cells, stopped }),
    },
    cells,
    arms: arms.map((arm) => arm.id),
    tasks,
  })
  mkdirSync(RESULTS_DIR, { recursive: true })
  const out = options.out ?? join(RESULTS_DIR, resultsName(date, options.model, mode.id))
  writeFileSync(out, report)
  writeFileSync(
    `${out.replace(/\.md$/, '')}.jsonl`,
    `${cells.map((one) => JSON.stringify(published(one))).join('\n')}\n`,
  )
  return out
}

/**
 * A finished run, re-read off disk and reported again — the isolation checks recomputed from the
 * transcripts the sessions wrote, the rest of the numbers as they were measured.
 *
 * This is here because a measurement bug found halfway through a run is otherwise a bill for a
 * second run. The first real run of this bench hit exactly that: the isolation check was calling
 * `ponytail` and `rtk+ponytail` contaminated for sharing a text on purpose, and the fix had to
 * reach the cells that had already been paid for.
 */
function rescore(options, argv) {
  const dir = options.rescore
  const rows = readFileSync(join(dir, 'cells.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
  const mode = modeOf(rows[0]?.mode ?? options.mode)
  const arms = ARMS.filter((arm) => rows.some((row) => row.arm === arm.id))
  const tasks = unitsOf(mode, readTasks()).filter((task) => rows.some((row) => row.task === task.id))
  const order = new Map(arms.map((arm, index) => [arm.id, index]))
  const byId = new Map(arms.map((arm) => [arm.id, arm]))
  const cells = rows
    .map((row) => ({ ...row, breaches: cellBreaches({ ...row, sessionIds: sessionsOf(row) }, byId.get(row.arm)) }))
    .sort((a, b) => a.task.localeCompare(b.task) || order.get(a.arm) - order.get(b.arm) || a.run - b.run)
  const out = write({
    options,
    mode,
    fixture: fixtureOf(options.fixture),
    cells,
    arms,
    tasks,
    date: runDate(dir),
    jsonl: join(dir, 'cells.jsonl'),
    command: `pnpm bench:tokens ${argv.join(' ')}`,
    claude: resolveCli('claude'),
    rtkPath: resolveCli('rtk'),
  })
  say(`rescored  ${cells.length} cells from ${dir}`)
  say(`report    ${out}`)
  return 0
}

/** The sessions a recorded cell had: T190's single id, or T197's list of them. */
function sessionsOf(row) {
  return row.sessionIds ?? (row.sessionId ? [row.sessionId] : [])
}

/**
 * What the shape of this run cannot answer, whichever arms it ran.
 *
 * Two of `solo`'s lines are the reason T197 exists: the first round said, in its own results file,
 * that it had priced RTK where nothing it filters happens and the terse voice where nobody writes a
 * DM. Each of the other two modes answers one of them, and arrives with its own list of what it in
 * turn cannot say — a shape that claims to have no limitations is a shape nobody has read.
 */
const SHAPE_LIMITS = {
  solo: [
    'One ticket per session, started cold. TinyCorp runs long-lived Employees that carry a conversation ' +
      'across many turns, where the system prompt is paid once and cached — so an arm that adds text is ' +
      'priced here at its worst case, and an arm that changes behaviour per turn at its least. ' +
      '`--mode long` is the other case.',
    'The terse voice governs DMs between Employees, and a bench session writes no DM. This measures what ' +
      'carrying the rule costs on a coding task, not what it saves on the messages it is about. ' +
      '`--mode duo` is where the messages are.',
  ],
  long: [
    'One triple of three small tickets, in one resumed session. It is a long session next to a cold one, ' +
      'and short next to a TinyCorp Employee that works a board for a day: what an arm does to the tenth ' +
      'ticket of a session is still not measured.',
    'The checkpoints are the bench’s and not an Employee’s own rhythm. Every arm runs the whole suite, the ' +
      'whole `git diff` and `git log` at the same three moments, which is what makes the arms comparable ' +
      'and is not what a session does unprompted.',
    'Nothing commits, so `git log` is one line in every cell. The command is in the checkpoint because the ' +
      'ticket named it; the command output RTK actually had to filter here is the suite and the diff.',
    'RTK still only sees Bash. A checkpoint is the workload it is for — a suite and a growing diff — but the ' +
      'reading a session does through Read, Grep and Glob is invisible to it in this mode too.',
  ],
  duo: [
    'The chat is a stand-in, not the Company server: `dm-mcp.mjs` over one JSONL file, with the app’s own ' +
      'tool names and its descriptions word for word, but none of the real thing’s SQLite, channels, pins, ' +
      'attachments or engine. What an Employee reads and writes is the same; what the app does around it is not.',
    'The protocol is the bench’s. The lead is told to DM the colleague twice — before it writes code, and when ' +
      'the change is ready — and every DM wakes the other, up to five wakes a cell. A real Company decides for ' +
      'itself how much to talk, and an arm that talked less because it was told to would be a measurement of ' +
      'the instruction.',
    'Both arms carry the app’s How you write section and differ by Between Employees alone. The tool ' +
      'descriptions name the Company’s voice setting the way the app’s do, identically in both arms.',
    'Two Employees in one checkout, and the colleague is told not to write files. A real Company gives a ' +
      'reviewer a worktree of its own.',
    'Whether the ticket landed is a green suite, code in the diff, and both Employees having written. It is ' +
      'not a review of the code, and the DM columns are characters and words with an estimate in tokens ' +
      'beside them (characters ÷ 4), never a count from a tokenizer.',
  ],
  boss: [
    'The boss is a fixed script, not a person and not a model. Every cell of every arm is asked the same ' +
      'three questions, in the same order and the same words, because a boss that answered a fragment ' +
      'differently from a paragraph would make the arms differ by their own input as well. What is not ' +
      'measured, then, is whether a real boss would have had to ask a follow-up.',
    'Three questions and two report-backs, all of them the bench’s protocol rather than an Employee’s ' +
      'own rhythm. A Company decides for itself how much to say, and an arm that said less because it was ' +
      'told to would be a measurement of the instruction.',
    '`answers right` is a keyword check over the reply — a path-shaped token, a digit, a yes or a no — ' +
      'and never a review of the answer. It catches an arm that saved tokens by dropping the fact it was ' +
      'asked for, which is the failure this add-on can have; it says nothing about an answer that is ' +
      'wrong in words that look right.',
    'The chat is the same stand-in `duo` uses, with `boss` at the other end of the DM rather than a ' +
      'colleague: the app’s own tool names and descriptions, and none of the real thing’s SQLite, ' +
      'channels, Inbox or approval flow. The add-on also governs a thread the boss is in, an @mention and ' +
      'an approval request, and none of those three exist here.',
    'Both arms carry the app’s How you write section and differ by How you answer the boss alone, at ' +
      'Full. Lite and Ultra are not measured by this run, and the card may not claim a number for them.',
  ],
}

/**
 * What this run cannot answer, written into its own results file.
 *
 * It is a list and not a paragraph because every line of it is a specific thing someone will
 * otherwise read the tables as having settled.
 */
function limitations({ options, mode, fixture, cells, stopped = null }) {
  const dirty = cells.filter((one) => one.breaches.length > 0).length
  const armsHere = new Set(cells.map((one) => one.arm))
  return [
    `n=${options.n} per ${mode.unit} and arm. Three agent sessions on one ticket differ by more than most of ` +
      'the gaps in these tables, which is why every number is a median with its interquartile range ' +
      'beside it and why a gap smaller than that spread is not a result.',
    `One model (${options.model}) and one fixture (${fixture.name}, a TypeScript React app). Nothing here ` +
      'transfers to another model or to a Python or Go repo without being run again.',
    ...SHAPE_LIMITS[mode.id],
    ...(armsHere.has('ponytail') || armsHere.has('rtk+ponytail')
      ? [
          'The ponytail arms prepend its `SKILL.md` with `--append-system-prompt`. The skill really ships as a ' +
            'plugin activated by a `SessionStart` hook; ponytail’s own README says pasting the text is an ' +
            'approximation of its `full` level.',
        ]
      : []),
    ...(mode.id === 'solo' && [...armsHere].some((arm) => arm.includes('rtk'))
      ? [
          'RTK can only filter what goes through Bash, and a Claude Code session does most of its reading ' +
            'through Read, Grep and Glob, which no hook rewrites. The `rtk gain` table below is therefore ' +
            'a number about a slice of the session, not about the session.',
        ]
      : []),
    'Not measured: whether the feature asked for was actually built, and whether it was built well. ' +
      'The fixture’s own suite is a regression guard — it catches a change that broke the repo — and it ' +
      'passes for a session that wrote nothing at all, so read `lines +` beside it, not instead of it.',
    'Not measured: quality, safety, or the review rounds a worse diff would cost downstream. An arm that ' +
      'spends 20% fewer tokens and needs a second attempt has saved nothing.',
    'Dependencies are installed once and every workspace links to that one tree, so no cell pays for ' +
      '`npm install`. Each cell checks the tree is unchanged afterwards and says so if it is not.',
    ...(stopped ? [`The run stopped before every cell was measured: ${stopped}`] : []),
    dirty === 0
      ? 'Every cell’s isolation was checked against its own transcript and held.'
      : `${dirty} cells failed the isolation check and their numbers are in the tables — read the JSONL.`,
  ]
}

const code = await main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  return 1
})
process.exitCode = code
