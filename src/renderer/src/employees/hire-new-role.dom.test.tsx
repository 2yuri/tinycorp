// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Company } from '../../../shared/company'
import type { RoleTemplate } from '../../../shared/domain/staff'

/**
 * Hire → New role, from the Employees view (T262). Both choices of the New role dialog end the same
 * way: back in the hire, with its draft kept and the new role picked. A template is made there and
 * then; a blank role is written first, in the same editor the Roles screen opens, while the hire
 * steps aside.
 */

const role = (id: string, name: string, persona: string): RoleTemplate => ({
  id,
  name,
  persona,
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: false,
})

const catalogue = vi.hoisted(() => ({ roles: [] as RoleTemplate[] }))
const createRole = vi.fn()

vi.mock('./use-employees-data', () => ({
  useStaffData: () => ({ roles: catalogue.roles, employees: [] }),
  useEmployeesData: () => ({
    former: [],
    capacity: null,
    repoNames: [],
    approvals: [],
    requests: [],
    teamLoad: null,
    level: null,
    channelNames: {},
  }),
  useMcpServers: () => [],
  useSkills: () => [],
  usePermissionDefault: () => null,
}))
vi.mock('../office', () => ({ useOfficeScene: () => ({ sprites: [] }) }))
vi.mock('../preflight', () => ({ useEveryProvider: () => null }))
vi.mock('../sessions', () => ({
  useSessionStatuses: () => ({
    statuses: {},
    startedAt: {},
    providerReady: {},
    subagents: {},
    subSessions: {},
    routedTo: {},
    error: null,
  }),
}))
vi.mock('../employee-drawer', () => ({ EmployeeDrawer: () => null }))

const { EmployeesView } = await import('./EmployeesView')

const pm = role('pm', 'PM', 'You are the project manager.')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  catalogue.roles = [pm]
  createRole.mockReset()
  Object.assign(window, {
    tinyCorp: { staff: { createRole }, hiring: { suggestName: async () => ({ ok: true, value: 'Lyra' }) } },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  render()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() =>
    root.render(
      // The view reads a Company's name and nothing else of it.
      <EmployeesView company={{ name: 'Tiny Corp' } as Company} route={{ view: 'employees' }} onNavigate={() => {}} />,
    ),
  )
}

const buttons = () => [...document.body.querySelectorAll('button')]
const press = async (label: string) => {
  const button = buttons().find((one) => one.textContent?.trim().startsWith(label))
  if (!button) throw new Error(`No button ${label}`)
  await act(async () => button.click())
}
const hire = () => document.body.querySelector<HTMLElement>('[aria-label="Hire an employee"]')
// Set aside, the hire is still mounted — its draft is kept — but its overlay is `hidden`.
const hireShown = () => hire()?.parentElement?.classList.contains('hidden') === false
const persona = () => hire()?.querySelector('textarea')?.value ?? ''

async function newRole(card: string) {
  await press('Hire')
  await press('New role')
  const template = [...document.body.querySelectorAll<HTMLElement>('[data-ui="Template"]')].find((one) =>
    one.textContent?.includes(card),
  )
  await act(async () => template?.click())
  await press(card === 'Start blank' ? 'Create role' : 'Create')
}

it('opens the role editor for a blank role, and Save returns to the hire with the role picked', async () => {
  await newRole('Start blank')

  expect(document.body.textContent).toContain('New role')
  expect(hireShown()).toBe(false)
  const name = document.body.querySelector<HTMLInputElement>('input[value=""]')
  expect(name).not.toBeNull()

  const made = role('writer', 'Writer', 'You write the docs.')
  createRole.mockImplementation(async () => {
    catalogue.roles = [pm, made]
    return { ok: true, value: made }
  })
  await press('Save')

  expect(createRole).toHaveBeenCalledOnce()
  expect(hireShown()).toBe(true)
  expect(persona()).toBe('You write the docs.')
})

it('comes back to the hire as it was when the blank role is cancelled', async () => {
  await newRole('Start blank')
  expect(hireShown()).toBe(false)

  await press('Cancel')

  expect(createRole).not.toHaveBeenCalled()
  expect(hireShown()).toBe(true)
  expect(persona()).toBe('You are the project manager.')
})

it('picks a template role in the hire as soon as it is made', async () => {
  const made = role('qa', 'QA', 'You test it in the running app.')
  createRole.mockImplementation(async () => {
    catalogue.roles = [pm, made]
    return { ok: true, value: made }
  })

  await newRole('QA')

  expect(createRole).toHaveBeenCalledOnce()
  expect(hireShown()).toBe(true)
  expect(persona()).toBe('You test it in the running app.')
})
