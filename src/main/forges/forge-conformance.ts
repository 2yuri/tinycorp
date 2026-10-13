import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PullRequestView } from '../../shared/code'
import type { ForgeAdapter, ForgeCliResult, RemoteVisibility, RunForge } from '../../shared/forges/adapter'
import { PREFLIGHT_STILL_OPENS, preflightBlocks } from '../../shared/providers/preflight'

/**
 * What every forge adapter has to do, as one suite each of them runs.
 *
 * The point is not to test an adapter twice: it is that the second adapter breaks in the same
 * place as the first. Nothing here touches a network, a token or a real repository — the adapter
 * is handed a fake CLI, and the fake is written by whoever wrote the adapter, because the only
 * thing the suite cannot know is what that product's CLI prints.
 *
 * So a forge adapter's author writes two things: the adapter, and {@link ForgeConformanceSpec.cli}
 * — their CLI as a function, answering for a world the suite sets up. Everything else here is the
 * same for every forge, and every assertion carries a sentence written for someone who has never
 * read this file: a stranger filling in a new forge should learn what is missing and which part of
 * the contract it belongs to from the failure alone.
 */

/** The parts of the contract, as `docs/forges.md` names them. */
export type ForgeContractPart =
  | 'open'
  | 'find'
  | 'read'
  | 'diff'
  | 'comment'
  | 'review'
  | 'merge'
  | 'remote'
  | 'auth'
  | 'install'
  | 'preflight'

/** The repo the suite acts in, as the world knows it. */
export const CONFORMANCE_BRANCH = 'ticket-7-a-forge-adapter'
export const CONFORMANCE_BASE = 'main'

/**
 * The credential the fake CLI holds, which the suite then looks for in every command the adapter
 * ran, beside anything else that reads like a secret. Authentication is the CLI's: an adapter that
 * passes a credential as an argument puts it in `ps` output for every process on the Mac.
 */
export const CONFORMANCE_TOKEN = 'tinycorp-never-passes-this-token'

/** One call the adapter made to the forge's CLI. */
export interface ForgeCall {
  command: string
  args: readonly string[]
  cwd: string
  /** The settings the adapter laid over the app's environment for this call, if any. */
  env?: Readonly<Record<string, string>>
  /** What the adapter wrote to the command's standard input, if anything. */
  stdin?: string
}

/** One review round posted on a PR: a summary, a verdict, and the threads it opened. */
export interface WorldReview {
  /** How the forge names it. */
  id: number
  body: string
  /** The forge's own word for the verdict, e.g. `APPROVE`. */
  event: string
  /** The ids of {@link WorldPullRequest.threads} this review opened, in order. */
  comments: number[]
}

/** One review thread on a PR: where it hangs, what was said in it, and whether it is settled. */
export interface WorldThread {
  /** How the forge names it; the adapter is handed it back as text. */
  id: number
  path: string
  line: number
  body: string
  resolved: boolean
  /** Bodies of the replies left in it, in order. */
  replies: string[]
}

/** A PR on the fake forge the suite sets up. */
export interface WorldPullRequest {
  url: string
  number: number
  branch: string
  base: string
  title: string
  body: string
  /** What a read of it must come back with, field for field. */
  view: PullRequestView
  /** The patch a diff of it must come back with, byte for byte. */
  patch: string
  merged: boolean
  /** Bodies of the comments left on the PR, in order. */
  comments: string[]
  /** Comments left on one line of its head, in order. */
  lineComments: { path: string; line: number; body: string }[]
  /** The review rounds posted on it, in order. */
  reviews: WorldReview[]
  /** Every review thread on it, in the order they were opened. */
  threads: WorldThread[]
}

/** A repository on the fake forge, created by the adapter or put there by the suite. */
export interface WorldRemote {
  name: string
  visibility: RemoteVisibility
  /** Where the forge says it lives, as a browser opens it. */
  webUrl: string
}

/**
 * The forge the suite is pretending exists, for the check that is running. The spec's
 * {@link ForgeConformanceSpec.cli} reads it to answer, and writes to it to record what a command
 * did — a comment posted, a merge, a PR opened.
 */
export interface ForgeWorld {
  /** Every PR this forge holds, whether the suite put it there or the adapter opened it. */
  pullRequests: WorldPullRequest[]
  /** The ones the adapter opened, in order. */
  opened: WorldPullRequest[]
  /** Every repository on the forge under the signed-in account, in the order they were created. */
  remotes: WorldRemote[]
  /** How the boss told the CLI to clone: the protocol a new repository's `origin` has to use. */
  cloneProtocol: 'https' | 'ssh'
  /** What the CLI says about itself when it is asked. */
  login: 'missing' | 'signed-out' | 'signed-in'
  /** The account a signed-in CLI names. */
  account: string
  /** The credential the CLI holds. It is the CLI's: nothing the adapter runs may carry it. */
  token: string
}

