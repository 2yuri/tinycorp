import {
  FALLBACK_PROVIDER,
  type ModelOption,
  PROVIDER_CATALOGUE,
  PROVIDER_MODELS,
  type Provider,
} from '../domain/providers'

export type { ModelOption }
export { FALLBACK_PROVIDER, PROVIDER_MODELS }

/** The label of an Employee without a model. */
export const DEFAULT_MODEL_LABEL = 'Default model'

export function modelOption(provider: Provider, id: string | null): ModelOption | null {
  if (id === null) return null
  return PROVIDER_MODELS[provider]?.find((option) => option.id === id) ?? null
}

/**
 * What a read-only strip — the drawer, the candidate chip — shows for an Employee's model: the
 * model's name, and the effort it runs at when it takes one, as the CLI spells it. The picker
 * draws the two apart (frame `CLSj9`); everywhere that has one line for both joins them here.
 */
export function modelLabel(provider: Provider, id: string | null): string {
  if (id === null) return DEFAULT_MODEL_LABEL
  const option = modelOption(provider, id)
  if (!option) return id
  return option.effort === null ? option.label : `${option.label} · ${option.effort}`
}

/**
 * The Provider whose catalogue owns a model id, or null when no entry does — the default (`null`),
 * or a model this build of TinyCorp no longer knows.
 *
 * A model id is unique across the catalogue (`providers.ts`), which is why the Provider is a fact
 * derived from the model rather than a second choice to keep in step with it: picking a model
 * picks the product that runs it, and nothing ever resets one because the other moved (T139).
 */
export function providerForModel(id: string | null): Provider | null {
  if (id === null) return null
  return PROVIDER_CATALOGUE.find((entry) => entry.models.some((option) => option.id === id))?.id ?? null
}

/** Accepts a known model id (or null for the default); anything else throws. */
export function requireModel(provider: Provider, id: unknown): string | null {
  if (id === null) return null
  if (typeof id !== 'string' || !modelOption(provider, id)) {
    const known = PROVIDER_MODELS[provider]?.map((o) => o.id).join(', ') ?? ''
    throw new Error(`Unknown model: ${String(id)}. Known models: ${known}`)
  }
  return id
}

/**
 * Accepts any model the catalogue knows, whichever Provider owns it (or null for the default).
 *
 * A hire proposal carries a model and no Provider: the Provider is the one that owns the model, and
 * it is written onto the Employee at the moment they are hired. So the proposal is checked against
 * the whole catalogue rather than one product's corner of it.
 */
export function requireKnownModel(id: unknown): string | null {
  if (id === null) return null
  if (typeof id !== 'string' || providerForModel(id) === null) {
    const known = PROVIDER_CATALOGUE.flatMap((entry) => entry.models.map((o) => o.id)).join(', ')
    throw new Error(`Unknown model: ${String(id)}. Known models: ${known}`)
  }
  return id
}

/**
 * Every model a hire may be asked for, one line each, grouped by the product that runs it: what
 * HR's `hire_request` offers and what an Employee holding `hire` is told (T169).
 *
 * The whole catalogue and not one product's corner of it, because that is exactly what the engine
 * accepts — `requireKnownModel` takes any id the catalogue holds, and the model names the Provider
 * the hire is put on (T139). A list of one product's models was a promise the engine never made.
 */
export function hireableModelLines(): string[] {
  return PROVIDER_CATALOGUE.flatMap((entry) => [
    `${entry.name}:`,
    ...entry.models.map((option) => `- \`${option.id}\`: ${modelLabel(entry.id, option.id)}`),
  ])
}
