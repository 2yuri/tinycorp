// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { HireEmployeeModal } from './HireEmployeeModal'

/**
 * The Hire modal with the Model list open shows one scroll area (T262). The list is inside the
 * modal, which is what hides both bars (`[aria-modal='true']` in `ui/tailwind.css`), and it is no
 * taller than the room left in the form under the field, so the form gets nothing more to scroll.
 */

const pm: RoleTemplate = {
  id: 'pm',
  name: 'PM',
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
}

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

it('opens the Model list inside the modal, and no taller than the form has room for', () => {
  act(() =>
    root.render(
      <HireEmployeeModal
        companyName="Tiny Corp"
        roles={[pm]}
        employees={[]}
        former={[] as Employee[]}
        repoNames={[]}
        headcount={null}
        error={null}
        suggestName={async () => 'Lyra'}
        onCancel={() => {}}
        onHire={() => {}}
      />,
    ),
  )
  const form = document.body.querySelector<HTMLElement>('[data-ui="Modal Form"]')
  const field = document.body.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
  const anchor = field?.parentElement
  if (!form || !field || !anchor) throw new Error('The Hire modal draws no MODEL field')
  // jsdom lays nothing out and reads no class: the form is a scroller ending at 620, the field at
  // 300. The list reads `bottom` and nothing else of either box, hence the partial `DOMRect`.
  form.style.overflowY = 'auto'
  form.getBoundingClientRect = () => ({ bottom: 620 }) as DOMRect
  anchor.getBoundingClientRect = () => ({ bottom: 300 }) as DOMRect

  act(() => field.click())

  const menu = document.body.querySelector<HTMLElement>('[data-slot="menu"]')
  expect(menu?.closest('[aria-modal="true"]')).not.toBeNull()
  expect(menu?.style.maxHeight).toBe('308px')
})
