// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { DeleteRoleForm } from './forms'
import { RolesPanel } from './RolesPanel'
import { roleRows } from './roles-model'

/**
 * The Roles list and the form that deletes a role (T240).
 *
 * What a document can see of this ticket is the two things the boss is protected by: a role nobody
 * uses is marked rather than swept, and a role Employees hold cannot be deleted without saying
 * where they go.
 */

const role = (id: string, name: string, seeded = true): RoleTemplate => ({
  id,
  name,
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded,
})

const employee = (name: string, roleId: string): Employee =>
  ({ id: name.toLowerCase(), name, roleId, title: roleId }) as unknown as Employee

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

const text = () => host.textContent ?? ''
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label))

describe('the Roles list', () => {
  const rows = roleRows([role('frontend', 'Frontend'), role('po', 'PO')], [employee('Ada', 'frontend')], [])

  it('marks the role nobody uses and offers to remove it, without touching the used one', () => {
    let removed = 0
    act(() =>
      root.render(
        <RolesPanel
          rows={rows}
          error={null}
          onNew={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onRemoveUnused={() => (removed += 1)}
        />,
      ),
    )

    expect(text()).toContain('2 in this Company · 1 not used')
    expect(text()).toContain('Not used')
    expect(text()).toContain('1 employee')
    expect(text()).toContain('PO came with the Company and nobody was ever hired into it.')

    act(() => button('Remove unused roles')?.click())
    expect(removed).toBe(1)
  })

  it('draws no Remove unused roles at all when every role is in use', () => {
    act(() =>
      root.render(
        <RolesPanel
          rows={rows.slice(0, 1)}
          error={null}
          onNew={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onRemoveUnused={() => {}}
        />,
      ),
    )

    expect(button('Remove unused roles')).toBeUndefined()
  })
})

describe('deleting a role', () => {
  it('says who is on it and deletes it only once they have somewhere to go', () => {
    const rows = roleRows([role('frontend', 'Frontend'), role('backend', 'Backend')], [employee('Ada', 'frontend')], [])
    const deletes: { reassignTo?: string }[] = []
    act(() =>
      root.render(
        <DeleteRoleForm
          role={rows[0]!.role}
          blocker="Ada is on this role. Pick where they go, or move them yourself first."
          others={[rows[1]!.role]}
          error={null}
          onCancel={() => {}}
          onDelete={(options) => deletes.push(options)}
        />,
      ),
    )

    expect(text()).toContain('Ada is on this role.')
    expect(host.querySelector('select')?.value).toBe('backend')

    act(() => button('Move them and delete Frontend')?.click())
    expect(deletes).toEqual([{ reassignTo: 'backend' }])
  })

  it('deletes a role nobody holds without asking where anybody goes', () => {
    const rows = roleRows([role('po', 'PO')], [], [])
    const deletes: { reassignTo?: string }[] = []
    act(() =>
      root.render(
        <DeleteRoleForm
          role={rows[0]!.role}
          blocker={null}
          others={[]}
          error={null}
          onCancel={() => {}}
          onDelete={(options) => deletes.push(options)}
        />,
      ),
    )

    expect(text()).toContain('Nobody is on this role.')
    expect(host.querySelector('select')).toBeNull()

    act(() => button('Delete PO')?.click())
    expect(deletes).toEqual([{}])
  })

  it('says so rather than offering a move when there is no other role to move them to', () => {
    const rows = roleRows([role('frontend', 'Frontend')], [employee('Ada', 'frontend')], [])
    act(() =>
      root.render(
        <DeleteRoleForm
          role={rows[0]!.role}
          blocker="Ada is on this role. Pick where they go, or move them yourself first."
          others={[]}
          error={null}
          onCancel={() => {}}
          onDelete={() => {}}
        />,
      ),
    )

    expect(text()).toContain('There is no other role to move them to. Make one first.')
  })
})
