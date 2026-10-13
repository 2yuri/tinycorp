/**
 * The Sandbox add-on: every Employee's Session inside ai-jail, when the boss turns it on (T260).
 *
 * The feature's front door. TinyCorp never installs ai-jail and never ships it — it is GPL-3.0-only,
 * found on the runtime's `PATH` and run as a separate program. What the add-on is, the line the
 * boss runs, and the sentences the card draws are in `src/shared/sandbox`; the jail itself is put
 * around a Session by `main/platform/sandbox-runtime.ts`, below every adapter.
 */

export { registerSandboxIpc } from './ipc'
export { SANDBOX_MIGRATION } from './sandbox'
export type { SandboxFacade } from './wire'
export { register as registerSandbox, type SandboxOptions } from './wire'