/** How one forge answers the suite's questions. */
export interface ForgeConformanceSpec {
  /** The forge whose catalogue entry this adapter is for. */
  forge: string
  /** What the suite calls this adapter, when that is not its forge's id. */
  label?: string
  /** The CLI the adapter drives, as the catalogue names it. */
  command: string
  /**
   * What the URL of pull request `number` looks like on this forge, for the PRs the suite puts on
   * it. Every forge spells its own — `/pull/42`, `/-/merge_requests/42`, `/pullrequest/42` — and an
   * adapter may read its repo out of one, so the world speaks the forge's own shape. Left out, it
   * is `https://forge.example/acme/app/pull/<number>`.
   */
  url?(number: number): string
  /**
   * Where this forge's CLI leaves the summary of a review round, read off a PR the adapter has
   * posted to: one entry per round. Forges shape a review differently — GitHub has a review object
   * with a body, GitLab has a note above its discussions — and the suite asks the author rather
   * than assuming GitHub's shape. Left out, it is the bodies of {@link WorldPullRequest.reviews}.
   */
  reviewSummaries?(pullRequest: WorldPullRequest): readonly string[]
  create(setup: ForgeConformanceSetup): ForgeAdapter
  /**
   * This forge's CLI, as a function: what it prints for one call, in this world.
   *
   * Everything product-specific lives here and nowhere else. Answer the way the real CLI does,
   * including how it refuses — a second PR for a branch that already has one, a merge of a PR that
   * is already merged, a read of a PR nobody can see. Record what a command did by writing to
   * `world`, so the suite can ask afterwards whether the comment was really posted.
   *
   * A call the fake does not recognise should answer a non-zero code with a line on stderr, the
   * way a CLI answers a subcommand it does not have. That is how a missing piece of this fake
   * shows up as a failing check rather than a silent pass.
   */
  cli(call: ForgeCall, world: ForgeWorld): ForgeCliResult
}

/** What the suite hands the adapter's factory. */
export interface ForgeConformanceSetup {
  command: string
  name: string
  /** The app's own folder, for commands that are about the CLI rather than about a repo. */
  cwd: string
  /** The fake CLI, built out of the spec's own `cli`. */
  runForge: RunForge
  installed(): boolean
}

/** One adapter under test, with a fresh world and a fresh temp checkout. */
export interface ForgeConformanceRun {
  adapter: ForgeAdapter
  /** The checkout every request is made from: a ticket's worktree. */
  cwd: string
  world: ForgeWorld
  /** Every call the adapter made to the CLI, in order. */
  calls: ForgeCall[]
  /** Puts an open PR for the conformance branch on the forge, and answers it. */
  givenPullRequest(over?: Partial<WorldPullRequest>): WorldPullRequest
  close(): void
}

/** One question of the contract, and the sentence it fails with. */
export interface ForgeConformanceCheck {
  contract: ForgeContractPart
  title: string
  run(run: ForgeConformanceRun, spec: ForgeConformanceSpec): void | Promise<void>
}

/** A check that did not hold. */
export interface ForgeConformanceFailure {
  contract: ForgeContractPart
  title: string
  message: string
}

/** The view a read has to come back with, so a check can compare field for field. */
export const CONFORMANCE_VIEW: PullRequestView = {
  title: 'A ForgeAdapter, so TinyCorp is not tied to one forge',
  state: 'open',
  head: CONFORMANCE_BRANCH,
  base: CONFORMANCE_BASE,
  additions: 214,
  deletions: 37,
  changedFiles: 9,
  mergeable: 'conflicting',
  checks: [
    { name: 'build', workflow: 'ci', state: 'passing', durationMs: 42_000 },
    { name: 'test', workflow: 'ci', state: 'failing', durationMs: null },
  ],
}

/** The patch a diff has to come back with, unchanged: trailing whitespace, markers and all. */
export const CONFORMANCE_PATCH = [
  'diff --git a/src/forge.ts b/src/forge.ts',
  'index 1111111..2222222 100644',
  '--- a/src/forge.ts',
  '+++ b/src/forge.ts',
  '@@ -1,3 +1,4 @@',
  ' export interface ForgeAdapter {',
  '+  merge(request: PullRequestRef): Promise<void>',
  ' }',
  '',
].join('\n')

