/** How many Sessions a Company runs at once, who waits for a slot, and whether the subscription limit was hit. */
export interface CapacityInfo {
  /** At most this many Sessions of the Company run at once. */
  concurrencyCap: number
  /** Sessions of the Company that are running now. */
  running: number
  /** Employees waiting for a slot, longest-waiting first. */
  parked: string[]
  /**
   * Set while every Provider this Company's Employees run on is out: no prompt is pushed to anyone
   * until one resets. A Company whose Employees are spread over two Providers and has one out
   * reads this as null and routes Employee by Employee instead (T173).
   */
  budget: BudgetExhausted | null
  /** One entry per Provider that is out right now, oldest first (T173). Empty when none is. */
  outages: ProviderOutage[]
}

export interface BudgetExhausted {
  exhaustedAt: string
  /** When the limit resets, or null when the provider did not say. */
  resetsAt: string | null
}

/** One Provider that ran out, and when the app expects it back (T173). */
export interface ProviderOutage extends BudgetExhausted {
  provider: string
  /** The account that hit the limit, or null for a Provider TinyCorp runs on one sign-in. */
  accountId: string | null
  /**
   * When the engine asks again, for a limit that named no reset time: a cheap status or usage read
   * on a backoff, never a prompt. Null once {@link resetsAt} is known.
   */
  nextCheckAt: string | null
}

/** How long the team waits when the usage-limit message names no reset time. */
export const UNKNOWN_RESET_RETRY_MS = 60 * 60 * 1000
