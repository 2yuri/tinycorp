import type { PullRequestView } from '../code'
import type { ProviderCheck } from '../providers/preflight'
import type { RemoteVisibility } from '../repos/repo'

export type { RemoteVisibility }

/**
 * The seam between the Company engine and one forge.
 *
 * TinyCorp does not call a forge's API and holds no token for one. It drives the forge's own CLI —
 * the one the boss is already signed into — exactly as a Provider adapter drives a coding CLI. The
 * credential is the CLI's, and stays the CLI's.
 *
 * The contract is what the engine needs and nothing more: open a PR for a branch that is already
 * pushed, find the one that is already open for it, read its state, read its patch, comment on it
 * (on the PR and on one line of its head), post a reviewer's round as one review with threads,
 * reply in those threads and resolve them, and merge it. Everything git does — the worktree, the
 * branch, the push, the local merge — is the engine's and never reaches here, and so does every
 * decision about whether an action is allowed: the autonomy level and the merge gate decide that
 * (decision 44), and an adapter that can merge is not an adapter that may.
 *
 * `docs/forges.md` is the guide, and `forge-conformance.ts` is the contract as a test suite.
 */
export interface ForgeAdapter {
  /**
   * Opens a PR from `branch` into `base`. The branch is already pushed when this is called — the
   * push is git's, not the forge's.
   *
   * A branch that already has an open PR is not an error and never opens a second one: answer the
   * PR that is there. The engine asks {@link findPullRequest} when this fails, so a CLI that
   * refuses a duplicate in its own words still lands on the right PR.
   */
  openPullRequest(request: OpenPullRequest): Promise<ForgePullRequest>
  /** The open PR for `branch`, or null when it has none. */
  findPullRequest(request: FindPullRequest): Promise<ForgePullRequest | null>
  /** What the forge says about a PR right now: its state, its size, its mergeability, its checks. */
  readPullRequest(request: PullRequestRef): Promise<PullRequestView>
  /**
   * The PR's whole change as a unified patch — what `git diff --patch` would print, not a rendered
   * page. It is read back by the review, so nothing may be truncated or reformatted.
   */
  readDiff(request: PullRequestRef): Promise<string>
  /** Comments on the PR itself. */
  comment(request: PullRequestRef & { body: string }): Promise<void>
  /**
   * Comments on one line of the PR's head, under the PR's review comments, and answers the
   * comment's URL — or null when the forge gives none.
   */
  commentOnLine(request: LineComment): Promise<string | null>
  /**
   * Posts one round of an agent's review as **one review** on the PR: a summary, a verdict, and a
   * thread on each line it has something to say about — a GitHub pull request review, a GitLab
   * merge request's discussions. Answers, for each comment in the order it was given, the thread
   * the forge opened for it, so a later reply or resolution lands in the right place.
   *
   * Optional: a forge whose CLI cannot open a resolvable thread leaves this out, and TinyCorp keeps
   * that Company's review conversation in the app alone and says so in the panel (T170).
   */
  postReview?(request: PostReview): Promise<ForgeReview>
  /**
   * Replies in a thread this adapter opened. Answers the reply's URL, or null when the forge gives
   * none. Left out with {@link postReview}.
   */
  replyToThread?(request: ThreadRef & { body: string }): Promise<string | null>
  /**
   * Marks a thread resolved on the forge. A thread that is already resolved counts as resolved and
   * is not an error. Left out with {@link postReview}.
   */
  resolveThread?(request: ThreadRef): Promise<void>
  /**
   * Merges the PR, squashing where the forge offers it. A PR that is already merged counts as
   * merged and is not an error: the engine may ask twice, and the second ask must not fail a
   * ticket that is done.
   *
   * Whether a merge is allowed at all is decided before this is called, by the Company's autonomy
   * level and the merge gate. An adapter never asks that question and never answers it.
   */
  merge(request: PullRequestRef): Promise<void>
  /**
   * Creates an empty repository on the forge, under the account the CLI is signed in as, and
   * answers where git pushes to it. Optional: a forge whose CLI cannot create one leaves it out,
   * and the app offers no remote for it — a repo with no remote works everywhere in the app.
   *
   * It creates the repository and nothing else. Adding `origin` and the first push are git's,
   * and the engine's (T144): the adapter never runs git, never pushes and never writes a file.
   * A name that is already taken on the forge is the CLI's refusal, carried in its own words.
   */
  createRemote?(request: CreateRemote): Promise<ForgeRemote>
  /** Whether the forge's CLI is on this machine. A repo on a missing CLI can open no PR. */
  installed(): boolean
  /**
   * Whether this forge's CLI can open a PR at all, and the forge's own words for fixing it when it
   * cannot: is the command here, is the boss signed in, and on what. The same shape a Provider's
   * preflight answers in (T135), for the same reason — the renderer cannot load an adapter, so the
   * words arrive as data.
   *
   * It is a subprocess with a timeout, and it may never open, close or change anything.
   */
  checkCli(): Promise<ProviderCheck>
}

/** A PR as the forge answers it. */
export interface ForgePullRequest {
  url: string
  /** Null when the forge's URL does not end in a number. */
  number: number | null
}

/** Where a forge command runs, and in which checkout. */
export interface ForgeRequest {
  /** The checkout the CLI is run from: the repo, or one of its worktrees. */
  cwd: string
}

