import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE, type Provider, type ProviderEntry } from '../../../shared/domain/providers'
import type { ProviderCheck, ProviderPreflight } from '../../../shared/providers/preflight'
import {
  closedField,
  DEFAULT_MODEL_WORD,
  effortField,
  entryForModel,
  MENU_MAX,
  MENU_MIN,
  menuHeight,
  modelGroups,
  UNKNOWN_MODEL_NOTE,
} from './model-picker'

/** A catalogue entry whose id is still the Provider union, so no test needs a cast. */
type Entry = ProviderEntry & { id: Provider }

/** Every Provider the catalogue holds, so no test here names one. */
const CATALOGUE: readonly Entry[] = PROVIDER_CATALOGUE
const [first, second] = CATALOGUE
const last = CATALOGUE.at(-1)!

const model = (provider: Entry = first!, index = 0) => provider.models[index]!

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

/** Every Provider signed in: the ordinary Monday. */
const allReady = CATALOGUE.map((entry) => answer(entry.id, 'ready'))

/** The first Provider model that has more than one effort to choose between. */
const withEfforts = first!.models.find(
  (option) => first!.models.filter((other) => other.model === option.model).length > 1,
)!

describe('the closed MODEL field', () => {
  it('reads the Provider off the model, whatever the Employee is stored as', () => {
    const owned = model(second!)

    const field = closedField({ provider: first!.id, model: owned.id }, allReady, 'Ada')

    expect(field.provider).toBe(second!.id)
    expect(field.name).toBe(second!.name)
    // The model's own name, with no effort in it: the effort is its own control now.
    expect(field.model).toBe(owned.label)
    expect(field.warning).toBeNull()
  })

  it('shows an Employee with no model as their Provider, with `default` where the model goes', () => {
    const field = closedField({ provider: second!.id, model: null }, allReady, 'Ada')

    expect(field).toMatchObject({
      provider: second!.id,
      name: second!.name,
      model: DEFAULT_MODEL_WORD,
      warning: null,
      unknown: false,
    })
  })

  it('takes the destructive line when the model’s CLI cannot run it, naming the Employee', () => {
    const notReady = [...allReady.filter((a) => a.provider !== last.id), answer(last.id, 'missing')]

    const field = closedField({ provider: first!.id, model: model(last).id }, notReady, 'Ada')

    expect(field.warning).toBe(`${last.command} is not installed on this Mac — Ada cannot start until it is.`)
  })

  it('says as much when the CLI is there and nobody is signed in', () => {
    const signedOut = [answer(first!.id, 'signed-out')]

    const field = closedField({ provider: first!.id, model: model().id }, signedOut, 'Ada')

    expect(field.warning).toBe(`${first!.command} is not signed in on this Mac — Ada cannot start until it is.`)
  })

  /** A refusal is never a guess: nothing is said until that Provider has actually been asked. */
  it('says nothing about a Provider nobody has asked about yet', () => {
    expect(closedField({ provider: first!.id, model: model().id }, null, 'Ada').warning).toBeNull()
    expect(closedField({ provider: first!.id, model: model().id }, [], 'Ada').warning).toBeNull()
  })

  it('names the Provider an Employee is stored on even when that has gone too', () => {
    const field = closedField({ provider: 'a-provider-tinycorp-removed' as Provider, model: null }, allReady, 'Ada')

    expect(field.name).toBe('a-provider-tinycorp-removed')
    expect(field.model).toBe(DEFAULT_MODEL_WORD)
    expect(field.warning).toBeNull()
  })

  /**
   * A Provider removed, an entry renamed: the row says what the Employee is on and that TinyCorp
   * no longer knows it, rather than snapping to a default behind the boss's back.
   */
  it('still draws a model the catalogue has lost, as it is stored', () => {
    const field = closedField({ provider: second!.id, model: 'a-model-tinycorp-removed' }, allReady, 'Ada')

    expect(field.unknown).toBe(true)
    expect(field.model).toBe('a-model-tinycorp-removed')
    expect(field.name).toBe(second!.name)
    expect(field.warning).toContain(UNKNOWN_MODEL_NOTE)
    expect(field.warning).toContain('Ada')
  })
})

