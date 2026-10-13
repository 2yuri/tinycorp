import { sep } from 'node:path'
import { repoChannels } from '../../../shared/domain/channels'
import type { FoundRepo, FoundReposEvent, FoundReposWalk } from '../../../shared/repos/found-repos'
import {
  isRepoRung,
  type NewRemote,
  type RemoteOffer,
  type RepoInspection,
  type RepoRung,
  type RepoStartPlan,
  STACK_KEYS,
  type StackConstraints,
  type UpdateRepoInput,
} from '../../../shared/repos/repo'
import { attempt, attemptAsync, type IpcHandlerRegistry, isRecord, requireString } from '../../core'
import type { ReposFacade } from './facade'
import { nearbyRepos } from './nearby-repos'
import { inspectMany } from './repo-inspector'
import { attachRepos, diskFolders, type ScanDeps, scanForRepos } from './repo-scan'
import { diskWalkDeps, type WalkDeps, walkForRepos } from './repo-walk'

export interface RepoIpcOptions {
  ipc: IpcHandlerRegistry
  engine: ReposFacade
  pickFolder(): Promise<string | null>
  /** The picker for a folder to scan; defaults to `pickFolder`. */
  pickScanFolder?(): Promise<string | null>
  /** Reads a checkout; defaults to answering that nothing is known. */
  inspect?(path: string): RepoInspection
  /** Turns a folder without a `.git` into a repo and reads it; unavailable by default. */
  initialise?(path: string): RepoInspection
  /** What starting a repo at a folder would do; refuses by default. */
  planStart?(path: string): RepoStartPlan
  /** The forges a remote can be created on; none by default. */
  remoteOffers?(): Promise<RemoteOffer[]>
  /** Creates a remote for a repo that has none; unavailable by default. */
  createRemote?(path: string, remote: NewRemote): Promise<RepoInspection>
  /** The sub-folders of a folder, for Scan a folder; defaults to reading the disk. */
  folders?: ScanDeps['folders']
  /** What the folder walk may read; defaults to reading the disk. */
  walkDeps?: WalkDeps
  /** Pushes one walk's events at every window; nothing is streamed without it. */
  broadcastFound?(event: FoundReposEvent): void
  /** The home folder, shown as `~` in worktree paths. */
  home?: string
  /** Tells every window that the repos changed. */
  broadcastChanged?(): void
}

