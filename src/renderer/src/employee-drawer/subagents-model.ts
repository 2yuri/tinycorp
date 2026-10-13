import type { SessionStatus } from '../../../shared/session'
import {
  holdsSeat,
  type SubSessionInfo,
  type SubSessionState,
  type SubSessionWorkspace,
} from '../../../shared/sub-sessions'
import type { SubagentInfo, SubagentState } from '../../../shared/subagents'
import { formatUptime } from './drawer-model'

/** A chip's state dot (`CuLyV`): green while it works, amber before it has, grey once it is not. */
export type ChipTone = 'live' | 'wait' | 'quiet'

const SUBAGENT_TONE: Record<SubagentState, ChipTone> = { started: 'wait', running: 'live', done: 'quiet' }

const SUB_SESSION_TONE: Record<SubSessionState, ChipTone> = {
  waiting: 'wait',
  starting: 'wait',
  working: 'live',
  done: 'quiet',
  stopped: 'quiet',
}

const EMPLOYEE_TONE: Partial<Record<SessionStatus, ChipTone>> = {
  busy: 'live',
  starting: 'wait',
  out_of_budget: 'wait',
}

/**
 * One chip on the Terminal tab's strip: the Employee first, then one per Session it started of its
 * own (T163), then one per subagent its own process runs (T162).
 */
export interface StripChip {
  /** Null for the Employee's own chip. */
  id: string | null
  /** A sub-session has a terminal of its own, which picking its chip swaps in; a subagent has none. */
  kind: 'employee' | 'session' | 'subagent'
  label: string
  /** The whole task, for the chip's tooltip; the Employee's has none. */
  title: string | null
  tone: ChipTone
  /** Where a sub-session works, drawn as its chip's icon; null for the others. */
  workspace: SubSessionWorkspace | null
}

/**
 * The strip, or null when there is nothing to put beside the Employee: a Session that started no
 * Sessions and runs no subagents, or a Provider that has none, draws no strip at all.
 */
export function stripChips(
  employeeName: string,
  status: SessionStatus,
  subagents: readonly SubagentInfo[],
  subSessions: readonly SubSessionInfo[] = [],
): StripChip[] | null {
  if (subagents.length === 0 && subSessions.length === 0) return null
  return [
    {
      id: null,
      kind: 'employee',
      label: employeeName,
      title: null,
      tone: EMPLOYEE_TONE[status] ?? 'quiet',
      workspace: null,
    },
    ...subSessions.map((sub) => ({
      id: sub.id,
      kind: 'session' as const,
      label: sub.name,
      // Two Sessions in one tree say so on their chips, not only on the card.
      title: `${sub.task} — ${sub.workspace === 'own' ? 'own worktree' : `shares ${employeeName}’s worktree`}`,
      tone: SUB_SESSION_TONE[sub.state],
      workspace: sub.workspace,
    })),
    ...subagents.map((subagent) => ({
      id: subagent.id,
      kind: 'subagent' as const,
      label: subagent.name,
      title: subagent.task,
      tone: SUBAGENT_TONE[subagent.state],
      workspace: null,
    })),
  ]
}

/** The sub-session whose card is shown and whose terminal is on screen, or none. */
export function pickedSubSession(subSessions: readonly SubSessionInfo[], picked: string | null): SubSessionInfo | null {
  return subSessions.find((sub) => sub.id === picked) ?? null
}

/** Whose terminal the drawer shows: the picked sub-session's own, else the Employee's. */
export function terminalOf(employeeId: string, subSessions: readonly SubSessionInfo[], picked: string | null): string {
  return pickedSubSession(subSessions, picked)?.id ?? employeeId
}

/**
 * The card's where line (`CuLyV`): the worktree and branch a sub-session works on, and whose it
 * came off — or that it shares the parent's, which is where writes can collide.
 */
export function subSessionWhere(sub: SubSessionInfo, parentName: string): string {
  if (sub.workspace === 'shared') return `shares ${parentName}’s worktree`
  if (sub.worktreeKept) return `own worktree · ${sub.branch} · off ${parentName}’s branch`
  if (sub.branchKept) return `worktree removed · ${sub.branch} · to merge into ${parentName}’s branch`
  return 'own worktree · removed, nothing to merge'
}

/** The card's last line for a sub-session: what it runs now and what it changed, in its tone. */
export function subSessionNow(sub: SubSessionInfo): { text: string; tone: ChipTone } {
  const count = sub.filesChanged ?? 0
  const files = count > 0 ? `  ·  ${count} ${count === 1 ? 'file' : 'files'} changed` : ''
  const tone = SUB_SESSION_TONE[sub.state]
  switch (sub.state) {
    case 'waiting':
      return { text: 'Waiting for a Session seat', tone }
    case 'starting':
      return { text: 'Starting', tone }
    case 'working':
      return { text: sub.now ? `Running  ${sub.now}${files}` : `Working${files}`, tone }
    case 'done':
      return { text: `${sub.result ? 'Reported' : 'Done'}${files}`, tone }
    case 'stopped':
      return { text: `Stopped${files}`, tone }
  }
}

/**
 * The line under the card (`CuLyV`): how many of the Company's seats this Employee holds — its own
 * Session and each sub-session that is running — and that none of them can start more.
 */
export function seatLine(
  employeeName: string,
  status: SessionStatus,
  subSessions: readonly SubSessionInfo[],
  concurrencyCap: number | null,
): string | null {
  if (subSessions.length === 0) return null
  const own = status !== 'off' && status !== 'parked' ? 1 : 0
  const held = own + subSessions.filter(holdsSeat).length
  const of =
    concurrencyCap === null
      ? `${held} Session ${held === 1 ? 'seat' : 'seats'}`
      : `${held} of the Company’s ${concurrencyCap} Session seats`
  return `${employeeName} is using ${of}. Started by ${employeeName}, one level deep — none of these can start more.`
}

/** How long a sub-session has run — until now, or until it ended. */
export function subSessionElapsed(sub: SubSessionInfo, now: number): string {
  const until = sub.endedAt ? Date.parse(sub.endedAt) : now
  if (until - Date.parse(sub.startedAt) < 60_000) return '<1m'
  return formatUptime(sub.startedAt, until)!
}

/** The subagent whose card is shown: the picked one while it is still on the strip, or none. */
export function pickedSubagent(subagents: readonly SubagentInfo[], picked: string | null): SubagentInfo | null {
  return subagents.find((subagent) => subagent.id === picked) ?? null
}

/** How long it has run — until now, or until it stopped. Under a minute reads `<1m`. */
export function subagentElapsed(subagent: SubagentInfo, now: number): string {
  const until = subagent.endedAt ? Date.parse(subagent.endedAt) : now
  if (until - Date.parse(subagent.startedAt) < 60_000) return '<1m'
  return formatUptime(subagent.startedAt, until)!
}

/** The card's last line: what it is running now and how many files it changed, in its tone. */
export function subagentNow(subagent: SubagentInfo): { text: string; tone: ChipTone } {
  const files =
    subagent.filesChanged > 0
      ? `  ·  ${subagent.filesChanged} ${subagent.filesChanged === 1 ? 'file' : 'files'} changed`
      : ''
  if (subagent.state === 'done') return { text: `Done${files}`, tone: 'quiet' }
  if (subagent.now === null) {
    return { text: subagent.state === 'started' ? 'Starting' : `Working${files}`, tone: SUBAGENT_TONE[subagent.state] }
  }
  return { text: `Running  ${subagent.now}${files}`, tone: 'live' }
}
