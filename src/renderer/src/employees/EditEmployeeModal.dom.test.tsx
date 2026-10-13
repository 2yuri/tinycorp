// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import { PROVIDERS } from '../../../shared/domain/providers'
import { CAPABILITIES, type Employee, type EmployeePatch, type RoleTemplate } from '../../../shared/domain/staff'
import { EditEmployeeModal } from './EditEmployeeModal'

const frontend: RoleTemplate = {
  id: 'frontend',
  name: 'Frontend',
  persona: 'You build the screens users touch.',
  capabilities: ['code'],
  repoFilter: ['web-app'],
  areas: [],
  mcpServers: ['s1'],
  skills: ['sk1'],
  seeded: true,
}

const backend: RoleTemplate = {
  id: 'backend',
  name: 'Backend',
  persona: 'You build careful APIs.',
  capabilities: ['code', 'review'],
  repoFilter: ['billing-api'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
}

const ada: Employee = {
  id: 'e1',
  name: 'Ada Lorne',
  roleId: 'frontend',
  title: 'Frontend',
  persona: 'You build the screens users touch.',
  capabilities: ['code'],
  repoFilter: ['web-app'],
  areas: [],
  mcpServers: ['s1'],
  skills: ['sk1'],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 3,
  sprite: 2,
  createdAt: '2025-09-12T09:00:00.000Z',
}

const SERVERS: McpServerRow[] = [
  {
    id: 's1',
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: true,
    employees: 4,
  },
  {
    id: 's2',
    name: 'playwright',
    transport: 'stdio',
    url: '',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: false,
    employees: 0,
  },
]

const SKILLS: SkillRow[] = [
  { id: 'sk1', name: 'review-checklist', path: '/Users/boss/skills/review-checklist', missing: false, employees: 4 },
  { id: 'sk2', name: 'pen-handoff', path: '/Users/boss/skills/pen-handoff', missing: true, employees: 1 },
]

let host: HTMLDivElement
let root: Root
const saved: EmployeePatch[] = []
let cancelled = 0

beforeEach(() => {
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

function edit(
  employee: Employee = ada,
  roles: RoleTemplate[] = [frontend, backend],
  servers = SERVERS,
  skills = SKILLS,
) {
  draw(
    <EditEmployeeModal
      companyName="Tiny Corp"
      employee={employee}
      roles={roles}
      employees={[employee]}
      repoNames={['web-app', 'billing-api', 'payments-web']}
      servers={servers}
      skills={skills}
      error={null}
      onCancel={() => cancelled++}
      onSave={(patch) => saved.push(patch)}
    />,
  )
}

/** The modal draws through a portal, so everything is looked up in the document. */
const modal = () => document.querySelector('form[role="dialog"]')!
const text = (selector: string) => document.querySelector(selector)?.textContent ?? ''
const all = (selector: string) => [...document.querySelectorAll(selector)].map((n) => n.textContent ?? '')

/**
 * The generated line under one labelled row, found by the row rather than by its place on the
 * screen: PERMISSIONS carries a help line of its own, so counting them is a moving target.
 *
 * Every part of the modal is found by the `data-ui` name it carries — the frames' own vocabulary,
 * and what the BEM names used to give a selector before the anatomy became class lists (T210f).
 */
const help = (label: 'INTEGRATIONS' | 'SKILLS') =>
  [...document.querySelectorAll('[data-ui="Field"]')]
    .find((field) => field.querySelector('[data-ui="Field Label"]')?.textContent === label)
    ?.querySelector('[data-ui="Field Help"]')?.textContent ?? ''

function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (!button) throw new Error(`no ${selector}`)
  act(() => button.click())
}

function clickLabelled(label: string) {
  click(`button[aria-label="${label}"]`)
}

/** The chip carrying this word, whichever row it is in. */
function chip(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[data-ui="Chip"], [data-ui="Role"]')].find(
    (node) => node.querySelector('[data-ui="Chip Label"], [data-ui="Role Label"]')?.textContent === label,
  )
  if (!found) throw new Error(`no ${label} chip`)
  return found
}

/**
 * Whether this chip is on. A chip that is one of a set is a label over a real radio (T190); the
 * grant chips are still switches, and say so on themselves.
 */
function chipOn(label: string): boolean {
  const found = chip(label)
  const control = found.querySelector<HTMLInputElement>('input')
  return control ? control.checked : found.getAttribute('aria-checked') === 'true'
}

/** The chip labels of the grant row under this label, in the order they are drawn. */
function row(label: string): string[] {
  const field = [...document.querySelectorAll('[data-ui="Field"]')].find(
    (node) => node.querySelector('[data-ui="Field Label"]')?.textContent === label,
  )
  if (!field) throw new Error(`no ${label} row`)
  return [...field.querySelectorAll('[data-ui="Chip Label"]')].map((node) => node.textContent ?? '')
}

function submit() {
  act(() => document.querySelector('form')!.requestSubmit())
}

/** Which job fields the form says are the Employee's own, right now. */
function markers(): string[] {
  return [...document.querySelectorAll('[data-ui="Override"]')].map(
    (node) => node.closest('[data-ui="Field"]')?.querySelector('[data-ui="Field Label"]')?.textContent ?? '?',
  )
}

describe('the Edit Employee modal (frame FbR2n)', () => {
  it('is one screen: header, the frame’s fields in the frame’s order, and a footer', () => {
    edit()

    expect(text('[data-ui="Modal Title"]')).toBe('Edit Ada Lorne')
    expect(text('[data-ui="Modal Subtitle"]')).toBe('Tiny Corp · Frontend · hired 12 Sep · desk 4')
    expect(all('[data-ui="Field Label"]')).toEqual([
      'ROLE',
      'LOOK',
      'NAME',
      'MODEL',
      'PERMISSIONS',
      'PERSONA',
      'REPOSITORY ACCESS',
      // AREAS is the paths inside those repos, so it reads straight after them (T239).
      'AREAS',
      'INTEGRATIONS',
      'SKILLS',
      'CAPABILITIES',
    ])
    expect(document.querySelector('header button[aria-label="Close"]')).not.toBeNull()
    expect(text('footer [data-ui="Modal Note"]')).toBe(
      'Saving restarts Ada’s Session to take the change: right away if it is idle, or when its turn ends.',
    )
    expect(text('button[type="submit"]')).toContain('Save changes')
  })

  it('scrolls the body between a header and a footer that do not', () => {
    edit()

    // The three parts are siblings of the modal, and only the middle one is the scroller.
    expect([...modal().children].map((n) => n.tagName.toLowerCase())).toEqual(['header', 'div', 'footer'])
    expect(modal().children[1]?.className).toContain('overflow-auto')
    for (const edge of [modal().children[0], modal().children[2]]) expect(edge?.className).toContain('shrink-0')
  })

  it('saves from the footer, from ⌘↵, and closes on Escape and on the header’s ×', () => {
    edit()

    click('button[type="submit"]')
    expect(saved).toHaveLength(1)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
    })
    expect(saved).toHaveLength(2)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    clickLabelled('Close')
    expect(cancelled).toBe(2)
  })

  it('sends every field it draws, so nothing the boss can see is silently dropped', () => {
    edit()

    submit()

    expect(saved[0]).toEqual({
      name: 'Ada Lorne',
      roleId: 'frontend',
      sprite: 2,
      provider: 'claude',
      model: null,
      permissionMode: 'skip-permissions',
      persona: frontend.persona,
      repoFilter: ['web-app'],
      areas: [],
      mcpServers: ['s1'],
      skills: ['sk1'],
      capabilities: ['code'],
      followRole: [],
    })
  })
})

