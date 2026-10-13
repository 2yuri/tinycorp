import type { Employee } from '../../../shared/domain/staff'
import type { AppliedNow, StaleSession } from '../../../shared/spawn-settings'
import type { Sessions } from './sessions'

/**
 * The settings cards' side of what a Session bakes in at its spawn (T237).
 *
 * The Sessions know which of them are still running an old setting; this says who they are, and
 * does what `Apply now` means: every idle one is restarted where it stands, and a busy one is
 * written down and restarted the moment its turn ends. Nothing here interrupts an Employee —
 * mid-turn is the one state this whole feature exists to stay out of.
 */
export interface SpawnSettingsService {
  /** Who is still on the old setting, in desk order, and which of the three each one is behind on. */
  stale(): StaleSession[]
  /** Restarts every idle stale Session now, and waits for the turn of every busy one. */
  applyNow(): AppliedNow
  /**
   * What saving an Employee does to its running Session (T268), with no button to press: restarted
   * where it stands when it is idle, and the moment its turn ends when it is not. A Session reads
   * its MCP servers, skills and instructions only when it is spawned, so an edit that waited for
   * the next one would sit unused for as long as the Session lives.
   */
  applyEdits(): AppliedNow
  /**
   * Called whenever what {@link stale} answers could have moved: a Session started, stopped or
   * finished a turn. Not when the boss writes a setting — that is answered on the spot to whoever
   * wrote it, and the card that did reads this again itself.
   */
  onChange(listener: () => void): () => void
}

export interface SpawnSettingsOptions {
  /** The current Company's Sessions, as everyone else sees them: parked and out-of-budget included. */
  sessions: Sessions
  /** The current Company's Employees, to name them. */
  employees(): Employee[]
  log(line: string): void
}

export function createSpawnSettings({ sessions, employees, log }: SpawnSettingsOptions): SpawnSettingsService {
  /**
   * Employees whose Session `Apply now` could not restart yet, by id.
   *
   * It outlives a Company switch on purpose: an Employee of another Company that is still working
   * is owed its restart, and an id belongs to one Employee. What takes an entry out is the restart
   * itself, the Session ending, or the boss changing the setting back.
   */
  const waiting = new Set<string>()
  const listeners = new Set<() => void>()
  sessions.onChange(() => {
    for (const listener of listeners) listener()
  })

  /** Everything that is not idle is busy here: starting, parked and out of budget alike. */
  const staleOf = (): StaleSession[] => {
    const named = employees()
    const status = new Map(sessions.list().map((session) => [session.employeeId, session.status]))
    return sessions.staleSessions().map(({ employeeId, settings }) => ({
      employeeId,
      name: named.find((employee) => employee.id === employeeId)?.name ?? 'An Employee',
      busy: status.get(employeeId) !== 'idle',
      settings,
    }))
  }

  /** True when it really restarted. A Session that stopped or caught up in the meantime is let go. */
  function restart(employeeId: string): boolean {
    try {
      return sessions.restart(employeeId)
    } catch (error) {
      log(`Settings: could not restart Employee ${employeeId}: ${(error as Error).message}`)
      return false
    }
  }

  /*
   * The turn ends, and the Session the boss asked for takes its place. A Session that ended
   * instead is owed nothing: the next one it starts is spawned from the settings as they are.
   *
   * The stream carries every open Company's Sessions, which is right — an Employee of a Company
   * the boss has since switched away from is still owed the restart they asked for.
   */
  sessions.onActivity(({ employeeId, status }) => {
    if (!waiting.has(employeeId)) return
    if (status === 'off') waiting.delete(employeeId)
    else if (status === 'idle' && restart(employeeId)) waiting.delete(employeeId)
  })

  return {
    stale: staleOf,

    applyNow() {
      const applied: AppliedNow = { restarted: [], waiting: [] }
      for (const session of staleOf()) {
        if (!session.busy && restart(session.employeeId)) {
          applied.restarted.push(session.employeeId)
          continue
        }
        waiting.add(session.employeeId)
        applied.waiting.push(session.employeeId)
      }
      return applied
    },

    applyEdits() {
      const applied: AppliedNow = { restarted: [], waiting: [] }
      const status = new Map(sessions.list().map((session) => [session.employeeId, session.status]))
      for (const employeeId of sessions.editedSessions()) {
        // Already owed a restart: its turn ending spawns it from whatever was saved last.
        if (waiting.has(employeeId)) continue
        if (status.get(employeeId) === 'idle' && restart(employeeId)) {
          applied.restarted.push(employeeId)
          continue
        }
        waiting.add(employeeId)
        applied.waiting.push(employeeId)
      }
      if (applied.restarted.length > 0 || applied.waiting.length > 0) {
        log(
          `Employee saved: restarted ${applied.restarted.length}, waiting on ${applied.waiting.length} to finish a turn`,
        )
      }
      return applied
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