describe('the open menu', () => {
  it('is the catalogue: one group per Provider, in catalogue order, each model once under it', () => {
    const groups = modelGroups({ provider: first!.id, model: null }, allReady)

    expect(groups.map((group) => group.provider)).toEqual(CATALOGUE.map((entry) => entry.id))
    expect(groups.map((group) => group.name)).toEqual(CATALOGUE.map((entry) => entry.name))
    for (const [index, group] of groups.entries()) {
      const entry = CATALOGUE[index]!
      // One row per CLI model, never one per (model, effort) pair — that is storage, not a choice.
      const models = [...new Set(entry.models.map((option) => option.model))]
      expect(group.models.map((row) => row.id)).toHaveLength(models.length + 1)
      // The default heads each group, so decision 31 stays reachable once a model is picked.
      expect(group.models[0]).toMatchObject({ id: null, name: DEFAULT_MODEL_WORD })
      expect(group.models.every((row) => row.provider === entry.id)).toBe(true)
    }
  })

  it('names each row with the model’s own name, and nothing about the effort', () => {
    const rows = modelGroups({ provider: first!.id, model: null }, allReady)
      .flatMap((group) => group.models)
      .filter((row) => row.id !== null)

    for (const row of rows) {
      const option = CATALOGUE.flatMap((e) => e.models).find((o) => o.id === row.id)!
      expect(row.name).toBe(option.label)
      expect(option.effort === null || !row.name.includes(option.effort)).toBe(true)
    }
  })

  it('ticks the row of the model the control is on, at whatever effort', () => {
    const chosen = model(second!, 1)

    const ticked = modelGroups({ provider: first!.id, model: chosen.id }, allReady)
      .flatMap((group) => group.models)
      .filter((row) => row.current)

    expect(ticked).toHaveLength(1)
    expect(ticked[0]!.name).toBe(chosen.label)
  })

  it('ticks the default of the Provider an Employee with no model runs on, and no other', () => {
    const ticked = modelGroups({ provider: second!.id, model: null }, allReady)
      .flatMap((group) => group.models)
      .filter((row) => row.current)

    expect(ticked).toHaveLength(1)
    expect(ticked[0]).toMatchObject({ id: null, provider: second!.id })
  })

  /** Listed, greyed, with the reason — the place you choose a model is where you find out. */
  it('lists a Provider whose CLI is not ready, greyed, with its state beside its name', () => {
    // The first is signed in, the second is not installed, and anything after them is signed out.
    const notReady = CATALOGUE.map((entry, index) =>
      answer(entry.id, index === 0 ? 'ready' : index === 1 ? 'missing' : 'signed-out'),
    )

    const groups = modelGroups({ provider: first!.id, model: null }, notReady)

    expect(groups.map((group) => [group.name, group.state, group.blocked])).toEqual([
      [first!.name, 'signed in', false],
      [second!.name, 'not installed', true],
      ...CATALOGUE.slice(2).map((entry) => [entry.name, 'not signed in', true]),
    ])
    // Greyed, never hidden: every model is still there to pick, and picking one is allowed.
    expect(groups[1]!.models.every((row) => row.blocked)).toBe(true)
  })

  it('says nothing beside a Provider nobody has asked about yet', () => {
    const groups = modelGroups({ provider: first!.id, model: null }, null)

    expect(groups.map((group) => group.state)).toEqual(CATALOGUE.map(() => null))
    expect(groups.some((group) => group.blocked)).toBe(false)
  })

  /** An API key is a warning and not a wall (T135): it is signed in, and nothing is greyed. */
  it('treats a warning as signed in, because it stops nothing', () => {
    const groups = modelGroups({ provider: first!.id, model: null }, [answer(first!.id, 'warning')])

    expect(groups[0]).toMatchObject({ state: 'signed in', blocked: false })
  })

  it('keeps the effort the control is on when a row is picked', () => {
    const siblings = first!.models.filter((option) => option.model === withEfforts.model)
    const deepest = siblings.at(-1)!

    const row = modelGroups({ provider: first!.id, model: deepest.id }, allReady)[0]!.models.find(
      (item) => item.name === deepest.label,
    )!

    expect(row.id).toBe(deepest.id)
  })
})

