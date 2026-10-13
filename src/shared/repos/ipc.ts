/**
 * The repos' slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { FoundReposEvent } from './found-repos'
import type {
  AddRepoInput,
  AttachScannedResult,
  NearbyRepos,
  NewRemote,
  RemoteOffer,
  Repo,
  RepoInspection,
  RepoStartPlan,
  UpdateRepoInput,
} from './repo'

/** What the renderer can ask about the current Company's repos. Exposed as `window.tinyCorp.repos`. */
export interface RepoApi {
  list(): Promise<Result<Repo[]>>
  add(input: AddRepoInput): Promise<Result<Repo>>
  update(id: string, changes: UpdateRepoInput): Promise<Result<Repo>>
  remove(id: string): Promise<Result<null>>
  /** Shows the native folder picker for a repo checkout. Resolves to null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Reads a folder's origin, default branch, history and detected stack. Never fails. */
  inspect(path: string): Promise<RepoInspection>
  /**
   * What starting a repo at `path` would do — create the folder, start in an empty one, start in
   * place among the files there, or refuse and say why. Touches nothing. Never fails.
   */
  planStart(path: string): Promise<RepoStartPlan>
  /**
   * Starts a repo at `path`, creating the folder when it does not exist yet: `git init` on main, a
   * `.gitignore` only where a folder already holds a stack, and an `Initial commit` on the boss's
   * own git identity. Refuses what `planStart` refuses. Answers the new repo as `inspect` reads it.
   * No Company needed.
   */
  initialise(path: string): Promise<Result<RepoInspection>>
  /** The forges a remote can be created on, and whether each one's CLI is ready to. */
  remoteOffers(): Promise<Result<RemoteOffer[]>>
  /**
   * Creates a repository on a forge for the repo at `path`, sets it as `origin` and pushes to it.
   * Refuses a repo that already has an `origin`.
   */
  createRemote(path: string, remote: NewRemote): Promise<Result<RepoInspection>>
  /** Where each repo's ticket worktrees go, by repo id, with the home folder shown as `~`. */
  worktreeRoots(): Promise<Result<Record<string, string>>>
  /** Shows the native folder picker for a folder to scan. Resolves to null when cancelled. */
  pickScanFolder(): Promise<string | null>
  /** The git checkouts in a folder and two levels below it, each read like `inspect`. */
  scan(folder: string): Promise<Result<RepoInspection[]>>
  /**
   * Walks a folder for every checkout inside it, five levels down, streaming what it finds on
   * `onFound` until it ends, is stopped, or runs past its time box. `scan` is the id the caller
   * gives this walk: every event carries it back, so events of a walk left behind by a change of
   * folder are ignored rather than raced with the reply that would have named it.
   */
  findRepos(folder: string, scan: string): Promise<Result<null>>
  /** Stops a walk started by `findRepos`. A walk that has already ended is left alone. */
  stopFinding(scan: string): Promise<void>
  /** Every push from every running walk. Returns an unsubscribe function. */
  onFound(listener: (event: FoundReposEvent) => void): () => void
  /** Reads several checkouts a few at a time, so the visible rows fill in first. Never fails. */
  inspectMany(paths: string[]): Promise<Record<string, RepoInspection>>
  /**
   * Attaches several checkouts at once with their detected stacks and the briefs given by path;
   * reports the ones that failed.
   */
  attachScanned(paths: string[], briefs?: Record<string, string>): Promise<Result<AttachScannedResult>>
  /** The checkouts beside the first repo (or in the Company folder) that are not connected yet. */
  nearby(): Promise<Result<NearbyRepos>>
  /** Fires after a repo is added, changed or removed. */
  onChanged(listener: () => void): () => void
}
