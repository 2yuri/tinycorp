import { describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { CapacityInfo } from '../../../shared/capacity'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import type { StaffingRequest, TeamLoad } from '../../../shared/hiring'
import {
  autonomyLine,
  capBadge,
  cardState,
  effectText,
  filterEmployees,
  formatDuration,
  headcountNotice,
  pendingHireProposal,
  repoChips,
  roleCounts,
  teamLoadRows,
} from './model'

const role = (id: string, name: string, extra: Partial<RoleTemplate> = {}): RoleTemplate => ({
  id,
  name,
  persona: `${name} persona`,
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
  ...extra,
})

const employee = (id: string, roleId: string, extra: Partial<Employee> = {}): Employee => ({
  id,
  name: id,
  roleId,
  title: roleId,
  mcpServers: [],
  skills: [],
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 0,
  sprite: 0,
  createdAt: '2026-09-17T09:00:00.000Z',
  ...extra,
})

const capacity = (extra: Partial<CapacityInfo> = {}): CapacityInfo => ({
  concurrencyCap: 5,
  running: 2,
  parked: [],
  budget: null,
  outages: [],
  ...extra,
})

describe('cardState', () => {
  it('labels the office state and colours its dot', () => {
    expect(cardState('working', 'busy')).toEqual({ label: 'Working', tone: 'success', dimmed: false })
    expect(cardState('blocked', 'idle')).toEqual({ label: 'Blocked', tone: 'danger', dimmed: false })
    expect(cardState('waiting', 'idle')).toEqual({ label: 'Waiting on you', tone: 'warning', dimmed: false })
    expect(cardState('reading', 'busy')).toEqual({ label: 'Reading', tone: 'muted', dimmed: false })
  })

  it('shows parked and off Employees dimmed, whatever the office says', () => {
    expect(cardState('off', 'parked')).toEqual({ label: 'Parked', tone: 'muted', dimmed: true })
    expect(cardState('off', 'off')).toEqual({ label: 'Off', tone: 'muted', dimmed: true })
    expect(cardState('off', 'out_of_budget')).toEqual({ label: 'Out of budget', tone: 'muted', dimmed: true })
  })
})

describe('repoChips', () => {
  const repos = ['web-app', 'billing-api', 'infra']

  it('says all repos for the wildcard and no repos when nothing matches', () => {
    expect(repoChips(['*'], repos, 1)).toEqual(['all repos'])
    expect(repoChips([], repos, 1)).toEqual(['no repos'])
    expect(repoChips(['mobile*'], repos, 1)).toEqual(['no repos'])
  })

  it('resolves globs to repo names and folds the rest into +N', () => {
    expect(repoChips(['web-app'], repos, 1)).toEqual(['web-app'])
    expect(repoChips(['*-a*'], repos, 1)).toEqual(['web-app', 'billing-api'])
    expect(repoChips(['web-app', 'billing-api', 'infra'], repos, 1)).toEqual(['web-app', '+2'])
    expect(repoChips(['web-app', 'billing-api'], repos, 3)).toEqual(['web-app', '+1'])
  })
})

describe('roleCounts and filterEmployees', () => {
  const roles = [role('pm', 'PM'), role('frontend', 'Frontend'), role('hr', 'HR')]
  const team = [employee('ada', 'frontend'), employee('bo', 'frontend'), employee('pam', 'pm')]

  it('counts Employees per catalog role, zero included', () => {
    expect(roleCounts(roles, team)).toEqual({ pm: 1, frontend: 2, hr: 0 })
  })

  it('keeps everyone without a role filter and only that role with one', () => {
    expect(filterEmployees(team, null).map((e) => e.id)).toEqual(['ada', 'bo', 'pam'])
    expect(filterEmployees(team, 'frontend').map((e) => e.id)).toEqual(['ada', 'bo'])
  })
})

describe('capBadge', () => {
  it('reads running over cap and parked, amber when every seat is taken', () => {
    expect(capBadge(capacity({ running: 5, parked: ['a', 'b', 'c'] }))).toEqual({
      label: '5 / 5 Sessions · 3 parked',
      tone: 'warning',
    })
    expect(capBadge(capacity())).toEqual({ label: '2 / 5 Sessions · 0 parked', tone: 'success' })
  })
})

const approval = (extra: Partial<Approval> = {}): Approval => ({
  id: 7,
  action: 'hire',
  requesterId: 'hera',
  subject: 'a new Frontend',
  ticketId: null,
  pullRequest: null,
  reason: 'Frontend is the bottleneck.',
  status: 'pending',
  decisionReason: null,
  channelId: 'general',
  messageId: 40,
  createdAt: '2026-09-17T09:48:00.000Z',
  decidedAt: null,
  ...extra,
})

const request = (extra: Partial<StaffingRequest> = {}): StaffingRequest => ({
  id: 3,
  kind: 'hire',
  requesterId: 'hera',
  roleId: 'frontend',
  employeeId: null,
  name: null,
  reason: 'Frontend is the bottleneck.',
  proposal: null,
  model: null,
  approvalId: 7,
  status: 'pending',
  createdAt: '2026-09-17T09:48:00.000Z',
  ...extra,
})

describe('pendingHireProposal', () => {
  const roles = [role('frontend', 'Frontend', { persona: 'Ships UI.', repoFilter: ['web-app'] })]
  const hera = employee('hera', 'hr', { name: 'Hera', title: 'HR' })

  it('pairs the oldest pending hire approval with its request and candidate', () => {
    const proposal = pendingHireProposal({
      approvals: [approval({ id: 6, action: 'merge' }), approval(), approval({ id: 8 })],
      requests: [request({ approvalId: 8, id: 4 }), request({ name: 'Lyra' })],
      roles,
      employees: [hera],
      former: [],
      defaultProvider: 'claude',
    })
    expect(proposal).toMatchObject({
      approval: { id: 7 },
      requester: { name: 'Hera', label: 'HR · hire' },
      candidate: {
        name: 'Lyra',
        roleLine: 'Frontend · from the role catalog',
        persona: 'Ships UI.',
        capabilities: ['code'],
        repoFilter: ['web-app'],
        provider: 'Claude Code',
        requestId: 3,
        model: null,
        modelLabel: 'Default model',
      },
      pendingCount: 2,
    })
  })

  it('names an unnamed hire at approval time, and a rehire after the former Employee', () => {
    const unnamed = pendingHireProposal({
      approvals: [approval()],
      requests: [request()],
      roles,
      employees: [hera],
      former: [],
      defaultProvider: 'claude',
    })
    expect(unnamed?.candidate.name).toBe('New Frontend')
    const juno = employee('juno', 'frontend', { name: 'Juno', title: 'Frontend', persona: 'Back again.' })
    const rehire = pendingHireProposal({
      approvals: [approval()],
      requests: [request({ employeeId: 'juno' })],
      roles,
      employees: [hera],
      former: [juno],
      defaultProvider: 'claude',
    })
    expect(rehire?.candidate).toMatchObject({ name: 'Juno', roleLine: 'Frontend · rehire', persona: 'Back again.' })
  })

  it('shows the stored proposal, which wins over the role, and makes it editable', () => {
    const proposal = pendingHireProposal({
      approvals: [approval()],
      requests: [
        request({
          model: 'opus-5-deep',
          proposal: {
            name: 'Lyra',
            roleId: 'devops',
            persona: 'Edited persona.',
            capabilities: ['code', 'review'],
            repoFilter: ['infra'],
            areas: [],
            model: 'opus-5-deep',
          },
        }),
      ],
      roles: [...roles, role('devops', 'DevOps')],
      employees: [hera],
      former: [],
      defaultProvider: 'claude',
    })
    expect(proposal).toMatchObject({
      requestId: 3,
      proposal: { name: 'Lyra', roleId: 'devops' },
      candidate: {
        name: 'Lyra',
        named: true,
        roleId: 'devops',
        roleName: 'DevOps',
        roleLine: 'DevOps · from the role catalog',
        persona: 'Edited persona.',
        capabilities: ['code', 'review'],
        repoFilter: ['infra'],
        model: 'opus-5-deep',
        modelLabel: 'Opus 5 · high',
      },
    })
  })

  it('shows the proposed model, else a rehire’s own model', () => {
    const proposed = pendingHireProposal({
      approvals: [approval()],
      requests: [request({ model: 'opus-5-deep' })],
      roles,
      employees: [hera],
      former: [],
      defaultProvider: 'claude',
    })
    expect(proposed?.candidate).toMatchObject({ model: 'opus-5-deep', modelLabel: 'Opus 5 · high' })
    const juno = employee('juno', 'frontend', { name: 'Juno', model: 'sonnet-5-fast' })
    const rehire = pendingHireProposal({
      approvals: [approval()],
      requests: [request({ employeeId: 'juno' })],
      roles,
      employees: [hera],
      former: [juno],
      defaultProvider: 'claude',
    })
    expect(rehire?.candidate).toMatchObject({ model: 'sonnet-5-fast', modelLabel: 'Sonnet 5 · low' })
  })

  it('is null without a pending hire', () => {
    expect(
      pendingHireProposal({
        approvals: [approval({ status: 'approved' })],
        requests: [],
        roles,
        employees: [],
        former: [],
        defaultProvider: 'claude',
      }),
    ).toBeNull()
  })
})

describe('teamLoadRows', () => {
  const load: TeamLoad = {
    employees: [],
    unassigned: [],
    columns: [{ id: 'doing', wipLimit: 3, count: 3, overLimit: false }],
    skillGaps: [],
    roles: [],
    roleLoad: [
      { roleId: 'frontend', name: 'Frontend', employees: 2, wip: 3 },
      { roleId: 'backend', name: 'Backend', employees: 1, wip: 1 },
    ],
    todoByRepo: [
      { repo: 'web-app', count: 5 },
      { repo: 'api', count: 2 },
    ],
    blocked: 0,
    review: { averageMs: (2 * 60 + 10) * 60_000, stays: 4 },
    headcount: { current: 3, max: null },
  }

  it('reads the role WIP against the Doing limit, the busiest Todo repo it can work in, and the review wait', () => {
    expect(teamLoadRows(load, { roleId: 'frontend', roleName: 'Frontend', repoFilter: ['*'] })).toEqual([
      { label: 'Frontend WIP', value: '3 / 3 breached', strong: true },
      { label: 'Todo in web-app', value: '5 tickets', strong: false },
      { label: 'Avg wait in Review', value: '2h 10m', strong: false },
    ])
    expect(teamLoadRows(load, { roleId: 'backend', roleName: 'Backend', repoFilter: ['api'] })[1]).toEqual({
      label: 'Todo in api',
      value: '2 tickets',
      strong: false,
    })
  })

  it('omits the limit when Doing has none, and says so when no Todo ticket or review stay exists', () => {
    const open = { ...load, columns: [], todoByRepo: [], review: { averageMs: null, stays: 0 } }
    expect(teamLoadRows(open, { roleId: 'backend', roleName: 'Backend', repoFilter: ['api'] })).toEqual([
      { label: 'Backend WIP', value: '1 open', strong: false },
      { label: 'Todo', value: '0 tickets', strong: false },
      { label: 'Avg wait in Review', value: '—', strong: false },
    ])
    expect(teamLoadRows(open, { roleId: 'qa', roleName: 'QA', repoFilter: [] })[0]).toEqual({
      label: 'QA WIP',
      value: '0 open',
      strong: false,
    })
  })
})

describe('formatDuration', () => {
  it('writes waits the way the design does', () => {
    expect(formatDuration(20_000)).toBe('<1m')
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(130 * 60_000)).toBe('2h 10m')
    expect(formatDuration((3 * 24 + 4) * 3_600_000 + 5 * 60_000)).toBe('3d 4h')
  })
})

