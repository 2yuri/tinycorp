import { FORGE_CATALOGUE, type ForgeEntry } from '../../../shared/forges'
import type { RemoteOffer, RemoteVisibility, RepoInspection } from '../../../shared/repos/repo'
import type { ForgeAdapters } from '../../forges'
import { createGitRunner, type GitRunner } from '../../platform'
import { createRepoInspector, type InspectRepo } from './repo-inspector'

/**
 * Giving a repo that has no remote one, on a forge (T144).
 *
 * The remote is optional and separate from starting the repo: a repo with no `origin` works
 * everywhere in the app (`NO_REMOTE_RULE`), so "start it local, give it a remote later" is a path,
 * not a degraded one. Creating the repository is the forge's, through its adapter; adding `origin`
 * and the first push are git's, here — the adapter never runs git.
 */

/**
 * The forges a remote can be created on: every catalogued forge whose adapter can create one, and
 * whether its CLI is ready to. A forge whose adapter cannot is not offered at all.
 */
export async function remoteOffers(
  adapters: ForgeAdapters,
  catalogue: readonly ForgeEntry[] = FORGE_CATALOGUE,
): Promise<RemoteOffer[]> {
  const offers: RemoteOffer[] = []
  for (const entry of catalogue) {
    const adapter = adapters[entry.id]
    if (!adapter?.createRemote) continue
    const check = await adapter.checkCli()
    const ready = check.state === 'ready'
    offers.push({
      forge: entry.id,
      name: entry.name,
      ready,
      account: ready ? check.account : null,
      fix: ready ? null : check.commands.join(' && ') || check.body || null,
    })
  }
  return offers
}

export interface CreateRemoteOptions {
  adapters: ForgeAdapters
  forge: string
  /** The repository's name on the forge. */
  name: string
  visibility: RemoteVisibility
  /** The one git (T259): `origin` is added and the first push is made by the repo's own git. */
  git?: GitRunner
  inspect?: InspectRepo
}

/**
 * Creates a repository on `forge` for the repo at `path`, sets it as `origin` and pushes the
 * current branch to it. Refuses a repo that already has an `origin`. Answers the repo as the
 * inspector reads it afterwards.
 */
export async function createRemoteFor(
  path: string,
  { adapters, forge, name, visibility, git = createGitRunner(), inspect = createRepoInspector() }: CreateRemoteOptions,
): Promise<RepoInspection> {
  const adapter = adapters[forge]
  const label = FORGE_CATALOGUE.find((entry) => entry.id === forge)?.name ?? forge
  if (!adapter?.createRemote) throw new Error(`TinyCorp cannot create a repository on ${label}`)
  const repoName = name.trim()
  if (!repoName) throw new Error('A repository needs a name')
  const before = inspect(path)
  if (!before.isGitRepo) throw new Error(`${path} is not a git repo`)
  if (before.remote) throw new Error(`${path} already has a remote: ${before.remote}`)

  const remote = await adapter.createRemote({ cwd: path, name: repoName, visibility })
  try {
    await git.output(path, ['remote', 'add', 'origin', remote.cloneUrl])
    await git.output(path, ['push', '--quiet', '--set-upstream', 'origin', 'HEAD'])
  } catch (error) {
    // The repository exists on the forge by now; say where, so nothing is created twice.
    throw new Error(
      `Created ${remote.webUrl}, but ${inspect(path).remote ? 'the first push' : 'adding it as origin'} failed: ${failure(error)}`,
    )
  }
  return inspect(path)
}

function failure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' ? stderr : ''
  return text.trim() || (error instanceof Error ? error.message : String(error))
}
