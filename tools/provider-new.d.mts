/** Types for `tools/provider-new.mjs`, the `pnpm provider:new` command. See `docs/providers.md`. */

/** The files the command reads and writes, relative to the repo root. */
export const CATALOGUE: string
/** The Provider module: one folder per Provider, the registry and the conformance suite beside them. */
export const PROVIDERS: string
export const REGISTRY: string
export const DOCS: string
export const TEMPLATE: string
export const TEMPLATE_FILES: readonly string[]

/** What a new Provider is called: its id, its product name and the CLI it is installed as. */
export interface NewProvider {
  id: string
  name: string
  command: string
}

/** `open-code` → `OpenCode`, for the factory and the types. */
export function pascal(id: string): string
/** `open-code` → `OPEN_CODE`, for the constants. */
export function upper(id: string): string
/** The template's text with every `example` in it replaced by this Provider's own names. */
export function rename(text: string, id: string, name: string): string
export function withCatalogueEntry(source: string, provider: NewProvider): string
export function withRegistryLine(source: string, provider: Pick<NewProvider, 'id'>): string
export function withDocsRow(source: string, provider: NewProvider): string
/** Everything the command would write, as `{ path: contents }`. Nothing is written. */
export function planProvider(root: string, provider: NewProvider): Record<string, string>
/** Writes it all, or throws having written nothing. Returns the paths, in the order written. */
export function createProvider(root: string, provider: NewProvider): string[]
