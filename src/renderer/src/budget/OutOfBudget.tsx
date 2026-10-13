import { Coffee, Pause, Repeat2, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BudgetExhausted } from '../../../shared/capacity'
import { PROVIDERS } from '../../../shared/domain/providers'
import { countAtWork } from '../../../shared/office/at-work'
import type { SessionStatus } from '../../../shared/session'
import { Button } from '../ui'
import { AUTO_RESUME_NOTE, automaticResetLine, resetLine } from './budget-text'
import '../ui/tailwind.css'

/*
 * Out of budget (design/html/out-of-budget.html, frame `d9m0M`). The scrim, the modal's shadow and
 * the pill ink are `--scrim`, `--elevation-modal` and `--canvas-foreground`, added to `ui/tokens.css`
 * by this ticket: they were three hexes written into this stylesheet, and two of them are shared
 * with Remove company. Pen strokes sit inside the box, so the bordered card gives the 1px back
 * from its padding.
 */
const OVERLAY = 'absolute inset-0 z-1 flex items-center justify-center bg-scrim p-24'

/** `leading-[normal]` because the frame sets the card on the font's own line, not the scale's. */
const CARD =
  'flex w-520 max-w-full shrink-0 flex-col items-center gap-16 rounded-md border border-border bg-card p-25 font-sans leading-[normal] shadow-modal'

const ICON = 'flex size-52 shrink-0 items-center justify-center rounded-full bg-secondary text-status-error-foreground'

/** 22px on the scale's own 28px line, which is the frame's. */
const TITLE = 'm-0 w-full text-center text-22 font-bold tracking-[-0.4px] text-foreground'

/** 13.5px on 22px — the scale pairs it with 16px, and this paragraph is set looser. */
const BODY = 'm-0 w-full text-center text-13-5/22 font-normal text-muted-foreground'

const RESET = 'flex shrink-0 items-center gap-9 rounded-full bg-card px-14 py-9 text-muted-foreground'

/** `/[inherit]` on both: the card's `normal` is the line these sit on. */
const RESET_LINE = 'whitespace-nowrap text-12-5/[inherit] font-semibold text-canvas-foreground'
const NOTE = 'm-0 w-full text-center text-11-5/[inherit] font-normal text-muted-foreground'

const BADGE =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-11 py-5 font-sans text-12/[normal] font-semibold text-canvas-foreground'

/**
 * Why `Continue on <P> now` cannot be pressed: the Company's rule names no fallback, or the only
 * Provider is the one that ran out. It reads the catalogue rather than naming a product.
 */
export const NO_FALLBACK_NOTE =
  PROVIDERS.length > 1
    ? 'Set a fallback in Company settings → Usage & routing'
    : 'There is no second Provider to continue on'

/** The app-wide budget state as the current Company sees it, and a clock for its countdown. */
export function useBudget(companyId: string | null): { budget: BudgetExhausted | null; now: Date } {
  const [budget, setBudget] = useState<BudgetExhausted | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!companyId) return setBudget(null)
    const api = window.tinyCorp.capacity
    let live = true
    const refresh = async () => {
      const result = await api.get()
      if (live) setBudget(result.ok ? result.value.budget : null)
    }
    void refresh()
    const stop = api.onChanged(() => void refresh())
    return () => {
      live = false
      stop()
    }
  }, [companyId])

  useEffect(() => {
    if (!budget) return
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [budget])

  return { budget, now }
}

/** The window title while out of budget (`Title` in design/html/out-of-budget.html). */
export function budgetTitle(companyName: string): string {
  return `${companyName} — out of budget`
}

/** The header's subtitle while out of budget (`Room Meta`). */
export function budgetSubtitle(floor: string): string {
  return `${floor} · everyone is in the coffee area`
}

/** The header's `Live Badge` with the red dot. */
export function BudgetBadge() {
  return (
    <span className={BADGE} role="status">
      <span className="size-6 rounded-full bg-destructive" aria-hidden />
      Out of budget
    </span>
  )
}

export interface BudgetOverlayProps {
  budget: BudgetExhausted
  now: Date
  onWait(): void
  /**
   * Whether the Company puts its Employees back at their desks at the reset by itself (T173). It
   * is on by default, and the card then says the return is already scheduled.
   */
  resumesAutomatically?: boolean
  /**
   * The Provider the Company's rule would continue on, in the boss's own words, with the button
   * that starts the switch now rather than at the reset. Absent draws no button.
   */
  continueOn?: { name: string; onContinue(): void } | null
}

/** The dim overlay and `Budget Card` over the office (design/html/out-of-budget.html, frame `d9m0M`). */
export function BudgetOverlay({
  budget,
  now,
  onWait,
  resumesAutomatically = true,
  continueOn = null,
}: BudgetOverlayProps) {
  return (
    <div className={OVERLAY} data-pencil-name="Dim Overlay">
      <section className={CARD} role="alertdialog" aria-labelledby="budget-title" aria-describedby="budget-body">
        <span className={ICON} aria-hidden>
          <Coffee size={25} />
        </span>
        <h2 className={TITLE} id="budget-title">
          The subscription limit is reached
        </h2>
        <p className={BODY} id="budget-body">
          Every Employee walked to the coffee area. Sessions stay alive and resume on their own ticket the moment your
          limit resets — nothing is lost, no work is dropped.
        </p>
        <span className={RESET}>
          <Timer size={14} aria-hidden />
          <span className={RESET_LINE}>
            {resumesAutomatically ? automaticResetLine(budget, now) : resetLine(budget, now)}
          </span>
        </span>
        <div className="flex shrink-0 justify-center gap-10">
          <Button variant="outline" icon={Pause} onClick={onWait}>
            Wait for the reset
          </Button>
          {/* The Company's own rule, applied now instead of at the reset (T173, frame `tdI8o` c). */}
          {continueOn ? (
            <Button icon={Repeat2} onClick={continueOn.onContinue}>
              {`Continue on ${continueOn.name} now`}
            </Button>
          ) : (
            <Button
              icon={Repeat2}
              aria-disabled="true"
              title={NO_FALLBACK_NOTE}
              className="cursor-default hover:bg-primary"
            >
              Continue on another provider
            </Button>
          )}
        </div>
        <p className={NOTE}>{resumesAutomatically ? AUTO_RESUME_NOTE : NO_FALLBACK_NOTE}</p>
      </section>
    </div>
  )
}

/** Sessions that can work now: out of budget, a live Session does not count as running. */
export function workingSessions(statuses: Record<string, SessionStatus>): number {
  return countAtWork(statuses)
}