/** The URL of PR `number` on the spec's forge, in that forge's own shape. */
export function conformanceUrl(spec: Pick<ForgeConformanceSpec, 'url'>, number: number): string {
  return spec.url?.(number) ?? `https://forge.example/acme/app/pull/${number}`
}

/** Opens a world and an adapter for one check. The caller closes it. */
export function openForgeConformance(spec: ForgeConformanceSpec): ForgeConformanceRun {
  const dir = mkdtempSync(join(tmpdir(), `forge-conformance-${spec.forge}-`))
  const cwd = join(dir, 'worktree')
  mkdirSync(cwd)
  const home = join(dir, 'app')
  mkdirSync(home)
  const world: ForgeWorld = {
    pullRequests: [],
    opened: [],
    remotes: [],
    cloneProtocol: 'https',
    login: 'signed-in',
    account: 'the-boss',
    token: CONFORMANCE_TOKEN,
  }
  const calls: ForgeCall[] = []
  const adapter = spec.create({
    command: spec.command,
    name: spec.label ?? spec.forge,
    cwd: home,
    installed: () => world.login !== 'missing',
    runForge(command, args, options) {
      const call: ForgeCall = {
        command,
        args: [...args],
        cwd: options.cwd,
        ...(options.env && { env: options.env }),
        ...(options.stdin !== undefined && { stdin: options.stdin }),
      }
      calls.push(call)
      if (world.login === 'missing') {
        return Promise.resolve({ code: null, stdout: '', stderr: `${command}: command not found` })
      }
      return Promise.resolve(spec.cli(call, world))
    },
  })
  return {
    adapter,
    cwd,
    world,
    calls,
    givenPullRequest(over = {}) {
      const pr: WorldPullRequest = {
        url: conformanceUrl(spec, 42),
        number: 42,
        branch: CONFORMANCE_BRANCH,
        base: CONFORMANCE_BASE,
        title: CONFORMANCE_VIEW.title,
        body: 'Ticket #7',
        view: CONFORMANCE_VIEW,
        patch: CONFORMANCE_PATCH,
        merged: false,
        comments: [],
        lineComments: [],
        reviews: [],
        threads: [],
        ...over,
      }
      world.pullRequests.push(pr)
      return pr
    },
    close() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The contract, in order. Every entry is one question with one sentence for its answer, so a
 * stranger's first `pnpm test` on an unfilled adapter reads as a list of what is still missing.
 */
export const FORGE_CONFORMANCE_CHECKS: readonly ForgeConformanceCheck[] = [
  {
    contract: 'open',
    title: 'opens a pull request for a branch that is already pushed, and answers its URL and number',
    async run({ adapter, cwd, world }) {
      const pr = await adapter.openPullRequest({
        cwd,
        branch: CONFORMANCE_BRANCH,
        base: CONFORMANCE_BASE,
        title: 'A ForgeAdapter',
        body: 'Ticket #7',
      })

      expect(
        world.opened.length,
        'open: nothing was opened on the forge. `openPullRequest` runs the CLI command that opens one, from the checkout it was handed',
      ).toBe(1)
      expect(
        world.opened[0]?.branch,
        `open: the PR was opened from the wrong branch — TinyCorp pushed ${CONFORMANCE_BRANCH} and the PR must come from it`,
      ).toBe(CONFORMANCE_BRANCH)
      expect(
        world.opened[0]?.base,
        `open: the PR goes into ${CONFORMANCE_BASE}, the base the ticket's worktree was branched from — never the forge's own default`,
      ).toBe(CONFORMANCE_BASE)
      expect(
        world.opened[0]?.title,
        'open: the title TinyCorp was given is the ticket subject; the PR must carry it, not one the adapter invented',
      ).toBe('A ForgeAdapter')
      expect(
        world.opened[0]?.body,
        'open: the body TinyCorp was given describes the ticket; the PR must carry it',
      ).toBe('Ticket #7')
      expect(
        pr.url,
        'open: the adapter answered no URL. The engine stores it, posts it in #prs and reads the PR back by it later',
      ).toBe(world.opened[0]?.url)
      expect(
        pr.number,
        'open: the PR number is what the board and the drawer draw (`#42`). Read it off the URL, or answer null when this forge’s URLs carry none',
      ).toBe(world.opened[0]?.number)
    },
  },
  {
    contract: 'open',
    title: 'never pushes, commits or touches git',
    async run({ adapter, cwd, calls }) {
      await adapter.openPullRequest({
        cwd,
        branch: CONFORMANCE_BRANCH,
        base: CONFORMANCE_BASE,
        title: 'A ForgeAdapter',
        body: 'Ticket #7',
      })

      expect(
        calls.map((call) => call.command).filter((command) => command === 'git'),
        'open: the adapter ran git. The branch is pushed before the adapter is called and every worktree, branch and local merge is the engine’s (decision 44) — a forge adapter only talks to its forge',
      ).toEqual([])
      expect(
        calls.every((call) => call.cwd.startsWith(cwd)),
        'open: a command ran somewhere other than the checkout it was handed. Every forge CLI reads the repo from the folder it runs in, so a command run elsewhere acts on the wrong repo',
      ).toBe(true)
    },
  },
  {
    contract: 'find',
    title: 'finds the pull request a branch already has, rather than opening a second one',
    async run({ adapter, cwd, givenPullRequest }) {
      const existing = givenPullRequest()

      const found = await adapter.findPullRequest({ cwd, branch: CONFORMANCE_BRANCH })

      expect(
        found?.url,
        'find: the branch already has an open PR and the adapter did not find it. TinyCorp asks this whenever opening one fails, so that a ticket moved back to Review lands on the PR it already has instead of failing',
      ).toBe(existing.url)
      expect(found?.number, 'find: the PR was found but with the wrong number').toBe(existing.number)
    },
  },
  {
    contract: 'find',
    title: 'answers null for a branch with no pull request, rather than failing',
    async run({ adapter, cwd }) {
      const found = await adapter.findPullRequest({ cwd, branch: 'ticket-99-nothing-here' })

      expect(
        found,
        'find: a branch with no PR is an answer, not an error — the engine asks this to decide whether to open one, and a throw here would look like a broken forge',
      ).toBeNull()
    },
  },
  {
    contract: 'open',
    title: 'a second open for the same branch ends on the pull request that is already there',
    async run({ adapter, cwd, givenPullRequest, world }) {
      const existing = givenPullRequest()

      // What the engine does: try to open, and when the forge refuses, ask what is already there.
      let opened: { url: string } | null = null
      try {
        opened = await adapter.openPullRequest({
          cwd,
          branch: CONFORMANCE_BRANCH,
          base: CONFORMANCE_BASE,
          title: 'A ForgeAdapter',
          body: 'Ticket #7',
        })
      } catch {
        opened = await adapter.findPullRequest({ cwd, branch: CONFORMANCE_BRANCH })
      }

      expect(
        opened?.url,
        'open: a branch that already has a PR must end on that PR. Either answer it from `openPullRequest`, or fail in a way `findPullRequest` can recover — never open a second PR for one branch',
      ).toBe(existing.url)
      expect(
        world.opened.length,
        'open: a second PR was opened for a branch that already had one. One ticket, one branch, one PR per repo',
      ).toBe(0)
    },
  },
  {
    contract: 'read',
    title: 'reads a pull request’s state, size, mergeability and checks',
    async run({ adapter, cwd, givenPullRequest }) {
      const pr = givenPullRequest()

      const view = await adapter.readPullRequest({ cwd, url: pr.url })

      expect(
        view,
        'read: what came back is not what the forge says about this PR. The review card draws every field of it — the title, whether it is still open, how big it is, whether it merges cleanly and what CI said — so every field has to be filled in from the forge, and the ones it does not report left empty rather than invented',
      ).toEqual(pr.view)
    },
  },
  {
    contract: 'read',
    title: 'fails with the forge’s own words when a pull request cannot be read',
    async run({ adapter, cwd }, spec) {
      const failure = await adapter
        .readPullRequest({ cwd, url: conformanceUrl(spec, 4040) })
        .then(() => null)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

      expect(
        failure,
        'read: a PR that cannot be read came back as an answer. The engine shows this sentence to the boss, so it has to throw',
      ).not.toBeNull()
      expect(
        (failure ?? '').trim().length,
        'read: the failure says nothing. Carry the CLI’s own words — "could not resolve to a PullRequest", whatever it said — because that sentence is what the boss reads in the drawer and in #prs',
      ).toBeGreaterThan(8)
    },
  },
  {
    contract: 'diff',
    title: 'reads the whole change as a patch, byte for byte',
    async run({ adapter, cwd, givenPullRequest }) {
      const pr = givenPullRequest()

      const patch = await adapter.readDiff({ cwd, url: pr.url })

      expect(
        patch,
        'diff: the patch came back changed. The review parses it as a unified diff and the boss comments on its line numbers, so ask the CLI for a patch (not a rendered page), and hand it back untouched — no trimming, no truncating, no re-wrapping',
      ).toBe(CONFORMANCE_PATCH)
    },
  },
  {
    contract: 'comment',
    title: 'comments on the pull request',
    async run({ adapter, cwd, givenPullRequest }) {
      const pr = givenPullRequest()

      await adapter.comment({ cwd, url: pr.url, body: 'Reviewed by Ada: two things below.' })

      expect(
        pr.comments,
        'comment: nothing was posted. A review that TinyCorp ran says what it found on the PR itself, so the boss reads it where the change is',
      ).toEqual(['Reviewed by Ada: two things below.'])
    },
  },
  {
    contract: 'comment',
    title: 'comments on one line of the pull request’s head, and answers where it landed',
    async run({ adapter, cwd, givenPullRequest }) {
      const pr = givenPullRequest()

      const url = await adapter.commentOnLine({
        cwd,
        url: pr.url,
        path: 'src/forge.ts',
        line: 7,
        body: 'This belongs on the adapter.',
      })

      expect(
        pr.lineComments,
        'comment: the boss’s comment on one line of the diff did not reach the PR. It has to land on that file and that line of the head, under the PR’s review comments — not as another comment on the PR as a whole',
      ).toEqual([{ path: 'src/forge.ts', line: 7, body: 'This belongs on the adapter.' }])
      expect(
        url === null || typeof url === 'string',
        'comment: answer the new comment’s URL so the app can link to it, or null when this forge gives none — never undefined',
      ).toBe(true)
    },
  },
  {
    contract: 'review',
    title: 'posts one round of a review as one review, with a thread on each line it names',
    async run({ adapter, cwd, givenPullRequest }, spec) {
      if (!adapter.postReview) return
      const pr = givenPullRequest()

      const posted = await adapter.postReview({
        cwd,
        url: pr.url,
        summary: 'Two things below; the rest reads well.',
        verdict: 'changes',
        threads: [
          { path: 'src/forge.ts', line: 7, body: 'This belongs on the adapter.' },
          { path: 'src/forge.ts', line: 21, body: 'Name the refusal.' },
        ],
      })

      expect(
        reviewSummaries(spec, pr).length,
        'review: an agent’s round did not land as one review. Every comment of one round goes up together, so the boss opens the PR and reads a review — not a scatter of comments posted one at a time',
      ).toBe(1)
      expect(
        reviewSummaries(spec, pr)[0],
        'review: the round’s summary is what the reviewer said about the change as a whole; the review has to carry it',
      ).toContain('Two things below; the rest reads well.')
      expect(
        pr.threads.map((thread) => ({ path: thread.path, line: thread.line, body: thread.body })),
        'review: the round’s threads did not land on the PR, on the file and line they name, in the order they were given',
      ).toEqual([
        { path: 'src/forge.ts', line: 7, body: 'This belongs on the adapter.' },
        { path: 'src/forge.ts', line: 21, body: 'Name the refusal.' },
      ])
      expect(
        posted.threads.length,
        'review: the adapter answered a different number of threads than it was given. The engine pairs them by position, so one missing entry sends the next reply to the wrong line',
      ).toBe(2)
      expect(
        posted.threads.every((thread) => typeof thread.id === 'string' && thread.id.trim() !== ''),
        'review: a thread came back with no id. The id is how this adapter recognises the thread again — without one, a reply or a resolution has nowhere to land',
      ).toBe(true)
      expect(
        new Set(posted.threads.map((thread) => thread.id)).size,
        'review: two threads came back with the same id, so a reply to one would land on the other',
      ).toBe(2)
    },
  },
  {
    contract: 'review',
    title: 'a summary with no threads is still a review',
    async run({ adapter, cwd, givenPullRequest }, spec) {
      if (!adapter.postReview) return
      const pr = givenPullRequest()

      const posted = await adapter.postReview({
        cwd,
        url: pr.url,
        summary: 'Ship it.',
        verdict: 'approve',
        threads: [],
      })

      expect(
        reviewSummaries(spec, pr).length,
        'review: an approval with nothing to say about any line is still a round, and still goes on the PR',
      ).toBe(1)
      expect(posted.threads, 'review: no threads were asked for, so none may be answered').toEqual([])
    },
  },
  {
    contract: 'review',
    title: 'replies in a thread it opened',
    async run({ adapter, cwd, givenPullRequest }) {
      if (!adapter.postReview || !adapter.replyToThread) return
      const pr = givenPullRequest()
      const { threads } = await adapter.postReview({
        cwd,
        url: pr.url,
        summary: '',
        verdict: 'changes',
        threads: [{ path: 'src/forge.ts', line: 7, body: 'This belongs on the adapter.' }],
      })

      const url = await adapter.replyToThread({ cwd, url: pr.url, threadId: threads[0]!.id, body: 'Fixed in 3f2a1c9.' })

      expect(
        pr.threads[0]?.replies,
        'review: the assignee’s answer did not land in the thread it answers. A reply is a reply on the forge too, under the comment that asked — never a new comment beside it',
      ).toEqual(['Fixed in 3f2a1c9.'])
      expect(
        url === null || typeof url === 'string',
        'review: answer the reply’s URL so the app can link to it, or null when this forge gives none — never undefined',
      ).toBe(true)
    },
  },
  {
    contract: 'review',
    title: 'resolves a thread, and resolving one twice is not an error',
    async run({ adapter, cwd, givenPullRequest }) {
      if (!adapter.postReview || !adapter.resolveThread) return
      const pr = givenPullRequest()
      const { threads } = await adapter.postReview({
        cwd,
        url: pr.url,
        summary: '',
        verdict: 'changes',
        threads: [{ path: 'src/forge.ts', line: 7, body: 'This belongs on the adapter.' }],
      })

      await adapter.resolveThread({ cwd, url: pr.url, threadId: threads[0]!.id })
      const second = await adapter
        .resolveThread({ cwd, url: pr.url, threadId: threads[0]!.id })
        .then(() => null)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

      expect(
        pr.threads[0]?.resolved,
        'review: the thread was not resolved on the forge. A thread the reviewer settled in TinyCorp has to read as settled on the PR, or the boss opens it and sees an argument that is over',
      ).toBe(true)
      expect(
        second,
        'review: resolving a thread that is already resolved failed. The boss resolves one on the web while TinyCorp is asking, or the engine asks twice after a restart — either way it is settled, and this must not throw',
      ).toBeNull()
    },
  },
  {
    contract: 'review',
    title: 'never passes a credential, and never runs git, to post a review',
    async run({ adapter, cwd, givenPullRequest, calls, world }) {
      if (!adapter.postReview) return
      const pr = givenPullRequest()

      await adapter.postReview({
        cwd,
        url: pr.url,
        summary: 'Two things below.',
        verdict: 'changes',
        threads: [{ path: 'src/forge.ts', line: 7, body: 'This belongs on the adapter.' }],
      })

      expect(
        calls.flatMap((call) => call.args).filter((arg) => arg.includes(world.token) || looksLikeCredential(arg)),
        'review: a command carried a credential. Posting a review is authenticated the way everything else here is — by the CLI, with the login the boss already gave it',
      ).toEqual([])
      expect(
        calls.map((call) => call.command).filter((command) => command === 'git'),
        'review: the adapter ran git. A review is the forge’s; nothing about it touches a checkout',
      ).toEqual([])
    },
  },
  {
    contract: 'merge',
    title: 'merges the pull request',
    async run({ adapter, cwd, givenPullRequest }) {
      const pr = givenPullRequest()

      await adapter.merge({ cwd, url: pr.url })

      expect(
        pr.merged,
        'merge: the PR was not merged. Squash where the forge offers it, and remember that whether a merge is allowed was decided before this was called — by the Company’s autonomy level and the merge gate (decision 44), never here',
      ).toBe(true)
    },
  },
  {
    contract: 'merge',
    title: 'a pull request that is already merged counts as merged',
    async run({ adapter, cwd, givenPullRequest }) {
      const pr = givenPullRequest({ merged: true })

      const failure = await adapter
        .merge({ cwd, url: pr.url })
        .then(() => null)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

      expect(
        failure,
        'merge: merging a PR that is already merged failed. The boss merges one on the web while TinyCorp is asking, or the engine asks twice after a restart — either way the ticket is done, and this must not throw',
      ).toBeNull()
    },
  },
  {
    contract: 'remote',
    title: 'creates an empty repository, private unless asked, and answers where it lives',
    async run({ adapter, cwd, world }) {
      if (!adapter.createRemote) return
      const remote = await adapter.createRemote({ cwd, name: 'payments-web', visibility: 'private' })

      expect(
        world.remotes.map((created) => [created.name, created.visibility]),
        'remote: the forge holds no private repository by that name. `createRemote` creates exactly the repository it was asked for, under the account the CLI is signed in as, and a repository the boss did not say to make public is private',
      ).toEqual([['payments-web', 'private']])
      expect(
        remote.webUrl,
        'remote: answer the repository’s page as the forge names it, so the app can link to it',
      ).toBe(world.remotes[0]?.webUrl)
      expect(
        remote.cloneUrl.trim().length,
        'remote: answer a clone URL. The engine sets `origin` to it and pushes the first commit there',
      ).toBeGreaterThan(0)

      await adapter.createRemote({ cwd, name: 'landing', visibility: 'public' })
      expect(
        world.remotes[1]?.visibility,
        'remote: the boss asked for a public repository and the forge holds something else',
      ).toBe('public')
    },
  },
  {
    contract: 'remote',
    title: 'clones over the protocol the boss set the CLI to',
    async run({ adapter, cwd, world }) {
      if (!adapter.createRemote) return
      world.cloneProtocol = 'ssh'

      const remote = await adapter.createRemote({ cwd, name: 'payments-web', visibility: 'private' })

      expect(
        /^https?:/.test(remote.cloneUrl),
        'remote: the CLI is set to clone over SSH and `origin` would be an https URL. The first push then asks for a credential the boss never set up for https — read the CLI’s own setting and answer the URL it would clone',
      ).toBe(false)
    },
  },
  {
    contract: 'remote',
    title: 'creates the repository and nothing else: never git, never outside the checkout',
    async run({ adapter, cwd, calls }) {
      if (!adapter.createRemote) return
      await adapter.createRemote({ cwd, name: 'payments-web', visibility: 'private' })

      expect(
        calls.map((call) => call.command).filter((command) => command === 'git'),
        'remote: the adapter ran git. Adding `origin` and pushing the first commit are the engine’s — a forge adapter only talks to its forge',
      ).toEqual([])
      expect(
        calls.every((call) => call.cwd.startsWith(cwd)),
        'remote: a command ran somewhere other than the checkout it was handed',
      ).toBe(true)
    },
  },
  {
    contract: 'remote',
    title: 'refuses a name that is already taken, in the forge’s own words',
    async run({ adapter, cwd, world }) {
      if (!adapter.createRemote) return
      world.remotes.push({
        name: 'payments-web',
        visibility: 'private',
        webUrl: 'https://forge.example/x/payments-web',
      })

      const failure = await adapter
        .createRemote({ cwd, name: 'payments-web', visibility: 'private' })
        .then(() => null)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

      expect(
        failure,
        'remote: a name that is already taken came back as a new repository. The boss would push into a repository that is not theirs to start — throw with what the CLI said',
      ).not.toBeNull()
      expect(world.remotes.length, 'remote: a second repository was created under a taken name').toBe(1)
    },
  },
  {
    contract: 'auth',
    title: 'never carries a credential: the login is the CLI’s',
    async run({ adapter, cwd, givenPullRequest, calls, world }) {
      const pr = givenPullRequest()
      await adapter.openPullRequest({ cwd, branch: 'ticket-8', base: CONFORMANCE_BASE, title: 't', body: 'b' })
      await adapter.readPullRequest({ cwd, url: pr.url })
      await adapter.comment({ cwd, url: pr.url, body: 'ok' })

      await adapter.findPullRequest({ cwd, branch: CONFORMANCE_BRANCH })
      await adapter.checkCli()

      const carried = (call: ForgeCall) => [
        ...call.args,
        ...Object.entries(call.env ?? {}).map(([name, value]) => `${name}=${value}`),
      ]
      const leaked = calls.filter((call) =>
        carried(call).some((arg) => arg.includes(world.token) || looksLikeCredential(arg)),
      )

      expect(
        leaked.map((call) => `${call.command} ${carried(call).join(' ')}`),
        'auth: a command carried a credential, in an argument or in the environment it was run with. TinyCorp never holds a forge token, never reads one and never passes one — the CLI has it, and an argument is readable by every other process on the Mac through `ps`. Sign in with the CLI’s own command instead',
      ).toEqual([])
    },
  },
  {
    contract: 'install',
    title: 'knows whether its CLI is on this machine',
    run({ adapter }) {
      expect(
        typeof adapter.installed(),
        'install: installed() must answer true or false by looking for the CLI on PATH. A repo whose forge CLI is missing can open no PR, and the app says so instead of failing when an Employee is ready',
      ).toBe('boolean')
    },
  },
  {
    contract: 'preflight',
    title: 'says its CLI is missing, with the commands that fix it',
    async run({ adapter, world }) {
      world.login = 'missing'

      const check = await adapter.checkCli()

      expect(
        check.state,
        'preflight: the CLI is not on this machine and the check did not say `missing`. That is the state the card draws, and the sentence a repo on this forge refuses a PR with',
      ).toBe('missing')
      expect(
        check.commands.length,
        'preflight: a missing CLI with no commands to fix it leaves the boss nowhere to go. Give the command that installs it and the one that signs in, in the product’s own words',
      ).toBeGreaterThan(0)
      expect(
        `${check.title} ${check.body}`.trim().length,
        'preflight: the card says nothing about what is wrong. Name the product and what cannot happen until it is sorted',
      ).toBeGreaterThan(20)
      expect(
        preflightBlocks(check),
        'preflight: a missing CLI has to read as blocked, so nothing waits on a PR that can never open',
      ).toBe(true)
    },
  },
  {
    contract: 'preflight',
    title: 'says when the CLI is there and nobody is signed in',
    async run({ adapter, world }) {
      world.login = 'signed-out'

      const check = await adapter.checkCli()

      expect(
        check.state,
        'preflight: the CLI answered that nobody is signed in and the check did not say `signed-out`. A signed-out CLI opens no PR, and the boss can fix it in one command if the app says so',
      ).toBe('signed-out')
      expect(
        check.commands.length,
        'preflight: a signed-out CLI with no commands to fix it leaves the boss nowhere to go',
      ).toBeGreaterThan(0)
      expect(
        check.note,
        'preflight: the note beside `Check again` is a Provider’s, and it says nothing runs until this is sorted. A forge is not a Provider: say what still works, because worktrees, branches, diffs and local merges all carry on without it',
      ).not.toBe(PREFLIGHT_STILL_OPENS)
    },
  },
  {
    contract: 'preflight',
    title: 'says it is ready when the CLI is signed in, and spends nothing to find out',
    async run({ adapter, world, calls }) {
      world.login = 'signed-in'

      const check = await adapter.checkCli()

      expect(
        check.state,
        'preflight: the CLI is signed in and the check did not say `ready`. The boss is then shown a problem that is not there',
      ).toBe('ready')
      expect(
        check.account,
        'preflight: answer the account the CLI names, or null when it names none — never a guess, and never an empty string',
      ).toSatisfy((value: unknown) => value === null || (typeof value === 'string' && value.trim() !== ''))
      expect(
        calls.every((call) => !MUTATING.some((word) => call.args.includes(word))),
        'preflight: the check ran a command that changes something. It asks the CLI where it stands and nothing else — it never opens, closes, comments on or merges anything',
      ).toBe(true)
    },
  },
]

/** The round summaries a forge's PR carries, as that forge's author says they are found. */
function reviewSummaries(spec: Pick<ForgeConformanceSpec, 'reviewSummaries'>, pr: WorldPullRequest): readonly string[] {
  return spec.reviewSummaries?.(pr) ?? pr.reviews.map((review) => review.body)
}

/** An argument that is carrying a secret: a token, a password, an Authorization header. */
function looksLikeCredential(arg: string): boolean {
  return /(^|[-_])(token|password|secret|credential)s?[=:]/i.test(arg) || /\bbearer\s+\S/i.test(arg)
}

/** Words no command the preflight runs may carry: asking must never change anything. */
const MUTATING = ['create', 'merge', 'comment', 'close', 'edit', 'delete']

/**
 * Runs the forge conformance suite over one adapter. Call it from that adapter's own test file;
 * whatever the adapter does on top of this belongs in tests beside the call.
 */
export function describeForgeConformance(spec: ForgeConformanceSpec): void {
  describe(`${spec.label ?? spec.forge} adapter conformance`, () => {
    for (const check of FORGE_CONFORMANCE_CHECKS) {
      it(`${check.contract}: ${check.title}`, async () => {
        const run = openForgeConformance(spec)
        try {
          await check.run(run, spec)
        } finally {
          run.close()
        }
      })
    }
  })
}

/**
 * The same suite as a function, for a test that has to watch it fail — an adapter that is not
 * finished yet, or the suite's own test that it catches what it claims to. Returns one entry per
 * check that did not hold, empty when the adapter is green.
 */
export async function runForgeConformance(spec: ForgeConformanceSpec): Promise<ForgeConformanceFailure[]> {
  const failures: ForgeConformanceFailure[] = []
  for (const check of FORGE_CONFORMANCE_CHECKS) {
    const run = openForgeConformance(spec)
    try {
      await check.run(run, spec)
    } catch (error) {
      failures.push({
        contract: check.contract,
        title: check.title,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      run.close()
    }
  }
  return failures
}
