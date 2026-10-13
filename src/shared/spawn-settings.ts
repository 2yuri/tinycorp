/**
 * The Company settings an Employee's instructions are written from at its spawn (T237).
 *
 * Five of the boss's settings are read once, when a Session starts: how Employees talk to each
 * other (T180), how many tokens of its own notes it reads (T193), whether Lean builder is on
 * (T194), whether Caveman is (T261), and whether the Session is started inside ai-jail (T260). A
 * Session that is already running carries what it was told until it starts again — which is the
 * design, not a gap: nothing edits an Employee mid-turn.
 *
 * Four of them are written into the Employee's *instructions*; the Sandbox add-on is not — it
 * changes the command the Session is started with. It belongs here all the same, because the rule
 * this list encodes is *read once at spawn, and a running Session keeps what it got*, and the
 * strip and `Apply now` are what that rule owes the boss.
 *
 * So the screens say it out loud, name who is still on the old setting, and offer `Apply now`,
 * which restarts every idle Session where it stands, resuming its conversation with fresh
 * instructions. Everything else on those tabs — who tests before a merge, the concurrency cap —
 * is read by the engine when it is used, and needs none of this.
 */

/** The settings a Session bakes in, by the name the engine and the screens both use. */
export const SPAWN_SETTINGS = ['colleagueVoice', 'notesBudget', 'buildStyle', 'caveman', 'sandbox'] as const

export type SpawnSetting = (typeof SPAWN_SETTINGS)[number]

/** What they were worth at one moment: a Session's own copy, or the Company's now. */
export type SpawnSettings = Record<SpawnSetting, string | number>

/** One Employee whose running Session still carries what it was told when it started. */
export interface StaleSession {
  employeeId: string
  name: string
  /**
   * It is mid-turn, so `Apply now` does not interrupt it: the change reaches it when its turn
   * ends. Everything that is not idle reads as busy here, including a Session that is starting.
   */
  busy: boolean
  /** Which of them it is behind on, so each card names only the Employees its own setting left behind. */
  settings: SpawnSetting[]
}

/** What `Apply now` did, in Employee ids: restarted where it stands, or waiting for a turn to end. */
export interface AppliedNow {
  restarted: string[]
  waiting: string[]
}

/** The note beside every setting a Session bakes in. */
export const APPLIES_NEXT_SESSION = 'Applies from each Employee’s next Session'

/** Which of them differ between what a Session was told and what the Company says now. */
export function changedSettings(spawned: SpawnSettings, now: SpawnSettings): SpawnSetting[] {
  return SPAWN_SETTINGS.filter((setting) => spawned[setting] !== now[setting])
}

/**
 * Who is still on the old setting, in one sentence: the ones a restart would reach, and then the
 * ones whose turn has to end first. Empty when nobody is behind, which is when no note is drawn.
 */
export function staleLine(stale: StaleSession[]): string {
  if (stale.length === 0) return ''
  const idle = stale.filter((one) => !one.busy).map((one) => one.name)
  const busy = stale.filter((one) => one.busy).map((one) => one.name)
  const sentences = []
  if (idle.length > 0) sentences.push(`Still on the old setting: ${list(idle)}.`)
  if (busy.length > 0) {
    sentences.push(`${list(busy)} ${busy.length === 1 ? 'gets it when its turn ends' : 'get it when their turns end'}.`)
  }
  return sentences.join(' ')
}

/** Names as a sentence says them: `Ada`, `Ada and Iris`, `Ada, Iris and Vega`. */
function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
