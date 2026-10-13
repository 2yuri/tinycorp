import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { armIds, armOf, armsOfMode } from './arms.mjs'
import { bossUnits } from './boss.mjs'
import { duoUnits } from './duo.mjs'
import { longUnits } from './long.mjs'

/**
 * What one `pnpm bench:tokens` run is going to do, worked out before it does any of it (T190).
 *
 * Everything here is a pure function of the command line and the files on disk, which is what
 * makes `--dry-run` worth having: the plan the boss reads is the object the run then executes, not
 * a description of it written separately and free to drift.
 *
 * A run also has a **shape** (T197), because the first round's two biggest results were both about
 * the shape rather than the arms: RTK was measured where nothing it filters happens, and the terse
 * voice where nobody writes a DM. {@link MODES} is that shape — what one cell is, which arms mean
 * anything in it, and what a cell of it is expected to spend.
 */

/** The tasks folder, one ticket per file, read in filename order so a run is reproducible. */
export const TASKS_DIR = join(import.meta.dirname, 'tasks')

/** Where a results file lands. */
export const RESULTS_DIR = join(import.meta.dirname, 'results')

/**
 * What the dry run prices a `solo` cell at, and where the numbers come from: the mean over the
 * eighty cells of `results/2026-09-23-sonnet.md`, which cost $55.17 and moved 140M tokens in all.
 *
 * A mean and not a median, because the estimate is a total and a total is a sum: the spread across
 * cells is enormous — the date-picker ticket runs seven times the tiny one — so the median cell
 * would underprice a whole run by a third. It is still a guess, it moves with the task list and
 * the model, and the command says so where it prints it.
 */
export const COST_PER_CELL_USD = 0.69
export const TOKENS_PER_CELL = 1_750_000

/**
 * The shapes a run can take, and what one cell of each is expected to spend.
 *
 * The `long` and `duo` prices are built from the same results file, not guessed: the three tickets
 * of the long triple have baseline medians of $0.315, $0.403 and $0.345 there — $1.06 in three cold
 * sessions — and a long cell is those three plus three checkpoints on top of a context that keeps
 * growing, which is priced at a little over twice the cold sum. `duo` is `edit-comment`, whose
 * baseline median is $0.737, paid by a lead that also writes DMs and a colleague woken a few times,
 * which is priced at twice one cold session. Both are guesses from one arm of one run, and the
 * command prints them as guesses; the results file of the run that used them is what corrects them.
 */
export const MODES = {
  solo: {
    id: 'solo',
    what: 'one ticket, one cold session (T190)',
    unit: 'ticket',
    units: (tasks) => tasks,
    costPerCellUsd: COST_PER_CELL_USD,
    tokensPerCell: TOKENS_PER_CELL,
  },
  long: {
    id: 'long',
    what: 'three tickets in one resumed session, the suite and git between them (T197)',
    unit: 'triple',
    units: longUnits,
    costPerCellUsd: 2.4,
    tokensPerCell: 7_000_000,
  },
  duo: {
    id: 'duo',
    what: 'two Employees, one ticket, a real DM thread between them (T197)',
    unit: 'ticket',
    units: duoUnits,
    costPerCellUsd: 1.5,
    tokensPerCell: 4_000_000,
  },
  /**
   * One Employee and a scripted boss reading it (T261). Priced off `duo`'s own guess: this is one
   * session rather than two, woken three times rather than five, so it is a little over half a
   * `duo` cell and a little under one and a half cold ones. It is a guess like the other two, and
   * the results file of the first real run is what corrects it.
   */
  boss: {
    id: 'boss',
    what: 'one Employee, one ticket, a scripted boss asking after it (T261)',
    unit: 'ticket',
    units: bossUnits,
    costPerCellUsd: 0.9,
    tokensPerCell: 2_500_000,
  },
}