/** Exposes the current Company's repos to the renderer. Holds no state of its own. */
export function registerRepoIpc({
  ipc,
  engine,
  pickFolder,
  pickScanFolder = pickFolder,
  inspect = unknownRepo,
  initialise = () => {
    throw new Error('Initialising a repository is not available')
  },
  planStart = (path) => ({ kind: 'refused', path, reason: 'Starting a repository is not available' }),
  remoteOffers = () => Promise.resolve([]),
  createRemote = () => Promise.reject(new Error('Creating a remote is not available')),
  folders = diskFolders,
  walkDeps = diskWalkDeps,
  broadcastFound = () => {},
  home,
  broadcastChanged = () => {},
}: RepoIpcOptions): void {
  engine.onRepoChecksSet(broadcastChanged)
  const changing =
    <T>(action: () => T) =>
    () => {
      const value = action()
      broadcastChanged()
      return value
    }

  ipc.handle(repoChannels.list, () => attempt(() => engine.repos.list()))
  ipc.handle(repoChannels.pickFolder, () => pickFolder())

  ipc.handle(repoChannels.add, (_event, input) =>
    attempt(
      changing(() => {
        if (!isRecord(input)) throw new Error('Missing repo details')
        const name = optionalString(input['name'], 'repo name')
        const brief = optionalString(input['brief'], 'repo brief')
        const rung = readRung(input['rung'])
        return engine.repos.add({
          path: requireString(input['path'], 'repo path'),
          ...(name !== undefined && { name }),
          ...(brief !== undefined && { brief }),
          ...(input['stack'] !== undefined && { stack: readStack(input['stack']) }),
          ...(rung !== undefined && { rung }),
        })
      }),
    ),
  )

  ipc.handle(repoChannels.update, (_event, id, changes) =>
    attempt(
      changing(() => {
        if (!isRecord(changes)) throw new Error('Missing repo changes')
        const name = optionalString(changes['name'], 'repo name')
        const brief = optionalString(changes['brief'], 'repo brief')
        const rung = readRung(changes['rung'])
        const update: UpdateRepoInput = {
          ...(name !== undefined && { name }),
          ...(brief !== undefined && { brief }),
          ...(rung !== undefined && { rung }),
        }
        if (changes['stack'] !== undefined) update.stack = readStack(changes['stack'])
        return engine.repos.update(requireString(id, 'repo id'), update)
      }),
    ),
  )

  ipc.handle(repoChannels.remove, (_event, id) =>
    attempt(
      changing(() => {
        engine.repos.remove(requireString(id, 'repo id'))
        return null
      }),
    ),
  )

  ipc.handle(repoChannels.inspect, (_event, path) =>
    typeof path === 'string' && path.trim() ? inspect(path.trim()) : unknownRepo(String(path ?? '')),
  )

  ipc.handle(repoChannels.initialise, (_event, path) =>
    attempt(() => initialise(requireString(path, 'folder to initialise').trim())),
  )

  ipc.handle(repoChannels.planStart, (_event, path) =>
    typeof path === 'string' && path.trim()
      ? planStart(path.trim())
      : { kind: 'refused', path: String(path ?? ''), reason: 'Choose a folder' },
  )

  ipc.handle(repoChannels.remoteOffers, () => attemptAsync(() => remoteOffers()))

  ipc.handle(repoChannels.createRemote, (_event, path, remote) =>
    attemptAsync(() => {
      if (!isRecord(remote)) throw new Error('Missing remote details')
      const visibility = remote['visibility'] ?? 'private'
      if (visibility !== 'private' && visibility !== 'public')
        throw new Error(`Unknown visibility: ${String(visibility)}`)
      return createRemote(requireString(path, 'repo path').trim(), {
        forge: requireString(remote['forge'], 'forge'),
        name: requireString(remote['name'], 'repository name').trim(),
        visibility,
      })
    }),
  )

  ipc.handle(repoChannels.pickScanFolder, () => pickScanFolder())

  ipc.handle(repoChannels.scan, (_event, folder) =>
    attempt(() => scanForRepos(requireString(folder, 'folder to scan'), { folders, inspect })),
  )

  // Walks in flight, by their id, so Stop and a closing modal can reach the right one.
  const walks = new Map<string, { cancelled: boolean }>()

  ipc.handle(repoChannels.findRepos, (_event, folder, id) =>
    attempt(() => {
      const target = requireString(folder, 'folder to find repos in').trim()
      const scan = requireString(id, 'walk id')
      if (walks.has(scan)) throw new Error(`That walk is already running: ${scan}`)
      const walk = { cancelled: false }
      walks.set(scan, walk)
      void streamWalk({ scan, folder: target, walk, deps: walkDeps, send: broadcastFound }).finally(() =>
        walks.delete(scan),
      )
      return null
    }),
  )

  ipc.handle(repoChannels.stopFinding, (_event, scan) => {
    const walk = typeof scan === 'string' ? walks.get(scan) : undefined
    if (walk) walk.cancelled = true
    return null
  })

  ipc.handle(repoChannels.inspectMany, (_event, paths) =>
    Array.isArray(paths)
      ? inspectMany(
          paths.filter((path): path is string => typeof path === 'string' && path.trim() !== ''),
          inspect,
        )
      : Promise.resolve({}),
  )

  ipc.handle(repoChannels.attachScanned, (_event, paths, briefs) =>
    attempt(
      changing(() => {
        if (!Array.isArray(paths) || paths.length === 0) throw new Error('Choose at least one repo to attach')
        const wanted = paths.map((path) => requireString(path, 'repo path'))
        return attachRepos(wanted, engine.repos, inspect, readBriefs(briefs))
      }),
    ),
  )

  ipc.handle(repoChannels.nearby, () =>
    attempt(() => {
      const company = engine.currentCompany()
      if (!company) throw new Error('No Company is open')
      return nearbyRepos(company, engine.repos.list(), { folders, inspect })
    }),
  )

  ipc.handle(repoChannels.worktreeRoots, () =>
    attempt(() =>
      Object.fromEntries(engine.repos.list().map((repo) => [repo.id, tildify(engine.worktreeRootOf(repo), home)])),
    ),
  )
}

