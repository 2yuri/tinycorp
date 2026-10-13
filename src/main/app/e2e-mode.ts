/**
 * The posture `pnpm test:e2e` puts the app in (T189): the fake Provider, and no network.
 *
 * An end-to-end run starts the real app and drives the real screens, so the two things it must
 * not do are the two things the app does on its own. It must not start a real `claude` — a run
 * would spend the boss's subscription, and a CI runner has no CLI at all, so the preflight would
 * take the window before the first screen drew and every e2e would be a test of what a machine
 * without Claude Code looks like. And it must not reach the network: the app asks GitHub whether
 * there is a newer build (T130) and Claude what is left of the subscription (T141), and a test
 * that quietly depends on either is a test that goes red on a train.
 *
 * All three are seams the app already has — `providers`, `readLatest`, `credential` — so this is a
 * posture rather than a mode: nothing further in is branched on, and the screens under test are
 * the screens a boss gets.
 *
 * **It is not a switch a boss could flip.** A packaged build ignores the variable entirely, so
 * setting it in a shipped app does nothing at all; only a build started from `out/` — a
 * developer's own checkout, and the e2e suite — reads it. That is what `e2e-mode.test.ts` holds,
 * and it is why the gate takes `packaged` rather than reading `app.isPackaged` for itself.
 *
 * It names a variable rather than a flag for the reason the smoke run does (`smoke-run.ts`):
 * Electron owns `argv` and hands the app whatever is left of it.
 *
 * Nothing is imported here, so the Playwright suite in `e2e/` can read the variable's name from
 * the app itself rather than spelling it a second time.
 */

/** Set to anything non-empty, in an unpackaged build, to run against the fake and no network. */
export const E2E_ENV = 'TINYCORP_E2E'

export interface E2EGate {
  /** `app.isPackaged`: true for the build a boss downloads, where the variable means nothing. */
  packaged: boolean
  env: NodeJS.ProcessEnv
}

/** Whether this process was started by an end-to-end run. False everywhere a boss is. */
export function endToEndRun({ packaged, env }: E2EGate): boolean {
  // A shipped build has no switch: whatever the environment says, the real app is what runs.
  if (packaged) return false
  return (env[E2E_ENV] ?? '').trim() !== ''
}