/** The mode called `id`, or throws naming the ones there are. */
export function modeOf(id) {
  const one = MODES[id]
  if (!one) throw new Error(`no mode ${id}; this bench has ${Object.keys(MODES).join(', ')}`)
  return one
}

/** The units of one mode's run: a ticket per cell, or a triple of them. */
export function unitsOf(mode, tasks) {
  return mode.units(tasks)
}

/** One ticket, as `tasks/*.md` writes it. */
export function readTask(file) {
  const text = readFileSync(file, 'utf8')
  const found = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!found) throw new Error(`${file} has no front matter`)
  const head = {}
  for (const line of found[1].split('\n')) {
    const pair = /^(\w+):\s*(.*)$/.exec(line.trim())
    if (pair) head[pair[1]] = pair[2]
  }
  if (!head['id']) throw new Error(`${file} names no id`)
  return {
    id: head['id'],
    size: head['size'] ?? 'unknown',
    /** What this ticket invites an agent to over-build, or `none`. */
    trap: head['trap'] ?? 'none',
    prompt: found[2].trim(),
    file,
  }
}

/** Every ticket, in filename order. */
export function readTasks(dir = TASKS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => readTask(join(dir, name)))
}

/** The flags `pnpm bench:tokens` takes. `--n 3` and `--n=3` are the same thing. */
export function parseArgs(argv) {
  const options = {
    model: 'sonnet',
    mode: 'solo',
    n: 3,
    arms: null,
    tasks: null,
    fixture: 'bulletproof-react',
    workers: 1,
    dryRun: false,
    yes: false,
    out: null,
    keep: false,
    rescore: null,
    budgetUsd: null,
  }
  const flags = {
    n: 'n',
    model: 'model',
    mode: 'mode',
    budget: 'budgetUsd',
    arms: 'arms',
    tasks: 'tasks',
    fixture: 'fixture',
    workers: 'workers',
    out: 'out',
    rescore: 'rescore',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (raw === '--yes') {
      options.yes = true
      continue
    }
    if (raw === '--keep') {
      options.keep = true
      continue
    }
    const found = /^--([\w-]+)(?:=(.*))?$/.exec(raw)
    if (!found) throw new Error(`unknown argument ${raw}`)
    const name = flags[found[1]]
    if (!name) throw new Error(`unknown flag --${found[1]}`)
    const value = found[2] ?? argv[++index]
    if (value === undefined) throw new Error(`--${found[1]} needs a value`)
    if (name === 'n' || name === 'workers') {
      const number = Number.parseInt(value, 10)
      if (!Number.isFinite(number) || number < 1) throw new Error(`--${found[1]} must be a positive whole number`)
      options[name] = number
    } else if (name === 'budgetUsd') {
      const number = Number.parseFloat(value)
      if (!Number.isFinite(number) || number <= 0) throw new Error('--budget must be a positive number of dollars')
      options.budgetUsd = number
    } else if (name === 'arms' || name === 'tasks') {
      options[name] = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    } else {
      options[name] = value
    }
  }
  return options
}

/**
 * The cells a run is made of, in the order they are run: task, then repeat, then arm.
 *
 * Every ordering here is about what a run that stops halfway leaves behind. Task-major, because a
 * run that got through two tickets has both arms' numbers for both of them, where arm-major would
 * leave one arm complete and the rest empty. Then repeat before arm (T197), so a stopped run holds
 * whole repeats: `--budget` ends a run between cells, and ending it between an arm and the arm it
 * is being compared against is how a benchmark publishes a gap that is really a missing cell.
 */
export function planCells({ tasks, arms, n }) {
  const cells = []
  for (const task of tasks) {
    for (let run = 1; run <= n; run += 1) {
      for (const arm of arms) cells.push({ task, arm, run, id: `${task.id}__${arm.id}__${run}` })
    }
  }
  return cells
}

