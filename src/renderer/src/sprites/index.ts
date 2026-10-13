/**
 * The character sheet: one PNG of pixel people, sliced, chroma-keyed and drawn.
 *
 * It names nothing else in the renderer. The office walks these characters around a floor and the
 * kit's `Avatar` draws the same one standing still, so it sits below both rather than inside either.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { CharacterPortrait } from './CharacterPortrait'
export { type Box, type SheetStyle, sliceSheet } from './sprite-sheet'
