/**
 * How Employees build, per Company (T194): the Lean builder add-on.
 *
 * On `lean` every Employee's instructions carry a ladder it climbs before writing code, and stops
 * at the first rung that holds. On `standard` the section is not rendered at all, which is what a
 * Company does until the boss turns it on — an add-on is offered, never assumed.
 *
 * The ladder is ponytail's, by Dietrich Gebert (MIT), written here in our own words rather than
 * vendored: `tools/bench/vendor/ponytail/SKILL.md` is the real ruleset and is only read by the
 * benchmark. `NOTICE` carries the credit.
 */

export const BUILD_STYLES = ['lean', 'standard'] as const
export type BuildStyle = (typeof BUILD_STYLES)[number]

/**
 * What a Company that has never touched the setting builds like. Off: the ladder measured well
 * (see {@link LEAN_MEASURED}) but it changes what every Employee writes, and a Company inherits no
 * opinion about that from us.
 */
export const DEFAULT_BUILD_STYLE: BuildStyle = 'standard'

export function isBuildStyle(value: unknown): value is BuildStyle {
  return BUILD_STYLES.includes(value as BuildStyle)
}

/**
 * The ladder, in the words frame `ttODp` draws and the words an Employee reads. One copy, so the
 * card can never show the boss a rung the instructions do not carry.
 */
export const LEAN_LADDER = [
  'Does it need to exist?',
  'Already in this repo?',
  'The standard library?',
  'A native platform feature?',
  'An installed dependency?',
  'One line?',
  'Only then: the minimum that works.',
] as const

/** What laziness never reaches, on the card and in the instructions alike. */
export const LEAN_NEVER_CUT =
  'validation at a trust boundary, error handling that prevents data loss, security or accessibility.'

/**
 * The section Lean adds to every Employee's instructions, and nothing else changes.
 *
 * It opens with a blank line because it is spread into the instructions between two sections, and
 * `LEAN_RULES.length` is the `Adds N lines to instructions` chip: the card counts the real section
 * rather than repeating a number that would quietly go stale.
 */
export const LEAN_RULES: readonly string[] = [
  '',
  '## How you build',
  '',
  'Before you write code, climb this ladder and stop at the first rung that holds. It shortens the solution, ' +
    'never the reading: understand what the change touches first, then climb.',
  '',
  ...LEAN_LADDER.map((rung, index) => `${index + 1}. ${rung}`),
  '',
  `Never cut: ${LEAN_NEVER_CUT}`,
]

/**
 * What `pnpm bench:tokens` found for this add-on, as the card's three tiles.
 *
 * Read off `tools/bench/results/2026-09-23-sonnet.md` (T190, #441): the `ponytail` arm spent 71.7%
 * of baseline's tokens, 67.6% of its cost and wrote 70.9% of its lines, over 80 real Claude Code
 * sessions with tests green in every arm. No token claim ships unmeasured, so these numbers are on
 * the card the boss decides from.
 */
export const LEAN_MEASURED = [
  { change: '−28%', what: 'tokens' },
  { change: '−32%', what: 'cost' },
  { change: '−29%', what: 'lines written' },
] as const

/** The line under the tiles: the size of the run, and what it is not. */
export const LEAN_MEASURED_CAVEAT =
  '80 Sonnet sessions on 8 tickets, tests green in every arm. n=2: a direction, not a guarantee.'
