/**
 * The menu-bar item stands in for the office header while the window is closed (T117), so the two
 * have to say the same thing about the same floor. Both are pure projections, so this puts one
 * office through each of them and compares the numbers, room by room.
 */
import { describe, expect, it } from 'vitest'
import { traySummary } from '../../../shared/app/tray'
import type { Approval } from '../../../shared/approvals'
import type { Employee } from '../../../shared/domain/staff'
import { type OfficeInput, projectOffice } from '../../../shared/office/projection'
import type { SessionStatus } from '../../../shared/session'
import { officeHeaderFacts } from './header-facts'

function employee(name: string, desk: number): Employee {
  return {
    id: name.toLowerCase(),
    name,
    roleId: 'backend',
    title: 'Engineer',
    persona: '',
    capabilities: [],
    repoFilter: [],
    areas: [],
    mcpServers: [],
    skills: [],
    provider: 'claude',
    permissionMode: 'skip-permissions',
    model: null,
    overrides: [],
    sprite: 0,
    desk,
    createdAt: '2026-09-17T00:00:00.000Z',
  }
}

function pending(requesterId: string): Approval {
  return {
    id: 1,
    action: 'open_pr',
    requesterId,
    subject: '#1 Login page',
    ticketId: 1,
    pullRequest: null,
    reason: 'Ready for review',
    status: 'pending',
    decisionReason: null,
    channelId: 'general',
    messageId: 1,
    createdAt: '2026-09-17T09:31:00.000Z',
    decidedAt: null,
  }
}

/** One floor, read by the header and by the menu bar, with the numbers each of them found. */
function bothReadings(input: {
  sessions: Record<string, SessionStatus>
  approvals?: Approval[]
  /** Employees whose Session stopped in its terminal to ask the boss (T165). */
  asking?: string[]
}) {
  const names = Object.keys(input.sessions)
  const employees = names.map((id, i) => employee(id, i))
  const office: OfficeInput = {
    employees,
    sessions: input.sessions,
    approvals: input.approvals ?? [],
    asking: input.asking ?? [],
    now: Date.parse('2026-09-17T10:00:00.000Z'),
  }
  const header = officeHeaderFacts(projectOffice(office).sprites)
  const tray = traySummary({
    sessions: input.sessions,
    pendingRequesterIds: (input.approvals ?? []).filter((a) => a.status === 'pending').map((a) => a.requesterId),
    askingIds: input.asking ?? [],
    outOfBudget: false,
    paused: false,
    companies: [{ id: 'acme', name: 'Acme', current: true }],
  })
  return { header, tray }
}

describe('the menu-bar summary matches the office header', () => {
  it('counts the same Employees at work, whatever their Sessions are doing', () => {
    const { header, tray } = bothReadings({
      sessions: { ada: 'busy', bo: 'idle', cy: 'starting', di: 'off', ed: 'parked', flo: 'out_of_budget' },
    })

    expect(tray.atWork).toBe(header.atWork)
    expect(tray.atWork).toBe(3)
  })

  it('counts the same Employees waiting on the boss', () => {
    const { header, tray } = bothReadings({
      sessions: { ada: 'busy', bo: 'idle' },
      approvals: [pending('ada'), pending('bo')],
    })

    expect(tray.waitingOnYou).toBe(header.waitingOnYou)
    expect(tray.waitingOnYou).toBe(2)
  })

  it('agrees that a parked Employee with an undecided Approval is parked, not waiting', () => {
    // The office reads `parked` before the `!`, so their sprite is at the counter, not the boss desk.
    const { header, tray } = bothReadings({
      sessions: { ada: 'parked', bo: 'out_of_budget', cy: 'off' },
      approvals: [pending('ada'), pending('bo'), pending('cy')],
    })

    expect(tray.waitingOnYou).toBe(header.waitingOnYou)
    expect(tray.waitingOnYou).toBe(0)
  })

  it('reads an empty floor the same way', () => {
    const { header, tray } = bothReadings({ sessions: {} })

    expect([tray.atWork, tray.waitingOnYou]).toEqual([header.atWork, header.waitingOnYou])
  })
})
