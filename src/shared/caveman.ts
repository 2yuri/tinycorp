/**
 * How Employees answer the boss, per Company (T261): the Caveman add-on.
 *
 * On `lite`, `full` or `ultra` every Employee's instructions carry one more section, and it reaches
 * exactly one place — a message addressed to the boss. On `off` the section is not rendered at all,
 * which is what a Company does until the boss turns it on: an add-on is offered, never assumed.
 *
 * The idea is caveman's, by Julius Brussee. Its skill is MIT and its engine and proxy are BSL-1.1,
 * which is not open source, so nothing of either is here: this is the idea in our own words, and
 * `NOTICE` carries the credit the way it carries ponytail's for Lean builder (T194).
 *
 * What it must never reach is the point of the setting. Code, a command, a path, an error, an id
 * and a security warning are the payload and go through word for word; a commit, a pull request, a
 * plan and ticket text are read later by people who were not in the conversation and stay in full
 * sentences; and a DM to a colleague is the colleague voice's business (T180), never this one.
 */

/** Every value the setting takes, `off` included. */
export const CAVEMAN_LEVELS = ['off', 'lite', 'full', 'ultra'] as const
export type CavemanLevel = (typeof CAVEMAN_LEVELS)[number]

/** The three the segmented control offers, in the order frame `U8MYE` draws them. */
export const CAVEMAN_INTENSITIES = ['lite', 'full', 'ultra'] as const
export type CavemanIntensity = (typeof CAVEMAN_INTENSITIES)[number]

/**
 * What a Company that has never touched the setting answers like. Off, and it stays off until
 * {@link CAVEMAN_MEASURED} holds a number: no token claim ships unmeasured, and this one is not
 * measured yet.
 */
export const DEFAULT_CAVEMAN: CavemanLevel = 'off'

/** Which intensity the toggle turns on, and where the control stands before the boss moves it. */
export const DEFAULT_CAVEMAN_INTENSITY: CavemanIntensity = 'full'

export function isCavemanLevel(value: unknown): value is CavemanLevel {
  return CAVEMAN_LEVELS.includes(value as CavemanLevel)
}

export function isCavemanIntensity(value: unknown): value is CavemanIntensity {
  return CAVEMAN_INTENSITIES.includes(value as CavemanIntensity)
}

/** The label on each segment of the control. */
export const CAVEMAN_LABEL: Record<CavemanIntensity, string> = { lite: 'Lite', full: 'Full', ultra: 'Ultra' }

/** The line under the control, and the whole of what the three differ by. */
export const CAVEMAN_HINT = 'Lite drops the filler. Full answers in fragments. Ultra keeps only what you need to act.'

/**
 * The same answer at each intensity, as the card shows the boss what it is turning on.
 *
 * One per intensity rather than one for Full, because the card is where the boss picks between the
 * three and a Full example under a Lite label would be the card promising something else. Every one
 * of them keeps the number — 142 — for the same reason the instructions do: a count is payload.
 */
export const CAVEMAN_EXAMPLE = {
  before:
    'I looked into the failing test. It fails because the fixture creates a new date on every run, so the ' +
    'snapshot never matches. I pinned the date in the fixture, and all 142 tests pass now.',
  answer: {
    lite: 'The fixture made a new date on every run, so the snapshot never matched. I pinned it. 142 tests pass.',
    full: 'Fixture made new date every run → snapshot never match. Pinned date. 142 tests pass.',
    ultra: 'Pinned the fixture date. 142 tests pass.',
  } as Record<CavemanIntensity, string>,
} as const

/**
 * The three rules under the example, in the boss's second person.
 *
 * They are the card's copy of what {@link cavemanRules} tells an Employee, not the same string: the
 * card says "to you" where the instructions say "to the boss". `caveman.test.ts` is what keeps the
 * two saying the same three things, so the card can never promise the boss a limit the section
 * does not carry.
 */
export const CAVEMAN_CARD_RULES = [
  'Only in messages to you. Employees talk to each other as they always do.',
  'Never touches code, commands, file paths, error messages or a security warning.',
  'Commits, pull requests and plans stay in full sentences.',
] as const

/** The three tiles of the Measured block, in the order the frame draws them. */
export const CAVEMAN_MEASURES = ['output tokens', 'cost', 'answers right'] as const

/** What a benchmark found for this add-on: three tiles and the line that says how big the run was. */
export interface CavemanMeasured {
  tiles: readonly { change: string; what: string }[]
  caveat: string
}

