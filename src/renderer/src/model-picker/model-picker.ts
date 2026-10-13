/**
 * MODEL and EFFORT, the two controls of frame `CLSj9` (T139), as pure data.
 *
 * Provider and model were two selects, and they fought: changing the Provider replaced the model
 * with the new product's default, so a boss who looked at what else was there came back to find
 * their choice gone. They were never two choices. A model id belongs to exactly one entry of
 * `PROVIDER_CATALOGUE`, so the Provider is derived from the model — and with nothing to keep in
 * step, there is no reset left to write.
 *
 * What is two choices is the model and how hard it thinks. The catalogue stores one entry per
 * `(model, effort)` pair, which is storage rather than a way to choose, so these functions present
 * the two axes over it: MODEL lists each model once, and EFFORT offers exactly the levels the
 * entries for that model carry — in the CLI's own words, never one it would reject.
 *
 * Nothing here names a Provider: the groups, their marks, their names, their models and their
 * effort levels are the catalogue, and the preflight state arrives as data the main process
 * already read (T135).
 */

import {
  type Effort,
  type ModelOption,
  PROVIDER_CATALOGUE,
  type Provider,
  type ProviderIcon,
} from '../../../shared/domain/providers'
import { machineWords } from '../../../shared/platform/machine-words'
import type { PreflightState, ProviderPreflight } from '../../../shared/providers/preflight'
import { preflightBlocks } from '../../../shared/providers/preflight'
import { modelOption, providerForModel } from '../../../shared/staff/models'
import { hostPlatform } from '../chrome'

/** What the control holds: a model, and the Provider it is read against when there is no model. */
export interface ModelChoice {
  provider: Provider
  /** Null runs on the Provider's default (decision 31). */
  model: string | null
}

/** Where the model goes when an Employee has none: the product's own default. */
export const DEFAULT_MODEL_WORD = 'default'

/** What the row says about a model no entry of the catalogue owns any more. */
export const UNKNOWN_MODEL_NOTE = 'TinyCorp no longer knows this model'

/** What the field calls the Employee it is about when nobody has named them yet. */
export const SOMEONE = 'this Employee'

/**
 * The word the menu's group header carries on the right. A Provider nobody has asked about yet
 * says nothing — a preflight answer is read, never guessed.
 */
const STATE_WORD: Record<PreflightState, string> = {
  ready: 'signed in',
  warning: 'signed in',
  missing: 'not installed',
  'signed-out': 'not signed in',
}

/** The half-sentence each blocked state contributes to the line under a closed field. */
function blockedReason(state: PreflightState, platform: string): string | null {
  const machine = machineWords(platform).machine
  if (state === 'missing') return `is not installed on ${machine}`
  if (state === 'signed-out') return `is not signed in on ${machine}`
  return null
}

export interface ModelRow {
  /** The entry this row picks: the model at the effort the control keeps. Null is the default. */
  id: string | null
  /** The model's name, as the catalogue spells it. */
  name: string
  provider: Provider
  /** The row the control is on now: ticked, and drawn on `--primary-subtle`. */
  current: boolean
  /** Its Provider's CLI cannot run an Employee today: greyed, still choosable. */
  blocked: boolean
}

export interface ModelGroup {
  provider: Provider
  name: string
  icon: ProviderIcon
  /** `signed in`, `not installed`… — null until this Provider has been asked. */
  state: string | null
  blocked: boolean
  models: ModelRow[]
}

/** One Provider's cached preflight answer, or null while nobody has asked. */
function checkFor(
  preflight: readonly ProviderPreflight[] | null | undefined,
  provider: Provider,
): ProviderPreflight | null {
  return preflight?.find((check) => check.provider === provider) ?? null
}

/**
 * Every entry for one CLI model, in catalogue order: the same model at each level it takes.
 *
 * This is where a model's levels live. They belong to the model and not to the product: one CLI
 * accepts `xhigh` and denies it for some of its own models, and another takes a level for one
 * model it has no notion of for the next.
 */
function entriesFor(provider: Provider, model: string): ModelOption[] {
  const entry: { models: readonly ModelOption[] } | undefined = PROVIDER_CATALOGUE.find((e) => e.id === provider)
  return (entry?.models ?? []).filter((option) => option.model === model)
}

/**
 * The entry to move to when the boss picks another model: the level they were on where the new
 * model takes it, and otherwise that model's own default — its first entry in the catalogue.
 *
 * The ticket left the fall open between this and "the nearest level". It is this one because there
 * is no order to be near along: the levels belong to the model, and one model's `high` is not a
 * position in another model's list. Ranking them would mean inventing a severity order across
 * products, which is the invention this ticket took out. A model's first entry, on the other hand,
 * is a claim the catalogue already makes.
 */
export function entryForModel(provider: Provider, model: string, effort: Effort | null): ModelOption {
  const entries = entriesFor(provider, model)
  return entries.find((option) => option.effort === effort) ?? entries[0]!
}

/**
 * The open menu: every Provider the Company knows, in catalogue order, each of its models once. A
 * Provider whose CLI is not ready is listed, greyed, with the reason — never hidden. The place you
 * choose a model is where you find out.
 */
