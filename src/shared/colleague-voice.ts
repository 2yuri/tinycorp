/**
 * How Employees talk to each other (T180). Every word between two Employees is paid twice — once
 * written, once read by the colleague — so a DM between colleagues can be fragments. Everything the
 * boss reads stays plain prose, and that is not a setting.
 *
 * Which voice a message is written in is decided by the engine, from where the message goes, and
 * never guessed by the model: see `betweenColleagues` and the wake prompt's hint in `inbox.ts`.
 */
import { BOSS, dmMembers } from './domain/chat'

export const COLLEAGUE_VOICES = ['terse', 'plain'] as const
export type ColleagueVoice = (typeof COLLEAGUE_VOICES)[number]

/** What a Company that has never touched the setting does. */
export const DEFAULT_COLLEAGUE_VOICE: ColleagueVoice = 'terse'

export function isColleagueVoice(value: unknown): value is ColleagueVoice {
  return COLLEAGUE_VOICES.includes(value as ColleagueVoice)
}

/** The two segments of BETWEEN EMPLOYEES, as frame `L0glbm` words them. */
export const COLLEAGUE_VOICE_LABEL: Record<ColleagueVoice, string> = {
  terse: 'Terse',
  plain: 'Plain',
}

/** The line under the segments, which says what the chosen voice does. */
export const COLLEAGUE_VOICE_HELP: Record<ColleagueVoice, string> = {
  terse:
    'DMs between Employees, handoffs and review notes to a colleague are short fragments. Code, ' +
    'paths, numbers and error text are never shortened.',
  plain:
    'Employees write to each other the way they write to you: full sentences, plain words. It ' +
    'reads the same everywhere and costs more tokens.',
}

/**
 * The same news said twice, on the card: what a colleague gets and what the boss gets. A fixed
 * illustration with fixed counts — nothing in the app counts the tokens of a real message.
 */
export const VOICE_EXAMPLE: Record<ColleagueVoice, { to: string; tokens: number; text: string }> = {
  terse: {
    to: 'Iris',
    tokens: 24,
    text: 'PR #412 green. Migration name clash w/ #409 → renamed `billing-refunds`. Review auth.ts L40–88 pls.',
  },
  plain: {
    to: 'you',
    tokens: 41,
    text:
      'PR #412 is ready. Its migration clashed with Vega’s, so I renamed it, and I’ve asked Iris to ' +
      'check the auth change before it merges.',
  },
}

/** The two rows under the example: what the setting does not reach. */
export const VOICE_LOCKS = [
  {
    title: 'To you: always plain words',
    detail:
      'A DM to you, a channel, a PR comment, a ticket and the digest are written for a person: no ' +
      'filler, no model tells. Not a setting.',
  },
  {
    title: 'Always full sentences',
    detail:
      'A warning, a destructive step or a question someone must answer is written out in full, ' +
      'even between Employees.',
  },
] as const

/**
 * Whether a channel is a DM between two Employees, which is the only place terse ever applies.
 * A DM to or from the boss is not one, and neither is a channel, an epic or a thread in one: the
 * boss reads those. The engine asks this; the model is never left to judge its own audience.
 */
export function betweenColleagues(channelId: string, boss: string): boolean {
  const members = dmMembers(channelId)
  return members !== null && members.every((member) => member !== boss)
}

/**
 * The clause every wake prompt carries: the voice to answer that one message in. The engine says
 * it, so the model never has to work out who its audience is — the mistake that would leak
 * fragments into something the boss reads.
 */
export function voiceHint(channelId: string, voice: ColleagueVoice): string {
  return voice === 'terse' && betweenColleagues(channelId, BOSS)
    ? 'Colleague DM \u2192 reply terse: fragments, no filler; code, paths, numbers and error text exact, ' +
        'and full sentences for a warning, a destructive step or a question they must answer.'
    : 'The boss can read this \u2192 plain words, full sentences.'
}
