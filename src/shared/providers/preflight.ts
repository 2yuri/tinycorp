/**
 * Whether the CLI products this Company's Employees are hired on can run an Employee (T129, T135).
 *
 * Every Employee is a session of some coding CLI on the boss's own subscription (decision 3), so a
 * missing command or a missing login is the one thing that stops the whole app — and until T129
 * nothing said so. T129 said it for one Provider; T135 makes it every Provider the Company is
 * actually hired on, by moving the check itself onto the adapter (`checkCli`) and leaving this file
 * holding only the shape those words arrive in.
 *
 * The words themselves are the Provider's, written by its adapter and carried here as data: the
 * renderer cannot load an adapter, and a screen that knew one product's commands is exactly what
 * this ticket took out. So nothing in this file names a product.
 */

import type { Provider } from '../domain/providers'
import type { ProviderPlacement, ProviderRuntime } from '../platform/wsl'

/**
 * One labelled row of the card's mono box (frame `c8knu`, T167).
 *
 * A Mac has one place to install a CLI, so the card lists commands and nothing else. A Windows has
 * two — Windows itself and any WSL distro — and both are right, so the rows have to say which is
 * which: the shell they are typed in, and the prompt character that shell shows. A Provider with
 * one place still answers with {@link ProviderCheck.commands} and this stays empty.
 */
export type PreflightStepKind = 'install' | 'sign-in'

export interface PreflightStep {
  /**
   * What the row is for: putting the CLI in one place, or signing it in wherever it was put.
   *
   * The Windows chooser draws one place at a time (T250, frame `c8knu`) — its segment's install row
   * and the sign-in that follows it — so which row is which has to be a field. Reading it off the
   * label would be this file guessing at words the adapter wrote.
   */
  kind: PreflightStepKind
  /**
   * The place this row is typed in, for an `install` row. Null on the sign-in, which happens in
   * whichever place the boss chose and so belongs to none of them.
   *
   * It is the runtime itself and not its name because a screen has to *compare* it: the place the
   * boss picked in Your profile is stored as a runtime key (T249), and the chooser opens on the
   * segment that matches it.
   */
  runtime: ProviderRuntime | null
  /** `Windows`, `WSL · Ubuntu`, `Then sign in`. */
  label: string
  /** The aside after the label: `PowerShell`, `bash`, `where you installed it`. Empty for none. */
  hint: string
  /** What the row is drawn behind: `>` for PowerShell, `$` for a shell. */
  prompt: string
  command: string
}

/**
 * What a Provider's check found. `missing` and `signed-out` stop every Employee on that Provider;
 * `warning` is worth saying and stops nothing; `ready` draws nothing in the Launcher and one quiet
 * line in Company settings.
 */
export type PreflightState = 'ready' | 'missing' | 'signed-out' | 'warning'

/**
 * One Provider's answer, in the shape of the card of frame `KB9AX`: the same four rows, whichever
 * product filled them in.
 */
export interface ProviderCheck {
  state: PreflightState
  title: string
  /** What is wrong, in one sentence. A refused Session says this one back. */
  body: string
  /** The sentence that introduces the commands; empty when there are none. */
  lead: string
  /** One per row of the mono box, each drawn behind a `$`. */
  commands: string[]
  /** The line beside `Check again`. */
  note: string
  /**
   * Who the CLI says is signed in — an email, an account name — or null when it will not say.
   *
   * Your profile's Providers card draws it under the product (frame `Oykzs`). Null is an answer:
   * a CLI that reports no account leaves the line out rather than have one invented for it, and
   * a CLI nobody is signed into reports none by definition.
   */
  account: string | null
  /** The plan the CLI names, drawn after the product's name; null when it names none. */
  plan: string | null
  /**
   * The same commands, said one place at a time (T167). Present only where there is more than one
   * place to install a CLI — a Windows with WSL on it — and the card draws these instead of
   * {@link commands} when it is.
   */
  steps?: readonly PreflightStep[]
  /** `Looked in: Windows PATH · WSL: Ubuntu`. Empty where there was one place to look. */
  lookedIn?: string
  /**
   * Where this Provider's CLI was found on this machine and where its Sessions run (T167). Null
   * off Windows, where there is one place and a row about it would be noise.
   */
  placement?: ProviderPlacement | null
}

/** One Provider's answer, as the app remembers it: whose it is, and when it was asked. */
export interface ProviderPreflight extends ProviderCheck {
  provider: Provider
  /** When the check that produced this answer finished, ISO. `Check again` moves it. */
  checkedAt: string
  /**
   * Whether an Employee of the open Company is hired on this Provider (T169).
   *
   * It is what decides how hard the answer bites. An Employee hired on a CLI that cannot run is
   * stopped whatever else is on the Mac, so a blocked answer with this set takes the window. Before
   * the first hire nobody is stopped by anything, and any one Provider that can run an Employee is
   * enough to use TinyCorp — so the cards only appear when there is none.
   *
   * Read at each ask rather than cached with the answer: who is hired changes, what a CLI said does
   * not.
   */
  hired: boolean
}

/** The line every blocked state carries beside `Check again`; the screen has to keep this promise. */
export const PREFLIGHT_STILL_OPENS = 'The rest of the app still opens — nothing runs until this is sorted.'

/** Whether no Session on this Provider can start while this is its state. */
export function preflightBlocks(check: Pick<ProviderCheck, 'state'>): boolean {
  return check.state === 'missing' || check.state === 'signed-out'
}

/**
 * The Providers whose cards take the window.
 *
 * Inside a Company it is every Provider its Employees are hired on that cannot run one: those
 * Employees are stopped, and another product being installed is no comfort to them.
 *
 * Before the first hire it is the other way round (T169). Claude, Codex and OpenCode are equals and
 * a boss needs one of them, so as long as any answer is not blocked there is nothing to say and
 * this is empty. When none of them can run an Employee every card is drawn, in catalogue order,
 * because at that point the boss has no way in at all.
 */
export function blockedProviders(preflight: readonly ProviderPreflight[]): ProviderPreflight[] {
  const blocked = preflight.filter(preflightBlocks)
  if (preflight.some((entry) => entry.hired)) return blocked
  return blocked.length === preflight.length ? blocked : []
}

/**
 * What a refused Session start says back: that Provider's own two sentences, so the boss reads the
 * same thing here as on the Launcher rather than watching a terminal fill with nothing. Null when
 * nothing is wrong, and null when nobody has asked yet — a Session is never refused on a guess.
 */
export function preflightRefusal(check: ProviderCheck | null | undefined): string | null {
  if (!check || !preflightBlocks(check)) return null
  return `${check.title}. ${check.body}`
}
