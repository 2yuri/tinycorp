/**
 * The machine, as one door.
 *
 * Everything under `main/platform/` is about the computer the app is running on — child processes
 * and CLI lookup, git, the OS secret store, the network, WSL — and nothing about a Company, an
 * Employee or a ticket. Another module names this file and never a file inside the folder, so
 * "works on macOS, Windows and Linux" has one place to be fixed when it stops being true.
 *
 * Only what another module really uses is here. A name that is needed inside `platform` and
 * nowhere else stays inside it, and a file beside this one reaches its neighbour by name rather
 * than through here, which is what keeps the folder free of a cycle through its own front door.
 *
 * The pure half of this module is `src/shared/platform/`: the types and functions the renderer
 * names too, which both processes may import directly.
 */

export { cliInvocation, forgetCliPaths, resolveCli } from './cli-command'
export { type Clipboard, type ClipboardCopy, copyForAWhile } from './clipboard-copy'
export { findGitBash } from './git-bash'
export { excludeFromGit } from './git-exclude'
export { createGitRunner, type GitRunner } from './git-runner'
export {
  type BranchWork,
  branchName,
  createGitService,
  type GitService,
  NO_REMOTE,
  type ReviewThreadDraft,
  slugify,
} from './git-service'
export { adoptLoginShellPath } from './login-path'
export { listenOn } from './net/listen-on'
export { nodePtySpawn } from './node-pty-spawn'
export { onPath } from './on-path'
export { startPowerSaveBlocker } from './power-save-blocker'
export type { PtySession, PtySpawnOptions, SpawnPty } from './pty'
export { type CliOutcome, type RunCli, runCli } from './run-cli'
export { type ProcessRunner, type RunInDeps, runIn, setTeamRuntime } from './run-in'
export {
  backendProblem,
  namedSecretStore,
  platformSecrets,
  type SecretBackend,
  secretBackend,
  whereSecretsLive,
} from './safe-storage-secrets'
export { addedEnv, type SandboxPlanFor, sandboxSpawnPty } from './sandbox-runtime'
export { memorySecrets, type SecretStore } from './secrets'
export { shellInvocation } from './shell-command'
export { syncSkillFolder } from './skill-folders'
export { createWakeLock, type StartAssertion } from './wake-lock'
export {
  cachedWslDistros,
  cachedWslLoginPath,
  cachedWslProbe,
  forgetWsl,
  runWsl,
  type WslDistro,
  type WslRunner,
} from './wsl'
export {
  bindAddresses,
  confirmMirrored,
  HOOK_HEALTH_PATH,
  healthUrlOf,
  hostUrlFor,
  LOOPBACK,
  type WslHost,
  wslAdapterAddress,
  wslConfigPath,
  wslHost,
  wslNetworkingMode,
  wslReachesHook,
} from './wsl-network'
export { untranslatePaths } from './wsl-path'
export {
  isWsl,
  runtimePaths,
  teamHomeFolder,
  WSL_COMMAND,
  WSL_LOGIN_SCRIPT,
  type WslRuntimeOptions,
  wslCommand,
  wslEnv,
  wslHomeFolders,
  wslRunCli,
  wslSpawnPty,
} from './wsl-runtime'
