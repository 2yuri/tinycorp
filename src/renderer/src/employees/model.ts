import { type Approval, AUTONOMY_LABEL, type AutonomyLevel } from '../../../shared/approvals'
import type { CapacityInfo } from '../../../shared/capacity'
import { PROVIDER_LABEL, type Provider as ProviderId } from '../../../shared/domain/providers'
import {
  type Capability,
  type Employee,
  matchesRepoFilter,
  type Provider,
  type RepoFilter,
  type RoleTemplate,
} from '../../../shared/domain/staff'
import {
  type Headcount,
  hireExceedsHeadcount,
  type ProposedEmployee,
  type StaffingRequest,
  type TeamLoad,
} from '../../../shared/hiring'
import type { SpriteState } from '../../../shared/office/projection'
import type { SessionStatus } from '../../../shared/session'
import { modelLabel, providerForModel } from '../../../shared/staff/models'
import type { AvatarPerson } from '../ui'

/** The colour of a status dot: brand success, danger, warning, or the muted slate. */
export type DotTone = 'success' | 'danger' | 'warning' | 'muted'

export interface CardState {
  label: string
  tone: DotTone
  /** Parked and off Employees are drawn faded. */
  dimmed: boolean
}

const STATE: Record<SpriteState, Omit<CardState, 'dimmed'>> = {
  working: { label: 'Working', tone: 'success' },
  reading: { label: 'Reading', tone: 'muted' },
  talking: { label: 'Talking', tone: 'success' },
  waiting: { label: 'Waiting on you', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'danger' },
  parked: { label: 'Parked', tone: 'muted' },
  out_of_budget: { label: 'Out of budget', tone: 'muted' },
  idle: { label: 'Idle', tone: 'muted' },
  starting: { label: 'Starting', tone: 'muted' },
  off: { label: 'Off', tone: 'muted' },
}

const NOT_RUNNING: Partial<Record<SessionStatus, string>> = {
  off: 'Off',
  parked: 'Parked',
  out_of_budget: 'Out of budget',
}

/** An Employee card's badge, from the office projection and the Session status. */
export function cardState(sprite: SpriteState, session: SessionStatus): CardState {
  const idle = NOT_RUNNING[session]
  if (idle) return { label: idle, tone: 'muted', dimmed: true }
  return { ...STATE[sprite], dimmed: false }
}

/**
 * The repo chips of a card: `all repos` for the wildcard, `no repos` when nothing matches,
 * otherwise the matching repo names, folded into `+N` beyond what fits next to the capability chips.
 */
export function repoChips(filter: RepoFilter, repoNames: string[], capabilityCount: number): string[] {
  if (filter.some((pattern) => pattern.trim() === '*')) return ['all repos']
  const names = repoNames.filter((name) => matchesRepoFilter(filter, name))
  if (names.length === 0) return ['no repos']
  const slots = capabilityCount >= 3 ? 1 : 2
  if (names.length <= slots) return names
  const shown = names.slice(0, Math.max(1, slots - 1))
  return [...shown, `+${names.length - shown.length}`]
}

/** Employees per catalog role, every role listed. */
export function roleCounts(roles: RoleTemplate[], employees: Employee[]): Record<string, number> {
  const counts = Object.fromEntries(roles.map((r) => [r.id, 0]))
  for (const e of employees) if (e.roleId in counts) counts[e.roleId]! += 1
  return counts
}

export function filterEmployees(employees: Employee[], roleId: string | null): Employee[] {
  return roleId === null ? employees : employees.filter((e) => e.roleId === roleId)
}

export function capBadge(info: CapacityInfo): { label: string; tone: DotTone } {
  return {
    label: `${info.running} / ${info.concurrencyCap} Sessions · ${info.parked.length} parked`,
    tone: info.running >= info.concurrencyCap ? 'warning' : 'success',
  }
}

export { PROVIDER_LABEL }

export interface HireProposal {
  approval: Approval
  /** The staffing request behind the approval; null if it is not loaded yet. */
  requestId: number | null
  /** The proposed Employee, editable before approval; null for rehires and older requests. */
  proposal: ProposedEmployee | null
  requester: { name: string; label: string; person: AvatarPerson | null }
  candidate: {
    name: string
    /** The Employee coming back on a rehire; null for someone who has no id yet. */
    person: AvatarPerson | null
    /** False when the engine picks the name at hire time. */
    named: boolean
    roleId: string | null
    roleName: string
    roleLine: string
    persona: string
    capabilities: Capability[]
    repoFilter: RepoFilter
    provider: string
    providerId: Provider
    /** The request behind the approval; null when it is not loaded yet. */
    requestId: number | null
    /** The proposed model; null runs on the provider's default (or, for a rehire, their own model). */
    model: string | null
    modelLabel: string
  }
  /** Hire approvals waiting, this one included. */
  pendingCount: number
}