describe('the PERMISSIONS field (T164)', () => {
  const help = () =>
    [...document.querySelectorAll('[data-ui="Field"]')]
      .find((field) => field.querySelector('[data-ui="Field Label"]')?.textContent === 'PERMISSIONS')
      ?.querySelector('[data-ui="Field Help"]')?.textContent ?? ''

  it('opens on the mode this Employee runs with, and says what that means for its Session', () => {
    edit()

    expect(chipOn('Run without asking')).toBe(true)
    expect(chipOn('Ask first')).toBe(false)
    expect(help()).toBe('Its Session runs without stopping to ask. Starts with the CLI’s own skip flag.')
  })

  it('follows the choice, and saves it', () => {
    edit()

    act(() => chip('Ask first').click())

    expect(chipOn('Ask first')).toBe(true)
    expect(help()).toBe('Its Session asks in the terminal before it acts.')

    submit()

    expect(saved[0]).toMatchObject({ permissionMode: 'interactive' })
  })
})

describe('changing an Employee’s role', () => {
  it('moves a field the Employee followed onto the new role', () => {
    edit()

    act(() => chip('Backend').click())

    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe(backend.persona)
    expect(chip('review').getAttribute('aria-checked')).toBe('true')
    expect(markers()).toEqual([])

    submit()
    expect(saved[0]).toMatchObject({
      roleId: 'backend',
      persona: backend.persona,
      capabilities: ['code', 'review'],
      repoFilter: ['billing-api'],
      areas: [],
      mcpServers: [],
      skills: [],
    })
  })

  it('leaves a field the Employee made its own alone, and says so before Save', () => {
    edit({ ...ada, persona: 'Ada’s own persona.', overrides: ['persona'] })
    expect(markers()).toEqual(['PERSONA'])

    act(() => chip('Backend').click())

    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Ada’s own persona.')
    // Still marked: the boss can read what moved and what did not without saving first.
    expect(markers()).toEqual(['PERSONA'])

    submit()
    expect(saved[0]).toMatchObject({ roleId: 'backend', persona: 'Ada’s own persona.' })
  })

  it('marks a field the boss edits, and the reset puts the role’s value back', () => {
    edit()

    act(() => chip('code').click())
    expect(markers()).toEqual(['CAPABILITIES'])

    clickLabelled('Capabilities: follow role')
    expect(markers()).toEqual([])
    submit()
    expect(saved[0]).toMatchObject({ capabilities: ['code'], followRole: ['capabilities'] })
  })

  it('carries the role to the engine, which is what makes the change stick', () => {
    edit()

    act(() => chip('Backend').click())
    submit()

    expect(saved[0]?.roleId).toBe('backend')
  })

  it('changes nothing else: the same desk, the same character, the same name and model', () => {
    edit()

    act(() => chip('Backend').click())
    submit()

    expect(saved[0]).toMatchObject({ name: 'Ada Lorne', sprite: 2, model: null, provider: 'claude' })
    expect(text('[data-ui="Modal Subtitle"]')).toContain('desk 4')
  })
})

