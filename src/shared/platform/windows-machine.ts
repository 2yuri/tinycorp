import type { GitBashCheck } from './git-bash'

/**
 * What the first launch has to know about a Windows machine before it can ask the boss anything
 * (T249), and the words both screens that ask are written in.
 *
 * It is one answer rather than three channels because it is one question — *what is this machine*
 * — asked from lookups the app has already paid for: the distro listing the Providers card was
 * drawn from, and a handful of `stat` calls. Nothing here starts a distro.
 *
 * Off Windows it says so and holds nothing else. Neither screen is drawn there: a Mac has one
 * place a CLI can be, and a card saying so would be a card that tells the boss nothing.
 */
export interface WindowsMachine {
  /** Whether this is a Windows desktop. False on a Mac and on a Linux one. */
  windows: boolean
  /** Every distro this Windows has, the default one first. Empty with no WSL, and off Windows. */
  distros: readonly WindowsDistro[]
  /** Git for Windows' `bash.exe`, and where it was looked for. */
  gitBash: GitBashCheck
}

export interface WindowsDistro {
  name: string
  /** The distro `wsl.exe` opens when nobody names one — the one the boss's own `wsl` gives them. */
  default: boolean
}

/** A machine nobody has asked about yet, and what every non-Windows desktop answers. */
export const NO_WINDOWS_MACHINE: WindowsMachine = {
  windows: false,
  distros: [],
  gitBash: { path: null, lookedIn: [] },
}

/* The first-launch step (frames `laIUL`, `QFh5u`). */

export const SETUP_TITLE = 'Set up Tiny Corp on Windows'

export const SETUP_SUB = 'Two choices for this computer. You can change them any time in Your profile.'

/** The window's own title while the step is up. */
export const SETUP_WINDOW_TITLE = 'Set up TinyCorp'

export const SETUP_CONTINUE = 'Continue'

/* The first question, asked the same way on both screens. */

export const TEAM_RUNTIME_TITLE = 'Where your team runs'

export const TEAM_RUNTIME_SUB =
  "Every Employee's CLI starts here. One Provider can still run somewhere else, in Your profile → Providers."

export const WINDOWS_OPTION_TITLE = 'Windows'
export const WSL_OPTION_TITLE = 'WSL'

/**
 * What running on Windows itself means. `names` is whichever Providers the catalogue says need Git
 * for Windows, so the screen names no product of its own (`no-provider-names.test.ts`).
 */
export function windowsOptionDesc(names: readonly string[]): string {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
  const needs = names.length === 1 ? 'needs' : 'need'
  return list
    ? `Runs each CLI on Windows itself. ${list} ${needs} Git for Windows here.`
    : 'Runs each CLI on Windows itself.'
}

export const WSL_OPTION_DESC = 'Runs each CLI inside your Linux distro — what most dev tools expect.'

export const DISTRO_TITLE = 'WSL distribution'

export const DISTRO_SUB = "Windows' default distro, or one you installed."

/* Your profile's card (frame `t1VDYQ`). */

export const ON_THIS_PC_TITLE = 'On this PC'

export const ON_THIS_PC_SUB =
  'Where your team runs here, and how its terminal behaves. Only this PC — every Company on it.'

/**
 * The same card on a Mac or a Linux desktop, where there is one place a CLI can be and no Git for
 * Windows to look for: the right button is the only question left, and it is a real one — the
 * frame is Windows', so this line is not in it.
 */
export const ON_THIS_MACHINE_SUB = "How an Employee's terminal behaves here. Only this computer — every Company on it."

/** What the card is called where there is no PC to speak of. */
export const ON_THIS_MACHINE_TITLE = 'On this computer'
