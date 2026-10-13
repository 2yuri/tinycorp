/**
 * `forges`' test kit: a forge that records what it was asked and answers what the test set up.
 *
 * It is not part of `forges/index.ts`. A test names this file, so nothing that wants a real forge
 * carries a fake into its graph.
 */

import type { PullRequestView } from '../../shared/code'
import type {
  FindPullRequest,
  ForgeAdapter,
  ForgePullRequest,
  LineComment,
  OpenPullRequest,
  PullRequestRef,
} from '../../shared/forges/adapter'
import type { ProviderCheck } from '../../shared/providers/preflight'

/** A forge for tests: records what it was asked, and answers whatever the test set up. */
export interface FakeForge extends ForgeAdapter {
  /** Every PR the service asked to open, in order. */
  opened: OpenPullRequest[]
  /** Every branch it asked about, in order. */
  searched: FindPullRequest[]
  /** Every PR it read, merged, commented on or asked for a patch, in order. */
  reads: PullRequestRef[]
  merges: PullRequestRef[]
  comments: (PullRequestRef & { body: string })[]
  lineComments: LineComment[]
  diffs: PullRequestRef[]
  /** Makes the next open fail with `message`, the way a forge refuses one. */
  failOpen(message: string): void
  /** The PR `findPullRequest` answers; null until a test says otherwise. */
  existing: ForgePullRequest | null
  /** What a read answers. */
  setView(view: Partial<PullRequestView>): void
  /** What a diff answers. */
  setPatch(patch: string): void
  /** Whether the CLI is on this machine; true otherwise. */
  setInstalled(installed: boolean): void
}

export const FAKE_PR_URL = 'https://github.com/acme/app/pull/42'

export function fakeForge({ url = FAKE_PR_URL, number = 42 }: { url?: string; number?: number } = {}): FakeForge {
  let openFailure: string | null = null
  let installed = true
  let patch = ''
  let view: PullRequestView = {
    title: '',
    state: 'open',
    head: '',
    base: 'main',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    mergeable: 'unknown',
    checks: [],
  }
  const forge: FakeForge = {
    opened: [],
    searched: [],
    reads: [],
    merges: [],
    comments: [],
    lineComments: [],
    diffs: [],
    existing: null,
    failOpen(message) {
      openFailure = message
    },
    setView(next) {
      view = { ...view, ...next }
    },
    setPatch(next) {
      patch = next
    },
    setInstalled(next) {
      installed = next
    },
    async openPullRequest(request) {
      forge.opened.push(request)
      await Promise.resolve()
      if (openFailure !== null) {
        const message = openFailure
        openFailure = null
        throw new Error(message)
      }
      return { url, number }
    },
    async findPullRequest(request) {
      forge.searched.push(request)
      await Promise.resolve()
      return forge.existing
    },
    async readPullRequest(request) {
      forge.reads.push(request)
      await Promise.resolve()
      return view
    },
    async readDiff(request) {
      forge.diffs.push(request)
      await Promise.resolve()
      return patch
    },
    async comment(request) {
      forge.comments.push(request)
      await Promise.resolve()
    },
    async commentOnLine(request) {
      forge.lineComments.push(request)
      await Promise.resolve()
      return `${request.url}#discussion_r${forge.lineComments.length}`
    },
    async merge(request) {
      forge.merges.push(request)
      await Promise.resolve()
    },
    installed: () => installed,
    checkCli(): Promise<ProviderCheck> {
      return Promise.resolve({
        state: installed ? 'ready' : 'missing',
        title: '',
        body: '',
        lead: '',
        commands: [],
        note: '',
        account: null,
        plan: null,
      })
    },
  }
  return forge
}
