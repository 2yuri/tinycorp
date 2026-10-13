// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Employee, EmployeePatch, RoleTemplate } from '../../../shared/domain/staff'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { HireEmployeeModal } from '../hiring'
import { EditEmployeeModal } from './EditEmployeeModal'

const noop = () => {}

const frontend: RoleTemplate = {
  id: 'frontend',
  name: 'Frontend',
  persona: 'You build the screens users touch.',
  capabilities: ['code'],
  repoFilter: ['*web*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
}

const vega: Employee = {
  id: 'e1',
  name: 'Vega',
  roleId: 'frontend',
  title: 'Frontend',
  persona: 'Lives in the component layer.',
  capabilities: ['code'],
  repoFilter: ['*web*'],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 0,
  sprite: 6,
  createdAt: '',
}

let host: HTMLDivElement
let root: Root
const saved: EmployeePatch[] = []
let cancelled = 0

beforeEach(() => {
  // React only allows `act` to drive a render when the environment says it is a test.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  saved.length = 0
  cancelled = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function draw(element: ReactNode) {
  act(() => root.render(element))
}

function editVega(employee = vega) {
  draw(
    <EditEmployeeModal
      companyName="Tiny Corp"
      employee={employee}
      roles={[frontend]}
      employees={[employee]}
      repoNames={[]}
      error={null}
      onSave={(patch) => saved.push(patch)}
      onCancel={() => cancelled++}
    />,
  )
}

/** The `n / N` the LOOK tile shows, as the character index it stands for. */
function shown(): number {
  const count = document.querySelector('[data-ui="Look Count"]')?.textContent ?? ''
  return Number(count.split('/')[0]!.trim()) - 1
}

function press(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`no ${label} button`)
  act(() => button.click())
}

describe('editing an Employee’s character', () => {
  it('opens on the character the Employee wears today', () => {
    editVega()

    expect(shown()).toBe(vega.sprite)
  })

  it('walks the sheets with the arrows, wrapping at each end', () => {
    editVega({ ...vega, sprite: 0 })

    press('Previous character')
    expect(shown()).toBe(CHARACTER_SHEETS - 1)
    press('Next character')
    expect(shown()).toBe(0)
    press('Next character')
    expect(shown()).toBe(1)
  })

  it('saves the chosen character, and an untouched form saves the one they already wear', () => {
    editVega()

    press('Next character')
    act(() => document.querySelector('form')!.requestSubmit())
    expect(saved.at(-1)?.sprite).toBe(vega.sprite + 1)

    // A fresh Edit, opened and saved without touching LOOK: the look must come back as it went in.
    draw(<></>)
    editVega()
    act(() => document.querySelector('form')!.requestSubmit())
    expect(saved.at(-1)?.sprite).toBe(vega.sprite)
  })

  it('sends nothing when the boss cancels after moving the look', () => {
    editVega()

    press('Next character')
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!
    act(() => cancel.click())

    expect(saved).toEqual([])
    expect(cancelled).toBe(1)
  })
})

describe('the LOOK control', () => {
  it('carries its own floor colour, rather than one an overlay above it happens to set', () => {
    // The colour used to be a custom property on the overlay, and the control read it from up
    // there; it travels — hiring draws it in the modal, editing in the Employees side panel — so
    // now it is on the strip that draws the floor and nowhere else (T210f).
    editVega()
    const floor = document.querySelector('[data-ui="Look Floor"]')

    expect(floor?.className).toContain('bg-[#3b2a22]')
    expect(document.querySelector('[data-ui="Modal Overlay"]')?.className).not.toContain('#3b2a22')
  })

  it('is the same one in the hire modal and the edit modal', () => {
    const look = () => {
      const control = document.querySelector('[data-ui="Look"]')
      if (!control) throw new Error('no LOOK control')
      return control.outerHTML
    }

    draw(
      <HireEmployeeModal
        companyName="Tiny Corp"
        roles={[frontend]}
        employees={[]}
        former={[]}
        repoNames={[]}
        headcount={null}
        error={null}
        suggestName={async () => null}
        onCancel={noop}
        onHire={noop}
        initialSprite={vega.sprite}
      />,
    )
    const hire = look()
    draw(<></>)
    editVega()

    expect(look()).toBe(hire)
  })
})