/** How often at most a running walk pushes what it has found; often enough to read as streaming. */
const STREAM_EVERY_MS = 120

/**
 * Runs one walk and pushes it to the windows as it goes: the rows found since the last push, where
 * it is, and the whole walk once it ends. Nothing here throws — a folder that cannot be walked at
 * all comes back as an event carrying the reason.
 */
async function streamWalk({
  scan,
  folder,
  walk,
  deps,
  send,
  now = () => Date.now(),
}: {
  scan: string
  folder: string
  walk: { cancelled: boolean }
  deps: WalkDeps
  send(event: FoundReposEvent): void
  now?(): number
}): Promise<void> {
  let waiting: FoundRepo[] = []
  let total = 0
  let at = ''
  let pushed = 0
  const push = (ended: FoundReposWalk | null, error: string | null) => {
    pushed = now()
    const found = waiting
    waiting = []
    send({ scan, found, total, at, walk: ended, error })
  }
  try {
    const ended = await walkForRepos(folder, deps, {
      cancelled: () => walk.cancelled,
      onFound(one) {
        waiting.push(one)
        total += 1
      },
      onProgress(where) {
        at = where
        if (now() - pushed >= STREAM_EVERY_MS) push(null, null)
      },
    })
    at = ''
    push(ended, null)
  } catch (caught) {
    at = ''
    push(null, caught instanceof Error ? caught.message : String(caught))
  }
}

function unknownRepo(path: string): RepoInspection {
  return {
    path,
    isGitRepo: false,
    remote: null,
    defaultBranch: null,
    commitCount: null,
    lastCommitAt: null,
    detected: {},
  }
}

/** `~/acme/worktrees/web-app`, and `~\acme\worktrees\web-app` where that is how a path is written. */
function tildify(path: string, home: string | undefined): string {
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
}

function readStack(value: unknown): Partial<StackConstraints> {
  if (!isRecord(value)) throw new Error('Missing repo stack')
  const stack: Partial<StackConstraints> = {}
  for (const key of STACK_KEYS) {
    const field = optionalString(value[key], `stack ${key}`)
    if (field !== undefined) stack[key] = field
  }
  return stack
}

function optionalString(value: unknown, what: string): string | undefined {
  if (value !== undefined && typeof value !== 'string') throw new Error(`A ${what} must be text`)
  return value
}

/** What TinyCorp may do to the repo, as the renderer sends it; absent leaves the default. */
function readRung(rung: unknown): RepoRung | undefined {
  if (rung === undefined || rung === null) return undefined
  if (!isRepoRung(rung)) throw new Error(`Unknown repo rung: ${String(rung)}`)
  return rung
}

/** The briefs by repo path sent with `attachScanned`; absent means none. */
function readBriefs(briefs: unknown): Record<string, string> {
  if (briefs === undefined || briefs === null) return {}
  if (typeof briefs !== 'object' || Array.isArray(briefs)) throw new Error('Briefs must be text by repo path')
  const result: Record<string, string> = {}
  for (const [path, brief] of Object.entries(briefs)) {
    if (typeof brief !== 'string') throw new Error(`The brief of ${path} must be text`)
    result[path] = brief
  }
  return result
}
