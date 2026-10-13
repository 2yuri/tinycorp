import type { Provider } from '../domain/staff'

/**
 * What a Company does when one Provider runs out of subscription (T173, frame `bB6VX`).
 *
 * The rule is per Provider, because the limits are: Claude running out says nothing about Codex.
 * An Employee may override its Company's rule, and the override is stored on the Employee.
 */
export type OutOfProviderRule =
  /** Wait in the coffee area until the limit resets, keeping the Session and the ticket. */
  | { kind: 'wait' }
  /** Carry on somewhere else: a fallback Provider and, optionally, one of its models. */
  | { kind: 'continue'; provider: Provider; model: string | null }

export const WAIT_FOR_RESET: OutOfProviderRule = { kind: 'wait' }

/** The Company's own answer for every Provider, and the two toggles that go with it. */
export interface UsageRouting {
  /** The rule per Provider. A Provider with no entry waits. */
  rules: Record<string, OutOfProviderRule>
  /** Whether an Employee that continued elsewhere moves back when `<P>` resets. Default on. */
  moveBack: Record<string, boolean>
  /** Whether parked Employees go back to their desks at the reset without the boss. Default on. */
  resumeAtReset: boolean
  /**
   * Whether an account at its limit moves to another account of the same Provider. **Off by
   * default** (frame `bB6VX`): the boss turns it on, having read {@link ROTATION_WARNING}.
   */
  rotateAccounts: boolean
  /** The account every Employee of this Company is pinned to, per Provider; absent is "first with room left". */
  pinnedAccount: Record<string, string>
}

/** What a Company does before the boss has said anything: wait, move back, resume, never rotate. */
export const DEFAULT_USAGE_ROUTING: UsageRouting = {
  rules: {},
  moveBack: {},
  resumeAtReset: true,
  rotateAccounts: false,
  pinnedAccount: {},
}

/** The warning the boss reads when they turn rotation on, word for word from frame `bB6VX`. */
export const ROTATION_WARNING = {
  title: 'Off by default',
  body:
    'Switching between accounts of one provider to get around its limit may break that ' +
    'provider’s terms. Your accounts, your call.',
} as const

/** One Employee's own answer, kept on the Employee; null means it follows the Company (frame `bB6VX`). */
export interface EmployeeRouting {
  /** This Employee's rule for every Provider it might run out of, or null to follow the Company. */
  rule: OutOfProviderRule | null
  /** The account this Employee is pinned to, per Provider, over the Company's pin. */
  pinnedAccount: Record<string, string>
}

export const FOLLOWS_COMPANY: EmployeeRouting = { rule: null, pinnedAccount: {} }

/** The rule that actually applies to one Employee when `provider` runs out. */
export function ruleFor(company: UsageRouting, employee: EmployeeRouting | null, provider: string): OutOfProviderRule {
  return employee?.rule ?? company.rules[provider] ?? WAIT_FOR_RESET
}

/** The account an Employee should run `provider` on, or null for "the first one with room left". */
export function pinnedAccountFor(
  company: UsageRouting,
  employee: EmployeeRouting | null,
  provider: string,
): string | null {
  return employee?.pinnedAccount[provider] ?? company.pinnedAccount[provider] ?? null
}

/** Whether an Employee that continued elsewhere moves back when `provider` resets. */
export function movesBack(company: UsageRouting, provider: string): boolean {
  return company.moveBack[provider] ?? true
}

/** Whether an Employee follows its Company in everything: the Overrides list holds the rest. */
export function followsCompany(routing: EmployeeRouting | null): boolean {
  return !routing || (routing.rule === null && Object.keys(routing.pinnedAccount).length === 0)
}

/**
 * How one override reads in the Overrides list (frame `bB6VX`): `Waits for reset · keeps Claude for
 * QA`, `Pinned to Work · Team`. Takes the names rather than reading a catalogue, so nothing here
 * has to know a Provider's or an account's spelling.
 */
export function overrideSummary(
  routing: EmployeeRouting,
  names: { provider(id: string): string; account(id: string): string | null },
): string {
  const parts: string[] = []
  if (routing.rule?.kind === 'wait') parts.push('Waits for reset')
  if (routing.rule?.kind === 'continue') parts.push(`Continues on ${names.provider(routing.rule.provider)}`)
  for (const [provider, accountId] of Object.entries(routing.pinnedAccount)) {
    const account = names.account(accountId)
    if (account) parts.push(`Pinned to ${account}`)
    else parts.push(`Pinned to an account of ${names.provider(provider)} that is gone`)
  }
  return parts.join(' · ')
}

/**
 * How long the engine waits before it asks again when a limit named no reset time. It doubles up
 * to {@link MAX_UNKNOWN_RESET_BACKOFF_MS}, and every re-check is the adapter's own status or usage
 * read — never a prompt, which would spend the usage it is asking about.
 */
export const FIRST_UNKNOWN_RESET_BACKOFF_MS = 5 * 60 * 1000

export const MAX_UNKNOWN_RESET_BACKOFF_MS = 60 * 60 * 1000

/** The wait before the `attempt`-th re-check of a limit with no known reset time, 1-based. */
export function unknownResetBackoffMs(attempt: number): number {
  const doubled = FIRST_UNKNOWN_RESET_BACKOFF_MS * 2 ** Math.max(0, attempt - 1)
  return Math.min(doubled, MAX_UNKNOWN_RESET_BACKOFF_MS)
}
