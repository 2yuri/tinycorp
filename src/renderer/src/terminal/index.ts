/**
 * An Employee's live terminal, and what RTK is doing to what it reads.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

import { type ComponentType, lazy } from 'react'
import type { LiveTerminalProps } from './LiveTerminal'
import type { PtyScreenProps } from './PtyScreen'

export type { PtyScreenProps } from './PtyScreen'
export { RtkChip } from './RtkChip'

/**
 * An Employee's terminal, loaded the first time a drawer opens on one (T211).
 *
 * xterm and its WebGL addon are about 450 KB before minification, and nothing outside the drawer
 * draws them — the Launcher, the onboarding wizard and the preflight cards were all paying for
 * them. Whoever renders it needs a `<Suspense>` above it.
 */
export const LiveTerminal: ComponentType<LiveTerminalProps> = lazy(async () => ({
  default: (await import('./LiveTerminal')).LiveTerminal,
}))

/**
 * The sign-in modal's terminal (T263), from the same lazy chunk: whichever of the two mounts first
 * pulls xterm, and the startup bundle holds neither.
 */
export const PtyScreen: ComponentType<PtyScreenProps> = lazy(async () => ({
  default: (await import('./PtyScreen')).PtyScreen,
}))
