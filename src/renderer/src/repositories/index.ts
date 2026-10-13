/**
 * The repos a Company works in: the screen, the cards, and finding them on disk.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { FoundReposPicker } from './FoundRepos'
export { knownFoundRepos } from './found-repos-model'
export { InitialiseRepoAlert } from './InitialiseRepo'
export { BriefField, ChecksSection } from './RepoAbout'
export { RepoMenu } from './RepoCard'
export { Repositories } from './Repositories'
export { accessChanges, accessOf, type CommandKey, stackCommands, workingRoles } from './repo-view-model'
export { StackPanel } from './StackPanel'
export { type FoundRepos, useFoundRepos } from './use-found-repos'
