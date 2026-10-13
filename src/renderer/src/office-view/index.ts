/**
 * The Office screen: the floor, its header, and what it says about who is where.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

import { type ComponentType, lazy } from 'react'
import type { OfficeViewProps } from './OfficeView'

export { fallbackOffer } from './fallback-offer'
export { officeHeaderFacts } from './header-facts'
export { OfficeActions } from './OfficeHeader'
export { toggleLegend } from './toggle-legend'

/**
 * The Office screen, loaded the first time it is opened (T211).
 *
 * It is the one screen that draws the PixiJS canvas and the one that opens the Employee drawer, so
 * a static export here put ~1.1 MB of WebGL and xterm in the chunk the Launcher, the onboarding
 * wizard and the preflight cards are served from — screens that draw neither. Every other door into
 * this folder — `toggleLegend` for the View menu, `fallbackOffer` and `officeHeaderFacts` — stays
 * eager, and the menu's Legend request already waits for the canvas to arrive (`toggle-legend.ts`).
 *
 * Whoever renders it needs a `<Suspense>` above it.
 */
export const OfficeView: ComponentType<OfficeViewProps> = lazy(async () => ({
  default: (await import('./OfficeView')).OfficeView,
}))
