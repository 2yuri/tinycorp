/**
 * Whether the Terminal tab's ticket card shows its checklist (TI-2). It starts folded, so a long
 * list never takes the terminal's room, and it comes back the way the boss left it, in this window
 * and the next one — as the drawer's width does.
 */
const OPEN_KEY = 'tinycorp.drawer.checklist-open'

/** The kept choice, or folded when nothing is stored (storage can be off, or hold junk). */
export function rememberedChecklistOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function rememberChecklistOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, String(open))
  } catch {
    // Nothing to do: the card opens folded next time.
  }
}
