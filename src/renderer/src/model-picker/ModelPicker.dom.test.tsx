// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE, type Provider, type ProviderEntry } from '../../../shared/domain/providers'
import type { ProviderCheck, ProviderPreflight } from '../../../shared/providers/preflight'
import type { ModelOption } from '../../../shared/staff/models'
import { ModelPicker } from './ModelPicker'
import type { ModelChoice } from './model-picker'

/** A catalogue entry whose id is still the Provider union, so no test needs a cast. */
type Entry = ProviderEntry & { id: Provider }

const CATALOGUE: readonly Entry[] = PROVIDER_CATALOGUE
const [first, second] = CATALOGUE
const last = CATALOGUE.at(-1)!

function answer(provider: Provider, state: ProviderCheck['state']): ProviderPreflight {
  return {
    provider,
    state,
    title: '',
    body: '',
    lead: '',
    commands: [],
    note: '',
    account: null,
    plan: null,
    checkedAt: '',
    hired: false,
  }
}

const allReady = CATALOGUE.map((entry) => answer(entry.id, 'ready'))

let host: HTMLDivElement
let root: Root
const chosen: ModelChoice[] = []

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  chosen.length = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function draw(element: ReactNode) {
  act(() => root.render(element))
}

function picker(props: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  draw(
    <ModelPicker
      value={null}
      provider={first!.id}
      preflight={allReady}
      who="Ada"
      onChange={(choice) => chosen.push(choice)}
      {...props}
    />,
  )
}

/*
 * The control is found the way the boss finds it and the way a screen reader reads it: by role, by
 * label, and by the `data-ui` names its two halves carry. Nothing here selects on a class, so the
 * translation to utilities (T210f) left every one of these tests saying what it said before.
 */
const field = () => host.querySelector<HTMLButtonElement>('button[aria-label="Model"]')!
const open = () => act(() => field().click())
const menu = () => host.querySelector('[role="menu"]')
const rows = (within: ParentNode = host) => [...within.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]

/** The group the menu draws for one Provider, by the name in its header. */
const groupFor = (name: string) => {
  const group = [...host.querySelectorAll('fieldset')].find((node) => node.getAttribute('aria-label') === name)
  if (!group) throw new Error(`no group for ${name}`)
  return group
}

/** The group's header, which is what greys when the Provider is not ready. */
const headOf = (group: Element) => group.querySelector('div')!

/** One model's row, found the way the boss finds it: under its Provider, by the name it shows. */
const rowFor = (provider: Entry, option: ModelOption) => {
  const row = rows(groupFor(provider.name)).find((item) => item.textContent === option.label)
  if (!row) throw new Error(`no row for ${option.label}`)
  return row
}

/** The EFFORT control's segments, in the order they are drawn. */
const efforts = () => [...host.querySelectorAll<HTMLLabelElement>('[role="radiogroup"] label')]
const effortFor = (word: string) => {
  const found = efforts().find((button) => button.textContent === word)
  if (!found) throw new Error(`no effort ${word}`)
  return found
}
const text = (selector: string) => host.querySelector(selector)?.textContent ?? null

describe('picking a model', () => {
  it('opens the catalogue as one menu and closes again', () => {
    picker()

    expect(menu()).toBeNull()
    open()
    expect(menu()).not.toBeNull()
    expect(field().getAttribute('aria-expanded')).toBe('true')
    open()
    expect(menu()).toBeNull()
  })

  /** The whole of T139: one choice, and the Provider is a fact that comes with it. */
  it('sends the Provider that owns the model, from wherever the control started', () => {
    const wanted = second!.models[0]!
    picker({ provider: first!.id, value: null })

    open()
    act(() => rowFor(second!, wanted).click())

    expect(chosen).toEqual([{ provider: second!.id, model: wanted.id }])
  })

  it('sends the Provider’s own default when the default row is picked', () => {
    picker({ value: first!.models[0]!.id })

    open()
    act(() => rows(groupFor(second!.name))[0]!.click())

    expect(chosen).toEqual([{ provider: second!.id, model: null }])
  })

  /**
   * There is no Provider control any more, so there is no provider change that could reset a
   * model. The control only ever reports the pair it was clicked on.
   */
  it('never reports a model the boss did not click', () => {
    picker({ value: last.models[0]!.id, provider: last.id })

    open()
    act(() => rowFor(first!, first!.models[0]!).click())
    open()
    act(() => rowFor(last, last.models[0]!).click())

    expect(chosen).toEqual([
      { provider: first!.id, model: first!.models[0]!.id },
      { provider: last.id, model: last.models[0]!.id },
    ])
  })

  it('ticks the current row and leaves every other one plain', () => {
    const current = second!.models[0]!
    picker({ value: current.id })

    open()
    const checked = rows().filter((row) => row.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]!.textContent).toBe(current.label)
    // The ticked row is the only one drawn on the primary wash.
    expect(checked[0]!.className).toContain('bg-primary-subtle')
  })
})