describe('against the frame (T155)', () => {
  it('opens at rest: the NAME field is not focused, so it wears no accent border, ring or caret', () => {
    edit()

    const name = document.querySelector<HTMLInputElement>('[data-ui="Name"]')!
    expect(name.value).toBe('Ada Lorne')
    expect(document.activeElement).not.toBe(name)
  })

  it('names the Employee by its given name in every sentence, and by its full name only in the title', () => {
    edit({ ...ada, mcpServers: ['s1', 's2'], overrides: ['mcpServers'] })

    expect(text('[data-ui="Modal Title"]')).toBe('Edit Ada Lorne')
    expect(help('INTEGRATIONS')).toContain('playwright is Ada’s own.')
    expect(help('SKILLS')).toMatch(/^Folders of instructions Ada can open\./)
    expect(text('[data-ui="Modal Note"]')).toMatch(/^Saving restarts Ada’s Session/)
  })

  it('follows the NAME field as the boss types, and says “This Employee” when it is empty', () => {
    edit()
    const name = document.querySelector<HTMLInputElement>('[data-ui="Name"]')!
    const type = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, value)
        name.dispatchEvent(new Event('input', { bubbles: true }))
      })

    type('  Grace   Holt ')
    expect(text('[data-ui="Modal Note"]')).toMatch(/^Saving restarts Grace’s Session/)
    type('   ')
    expect(text('[data-ui="Modal Note"]')).toMatch(/^Saving restarts This Employee’s Session/)
  })

  it('draws the capabilities the Employee holds first, as the frame does, and keeps them put when pressed', () => {
    edit({ ...ada, capabilities: ['code', 'review'] })
    const capabilities = () => row('CAPABILITIES')

    expect(capabilities()).toEqual(['code', 'review', 'test', 'plan', 'intake', 'hire'])
    act(() => chip('review').click())
    act(() => chip('hire').click())
    expect(capabilities()).toEqual(['code', 'review', 'test', 'plan', 'intake', 'hire'])
  })

  it('draws every capability exactly once, whatever the Employee holds', () => {
    edit({ ...ada, capabilities: ['intake', 'hire'] })

    expect(row('CAPABILITIES')).toEqual(['intake', 'hire', 'code', 'review', 'test', 'plan'])
    expect([...row('CAPABILITIES')].sort()).toEqual([...CAPABILITIES].sort())
  })

  it('draws the integrations and skills the Employee holds first too, whatever order the catalogue keeps', () => {
    edit({ ...ada, mcpServers: ['s2'], skills: ['sk2'] })

    expect(row('INTEGRATIONS')).toEqual(['playwright', 'linear'])
    expect(row('SKILLS')).toEqual(['pen-handoff', 'review-checklist'])
  })

  it('keeps the divider under REPOSITORY ACCESS from shrinking to nothing in the scrolling body', () => {
    // A layout jsdom cannot measure, so the class list is what is checked: a 1px flex item with no
    // text in an overflowing column shrinks to zero height unless it is told not to.
    const divider = () => document.querySelector('[data-ui="Modal Form"] > [data-ui="Divider"]')
    expect(divider()).toBeNull()
    edit()
    expect(divider()?.className).toContain('shrink-0')
    expect(divider()?.className).toContain('h-1')
  })
})

