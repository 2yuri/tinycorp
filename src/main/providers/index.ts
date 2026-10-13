/**
 * The Provider seam, as one door.
 *
 * A Provider is one CLI product an Employee's Session can run on. The catalogue that names them is
 * `shared/domain/providers.ts`; this folder is the main-process half — an adapter per product, the
 * conformance suite every adapter passes, the hook receiver their Sessions POST to, and the
 * preflight that says whether the boss can use one yet.
 *
 * Adding a Provider is still one folder and two lines (decisions 55 and 56), and none of them is
 * here: the registry inside the folder is what a new adapter is named in. What is here is what the
 * rest of the app needs, which is deliberately small — an adapter is handed an Employee, a folder
 * and a rendered prompt, and it spawns a process.
 *
 * The fake adapters are not part of this: a test, and the end-to-end build, name
 * `providers/testing.ts` directly rather than have every consumer of a Provider carry a fake.
 */

export { startHookReceiver } from './hooks/hook-receiver'
export { createPreflight } from './preflight'
export { registerPreflightIpc } from './preflight-ipc'
export {
  askOf,
  configDirVars,
  type GrantedMcpServer,
  type GrantedSkill,
  type HookPayload,
  hookSessionId,
  isProviderSessionId,
  type ProviderAccountSupport,
  type ProviderAdapter,
  type ProviderAdapters,
  type PtySession,
  type SessionSignal,
  type SpawnAccount,
  type SubagentSignal,
} from './provider-adapter'
export { HOOK_TOKEN_HEADER, stripAnsi } from './provider-hooks'
export { createProviderAdapters, refreshProviderAdapters } from './provider-registry'
export { createProviderRuntimes } from './provider-runtimes'
export { clearSessionFiles } from './session-files'
