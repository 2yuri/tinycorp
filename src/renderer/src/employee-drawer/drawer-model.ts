import type { SkillRow } from '../../../shared/catalogue/skills'
import { skillsMeta } from '../../../shared/catalogue/skills'
import type { Column, Ticket } from '../../../shared/domain/board'
import { PROVIDER_LABEL, PROVIDER_SKILLS_FOLDER } from '../../../shared/domain/providers'
import { type Employee, PERMISSION_META_LABEL, type Provider } from '../../../shared/domain/staff'
import type { SpriteState } from '../../../shared/office/projection'
import { machineWords } from '../../../shared/platform/machine-words'
import type { SessionStatus } from '../../../shared/session'
import { hostPlatform } from '../chrome'

export type DrawerTab = 'terminal' | 'ticket' | 'chats' | 'memory'

/** The office state as the drawer's badge shows it, with the dot's tone. */
export const STATE_BADGE: Record<SpriteState, { label: string; tone: 'live' | 'wait' | 'stop' | 'quiet' }> = {
  working: { label: 'Working', tone: 'live' },
  reading: { label: 'Reading', tone: 'live' },
  talking: { label: 'Talking', tone: 'live' },
  starting: { label: 'Starting', tone: 'quiet' },
  idle: { label: 'Idle', tone: 'quiet' },
  waiting: { label: 'Waiting on you', tone: 'wait' },
  blocked: { label: 'Blocked', tone: 'stop' },
  parked: { label: 'Parked', tone: 'quiet' },
  out_of_budget: { label: 'Out of budget', tone: 'stop' },
  off: { label: 'Off', tone: 'quiet' },
}

export { PERMISSION_META_LABEL, PROVIDER_LABEL }

/**
 * What the handoff button offers, and why it is off (frame `zOVl6`). Only one side can drive a
 * Session at a time, so the button waits until the Session has no process behind it.
 */
export const COPY_HANDOFF_LABEL = 'Copy the command to open this Session in your terminal'
export const HANDOFF_WHILE_LIVE = 'Stop the Session first: two terminals on one Session would talk over each other.'

/** The statuses with no process behind them: nothing there to talk over. */
const PROCESSLESS: SessionStatus[] = ['off', 'parked']

/** Why the handoff button is off, or null when it can be pressed. */
export function handoffBlocked(status: SessionStatus): string | null {
  return PROCESSLESS.includes(status) ? null : HANDOFF_WHILE_LIVE
}

/** What the toast reads back after a copy (frame `zOVl6`). */
export function copiedLine(shown: string): string {
  return `Copied: ${shown}`
}

const SESSION_META: Record<SessionStatus, string> = {
  off: 'Session off',
  starting: 'Session starting',
  idle: 'Session live',
  busy: 'Session live',
  parked: 'Session parked',
  out_of_budget: 'Out of budget',
}

export function sessionMeta(status: SessionStatus): string {
  return SESSION_META[status]
}

/** What an Employee whose Provider is missing cannot do, and how the boss fixes it. */
export const PROVIDER_MISSING_HINT = 'Install it, or move this Employee to another Provider.'

/**
 * The Provider item on the meta strip. A Provider whose CLI is not on this machine says so here
 * rather than letting the Start button fail: `<Provider> — not installed`.
 */
export function providerMeta(
  provider: Provider,
  ready: boolean,
  labels: Record<string, string> = PROVIDER_LABEL,
): string {
  return ready ? labels[provider]! : `${labels[provider]} — not installed`
}

/**
 * The skills item on the meta strip (T137), or null when there is nothing to say. An Employee that
 * holds skills on a Provider whose product reads none says `<Provider> — no skills`: the grant
 * reached nothing, and the drawer says so rather than letting the app pretend it did.
 */
export function skillsItem(
  employee: Pick<Employee, 'provider' | 'skills'>,
  catalogue: readonly SkillRow[],
  labels: Record<string, string> = PROVIDER_LABEL,
  folders: Record<string, string | null> = PROVIDER_SKILLS_FOLDER,
): string | null {
  const held = employee.skills
    .map((id) => catalogue.find((skill) => skill.id === id))
    .filter((skill): skill is SkillRow => skill !== undefined)
  return skillsMeta(held, labels[employee.provider]!, folders[employee.provider] !== null)
}

/** Why Start Session is out of reach, or null when it is not. */
export function startBlocked(
  provider: Provider,
  ready: boolean,
  labels: Record<string, string> = PROVIDER_LABEL,
  platform: string = hostPlatform(),
): string | null {
  return ready
    ? null
    : `${labels[provider]} is not installed on ${machineWords(platform).machine}. ${PROVIDER_MISSING_HINT}`
}

/** `<Role> · <capabilities>`, the line under the name. */
export function roleLine(employee: Pick<Employee, 'title' | 'capabilities'>): string {
  return employee.capabilities.length === 0 ? employee.title : `${employee.title} · ${employee.capabilities.join(', ')}`
}

/** How long a Session has run, as `4h 12m`; null when it is not running. */
export function formatUptime(startedAt: string | null, now: number): string | null {
  if (startedAt === null) return null
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes / 60) % 24
  const rest = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rest}m`
  return `${rest}m`
}

/**
 * Open work first: what is in progress, then what waits for review or a test, then what is queued,
 * and last what is still being planned.
 *
 * Every column has a rank, and a record over `Column` is what makes the compiler ask for it. This
 * was a list of the three columns someone remembered, and `indexOf` gave -1 for the two that were
 * left out, so a ticket in Planning sorted ahead of the one in Doing and was the one the drawer's
 * card showed (TI-2). A sixth column would do it again; now it does not compile until it is ranked.
 */
const OPEN_ORDER: Record<Column, number> = {
  doing: 0,
  review: 1,
  testing: 2,
  todo: 3,
  planning: 4,
  /** Filtered out before the sort; here so no column can be forgotten. */
  done: 5,
}

/** The Employee's tickets that are not done, the one being worked on first. */
export function openTickets(tickets: Ticket[], employeeId: string): Ticket[] {
  return tickets
    .filter((t) => t.assigneeId === employeeId && t.column !== 'done')
    .sort((a, b) => OPEN_ORDER[a.column] - OPEN_ORDER[b.column])
}

export function subtaskProgress(ticket: Ticket): { done: number; total: number; percent: number } {
  const total = ticket.subtasks.length
  const done = ticket.subtasks.filter((s) => s.done).length
  return { done, total, percent: total === 0 ? 0 : (done / total) * 100 }
}
