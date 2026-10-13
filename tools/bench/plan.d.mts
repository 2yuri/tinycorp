/** Types for `tools/bench/plan.mjs`: what one `pnpm bench:tokens` run will do, before it does it. */

import type { Arm } from './arms.mjs'

export const TASKS_DIR: string
export const RESULTS_DIR: string
export const COST_PER_CELL_USD: number
export const TOKENS_PER_CELL: number

/** One shape a run can take: what a cell of it is, and what it is expected to spend. */
export interface Mode {
  id: string
  /** One line for the command and the results file. */
  what: string
  /** What one cell works: a `ticket`, or a `triple` of them. */
  unit: string
  units: (tasks: readonly Task[]) => Unit[]
  costPerCellUsd: number
  tokensPerCell: number
}

export const MODES: { solo: Mode; long: Mode; duo: Mode; boss: Mode }
export function modeOf(id: string): Mode
export function unitsOf(mode: Mode, tasks: readonly Task[]): Unit[]

/** One ticket from `tasks/*.md`. */
export interface Task {
  id: string
  size: string
  /** What this ticket invites an agent to over-build, or `none`. */
  trap: string
  prompt: string
  file: string
}

export function readTask(file: string): Task
export function readTasks(dir?: string): Task[]

/**
 * What one cell works: a ticket in `solo` and `duo`, a triple of them in `long`. The report reads
 * the three fields it has in common with a task and nothing else.
 */
export interface Unit {
  id: string
  size: string
  trap: string
  prompt: string
  /** The tickets of a triple, in order. Absent for a single ticket. */
  tasks?: readonly string[]
  /** The legs of a long cell, in order. Absent for a single ticket. */
  legs?: readonly Leg[]
}

/** One `claude` process of a cell: what it was asked, and which ticket it belongs to. */
export interface Leg {
  id: string
  kind: string
  task: string
  prompt: string
}

/** The command line, read. */
export interface Options {
  model: string
  /** Which shape of run: a key of {@link MODES}. */
  mode: string
  n: number
  arms: string[] | null
  tasks: string[] | null
  fixture: string
  workers: number
  dryRun: boolean
  yes: boolean
  out: string | null
  /** Keep every cell's workspace instead of removing it once it is measured. */
  keep: boolean
  /** A finished run folder to re-read and re-report, instead of running anything. */
  rescore: string | null
  /** What the whole run may spend before it stops, or null for no cap. */
  budgetUsd: number | null
}

export function parseArgs(argv: readonly string[]): Options

/** One cell: one unit of work, one arm, one repeat. */
export interface Cell {
  task: Unit
  arm: Arm
  run: number
  id: string
}

export function planCells(options: { tasks: readonly Unit[]; arms: readonly Arm[]; n: number }): Cell[]
export function chosenArms(names: readonly string[] | null, mode?: Mode): Arm[]
export function chosenTasks<T extends { id: string }>(all: readonly T[], names: readonly string[] | null): T[]

export interface Estimate {
  cells: number
  tokens: number
  costUsd: number
}

export function estimate(cells: readonly Cell[], mode?: Mode): Estimate

/** Why this run must not start, or null when it may. */
export function refusal(options: {
  env?: NodeJS.ProcessEnv
  yes: boolean
  dryRun: boolean
  rescore?: string | null
}): string | null

/** The day a run folder is named after, so a rescore writes that date and not today's. */
export function runDate(dir: string): Date

export function resultsName(date: Date, model: string, mode?: string): string

/** Why this run may not start one more cell, or null when it may. */
export function overBudget(options: { budgetUsd: number | null; spentUsd: number; nextUsd: number }): string | null
