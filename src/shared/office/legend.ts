/**
 * What the office legend says: every sprite state, in the order the floor reads, with the reason
 * label it puts under a sprite and one line on what it means (T74).
 */
import { type SpriteState, STATE_LABEL } from './projection'

/** The colour family a state belongs to; the same four the Employee drawer's badge uses. */
export type LegendTone = 'live' | 'wait' | 'stop' | 'quiet'

export interface LegendEntry {
  state: SpriteState
  /** The label the sprite shows, or the shape of it where it names a colleague. */
  label: string
  tone: LegendTone
  /** One line the boss can read to know why someone is where they are. */
  means: string
}

export const OFFICE_LEGEND: LegendEntry[] = [
  { state: 'working', label: STATE_LABEL.working, tone: 'live', means: 'At their desk, changing something.' },
  { state: 'reading', label: STATE_LABEL.reading, tone: 'live', means: 'At their desk, looking around the repo.' },
  {
    state: 'talking',
    label: 'In a meeting with …',
    tone: 'live',
    means: 'In a live exchange: the meeting room with whoever is in it, a colleague’s desk, or your desk.',
  },
  {
    state: 'waiting',
    label: STATE_LABEL.waiting,
    tone: 'wait',
    means: 'At your desk with a “!”: an approval of theirs needs your call.',
  },
  {
    state: 'blocked',
    label: STATE_LABEL.blocked,
    tone: 'stop',
    means: 'At the coffee counter with a “?”: a ticket they hold is blocked.',
  },
  {
    state: 'parked',
    label: STATE_LABEL.parked,
    tone: 'quiet',
    means: 'At the coffee counter, waiting for a free slot.',
  },
  {
    state: 'out_of_budget',
    label: STATE_LABEL.out_of_budget,
    tone: 'stop',
    means: 'At the coffee counter until the usage limit resets.',
  },
  { state: 'starting', label: STATE_LABEL.starting, tone: 'quiet', means: 'Their Session is spawning.' },
  { state: 'idle', label: STATE_LABEL.idle, tone: 'quiet', means: 'At their desk with nothing to do.' },
  { state: 'off', label: STATE_LABEL.off, tone: 'quiet', means: 'No Session running; their chair is empty.' },
]
