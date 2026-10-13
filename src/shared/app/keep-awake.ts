/**
 * Keeping the machine awake while the office works (T99, T177). A machine that sleeps stops every
 * Session in the room, so the office owns the decision: a coffee cup on the map with the three
 * modes Orca has. The mode is the boss's own, not the Company's (decision 47).
 *
 * It was a Mac affordance while the assertion was `caffeinate`. It is `powerSaveBlocker` now,
 * which macOS, Windows and Linux all have, so the cup is on the map wherever the app runs.
 */
export type KeepAwakeMode = 'on' | 'working' | 'off'

/** The default: it costs nothing while the office is idle and stops a night of work being lost. */
export const KEEP_AWAKE_DEFAULT: KeepAwakeMode = 'working'

export interface KeepAwakeState {
  mode: KeepAwakeMode
  /** Whether an assertion is held right now: the cup is lit while it is. */
  holding: boolean
  /** Whether this machine can be held awake at all. Where it cannot, the cup does not appear. */
  supported: boolean
}

/**
 * The menu, in the order design/screens/sMIWE.png lists it. `short` is what the menu header says
 * beside "holding": one word of the mode's own title, so the header never names a mode the menu
 * does not. The frame once said "Agent" for the middle one, Orca's word from before Agents became
 * Employees; it now says "Working", and the app says it with it (T159).
 */
export const KEEP_AWAKE_MODES: { mode: KeepAwakeMode; title: string; short: string; body: string }[] = [
  { mode: 'on', title: 'On', short: 'On', body: 'Awake for as long as the Company is open.' },
  {
    mode: 'working',
    title: 'While anyone is working',
    short: 'Working',
    body: 'Awake whenever an Employee has a Session running, and asleep again once the floor is quiet.',
  },
  {
    mode: 'off',
    title: 'Off',
    short: 'Off',
    body: 'Normal sleep. A Session running when this machine sleeps stops with it.',
  },
]

export function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
  return KEEP_AWAKE_MODES.some((entry) => entry.mode === value)
}

/** The menu header's right-hand side: which mode is on and whether it is holding right now. */
export function keepAwakeSummary(state: KeepAwakeState): string {
  const short = KEEP_AWAKE_MODES.find((entry) => entry.mode === state.mode)?.short ?? 'Off'
  return `${short} · ${state.holding ? 'holding' : 'not holding'}`
}
