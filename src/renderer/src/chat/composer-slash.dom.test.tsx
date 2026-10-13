// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SkillGroup } from '../../../shared/providers/slash-commands'
import { Composer, type SlashComposer } from './Composer'
import type { Refs } from './Messages'
import type { SlashOutcome } from './slash-run'

const refs: Refs = { tickets: [], channelIds: [], companyKey: 'TC', onChannel: () => {} }
const people = [
  { id: 'e-hera', name: 'Hera' },
  { id: 'e-orion', name: 'Orion' },
]

let host: HTMLDivElement
let root: Root
let sent: string[]
let ran: string[]
let outcome: SlashOutcome
/** Whose skills the draft can invoke, as `useSlashComposer` would answer; null for nobody's. */
let held: SkillGroup | null

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  sent = []
  ran = []
  outcome = { ok: true, note: null }
  held = null
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const slash: SlashComposer = {
  people,
  roles: [{ id: 'r-pm', name: 'Product manager' }],
  run: async (text) => {
    ran.push(text)
    return outcome
  },
  skills: () => held,
}

const ORION: SkillGroup = {
  owner: 'Orion',
  skills: [
    { name: 'review-checklist', description: 'The checks this team runs before a pull request', missing: false },
    { name: 'deploy-runbook', description: 'How a release goes out, step by step', missing: false },
    { name: 'pen-handoff', description: '', missing: true },
  ],
}

function mount(withSlash = true) {
  act(() =>
    root.render(
      <Composer
        variant="main"
        placeholder="Set a goal for the team…"
        people={people}
        refs={refs}
        slash={withSlash ? slash : undefined}
        onSend={async (text) => {
          sent.push(text)
          return true
        }}
      />,
    ),
  )
}

const box = () => host.querySelector('textarea')!

