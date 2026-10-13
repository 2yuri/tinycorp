// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import { EmployeeCard } from './parts'

/**
 * Leaving an Employee card's menu (T223).
 *
 * The boss opened it in the packaged app and could not get out of it: a click outside did nothing
 * and neither did Escape, because the only way out it had was the pointer leaving the box — and the
 * box was `pointer-events: none`, so the pointer never entered or left it at all. The class list is
 * `parts.tsx`'s business and only a browser can see it; what a document can see is the other half,
 * which is that the two ways every desktop menu closes were not wired to anything.
 */

const vega: Employee = {
  id: 'e1',
  name: 'Vega',
  roleId: 'frontend',
  title: 'Frontend',
  persona: 'Lives in the component layer.',
  capabilities: ['code'],
  repoFilter: ['web-app'],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 0,
  sprite: 0,
  createdAt: '',
}

let host: HTMLDivElement
let root: Root
let edited = 0

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  edited = 0
  act(() =>
    root.render(
      <EmployeeCard
        employee={vega}
        state={{ label: 'Idle', tone: 'muted', dimmed: false }}
        repos={['web-app']}
        onOpen={() => {}}
        menu={{ running: false, onEdit: () => (edited += 1), onStart: () => {}, onStop: () => {}, onFire: () => {} }}
      />,
    ),
  )
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const menu = () => host.querySelector('[data-card="menu"]')

/** The card's more button. The card is rendered with a menu in every test here, so it is always there. */
function trigger(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('[data-card="menu-button"]')
  if (!button) throw new Error('the card drew no more button')
  return button
}

const openMenu = () => act(() => trigger().click())

it('opens the menu and reaches Edit from it', () => {
  openMenu()
  const edit = [...host.querySelectorAll<HTMLButtonElement>('[data-slot="menu-item"]')].find(
    (item) => item.textContent === 'Edit',
  )
  expect(edit).toBeDefined()
  act(() => edit?.click())
  expect(edited).toBe(1)
  expect(menu()).toBeNull()
})

it('closes on Escape', () => {
  openMenu()
  expect(menu()).not.toBeNull()
  act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(menu()).toBeNull()
})

it('closes on a pointer down outside it', () => {
  openMenu()
  expect(menu()).not.toBeNull()
  act(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(menu()).toBeNull()
})

it('stays open when the pointer goes down inside it, and on a second press of its own button', () => {
  openMenu()
  act(() => void menu()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(menu()).not.toBeNull()

  // The button that opened it is not `outside`: its own click is what closes it, once.
  act(() => void trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(menu()).not.toBeNull()
  openMenu()
  expect(menu()).toBeNull()
})
