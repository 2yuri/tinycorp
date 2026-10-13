/**
 * Where the open tabs live while the boss is somewhere else (T121). The Files view is unmounted
 * the moment the shell shows another one, so the tabs cannot live in its state: they are held
 * here, for the Company they were opened in, and going back to Files finds them as they were.
 *
 * They are held in memory only. Closing the Company drops them, which is what the ticket asks.
 */
import { NO_TABS, type TabsState } from './tabs-model'

/** The tabs of one Company; another Company's are never shown. */
let held: { companyId: string; state: TabsState } | null = null

/** Installed once: the Company changing under the app is the same as closing it. */
let _forgetting: (() => void) | null = null

/** The tabs the Files view had in this Company, or none when it has not been there yet. */
export function recallTabs(companyId: string | null): TabsState {
  watchCompany()
  return held && companyId !== null && held.companyId === companyId ? held.state : NO_TABS
}

/** What the view has open now, kept for the next time the boss comes back to it. */
export function rememberTabs(companyId: string | null, state: TabsState): void {
  if (companyId === null) return
  watchCompany()
  held = { companyId, state }
}

/** Drops what is held: the Company closed, or the tests want a clean slate. */
export function forgetTabs(): void {
  held = null
}

function watchCompany(): void {
  _forgetting ??= globalThis.window?.tinyCorp?.company?.onChanged(() => forgetTabs()) ?? null
}