export function modelGroups(value: ModelChoice, preflight: readonly ProviderPreflight[] | null): ModelGroup[] {
  const owner = providerForModel(value.model)
  const chosen = owner === null ? null : modelOption(owner, value.model)
  return PROVIDER_CATALOGUE.map((entry) => {
    const check = checkFor(preflight, entry.id)
    const blocked = check ? preflightBlocks(check) : false
    // One row per CLI model, at the effort the control is on; the EFFORT control moves it after.
    const models = [...new Set(entry.models.map((option) => option.model))].map((model) => {
      const row = entryForModel(entry.id, model, chosen?.effort ?? null)
      // The row is current when the Employee is on that model of that Provider, at whatever effort.
      const current = owner === entry.id && chosen?.model === model
      return { id: row.id, name: row.label, provider: entry.id, current, blocked }
    })
    return {
      provider: entry.id,
      name: entry.name,
      icon: entry.icon,
      state: check ? STATE_WORD[check.state] : null,
      blocked,
      models: [
        // Decision 31 stays reachable: an Employee can always go back to running on the product's
        // own default, which is what they run on before anyone picks anything.
        {
          id: null,
          name: DEFAULT_MODEL_WORD,
          provider: entry.id,
          current: value.model === null && value.provider === entry.id,
          blocked,
        },
        ...models,
      ],
    }
  })
}

/** The 40px MODEL field the control draws closed. */
export interface ClosedField {
  provider: Provider
  /** The chip's name and mark; the Provider that owns the model, or the one it is stored on. */
  name: string
  icon: ProviderIcon
  /** The model's name, `default` when it has none, the raw id when nobody owns it. */
  model: string
  /** The destructive line under the field, or null when there is nothing to say. */
  warning: string | null
  /** True when the model is one this build of TinyCorp no longer knows. */
  unknown: boolean
}

/**
 * What the closed MODEL field says, in each of its four states: a model its Provider can run, a
 * model on a Provider whose CLI is not ready, no model at all, and a model no Provider here owns
 * any more.
 *
 * `who` is the Employee the field is about, named in the warning — the boss reads one sentence and
 * knows both what is wrong and who it stops.
 */
export function closedField(
  value: ModelChoice,
  preflight: readonly ProviderPreflight[] | null,
  who: string,
  platform: string = hostPlatform(),
): ClosedField {
  const provider = providerForModel(value.model) ?? value.provider
  // A Provider can go the same way a model can. When it has, the chip says the id the Employee is
  // stored on rather than borrowing another product's name.
  const entry = PROVIDER_CATALOGUE.find((e) => e.id === provider)
  const option = entry?.models.find((m) => m.id === value.model) ?? null
  const unknown = value.model !== null && option === null
  const check = checkFor(preflight, provider)
  const reason = check && blockedReason(check.state, platform)
  const name = entry?.name ?? provider
  return {
    provider,
    name,
    icon: entry?.icon ?? 'terminal',
    model: option?.label ?? value.model ?? DEFAULT_MODEL_WORD,
    warning: unknown
      ? `${UNKNOWN_MODEL_NOTE} — ${who} runs on whatever ${name} makes of it.`
      : reason
        ? `${entry?.command ?? provider} ${reason} — ${who} cannot start until it is.`
        : null,
    unknown,
  }
}

/** One segment of the EFFORT control: a level, and the entry picking it would store. */
export interface EffortLevel {
  /** The CLI's own word, drawn in mono. */
  word: Effort
  /** The `ModelOption` id this level stores. */
  id: string
  current: boolean
}

export interface EffortField {
  /** The levels this model takes, in the Provider's order; empty when it takes none. */
  levels: EffortLevel[]
  /** Set instead of the segments when this model has no effort at all. */
  note: string | null
}

/**
 * The EFFORT control under the MODEL field: exactly the levels the catalogue lists for the model
 * the control is on, in the Provider's order, and never one it does not.
 *
 * Null when there is nothing to choose between — no model, or a model TinyCorp no longer knows. A
 * model that takes no effort flag at all is not nothing: it is a sentence, because an empty
 * control would look like a control that failed to load.
 */
export function effortField(value: ModelChoice): EffortField | null {
  const provider = providerForModel(value.model)
  const chosen = provider === null || value.model === null ? null : modelOption(provider, value.model)
  if (!chosen || provider === null) return null
  const entry = PROVIDER_CATALOGUE.find((e) => e.id === provider)!
  // Catalogue order, which is the model's own: there is no order across models to sort by.
  const levels = entriesFor(provider, chosen.model)
    .filter((option): option is ModelOption & { effort: Effort } => option.effort !== null)
    .map((option) => ({ word: option.effort, id: option.id, current: option.id === chosen.id }))
  return {
    levels,
    // Not "this product has no effort flag" — that is a claim about the CLI, and it is false for
    // all three of them. What is true is that TinyCorp knows no level for this model, and an
    // unconfirmed one would be silently downgraded rather than refused.
    note:
      levels.length > 0 ? null : `No effort level is known for this model — it runs at ${entry.name}'s own default.`,
  }
}

/** The frame's open list: 460 tall at most, 6px under the field. */
export const MENU_MAX = 460
export const MENU_GAP = 6
/** Shorter than this the list is no longer a list, so it takes this and lets its scroller move. */
export const MENU_MIN = 160

/**
 * How tall the open list may be (T262): whatever is left between the field and the bottom of what
 * scrolls around it, so opening it never gives that scroller more to scroll. The Hire modal's form
 * is one such scroller; with the list inside it the two scrolled the same way at once.
 */
export function menuHeight(fieldBottom: number, roomBottom: number): number {
  return Math.round(Math.min(MENU_MAX, Math.max(MENU_MIN, roomBottom - fieldBottom - 2 * MENU_GAP)))
}

/** The nearest box around `from` that scrolls vertically, or null where only the window does. */
export function scrollerAround(from: Element): Element | null {
  for (let at = from.parentElement; at; at = at.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at
  }
  return null
}
