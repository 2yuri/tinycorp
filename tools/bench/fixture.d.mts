/** Types for `tools/bench/fixture.mjs`, the repo every cell of `pnpm bench:tokens` runs against. */

export const BENCH_TMP: string
export const GENERATED: readonly string[]

/** One fixture: a real repo pinned by commit, and how to make it runnable. */
export interface Fixture {
  id: string
  /** What the report calls it. */
  name: string
  url: string
  commit: string
  /** The app inside the clone, as path segments. */
  root: readonly string[]
  /** Files copied in before anything runs, as `{ written: copied-from }`. */
  seed: Record<string, string>
  /** The `npm` arguments the one install runs with. */
  install: readonly string[]
  /** The fixture's own suite, run through `npx`. */
  test: readonly string[]
  /** What a workspace copy leaves behind. */
  skip: readonly string[]
}

export const FIXTURES: Record<string, Fixture>
export function fixtureOf(id: string): Fixture

export function fixtureCache(one: Fixture, root?: string): string
export function fixtureRoot(one: Fixture, root?: string): string
export function installMarker(one: Fixture, root?: string): string
/** Bytes of the install marker, or null when it is not there. Compared, never parsed. */
export function installFingerprint(one: Fixture, root?: string): string | null

export function prepareFixture(one: Fixture, options?: { root?: string; onStep?: (step: string) => void }): string

/** What the fixture's own suite did. */
export interface TestOutcome {
  passed: boolean
  code: number | null
  ms: number
  /** The tail of what it printed. */
  output: string
}

export function runFixtureTests(one: Fixture, cwd: string, options?: { timeout?: number }): TestOutcome

export function makeWorkspace(one: Fixture, dir: string, options?: { root?: string }): string

/** What an agent left behind, as `git diff --numstat` counts it. */
export interface DiffStat {
  added: number
  removed: number
  files: string[]
}

export function diffStat(dir: string): DiffStat
export function readNumstat(text: string): DiffStat