describe('headcountNotice', () => {
  it('explains a hire above the maximum, and why it asks under Autonomous', () => {
    expect(headcountNotice('Lyra', { current: 7, max: 7 }, 'managed')).toBe(
      'Hiring Lyra makes 8 Employees, above the maximum headcount of 7.',
    )
    expect(headcountNotice('Lyra', { current: 9, max: 7 }, 'autonomous')).toBe(
      'Hiring Lyra makes 10 Employees, above the maximum headcount of 7. That is why this hire asks you.',
    )
  })

  it('says nothing within the maximum or without one', () => {
    expect(headcountNotice('Lyra', { current: 6, max: 7 }, 'autonomous')).toBeNull()
    expect(headcountNotice('Lyra', { current: 60, max: null }, 'autonomous')).toBeNull()
  })
})

describe('autonomyLine and effectText', () => {
  it('says what the level asks', () => {
    expect(autonomyLine('managed')).toBe('Managed — hires and merges always ask you first')
    expect(autonomyLine('supervised')).toBe('Supervised — every step asks you first')
    expect(autonomyLine('autonomous')).toBe('Autonomous — hires ask you only above headcount')
  })

  it('explains what approving does under the cap', () => {
    expect(effectText('Lyra', capacity({ running: 5, parked: ['juno'] }), ['Juno'])).toBe(
      'Approving starts a Session, gives Lyra a desk and a hello in #general. The cap is 5, so Juno stays parked until a seat frees up.',
    )
    expect(effectText('Lyra', capacity({ running: 5 }), [])).toBe(
      'Approving starts a Session, gives Lyra a desk and a hello in #general. The cap is 5, so Lyra stays parked until a seat frees up.',
    )
    expect(effectText('Lyra', capacity({ running: 2 }), [])).toBe(
      'Approving starts a Session, gives Lyra a desk and a hello in #general. The cap is 5, so Lyra starts right away.',
    )
  })
})