describe('the EFFORT control', () => {
  it('offers exactly the levels the catalogue lists for that model, in its own order', () => {
    const field = effortField({ provider: first!.id, model: withEfforts.id })!
    const siblings = first!.models.filter((option) => option.model === withEfforts.model)

    expect(field.note).toBeNull()
    // The model's own entries, in catalogue order. Never a level it does not have: that entry does
    // not exist, and drawing one greyed would be a claim about the model nothing here can back.
    expect(field.levels.map((level) => level.word)).toEqual(siblings.map((option) => option.effort))
    expect(field.levels.map((level) => level.id)).toEqual(siblings.map((option) => option.id))
  })

  it('marks the level the Employee runs at, and each level stores its own entry', () => {
    const field = effortField({ provider: first!.id, model: withEfforts.id })!

    const current = field.levels.filter((level) => level.current)
    expect(current.map((level) => level.id)).toEqual([withEfforts.id])
    expect(current[0]!.word).toBe(withEfforts.effort)
  })

  /**
   * A model TinyCorp knows no level for. The note is about the catalogue, not about the CLI: at
   * least one Provider here does take a level nobody has confirmed yet (#283), and an empty
   * control would read as one that failed to load.
   */
  it('says the model runs at the product’s default when no level is known for it', () => {
    const none = CATALOGUE.flatMap((entry) =>
      entry.models.filter((option) => option.effort === null).map((option) => [entry, option] as const),
    )
    expect(none.length).toBeGreaterThan(0)

    for (const [entry, option] of none) {
      const field = effortField({ provider: entry.id, model: option.id })!
      expect(field.levels).toEqual([])
      expect(field.note).toBe(`No effort level is known for this model — it runs at ${entry.name}'s own default.`)
    }
  })

  it('has nothing to draw with no model, nor with one the catalogue has lost', () => {
    expect(effortField({ provider: first!.id, model: null })).toBeNull()
    expect(effortField({ provider: first!.id, model: 'a-model-tinycorp-removed' })).toBeNull()
  })
})

describe('moving to another model', () => {
  it('keeps the effort where the new model has it', () => {
    const wanted = withEfforts.effort!
    const other = first!.models.find((option) => option.model !== withEfforts.model && option.effort === wanted)!

    expect(entryForModel(first!.id, other.model, wanted).id).toBe(other.id)
  })

  /**
   * The fall, when the new model does not take the level the boss was on: that model's own
   * default, its first entry. Not "the nearest level" — the levels belong to the model, so one
   * model's `high` is not a position in another model's list, and ranking them would mean
   * inventing a severity order across products, which is the invention this ticket took out.
   */
  it('falls to the model’s own default when the level it was on is not one of its own', () => {
    const [entry, model] = CATALOGUE.flatMap((e) =>
      [...new Set(e.models.map((o) => o.model))].map((m) => [e, m] as const),
    ).find(([e, m]) => e.models.some((o) => o.model === m && o.effort !== null))!
    const own = entry.models.filter((option) => option.model === model)

    expect(entryForModel(entry.id, model, 'a-level-no-catalogue-model-has').id).toBe(own[0]!.id)
    // And the level it was on, where the model does take it.
    for (const option of own) expect(entryForModel(entry.id, model, option.effort).id).toBe(option.id)
  })

  it('lands on the model’s only entry when it takes no effort at all', () => {
    const [entry, option] = CATALOGUE.flatMap((e) =>
      e.models.filter((o) => o.effort === null).map((o) => [e, o] as const),
    )[0]!

    expect(entryForModel(entry.id, option.model, 'high').id).toBe(option.id)
    expect(entryForModel(entry.id, option.model, null).id).toBe(option.id)
  })
})

describe('the open list’s height (T262)', () => {
  it('takes the frame’s 460 where there is room for it', () => {
    expect(menuHeight(100, 900)).toBe(MENU_MAX)
  })

  it('stops short of the bottom of what scrolls around it, so that never has more to scroll', () => {
    // The field ends at 300 and the form it is in at 620: 6px under the field, 6px above the edge.
    expect(menuHeight(300, 620)).toBe(308)
  })

  it('never shrinks below a list you can read', () => {
    expect(menuHeight(600, 620)).toBe(MENU_MIN)
  })
})
