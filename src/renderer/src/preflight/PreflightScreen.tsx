import { useEffect } from 'react'
import { APP_NAME } from '../../../shared/app/app-name'
import type { Boss } from '../../../shared/boss-profile'
import { PROVIDER_LABEL, PROVIDERS } from '../../../shared/domain/providers'
import { blockedProviders, type ProviderPreflight } from '../../../shared/providers/preflight'
import { LogoMark } from '../brand'
import { LAUNCHER_BODY, LAUNCHER_MARK, LAUNCHER_TAGLINE, LAUNCHER_WORDMARK, LauncherFrame } from '../launcher'
import { PreflightCard } from './PreflightCard'
import { PreflightChooser } from './PreflightChooser'
import '../ui/tailwind.css'

/*
 * The preflight screen (T210c): the Launcher's own window and head, with the cards where the
 * Company list goes.
 *
 * The head is `LAUNCHER_HEAD` written out with the 48px this screen puts under it rather than the
 * Launcher's 26px. Written out and not composed, because both Tailwind and `tailwind.test.ts` read
 * this file's own text: a composed list leaves the test with nothing of this screen to check.
 */
const HEAD = 'flex w-full shrink-0 flex-col items-center gap-12 pb-48'
/*
 * Two cards fit the 740px window and the chooser is one, so nothing normally scrolls. A Company
 * hired on three broken Providers still can, rather than hiding the last card, and `Check again`
 * rides on it. The -3/3 pair is so a focus ring is not clipped by the scroller.
 */
const CARDS = 'flex min-h-0 w-[calc(100%+6px)] flex-initial flex-col gap-12 -m-3 overflow-y-auto p-3'

/**
 * The tagline of frame `KB9AX`, where the rows name the products themselves (T250). Listing them
 * again over the top would be the same three names twice in four inches.
 */
export const PREFLIGHT_CHOOSER_TAGLINE = 'Every Employee is a coding agent on your own subscription.'

/**
 * The tagline of frame `uSaf3`: what an Employee is, in the one sentence that explains the cards.
 * It names every Provider in the catalogue, not the ones in trouble: an Employee is a coding
 * agent on whichever of them the boss picks, and naming only the missing one read as if TinyCorp
 * were that product alone.
 */
export function preflightTagline(): string {
  const names = PROVIDERS.map((provider) => PROVIDER_LABEL[provider])
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '')
  return `Every Employee is a coding agent on your own subscription: ${list}.`
}

/**
 * Whether the screen is the chooser rather than a stack of cards (T250).
 *
 * `blockedProviders` answers two different questions with one list. Inside a Company it is the
 * Providers this Company's Employees are hired on that cannot run one, and each of those is an
 * Employee stopped — a card each, as before. Before the first hire it is empty unless *every*
 * Provider is blocked, and then nobody is stopped yet and the boss has one thing to do rather than
 * three: set up a coding agent. So a list with nobody hired in it is the chooser.
 */
export function preflightIsChooser(blocked: readonly ProviderPreflight[]): boolean {
  return blocked.length > 0 && blocked.every((check) => !check.hired)
}

export interface PreflightScreenProps {
  /** The Providers in trouble, in catalogue order. One card each, or one row each in the chooser. */
  blocked: readonly ProviderPreflight[]
  /** The boss's own profile, for where the chooser says the team runs (T249). Null before it is read. */
  boss: Boss | null
  checking: boolean
  onRecheck(): void
  /** Leaves for the Launcher: the note beside `Check again`, and `Escape`. */
  onDismiss(): void
}

/**
 * The Launcher's own 680×740 window when no CLI here can run an Employee (T129, T135, T250): the
 * mark, `Tiny Corp`, the tagline, and — in place of the Company list — one of two things.
 *
 * Before the first hire it is the chooser of frame `KB9AX`: one card, a row per Provider, one of
 * them open. Inside a Company it is frame `uSaf3`: a card per Provider its Employees are hired on
 * and cannot run, because each of those is an Employee stopped and another product being installed
 * is no comfort to them.
 *
 * It does not trap — the line beside `Check again` is the way out, and so is `Escape`.
 */
export function PreflightScreen({ blocked, boss, checking, onRecheck, onDismiss }: PreflightScreenProps) {
  const choosing = preflightIsChooser(blocked)
  return (
    // The Pen title `KB9AX` carried named the one Provider it was drawn for; the screen is the
    // same one and is now about a coding agent, whichever product that turns out to be.
    <LauncherFrame name="Desktop App / Provider Missing" title={APP_NAME}>
      <div className={LAUNCHER_BODY}>
        <div className={HEAD}>
          <LogoMark size={78} className={LAUNCHER_MARK} />
          <h1 className={LAUNCHER_WORDMARK}>Tiny Corp</h1>
          <p className={LAUNCHER_TAGLINE}>{choosing ? PREFLIGHT_CHOOSER_TAGLINE : preflightTagline()}</p>
        </div>
        <div className={CARDS}>
          {choosing ? (
            <PreflightChooser
              blocked={blocked}
              boss={boss}
              checking={checking}
              onRecheck={onRecheck}
              onDismiss={onDismiss}
            />
          ) : (
            blocked.map((check, index) => (
              <PreflightCard
                key={check.provider}
                check={check}
                checking={checking}
                onRecheck={onRecheck}
                onDismiss={onDismiss}
                // Two cards, one check: the last of them carries the note and the button.
                footer={index === blocked.length - 1}
              />
            ))
          )}
        </div>
      </div>
    </LauncherFrame>
  )
}

/**
 * Whether the cards take the whole window: only while some Provider the Company is hired on cannot
 * run an Employee at all, and only until the boss dismisses them — the promise on the card is that
 * the rest of the app opens. Nothing is drawn before the first answers are in.
 */
export function preflightTakesTheWindow(preflight: readonly ProviderPreflight[] | null, dismissed: boolean): boolean {
  return !dismissed && preflight !== null && blockedProviders(preflight).length > 0
}

/** `Escape` leaves the screen, like every other window the boss can back out of; null while it is gone. */
export function useDismissOnEscape(onDismiss: (() => void) | null): void {
  useEffect(() => {
    if (!onDismiss) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])
}
