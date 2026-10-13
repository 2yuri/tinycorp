import { PROVIDER_SHORT_NAME, type Provider } from '../../../shared/domain/providers'
import type { RoutingSettings } from '../../../shared/ipc'
import type { SessionStatus } from '../../../shared/session'

/**
 * `Continue on <P> now` on the out-of-budget card (T173, frame `tdI8o`, c): the Provider the
 * Company's own rule names, and the Employees it would move — the ones sitting out of budget.
 *
 * Null when the Company's rule is to wait, which is the default: the card then offers nothing to
 * press, because the Company already decided to wait and the return is already scheduled.
 */
export function fallbackOffer(
  routing: RoutingSettings | null,
  statuses: Record<string, SessionStatus>,
): { name: string; onContinue(): void } | null {
  if (!routing) return null
  const waiting = Object.keys(statuses).filter((id) => statuses[id] === 'out_of_budget')
  if (waiting.length === 0) return null
  const rules = Object.values(routing.routing.rules).filter((rule) => rule.kind === 'continue')
  const rule = rules[0]
  if (!rule || rule.kind !== 'continue') return null
  return {
    name: PROVIDER_SHORT_NAME[rule.provider as Provider] ?? rule.provider,
    onContinue() {
      for (const employeeId of waiting) void window.tinyCorp.routing.continueNow(employeeId)
    },
  }
}