describe('where a grant came from', () => {
  it('says it in the frame’s words, generated from the override machinery', () => {
    edit({ ...ada, mcpServers: ['s1', 's2'], overrides: ['mcpServers'] })

    expect(help('INTEGRATIONS')).toBe(
      'The MCP servers this Employee is handed. Its role gives it linear; playwright is Ada’s own.',
    )
  })

  it('follows the chips as the boss turns them on and off', () => {
    edit()
    expect(help('INTEGRATIONS')).toBe('The MCP servers this Employee is handed. Its role gives it linear.')

    act(() => chip('linear').click())
    expect(help('INTEGRATIONS')).toBe('The MCP servers this Employee is handed. Ada turned linear off.')

    act(() => chip('playwright').click())
    expect(help('INTEGRATIONS')).toBe(
      'The MCP servers this Employee is handed. Ada added playwright; Ada turned linear off.',
    )
  })

  it('never opens the sentence on a grant’s name: they are identifiers, not words', () => {
    edit({ ...ada, mcpServers: ['s2'], overrides: ['mcpServers'] })

    // `linear` came from the role and is off; `playwright` is hers. Neither name is capitalised.
    expect(help('INTEGRATIONS')).toBe(
      'The MCP servers this Employee is handed. Ada added playwright; Ada turned linear off.',
    )
  })

  it('says where servers come from when the Company has none', () => {
    edit(ada, [frontend, backend], [])

    expect(help('INTEGRATIONS')).toContain('Company settings')
  })
})

/**
 * SKILLS is the INTEGRATIONS row again over the skill catalogue (T137): the same chips, the same
 * override marker, the same generated sentence. These say so rather than trusting that it is.
 */
describe('the SKILLS row', () => {
  it('draws one chip per skill folder, with the ones the Employee holds turned on', () => {
    edit()

    expect(chip('review-checklist').getAttribute('aria-checked')).toBe('true')
    expect(chip('pen-handoff').getAttribute('aria-checked')).toBe('false')
  })

  it('says on the chip that a folder is not where the boss left it', () => {
    edit()

    expect(chip('pen-handoff').textContent).toContain('Folder is missing')
  })

  it('says where the grants came from, out of the same override machinery', () => {
    edit({ ...ada, skills: ['sk1', 'sk2'], overrides: ['skills'] })

    expect(help('SKILLS')).toBe(
      'Folders of instructions Ada can open. Its role gives it review-checklist; pen-handoff is Ada’s own.',
    )
  })

  // The caveat itself is `skillsLine`'s, and since T253 every Provider in the catalogue reads
  // skills, so there is no Employee this modal can draw it for. It is covered where it can be
  // driven — `skills-line.test.ts` — and what is checked here is that no Employee is told it now.
  it('says nothing about a Provider reading no skills, because every one of them reads them', () => {
    for (const provider of PROVIDERS) {
      edit({ ...ada, provider })

      expect(help('SKILLS')).not.toContain('would not look at them')
    }
  })

  it('marks the grant as overridden, and the reset puts the role’s skills back', () => {
    edit()
    expect(markers()).toEqual([])

    act(() => chip('pen-handoff').click())
    expect(markers()).toEqual(['SKILLS'])

    clickLabelled('Skills: follow role')
    expect(markers()).toEqual([])
    submit()
    expect(saved[0]).toMatchObject({ skills: ['sk1'], followRole: ['skills'] })
  })

  it('follows a role change like every other grant', () => {
    edit()

    act(() => chip('Backend').click())
    submit()

    expect(saved[0]).toMatchObject({ roleId: 'backend', skills: [] })
  })

  it('says where skills come from when the Company has none', () => {
    edit(ada, [frontend, backend], SERVERS, [])

    expect(help('SKILLS')).toContain('Company settings')
  })
})

/**
 * T239: a filter that lets an Employee into no repo of the Company used to be silent, and its whole
 * effect was that every ticket landed on somebody else. Edit Employee says it and offers the click
 * that undoes it; areas are the other half — which paths inside the repos they do get.
 */
describe('A filter that shuts this Employee out', () => {
  const warning = () => document.querySelector('[data-slot="alert"][data-variant="warning"]')

  it('says so, and Allow all repos puts every repo back', () => {
    edit({ ...ada, repoFilter: ['*mobile*'] })

    expect(warning()?.textContent).toContain('Ada can’t work in any of this Company’s repos')

    click('[data-slot="alert"] button')
    submit()

    expect(saved[0]).toMatchObject({ repoFilter: ['*'] })
    expect(warning()).toBeNull()
  })

  it('says nothing about an Employee that does not code, whatever its filter lets in', () => {
    edit({ ...ada, capabilities: ['review'], repoFilter: [] })

    expect(warning()).toBeNull()
  })

  it('saves the areas the boss typed, and marks them the Employee’s own', () => {
    edit()

    const field = document.querySelector<HTMLInputElement>('input[data-ui="Areas"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        field,
        'src/renderer/**, packages/ui',
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    submit()

    expect(saved[0]).toMatchObject({ areas: ['src/renderer/**', 'packages/ui'] })
    expect(markers()).toEqual(['AREAS'])
  })
})
