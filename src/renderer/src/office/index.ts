/**
 * The office floor itself — the painting, the characters on it, and the boss's own desk.
 *
 * `office-view` is the screen around it; this is the scene.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

import { type ComponentType, lazy } from 'react'
import type { OfficeProps } from './Office'

export { BossDesk } from './BossDesk'
export type { OfficeHandle } from './Office'
export { useOfficeScene } from './use-office-scene'

/**
 * The floor itself, loaded the first time it is drawn (T211).
 *
 * `useOfficeScene` is the same projection the Employees view reads for its cards, and a static
 * export of the canvas beside it dragged PixiJS into that screen's chunk — and from there into
 * every screen, because they are all in one. Whoever renders it needs a `<Suspense>` above it.
 */
export const Office: ComponentType<OfficeProps> = lazy(async () => ({ default: (await import('./Office')).Office }))