/**
 * What `pnpm bench:tokens --mode boss` found — nothing yet, which is why this is `null`.
 *
 * Lean builder's equivalent is three numbers read off a results file (T190, #441). This add-on has
 * an arm and a mode and no run: a real run spends the boss's subscription and is theirs to say yes
 * to, so until `tools/bench/results/` holds one, this stays null, the tiles read `—` and the toggle
 * is disabled. That is "no token claim ships unmeasured" with a switch on it rather than a promise.
 */
export const CAVEMAN_MEASURED: CavemanMeasured | null = null

/** The foot under three empty tiles: why they are empty, and what fills them. */
export const CAVEMAN_UNMEASURED =
  'Not measured yet. pnpm bench:tokens --mode boss runs it on your subscription, with your ok — and the ' +
  'number goes here before this can be turned on.'

/** The tile that stands in for a number nobody has measured. */
const NO_NUMBER = '—'

/**
 * The Measured block and the toggle beside it, from whatever has been measured.
 *
 * One function rather than three reads of the same null, because the toggle and the foot are the
 * same fact: an add-on with no results file behind it cannot be turned on, and the block says why
 * in the place the boss is looking when they find that out.
 */
export function cavemanMeasuredBlock(measured: CavemanMeasured | null = CAVEMAN_MEASURED): {
  tiles: readonly { change: string; what: string }[]
  foot: string
  enabled: boolean
} {
  if (!measured) {
    return {
      tiles: CAVEMAN_MEASURES.map((what) => ({ change: NO_NUMBER, what })),
      foot: CAVEMAN_UNMEASURED,
      enabled: false,
    }
  }
  return { tiles: measured.tiles, foot: measured.caveat, enabled: true }
}

/** What each intensity asks for, and the only thing the three differ by. */
export const CAVEMAN_PER_LEVEL: Record<CavemanIntensity, string> = {
  lite:
    'Answer the boss in fewer words: no preamble, no restating of what they asked, no sign-off. Full ' +
    'sentences still, just fewer of them.',
  full:
    'Answer the boss in fragments rather than sentences. Drop articles, pleasantries, hedging and any ' +
    'clause that only announces what you are about to say. Two or three fragments is a whole answer.',
  ultra:
    'Answer the boss in the fewest words that let them act: what happened, and the one thing they have to ' +
    'decide. Nothing that is neither.',
}

/**
 * The section Caveman adds to every Employee's instructions, and nothing else changes.
 *
 * It opens with a blank line because it is spread into the instructions between two sections, and
 * it is rendered after How you write, whose "No fragments here" bullet it narrows — which is why
 * the section says so out loud rather than leaving an Employee holding two rules that disagree.
 *
 * Everything after the first line is the same at every intensity, on purpose: the scope is not a
 * dial. An Employee that cannot tell who it is writing to writes full sentences, so the failure
 * this section can have is always the harmless one.
 */
export function cavemanRules(level: CavemanLevel): readonly string[] {
  if (level === 'off') return []
  return [
    '',
    '## How you answer the boss',
    '',
    CAVEMAN_PER_LEVEL[level],
    '',
    'It reaches one place and no other: a message addressed to the boss. That is a DM to them, a reply in ' +
      'a thread they are in, a channel message where you pass `to: "boss"` or @mention them, the text of an ' +
      'approval request, and anything their Inbox shows them. Every chat tool says where its message is ' +
      'going in its own arguments — the channel you post to, the message you reply to — so read that ' +
      'rather than judge your own audience. When you cannot tell, write full sentences.',
    '',
    '- Never to a colleague. A DM to another Employee is written the way it always was, and each wake ' +
      'prompt names the voice for the message it delivers.',
    '- Never code, a command, a file path, an error message, an id, a number or a security warning. Those ' +
      'are the payload and they go through word for word; the prose around them is what gets cut.',
    '- Never a commit message, a pull request, a plan or ticket text. Those are read later by people who ' +
      'were not in the conversation, so they stay in full sentences.',
    '- A question the boss has to answer is written out in full, whatever the rest of the message is.',
    '- This narrows one bullet of How you write — "No fragments here" — for a message to the boss and ' +
      'nothing else. Every other rule there still holds: the point first, no headings, no sign-off.',
    '',
    'Every wake that carries a message the boss can read still ends "The boss can read this → plain words, ' +
      'full sentences." That clause says who is reading — a person, not a colleague — and it is how you ' +
      'tell a boss message apart from a colleague one. It is not an instruction to lengthen an answer this ' +
      'section shortened, and where the two meet this section wins, except in everything above that it ' +
      'never touches.',
  ]
}
