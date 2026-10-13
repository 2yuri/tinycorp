/**
 * How a screen reads the engine: one store per channel, shared by every component that reads it.
 *
 * `useIpcResource` is the hook and `resources` is the catalogue of channels, so a screen names one
 * of those constants rather than reaching for `window.tinyCorp` and keeping a copy of the answer.
 * What the two processes *say* to each other is `src/shared/ipc`; this is the renderer's side of it.
 *
 * `useIpcSnapshot` — the same read with its loading and error states — is not out here yet: no
 * screen shows a spinner or a channel's refusal, and it moves to the door with the first that does.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { resources } from './resources'
export { publishIpcValue, refreshIpcResource, useIpcResource } from './use-ipc-resource'
