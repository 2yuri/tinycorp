// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { HireEmployeeModal } from './HireEmployeeModal'

/**
 * Hiring into a role the Company does not hold yet (T240).
 *
 * The chip opens the New role dialog over this modal rather than replacing it, so the name, model
 * and character the boss already chose are still there when they come back — and the draft moves
 * onto the role that was just made, which is the role they opened the dialog to hire into.
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
  seeded: true,
})

const pm = role('pm', 'PM', 'You are the project manager.')
const qa = role('qa', 'QA', 'You test it in the running app.')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function show(props: { roles: RoleTemplate[]; selectRoleId?: string | null; onNewRole?: () => void }) {
  act(() =>
    root.render(
      <HireEmployeeModal
        companyName="Tiny Corp"
        employees={[]}
        former={[] as Employee[]}
        repoNames={[]}
        headcount={null}
        error={null}
        suggestName={async () => 'Lyra'}
        onCancel={() => {}}
        onHire={() => {}}
        {...props}
      />,
    ),
  )
}

const persona = () => document.body.querySelector('textarea')?.value ?? ''

it('opens the New role dialog without closing the hire modal', () => {
  let opened = 0
  show({ roles: [pm], onNewRole: () => (opened += 1) })
  const chip = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('New role'))

  act(() => chip?.click())

  expect(opened).toBe(1)
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
})

it('moves the draft onto the role that was created over it', () => {
  show({ roles: [pm], selectRoleId: null })
  expect(persona()).toBe('You are the project manager.')

  show({ roles: [pm, qa], selectRoleId: 'qa' })

  expect(persona()).toBe('You test it in the running app.')
})