export interface OpenPullRequest extends ForgeRequest {
  /** The branch the PR comes from, already pushed. */
  branch: string
  /** The branch it goes into. */
  base: string
  title: string
  body: string
}

export interface FindPullRequest extends ForgeRequest {
  branch: string
}

export interface CreateRemote extends ForgeRequest {
  /** The repository's name on the forge. */
  name: string
  visibility: RemoteVisibility
}

/** A repository just created on a forge. */
export interface ForgeRemote {
  /** Where the boss opens it in a browser. */
  webUrl: string
  /** What `origin` is set to: the protocol the forge's CLI is configured to clone with. */
  cloneUrl: string
}

/** A PR, by URL, acted on from a checkout of its repo. */
export interface PullRequestRef extends ForgeRequest {
  url: string
}

/** A comment on one line of a PR's head file. */
export interface LineComment extends PullRequestRef {
  path: string
  /** The line in the head file, as the diff numbers it. */
  line: number
  body: string
}

/** What a reviewer's round says: approve it, ask for changes, or simply say something. */
export type ReviewVerdictOnForge = 'approve' | 'changes' | 'comment'

/** One thread of a review round, before the forge has given it an id. */
export interface ReviewThreadDraft {
  path: string
  /** The line in the head file, as the diff numbers it. */
  line: number
  body: string
}

/** One round of a review, posted as a single review on the PR. */
export interface PostReview extends PullRequestRef {
  /** What the reviewer said about the change as a whole; may be empty. */
  summary: string
  verdict: ReviewVerdictOnForge
  /** The threads this round opens, in order. May be empty: a summary alone is still a review. */
  threads: readonly ReviewThreadDraft[]
}

/** A review as the forge answers it. */
export interface ForgeReview {
  /** The review's own URL, or null when the forge gives none. */
  url: string | null
  /**
   * One entry per thread of {@link PostReview.threads}, in the same order: the id this adapter will
   * be handed back in {@link ThreadRef}, and where it landed. An adapter that opened fewer threads
   * than it was given answers fewer entries, and the engine keeps those threads in the app alone.
   */
  threads: ForgeThread[]
}

/** A thread the forge opened, as this adapter will recognise it again. */
export interface ForgeThread {
  /**
   * How this forge names the thread — a GitHub review comment's id, a GitLab discussion's id.
   * It is opaque to everything outside this adapter, and stored as text.
   */
  id: string
  /** Where a browser opens it, or null when the forge gives none. */
  url: string | null
}

/** A thread on a PR, by the id its own forge gave it. */
export interface ThreadRef extends PullRequestRef {
  threadId: string
}

/**
 * Running a forge's CLI. Every adapter takes one, so a test never needs a network, a token or a
 * real repository: the conformance suite hands the adapter a fake CLI and reads back what it did.
 *
 * It resolves for any exit code — a forge saying "no pull requests found" is an answer, not a
 * crash — and only reports `code: null` when the command could not be started at all.
 */
export type RunForge = (command: string, args: readonly string[], options: RunForgeOptions) => Promise<ForgeCliResult>

export interface RunForgeOptions {
  /** The checkout to run in. Every forge CLI reads the repo from the folder it is run in. */
  cwd: string
  /** Bytes of stdout to allow. A PR's patch is far larger than a command's default 1MB. */
  maxBuffer?: number
  timeoutMs?: number
  /**
   * Settings for the CLI, laid over the app's own environment for this one command — the switch
   * that stops a CLI phoning home, the one that stops it prompting. Never a credential: the CLI
   * finds its login where the boss put it, and the conformance suite fails an adapter that passes
   * one here exactly as it fails one passed as an argument.
   */
  env?: Readonly<Record<string, string>>
  /**
   * What to write to the command's standard input, for the one thing a forge CLI cannot take as
   * arguments: a JSON body with an array of objects in it, which is how a review with its line
   * comments is posted in a single request. Never a credential, for the same reason as `env`.
   */
  stdin?: string
}

export interface ForgeCliResult {
  /** The exit code, or null when the command is not on this machine or could not run. */
  code: number | null
  stdout: string
  stderr: string
}

/** A forge's adapter, by forge. A forge that is not catalogued has no entry. */
export type ForgeAdapters = Partial<Record<string, ForgeAdapter>>

/** What every forge adapter factory is given. */
export interface ForgeAdapterOptions {
  /** The command the catalogue names, e.g. `gh`. */
  command: string
  /** The forge's full name, for the sentences its adapter writes. */
  name: string
  /**
   * Where a command that is about the CLI rather than about a repo runs — the preflight's status
   * command. The app's own folder; never a Company folder and never a repo.
   */
  cwd?: string
  /** Runs the forge's CLI. Left out, each adapter uses the real one. */
  runForge?: RunForge
  /** Overrides the `PATH` lookup that decides whether the CLI is on this machine. */
  installed?: () => boolean
}

/** The failing command's own words: its stderr, else its stdout, else the exit code. */
export function forgeFailure(command: string, args: readonly string[], result: ForgeCliResult): Error {
  if (result.code === null) {
    return new Error(`${command} is not installed: install it and sign in to open pull requests`)
  }
  const said = result.stderr.trim() || result.stdout.trim() || `exited ${result.code}`
  return new Error(`${command} ${args[0] ?? ''} failed: ${said}`.replace('  ', ' '))
}
