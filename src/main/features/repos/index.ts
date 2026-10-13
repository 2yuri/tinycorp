/**
 * The Company's repos: attaching them, reading what they are made of, and the rules each runs under.
 *
 * The feature's front door. A repo, what its stack declares and how far up the ladder it has come
 * are in `src/shared/repos`; what is here is the rows, the walks that find checkouts on disk, and
 * the refusals that keep an Employee from pushing where it may not.
 */

export type { ReposFacade } from './facade'
export { registerRepoIpc } from './ipc'
export { initialiseRepo, planRepoStart } from './repo-init'
export { createRepoInspector } from './repo-inspector'
export { createRemoteFor, remoteOffers } from './repo-remote'
export { mergeRefusal, pushRefusal, repoMayPush, ticketMergeRefusal } from './repo-rules'
export {
  REPOS_BRIEF_MIGRATION,
  REPOS_MIGRATION,
  REPOS_RUNG_MIGRATION,
  REPOS_STACK_COMMANDS_MIGRATION,
  type RepoRegistry,
} from './repos'
export { detectRepoOnDisk } from './stack-detection'
export { registerRepoTools } from './tools'
export { type ReposFeature, type ReposOptions, register as registerRepos } from './wire'
