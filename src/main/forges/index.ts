/**
 * The forge seam, as one door.
 *
 * A forge is where a repo's pull requests live, chosen per repo from its `origin`. The catalogue is
 * `shared/forges`; this folder is the main-process half — an adapter per forge, the conformance
 * suite they all pass, and the details a pull request is opened with.
 *
 * A repo on a forge with no adapter still works locally and says it can open no pull request, so
 * what leaves this door is small on purpose: the set of adapters, the details builder, and the
 * verdict a review carries onto whichever forge answered.
 */

export type { ForgeAdapters, ReviewVerdictOnForge } from '../../shared/forges/adapter'
export { createForgeAdapters } from './forge-registry'
export { createPullRequestDetails } from './pr-details'
export { teamForgeRunner } from './run-forge'
