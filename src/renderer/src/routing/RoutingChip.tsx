import { Repeat2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { PROVIDER_SHORT_NAME, type Provider } from '../../../shared/domain/providers'
import { clockTime } from '../../../shared/platform/clock-time'
import type { SessionRouting } from '../../../shared/session'
import '../ui/tailwind.css'

/*
 * The chip of frame `tdI8o` (a). The tint is `brand-warning` because that is the colour this chip
 * has always drawn: the stylesheet asked for `var(--warning, #f59e0b)` and `--warning` is defined
 * nowhere, so the fallback is what painted — and `--brand-warning` is that same `#f59e0b`. Whether
 * a warning chip should now take T208's `status-warning` tint instead is a design question, not a
 * translation, so it is left as it looks today.
 *
 * `/[inherit]` on the size because the stylesheet set `font-size` alone: a bare `text-12` would add
 * the scale's 15px line to text that inherits the drawer's.
 */
const CHIP =
  'mx-16 mb-8 flex flex-wrap items-center gap-10 rounded-sm border border-brand-warning/45 bg-brand-warning/10 px-10 py-6 text-12/[inherit]'

/** `#fbbf24` in Dark, which is what the `--warning-foreground` fallback painted. */
const LABEL = 'inline-flex items-center gap-6 text-status-warning-foreground'

/** `font: inherit` and `color: inherit` are `ui/tailwind.css`'s already, so only the rest is here. */
const BACK =
  'ml-auto inline-flex cursor-pointer items-center gap-6 rounded-[6px] border-0 bg-transparent px-8 py-4 text-foreground disabled:cursor-default disabled:text-muted-foreground'

/** `On <fallback> until <own> resets 21:00`, the chip of frame `tdI8o` (a). */
export function routingChipLabel(routing: SessionRouting, now: Date): string {
  const to = PROVIDER_SHORT_NAME[routing.provider as Provider] ?? routing.provider
  const from = PROVIDER_SHORT_NAME[routing.from as Provider] ?? routing.from
  if (!routing.resetsAt) return `On ${to} until ${from} resets`
  return `On ${to} until ${from} resets ${clockTime(new Date(routing.resetsAt), now)}`
}

/** `Back to <own Provider> now`, the button beside it. */
export function backNowLabel(routing: SessionRouting): string {
  return `Back to ${PROVIDER_SHORT_NAME[routing.from as Provider] ?? routing.from} now`
}

/** Why the button cannot be pressed yet, or null when it can. */
export function backNowBlocked(routing: SessionRouting, outOfBudget: boolean): string | null {
  if (!outOfBudget) return null
  return `${PROVIDER_SHORT_NAME[routing.from as Provider] ?? routing.from} has not reset yet`
}

/**
 * The drawer's routing chip (frame `tdI8o`, a): where this Employee is working while its own
 * Provider is out, and the boss's way to bring it back before the reset.
 *
 * It is drawn only while the Employee is off its own Provider. Moving back happens at the next
 * turn boundary, never in the middle of an edit — pressing it asks, it does not interrupt.
 */
export function RoutingChip({
  routing,
  employeeId,
  outOfBudget = false,
  now = new Date(),
}: {
  routing: SessionRouting
  employeeId: string
  /** Whether the Provider it came from is still out: the button then says so instead of acting. */
  outOfBudget?: boolean
  now?: Date
}) {
  const [error, setError] = useState<string | null>(null)
  const blocked = backNowBlocked(routing, outOfBudget)
  return (
    <div className={CHIP} data-ui="Routing chip">
      <span className={LABEL}>
        <Repeat2 size={13} aria-hidden />
        {routingChipLabel(routing, now)}
      </span>
      <button
        type="button"
        className={BACK}
        disabled={blocked !== null}
        title={blocked ?? backNowLabel(routing)}
        onClick={async () => {
          const result = await window.tinyCorp.routing.moveBackNow(employeeId)
          setError(result.ok ? null : result.error)
        }}
      >
        <Undo2 size={13} aria-hidden />
        {backNowLabel(routing)}
      </button>
      {error && (
        <span className="basis-full text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