/**
 * The arms this run covers, in report order, or throws naming the one that does not exist.
 *
 * An arm asked for by name still has to belong to the mode: `--mode long --arms terse-voice` would
 * otherwise run a cell whose number nothing in the report is a percentage of, and `--mode solo
 * --arms dm-terse` a voice arm with nobody to write to.
 */
export function chosenArms(names, mode = MODES.solo) {
  if (!names) return armsOfMode(mode.id)
  return names.map((name) => {
    const one = armOf(name)
    if (!one) throw new Error(`no arm ${name}; this bench has ${armIds().join(', ')}`)
    if (!one.modes.includes(mode.id)) {
      throw new Error(
        `arm ${name} is not one of mode ${mode.id}'s; it has ${armsOfMode(mode.id)
          .map((other) => other.id)
          .join(', ')}`,
      )
    }
    return one
  })
}

/** The tasks this run covers, or throws naming the one that does not exist. */
export function chosenTasks(all, names) {
  if (!names) return all
  return names.map((name) => {
    const one = all.find((task) => task.id === name)
    if (!one) throw new Error(`no task ${name}; this bench has ${all.map((task) => task.id).join(', ')}`)
    return one
  })
}

/** What a run is expected to cost, stated as the guess it is. */
export function estimate(cells, mode = MODES.solo) {
  return {
    cells: cells.length,
    tokens: cells.length * mode.tokensPerCell,
    costUsd: Math.round(cells.length * mode.costPerCellUsd * 100) / 100,
  }
}

/**
 * Why this run must not start, or null when it may.
 *
 * `ANTHROPIC_API_KEY` is the one that is not about the bench at all. Every session here runs on the
 * boss's own subscription, which is what TinyCorp does everywhere and what `pnpm test:claude`
 * already promises; a key in the environment would instead bill an account, silently and per cell.
 * The answer is to refuse and say so, not to unset it and carry on: a key that is set is a machine
 * configured for something else, and the boss should know which of the two they meant.
 */
export function refusal({ env = process.env, yes, dryRun, rescore = null }) {
  // Rescoring reads a finished run off disk and spends nothing, so neither guard applies to it.
  if (rescore) return null
  if (env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_AUTH_TOKEN']) {
    return 'ANTHROPIC_API_KEY is set. This bench spends your Claude subscription, never an API key: unset it and run again.'
  }
  if (!dryRun && !yes) return 'This spends real usage. Run it with --yes, or with --dry-run to see the plan first.'
  return null
}

/**
 * The day a run folder is named after. Rescoring one must write the date it was run rather than
 * the date it was rescored, or the same run lands in a second file a week later.
 */
export function runDate(dir) {
  const found = /(\d{4}-\d{2}-\d{2})T/.exec(dir.replace(/\\/g, '/').split('/').pop() ?? '')
  return found ? new Date(`${found[1]}T00:00:00Z`) : new Date()
}

/**
 * What a results file is called: the date it was run, the model it was run on, and the shape of the
 * run when it was not the original one — two rounds of the same day and model are two files.
 */
export function resultsName(date, model, mode = 'solo') {
  const shape = mode === 'solo' ? '' : `-${mode}`
  return `${date.toISOString().slice(0, 10)}-${model}${shape}.md`
}

/**
 * Whether a run that has already spent `spentUsd` may start one more cell, given `--budget`.
 *
 * The per-cell `--max-budget-usd` stops one runaway session; this stops a run. They are different
 * guards: the first round finished at $55 against an estimate of $55, and a round whose ticket says
 * "keep it under $40" needs the number to be enforced by something other than remembering it.
 */
export function overBudget({ budgetUsd, spentUsd, nextUsd }) {
  if (!budgetUsd) return null
  if (spentUsd + nextUsd <= budgetUsd) return null
  return `--budget $${budgetUsd.toFixed(2)} would be passed: $${spentUsd.toFixed(2)} spent, and the next cell is priced at about $${nextUsd.toFixed(2)}.`
}