/** Types into the box the way React reads it, and lets the caret follow. */
function type(text: string, caret = text.length) {
  const textarea = box()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(textarea, text)
    textarea.setSelectionRange(caret, caret)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(key: string) {
  act(() => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

const palette = () => host.querySelector('[aria-label="Commands"]')
const rows = () => [...host.querySelectorAll('[aria-label="Commands"] [data-slot=menu-item]')]
const names = () => rows().map((row) => row.querySelector('[data-slot=menu-item-label] span')!.textContent)
const labels = () => [...host.querySelectorAll('[data-slot=menu-group-label]')].map((label) => label.textContent)
const selected = () => rows().findIndex((row) => row.getAttribute('aria-selected') === 'true')

describe('the palette', () => {
  it('opens on a bare slash, in the kit’s Dropdown Menu', () => {
    mount()
    type('/')

    expect(palette()).not.toBeNull()
    expect(palette()!.getAttribute('data-ui')).toBe('Dropdown Menu')
    expect(rows()).toHaveLength(8)
    expect(rows()[0]!.textContent).toContain('/dm')
  })

  it('narrows as the name is typed, names that start with it first', () => {
    mount()
    type('/re')

    // Then what holds it, or says a word that starts with it: `hire`, a "request", "resume".
    expect(names()).toEqual(['/reject', '/resume', '/approve', '/hire', '/pause'])
  })

  it('walks with the arrows, wrapping, and completes on Enter', () => {
    mount()
    type('/res')

    expect(selected()).toBe(0)
    press('ArrowDown')
    expect(selected()).toBe(1)
    press('ArrowDown')
    expect(selected()).toBe(0)
    press('ArrowUp')
    expect(selected()).toBe(1)
    press('Enter')

    // `/resume`, then `/pause`, whose line says "until you resume".
    expect(box().value).toBe('/pause ')
    expect(sent).toEqual([])
  })

  it('closes on Escape and leaves Enter to send', () => {
    mount()
    type('/re')
    press('Escape')

    expect(palette()).toBeNull()
  })

  it('completes an Employee for /dm', () => {
    mount()
    type('/dm O')

    expect(rows().map((row) => row.textContent)).toEqual(['Orion'])
    press('Enter')
    expect(box().value).toBe('/dm Orion ')
  })

  it('has no groups at all for a draft that can invoke nobody’s skills', () => {
    mount()
    type('/')

    expect(labels()).toEqual([])
    expect(names()).toHaveLength(8)
  })

  it('stays shut where the composer has no commands', () => {
    mount(false)
    type('/')

    expect(palette()).toBeNull()
  })
})

describe('an Employee’s skills', () => {
  it('lists them first, with what each says it does, over the commands', () => {
    held = ORION
    mount()
    type('/')

    expect(labels()).toEqual(['Skills · Orion3 skills', 'Commands'])
    expect(names().slice(0, 4)).toEqual(['/review-checklist', '/deploy-runbook', '/pen-handoff', '/dm'])
    expect(rows()[0]!.textContent).toContain('The checks this team runs before a pull request')
    expect(rows()).toHaveLength(11)
  })

  it('says a folder that is gone is missing', () => {
    held = ORION
    mount()
    type('/pen')

    expect(rows()[0]!.textContent).toContain('Folder is missing')
  })

  it('filters both groups by name and by what they say', () => {
    held = ORION
    mount()
    type('/release')

    expect(names()).toEqual(['/deploy-runbook'])
    expect(labels()).toEqual(['Skills · Orion3 skills'])
    type('/approve')
    expect(names()).toEqual(['/approve'])
    expect(labels()).toEqual([])
  })

  it('inserts the skill and a space on Enter, for the rest of the message', () => {
    held = ORION
    mount()
    type('/dep')
    press('Enter')

    expect(box().value).toBe('/deploy-runbook ')
    expect(sent).toEqual([])
  })

  it('sends a message that opens with one as a message, not a command', async () => {
    held = ORION
    mount()
    type('/review-checklist PR 12 before it merges')
    press('Escape')
    press('Enter')
    await act(async () => {})

    expect(ran).toEqual([])
    expect(sent).toEqual(['/review-checklist PR 12 before it merges'])
  })

  it('invokes a skill named like a command, and lists it once, under SKILLS', async () => {
    held = { owner: 'Orion', skills: [{ name: 'approve', description: 'Sign it off the way we do', missing: false }] }
    mount()
    type('/approve')

    expect(names()).toEqual(['/approve'])
    expect(labels()).toEqual(['Skills · Orion1 skill'])
    press('Escape')
    press('Enter')
    await act(async () => {})
    expect(ran).toEqual([])
    expect(sent).toEqual(['/approve'])
  })

  it('leaves the commands as they were', async () => {
    held = ORION
    mount()
    type('/ticket Login page')
    press('Escape')
    press('Enter')
    await act(async () => {})

    expect(ran).toEqual(['/ticket Login page'])
    expect(sent).toEqual([])
  })
})

describe('running one', () => {
  it('runs a command that is typed in full and takes nothing, without completing it again', () => {
    mount()
    type('/pause')
    press('Enter')

    expect(ran).toEqual(['/pause'])
    expect(sent).toEqual([])
  })

  it('still completes a half-typed name on Enter', () => {
    mount()
    type('/pau')
    press('Enter')

    expect(ran).toEqual([])
    expect(box().value).toBe('/pause ')
  })

  it('posts nothing for an unknown command and shows the hint', async () => {
    outcome = { ok: false, hint: '/deploy is not a command. Type / to see them all.' }
    mount()
    type('/deploy staging')
    press('Enter')
    await act(async () => {})

    expect(sent).toEqual([])
    expect(host.querySelector('p[role="alert"]')!.textContent).toBe('/deploy is not a command. Type / to see them all.')
    // What was typed stays in the box, so it can be fixed rather than typed again.
    expect(box().value).toBe('/deploy staging')
  })

  it('shows what a command did, once the box is empty again', async () => {
    outcome = { ok: true, note: 'Created #57 in Todo.' }
    mount()
    type('/ticket Login page')
    press('Escape')
    press('Enter')
    await act(async () => {})

    expect(box().value).toBe('')
    expect(host.querySelector('p[role="alert"]')!.textContent).toBe('Created #57 in Todo.')
  })

  it('leaves a message that only looks like a path alone', async () => {
    mount()
    type('/Users/yuri/notes.md is where I put it')
    press('Enter')
    await act(async () => {})

    expect(ran).toEqual([])
    expect(sent).toEqual(['/Users/yuri/notes.md is where I put it'])
  })
})

describe('Moving the caret', () => {
  it('reads the caret while the select event is live, so an @ does not crash the composer', () => {
    mount()
    type('@')
    expect(() =>
      act(() => {
        // React's onSelect is built from the document's selectionchange, on the focused field.
        box().focus()
        box().setSelectionRange(1, 1)
        document.dispatchEvent(new Event('selectionchange'))
      }),
    ).not.toThrow()
    expect(host.textContent).toContain('Hera')
  })
})