/** The oldest pending hire approval, with who asked and who would join. */
export function pendingHireProposal(input: {
  approvals: Approval[]
  requests: StaffingRequest[]
  roles: RoleTemplate[]
  employees: Employee[]
  former: Employee[]
  /**
   * What a hire with no model of its own would run on: the Provider this Mac is ready for (T169).
   * The chip says the same product the engine would hire them onto.
   */
  defaultProvider: ProviderId
}): HireProposal | null {
  const pending = input.approvals.filter((a) => a.action === 'hire' && a.status === 'pending')
  const approval = pending[0]
  if (!approval) return null
  const request = input.requests.find((r) => r.approvalId === approval.id)
  const requester = [...input.employees, ...input.former].find((e) => e.id === approval.requesterId)
  const proposal = request?.proposal ?? null
  const role = input.roles.find((r) => r.id === (proposal?.roleId ?? request?.roleId))
  const back = request?.employeeId ? input.former.find((e) => e.id === request.employeeId) : undefined
  const roleName = back?.title ?? role?.name ?? 'Employee'
  const source = proposal ?? back ?? role
  const model = request?.model ?? back?.model ?? null
  // A model names the product that runs it (T139); without one it is a rehire's own Provider, and
  // without that the one this Mac is ready for.
  const provider = providerForModel(model) ?? back?.provider ?? input.defaultProvider
  return {
    approval,
    requestId: request?.id ?? null,
    proposal,
    requester: {
      name: requester?.name ?? approval.requesterId,
      label: `${requester?.title ?? 'Employee'} · hire`,
      person: requester ? { id: requester.id, sprite: requester.sprite } : null,
    },
    candidate: {
      name: proposal?.name ?? back?.name ?? request?.name ?? `New ${roleName}`,
      person: back ? { id: back.id, sprite: back.sprite } : null,
      named: Boolean(proposal ?? back ?? request?.name),
      roleId: proposal?.roleId ?? request?.roleId ?? null,
      roleName,
      roleLine: back ? `${roleName} · rehire` : `${roleName} · from the role catalog`,
      persona: source?.persona ?? approval.reason,
      capabilities: source?.capabilities ?? [],
      repoFilter: source?.repoFilter ?? [],
      provider: PROVIDER_LABEL[provider],
      providerId: provider,
      requestId: request?.id ?? null,
      model,
      modelLabel: modelLabel(provider, model),
    },
    pendingCount: pending.length,
  }
}

export interface LoadRow {
  label: string
  value: string
  /** The breached row is drawn bold. */
  strong: boolean
}

/** The TEAM LOAD card of a hire proposal, for the role being hired. */
export function teamLoadRows(
  load: TeamLoad,
  hire: { roleId: string | null; roleName: string; repoFilter: RepoFilter },
): LoadRow[] {
  const wip = load.roleLoad.find((r) => r.roleId === hire.roleId)?.wip ?? 0
  const limit = load.columns.find((c) => c.id === 'doing')?.wipLimit ?? null
  const breached = limit !== null && wip >= limit
  const busiest = load.todoByRepo.find((t) => matchesRepoFilter(hire.repoFilter, t.repo))

  return [
    {
      label: `${hire.roleName} WIP`,
      value: limit === null ? `${wip} open` : `${wip} / ${limit}${breached ? ' breached' : ''}`,
      strong: breached,
    },
    {
      label: busiest ? `Todo in ${busiest.repo}` : 'Todo',
      value: `${busiest?.count ?? 0} tickets`,
      strong: false,
    },
    {
      label: 'Avg wait in Review',
      value: load.review.averageMs === null ? '—' : formatDuration(load.review.averageMs),
      strong: false,
    },
  ]
}

/** A wait as the design writes it: `45m`, `2h 10m`, `3d 4h`. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return '<1m'
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes}m`
  const days = Math.floor(hours / 24)
  if (days === 0) return `${hours}h ${minutes % 60}m`
  return `${days}d ${hours % 24}h`
}

/** Why a hire needs a look when it would go above the maximum headcount; null when it would not. */
export function headcountNotice(name: string, headcount: Headcount, level: AutonomyLevel | null): string | null {
  if (!hireExceedsHeadcount(headcount)) return null
  const why = level === 'autonomous' ? ' That is why this hire asks you.' : ''
  return `Hiring ${name} makes ${headcount.current + 1} Employees, above the maximum headcount of ${headcount.max}.${why}`
}

const ASKS: Record<AutonomyLevel, string> = {
  supervised: 'every step asks you first',
  managed: 'hires and merges always ask you first',
  autonomous: 'hires ask you only above headcount',
}

export function autonomyLine(level: AutonomyLevel): string {
  return `${AUTONOMY_LABEL[level]} — ${ASKS[level]}`
}

/** What approving a hire does, given the cap and who already waits for a seat (by name). */
export function effectText(name: string, info: CapacityInfo, parkedNames: string[]): string {
  const start = `Approving starts a Session, gives ${name} a desk and a hello in #general.`
  if (info.running < info.concurrencyCap)
    return `${start} The cap is ${info.concurrencyCap}, so ${name} starts right away.`
  const waits = parkedNames[0] ?? name
  return `${start} The cap is ${info.concurrencyCap}, so ${waits} stays parked until a seat frees up.`
}
