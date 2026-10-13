/**
 * Usage: the subscriptions the Company runs on, what they have spent, and where a Session goes
 * when one of them runs out (T173).
 *
 * `provider-accounts.ts` is which login each Provider uses on this Mac, `provider-usage.ts` reads
 * what that login has spent, `usage-limits.ts` decides what the Company does when a Provider is
 * exhausted, and `usage-routing.ts` is the per-Employee rule that decision follows.
 *
 * This is the module's front door. The handoff wording, the outage bookkeeping and the account
 * folder layout stay inside; the tests name them directly.
 */

export { accountsFile } from './accounts-file'
export type { UsageFacade } from './facade'
export { outagesFile } from './outages-file'
export { providerLogins, signInReaders } from './provider-logins'
export { createProviderUsage, resetFromUsage } from './provider-usage'
export { registerRoutingIpc } from './routing-ipc'
export { createSignIns, signInPty } from './sign-in'
export { registerSignInIpc } from './sign-in-ipc'
export { registerUsageIpc } from './usage-ipc'
export type { HandoffMove, UsageLimits } from './usage-limits'
export { USAGE_ROUTING_MIGRATION } from './usage-routing'
export { register as registerUsage, type UsageOptions } from './wire'