describe('a Provider whose CLI is not ready', () => {
  const missing = [...allReady.filter((check) => check.provider !== last.id), answer(last.id, 'missing')]

  it('marks the closed field and says what is wrong and who it stops', () => {
    picker({ value: last.models[0]!.id, preflight: missing, who: 'Ada' })

    expect(field().className).toContain('border-destructive')
    expect(text('[role="alert"]')).toBe(`${last.command} is not installed on this Mac — Ada cannot start until it is.`)
  })

  it.each([
    ['win32', 'this PC'],
    ['linux', 'this computer'],
  ])('on %s, says the CLI is not installed on %s (T265)', (platform, machine) => {
    const holder = window as { tinyCorp?: unknown }
    holder.tinyCorp = { shell: { platform } }
    try {
      picker({ value: last.models[0]!.id, preflight: missing, who: 'Ada' })

      expect(text('[role="alert"]')).toBe(
        `${last.command} is not installed on ${machine} — Ada cannot start until it is.`,
      )
    } finally {
      delete holder.tinyCorp
    }
  })

  it('still lets the boss pick one of its models — a warning, never a block', () => {
    const wanted = last.models[0]!
    picker({ value: null, preflight: missing })

    open()
    expect(headOf(groupFor(last.name)).className).toContain('text-destructive')
    act(() => rowFor(last, wanted).click())

    expect(chosen).toEqual([{ provider: last.id, model: wanted.id }])
  })

  it('names the Employee only when there is one to name', () => {
    picker({ value: last.models[0]!.id, preflight: missing, who: '  ' })

    expect(text('[role="alert"]')).toContain('this Employee cannot start')
  })
})

describe('the EFFORT control', () => {
  /** The model the first Provider offers at more than one level. */
  const many = first!.models.find((option) => first!.models.filter((other) => other.model === option.model).length > 1)!
  const siblings = first!.models.filter((option) => option.model === many.model)

  it('draws one segment per level the model takes, in the CLI’s own word', () => {
    picker({ value: siblings[0]!.id })

    expect(efforts().map((button) => button.textContent)).toEqual(siblings.map((option) => option.effort))
    expect(efforts().filter((segment) => segment.querySelector<HTMLInputElement>('input')!.checked)).toHaveLength(1)
  })

  it('stores the entry for that model at that level, and never touches the model', () => {
    const other = siblings.find((option) => option.id !== siblings[0]!.id)!
    picker({ value: siblings[0]!.id })

    act(() => effortFor(other.effort!).click())

    expect(chosen).toEqual([{ provider: first!.id, model: other.id }])
  })

  /** A model TinyCorp knows no level for: a line, because an empty control reads as broken. */
  it('says so in a line for a model no level is known for', () => {
    const none = CATALOGUE.flatMap((entry) =>
      entry.models.filter((option) => option.effort === null).map((option) => [entry, option] as const),
    )[0]!
    picker({ value: none[1].id, provider: none[0].id })

    expect(efforts()).toEqual([])
    expect(host.textContent).toContain(
      `No effort level is known for this model — it runs at ${none[0].name}'s own default.`,
    )
  })

  it('is not drawn at all for an Employee on the Provider default', () => {
    picker({ value: null })

    expect(efforts()).toEqual([])
    expect(host.textContent).not.toContain('No effort level is known')
    expect(host.textContent).not.toContain('EFFORT')
  })

  it('keeps the level when the boss moves to a model that has it', () => {
    const deepest = siblings.at(-1)!
    const elsewhere = first!.models.find(
      (option) => option.model !== deepest.model && option.effort === deepest.effort,
    )!
    picker({ value: deepest.id })

    open()
    act(() => rowFor(first!, elsewhere).click())

    expect(chosen).toEqual([{ provider: first!.id, model: elsewhere.id }])
  })
})

describe('a model the catalogue no longer knows', () => {
  it('draws it as it is stored, and says TinyCorp no longer knows it', () => {
    picker({ value: 'a-model-tinycorp-removed', provider: second!.id, preflight: allReady })

    expect(text('[data-ui="Model Name"]')).toBe('a-model-tinycorp-removed')
    expect(text('[data-ui="Provider Name"]')).toBe(second!.name)
    expect(text('[role="alert"]')).toContain('no longer knows')
    // It is drawn, not fixed: nothing is sent until the boss picks something.
    expect(chosen).toEqual([])
  })
})

/**
 * The one-line form of frame `bB6VX`, under Usage & routing's own `CONTINUE ON` label: the field
 * with the level read out inside it, and no second control under it. Reusing the stacked form
 * there put a `MODEL` heading under a label that already said what the field was, and an EFFORT
 * track the frame does not draw — 23px of card the whole column then sat below (T196).
 */
describe('the inline field', () => {
  const many = first!.models.find((option) => first!.models.filter((other) => other.model === option.model).length > 1)!

  it('writes no label of its own, because the caller already wrote one', () => {
    picker({ value: many.id, inline: true })

    expect(host.textContent).not.toContain('MODEL')
    expect(host.textContent).not.toContain('EFFORT')
  })

  it('reads the level out inside the field instead of drawing the EFFORT track', () => {
    picker({ value: many.id, inline: true })

    expect(text('[data-ui="Badge"]')).toBe(many.effort)
    expect(efforts()).toEqual([])
  })

  it('reads out nothing for a model that takes no level', () => {
    picker({ value: null, inline: true })

    expect(text('[data-ui="Badge"]')).toBeNull()
  })

  it('still opens the catalogue, so the model stays the boss’s to pick', () => {
    picker({ value: many.id, inline: true })

    open()

    expect(rows().length).toBeGreaterThan(0)
  })
})
