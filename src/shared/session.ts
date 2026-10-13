import type { SubSessionInfo } from './sub-sessions'
import type { SubagentInfo } from './subagents'

/**
 * Where an Employee's Session is in its life, learned only from provider hooks:
 * `off` no process, `starting` spawned and not ready, `idle` waiting for a prompt, `busy` working.
 * `parked` no process, waiting for a concurrency slot; `out_of_budget` running, but the
 * subscription limit was hit and no prompt is pushed until it resets.
 */
export const SESSION_STATUSES = ['off', 'starting', 'idle', 'busy', 'parked', 'out_of_budget'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

/**
 * A Session that stopped in its own terminal to ask the boss before it acts (T165). The app never
 * answers it: it says who is waiting and on what, and the boss types the answer in the terminal.
 */
export interface SessionAsk {
  /** What it asks, in the Provider's own words: the tool and its target, e.g. `Write src/api/usage.ts`. */
  what: string
  /** When it started asking. */
  since: string
}

/** Longest `what` an ask carries; a CLI can hand over a whole command, and none of it belongs here. */
export const ASK_WHAT_MAX = 80

/**
 * The sentence earlier builds wrote into `<company folder>/CLAUDE.md`. One file for the whole
 * Company meant the last Employee to start owned it and every other one read that identity, so the
 * app stopped writing it; the line is kept only to recognise a stale file and delete it, never to
 * touch a `CLAUDE.md` the boss wrote.
 */
export const GENERATED_INSTRUCTIONS_MARKER = 'This file is written by the Company at every start.'

export interface SessionInfo {
  employeeId: string
  status: SessionStatus
  /**
   * The provider's session id: chosen by the app at spawn, or the one the provider named itself
   * once its first signal says so. Null until the first spawn.
   */
  providerSessionId: string | null
  /** Name of the last hook event received, e.g. `Stop`. */
  lastHook: string | null
  lastHookAt: string | null
  /** When the running Session was spawned; null while there is no process. */
  startedAt: string | null
  /**
   * Whether this Employee's Provider can be started at all: the app has an adapter for it and
   * its CLI is on this machine. The drawer says so rather than letting the spawn fail.
   */
  providerReady: boolean
  /**
   * The subagents the running Session runs inside its own process, as its hooks report them
   * (T162). Empty while it is off, and always for a Provider that has none.
   */
  subagents: SubagentInfo[]
  /**
   * The Sessions this Employee started of its own (T163), each with its own process, terminal and
   * seat, running or ended. Empty for an Employee that started none.
   */
  subSessions: SubSessionInfo[]
  /**
   * What this Session stopped to ask the boss in its terminal, or null when it is asking nothing
   * (T165). It is set by the Provider's own permission signal and cleared by the next signal that
   * says the Session moved on; a `skip-permissions` Session never asks.
   */
  asking: SessionAsk | null
  /**
   * Set while this Employee works somewhere other than its own Provider because that Provider ran
   * out (T173, frame `tdI8o`). Null whenever it is on its own.
   */
  routedTo: SessionRouting | null
}

/** An Employee running on a fallback Provider, as the drawer chip and the office label read it. */
export interface SessionRouting {
  /** The Provider it is running on now. */
  provider: string
  /** The model it was started with there, or null for that product's default. */
  model: string | null
  /** The Provider it came from, and will go back to when that one resets. */
  from: string
  /** When the Provider it came from resets, ISO, or null when nothing has said. */
  resetsAt: string | null
  /** Whether it moves back on its own once {@link from} resets. */
  movesBack: boolean
}

/**
 * The command that opens an Employee's Session in the boss's own terminal (T164). It is built by
 * the Provider adapter — the CLI, its resume args and the same permission and model args the app
 * spawns with — and never carries the app's own half of a Session: no MCP config, no hook token
 * and no appended system prompt.
 *
 * Nothing runs it. The drawer's button puts {@link command} on the clipboard and says so.
 */
export interface SessionHandoff {
  /** The whole command, shell-quoted, as it goes on the clipboard. */
  command: string
  /** The same command with the session id shortened, as the toast reads it back (frame `zOVl6`). */
  shown: string
}

/** An Employee `Resume all` owed a Session that could not be started, and why. */
export interface ResumeFailure {
  employeeId: string
  name: string
  reason: string
}

/**
 * What `Resume all` came to (T217), so the boss hears it wherever they pressed it — the office
 * header, the application menu, the menu-bar item or `/resume`.
 *
 * `Resume all` used to answer only whether the Company was still paused, and a resume that brought
 * nobody back looked exactly like one that brought the whole team: the failures went to the log and
 * the boss read nothing. This is what the engine knows about the attempt, and it is one word longer
 * than the boss's question on purpose — {@link from} is why nothing came back, not just that
 * nothing did.
 */
export interface ResumeAll {
  /** Whether the Company is still paused. False once the pause is lifted, which it always is. */
  paused: boolean
  /** Employees whose Sessions are starting again, in desk order. */
  resumed: string[]
  /** Employees the pause owed a Session that could not be started. */
  failed: ResumeFailure[]
  /**
   * Where the list of Sessions to bring back came from: `held` the Employees the pause stopped,
   * `restoring` what a reopen still owed a Session when the pause held nobody, and `nobody` when
   * neither knew of one — a Company paused with every Session already off.
   */
  from: 'held' | 'restoring' | 'nobody'
}

const sessionCount = (n: number) => (n === 1 ? '1 Session' : `${n} Sessions`)

/** The one line the boss reads after `Resume all`, wherever they pressed it. */
export function resumeAllNote(outcome: ResumeAll): string {
  const failures = outcome.failed.map(({ name, reason }) => `${name} could not start: ${reason}`).join('; ')
  if (outcome.from === 'nobody') {
    return 'Nothing to resume: no Session was running when this Company was paused. The pause is lifted, so you can start an Employee from the office.'
  }
  if (outcome.resumed.length === 0) return `Nothing came back. ${failures}.`
  if (failures) return `Resuming ${sessionCount(outcome.resumed.length)}. ${failures}.`
  return `Resuming ${sessionCount(outcome.resumed.length)}.`
}

/**
 * The same line, but only when something needs saying: null when every Session the pause held is
 * coming back, which is the case that needs no words — the office shows it.
 */
export function resumeAllProblem(outcome: ResumeAll): string | null {
  if (outcome.from !== 'nobody' && outcome.failed.length === 0) return null
  return resumeAllNote(outcome)
}
