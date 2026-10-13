import type { PullRequestCheck, PullRequestCheckState, PullRequestView } from '../../../shared/code'
import {
  type ForgeAdapter,
  type ForgeAdapterOptions,
  type ForgeCliResult,
  type ForgePullRequest,
  forgeFailure,
  type ReviewVerdictOnForge,
} from '../../../shared/forges/adapter'
import type { ProviderCheck } from '../../../shared/providers/preflight'
import { onPath } from '../../platform'
import { checkForgeCli, type ForgeSignIn } from '../forge-preflight'
import { FORGE_BUFFER, runForge as realRunForge } from '../run-forge'

/**
 * The first client of the forge seam: everything TinyCorp used to do with `gh`, and nothing more.
 *
 * It was the baseline once — `git-service.ts` shelled out to `gh pr create`, `gh pr view`,
 * `gh pr diff`, `gh pr comment`, `gh pr checks` and `gh pr merge` inline, and GitHub was not a
 * choice the app had made so much as a wire running through the only path a PR could take. Now it
 * is one adapter among however many there are, answering the same suite as the next one.
 *
 * The credential is `gh`'s. This file never reads a token, never writes one and never passes one.
 */
export function createGithubAdapter({
  command,
  name,
  cwd: statusCwd = process.cwd(),
  runForge = realRunForge,
  installed = () => onPath(command),
}: ForgeAdapterOptions): ForgeAdapter {
  /** Runs `gh` in a checkout and answers its stdout, or throws with its own words. */
  async function gh(cwd: string, args: readonly string[], maxBuffer?: number, stdin?: string): Promise<string> {
    const result = await run(cwd, args, maxBuffer, stdin)
    if (result.code !== 0) throw forgeFailure(command, args, result)
    return result.stdout
  }

  /** The PR this URL names, or a refusal in words the caller can show. */
  function partsOf(url: string): { owner: string; repo: string; number: number } {
    const pr = pullRequestParts(url)
    if (!pr) throw new Error(`${url} is not a pull request URL`)
    return pr
  }

  function run(cwd: string, args: readonly string[], maxBuffer?: number, stdin?: string): Promise<ForgeCliResult> {
    return runForge(command, args, {
      cwd,
      ...(maxBuffer !== undefined && { maxBuffer }),
      ...(stdin !== undefined && { stdin }),
    })
  }

  /** The PR head's commit, so GitHub anchors a line comment to the diff the boss read. */
  async function headCommit(cwd: string, url: string): Promise<string | null> {
    const result = await run(cwd, ['pr', 'view', url, '--json', 'headRefOid', '-q', '.headRefOid'])
    return result.code === 0 ? result.stdout.trim() || null : null
  }

  return {
    async openPullRequest({ cwd, branch, base, title, body }) {
      const args = ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body]
      // `gh` refuses a second PR for a branch that already has one, in its own words. That is not
      // this method's problem to unpick: the engine asks `findPullRequest` next and lands on the
      // PR that is already open, whatever the CLI called the refusal.
      const result = await run(cwd, args)
      if (result.code !== 0) throw forgeFailure(command, args, result)
      const pr = pullRequestAt(result.stdout)
      if (!pr) throw new Error(`${command} pr create printed no pull request URL: ${result.stdout.trim()}`)
      return pr
    },

    async findPullRequest({ cwd, branch }) {
      const args = ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--limit', '1']
      const result = await run(cwd, args)
      if (result.code !== 0) return null
      let rows: { url?: unknown }[]
      try {
        rows = JSON.parse(result.stdout || '[]') as { url?: unknown }[]
      } catch {
        return null
      }
      const url = rows.map((row) => row.url).find((value) => typeof value === 'string')
      return url ? pullRequestAt(url) : null
    },

    async readPullRequest({ cwd, url }) {
      const output = await gh(cwd, ['pr', 'view', url, '--json', PR_VIEW_FIELDS])
      return parsePullRequestView(JSON.parse(output) as Record<string, unknown>)
    },

    readDiff({ cwd, url }) {
      return gh(cwd, ['pr', 'diff', url, '--patch'], FORGE_BUFFER)
    },

    async comment({ cwd, url, body }) {
      await gh(cwd, ['pr', 'comment', url, '--body', body])
    },

    async commentOnLine({ cwd, url, path, line, body }) {
      const pr = partsOf(url)
      const head = await headCommit(cwd, url)
      const args = [
        'api',
        '--method',
        'POST',
        `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments`,
        '-f',
        `body=${body}`,
        '-f',
        `path=${path}`,
        '-F',
        `line=${line}`,
        '-f',
        'side=RIGHT',
        ...(head ? ['-f', `commit_id=${head}`] : []),
        '-q',
        '.html_url',
      ]
      return (await gh(cwd, args)).trim() || null
    },

    /**
     * One round of an agent's review as one GitHub pull request review: a body, an event, and a
     * comment per thread, all in a single request. GitHub is the only party that can open a review
     * thread, so the comments go in with the review rather than one at a time — that is what makes
     * the boss see a review on the PR rather than a scatter of comments.
     *
     * The body has to be JSON with an array of objects in it, which no `-f` flag can carry, so it
     * goes in on stdin with `--input -`. The threads' ids are then read back off the review's own
     * comments, in the order GitHub kept them.
     */
    async postReview({ cwd, url, summary, verdict, threads }) {
      const pr = partsOf(url)
      const head = await headCommit(cwd, url)
      const review = JSON.parse(
        await gh(
          cwd,
          ['api', '--method', 'POST', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`, '--input', '-'],
          undefined,
          JSON.stringify({
            ...(head ? { commit_id: head } : {}),
            body: summary,
            event: REVIEW_EVENT[verdict],
            comments: threads.map((thread) => ({
              path: thread.path,
              line: thread.line,
              side: 'RIGHT',
              body: thread.body,
            })),
          }),
        ),
      ) as { id?: number; html_url?: string }
      if (typeof review.id !== 'number') throw new Error(`${command} posted a review with no id: ${url}`)
      if (threads.length === 0) return { url: review.html_url ?? null, threads: [] }
      const comments = JSON.parse(
        await gh(cwd, [
          'api',
          '--paginate',
          `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews/${review.id}/comments`,
        ]),
      ) as { id?: number; html_url?: string }[]
      return {
        url: review.html_url ?? null,
        threads: comments
          .filter((comment) => typeof comment.id === 'number')
          .map((comment) => ({ id: String(comment.id), url: comment.html_url ?? null })),
      }
    },

    async replyToThread({ cwd, url, threadId, body }) {
      const pr = partsOf(url)
      const posted = await gh(cwd, [
        'api',
        '--method',
        'POST',
        `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments/${threadId}/replies`,
        '-f',
        `body=${body}`,
        '-q',
        '.html_url',
      ])
      return posted.trim() || null
    },

    /**
     * Resolving is GitHub's only review action that REST cannot do, so it is the one GraphQL call
     * here: the thread's node id is looked up by the comment id this adapter handed out, and a
     * thread already resolved is left alone rather than asked again.
     */
    async resolveThread({ cwd, url, threadId }) {
      const pr = partsOf(url)
      const answer = JSON.parse(
        await gh(cwd, [
          'api',
          'graphql',
          '-f',
          `query=${REVIEW_THREADS_QUERY}`,
          '-f',
          `owner=${pr.owner}`,
          '-f',
          `repo=${pr.repo}`,
          '-F',
          `number=${pr.number}`,
        ]),
      ) as ReviewThreadsAnswer
      const nodes = answer.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
      const thread = nodes.find((node) =>
        (node.comments?.nodes ?? []).some((comment) => String(comment.databaseId) === threadId),
      )
      if (!thread) throw new Error(`${command} found no review thread for comment ${threadId} on ${url}`)
      if (thread.isResolved) return
      await gh(cwd, ['api', 'graphql', '-f', `query=${RESOLVE_THREAD_MUTATION}`, '-f', `threadId=${thread.id}`])
    },

    async merge({ cwd, url }) {
      const args = ['pr', 'merge', url, '--squash']
      const result = await run(cwd, args)
      if (result.code === 0) return
      // A PR the boss merged on the web while TinyCorp was asking is merged, not failed.
      if (/already merged/i.test(`${result.stderr}${result.stdout}`)) return
      throw forgeFailure(command, args, result)
    },

    async createRemote({ cwd, name, visibility }) {
      // No `--source`: that would have gh add `origin` and push, and both are git's (T144).
      const created = await gh(cwd, ['repo', 'create', name, `--${visibility}`])
      const webUrl = /https?:\/\/\S+/.exec(created)?.[0]?.replace(/\/+$/, '')
      if (!webUrl) throw new Error(`${command} repo create printed no repository URL: ${created.trim()}`)
      // Clone the way the boss told gh to, so the first push uses the credential they already set up.
      const protocol = await run(cwd, ['config', 'get', 'git_protocol'])
      return {
        webUrl,
        cloneUrl: protocol.code === 0 && protocol.stdout.trim() === 'ssh' ? sshUrlOf(webUrl) : `${webUrl}.git`,
      }
    },

    installed,

    checkCli(): Promise<ProviderCheck> {
      return checkForgeCli({ name, command, signIn: githubSignIn, installed, runForge, cwd: statusCwd })
    },
  }
}

/** What GitHub calls each verdict a reviewer's round can carry. */
const REVIEW_EVENT: Record<ReviewVerdictOnForge, string> = {
  approve: 'APPROVE',
  changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
}

/** The PR's review threads, with the comment id each one started from. */
export const REVIEW_THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}`

export const RESOLVE_THREAD_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`

interface ReviewThreadsAnswer {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: { id: string; isResolved: boolean; comments?: { nodes?: { databaseId: number }[] } }[]
        }
      }
    }
  }
}

/** How `gh` is asked where it stands, and its own commands for fixing it. */
export const githubSignIn: ForgeSignIn = {
  statusArgs: ['auth', 'status'],
  installWith: 'brew install gh',
  signInWith: 'gh auth login',
  // `gh auth status` exits non-zero when no account is logged in, and prints the account when one is.
  signedIn: (result) => result.code === 0 && /logged in/i.test(`${result.stdout}${result.stderr}`),
  account: (result) => /account (\S+)/i.exec(`${result.stdout}${result.stderr}`)?.[1] ?? null,
}

/** The fields `gh pr view` is asked for: the PR's state, its size, its mergeability and its checks. */
const PR_VIEW_FIELDS =
  'title,state,headRefName,baseRefName,additions,deletions,changedFiles,mergeable,statusCheckRollup'

interface RollupItem {
  __typename?: string
  name?: string
  context?: string
  workflowName?: string
  status?: string
  conclusion?: string
  state?: string
  startedAt?: string
  completedAt?: string
}

/** `gh pr view --json` output as a PullRequestView; missing fields read as empty. */
export function parsePullRequestView(json: Record<string, unknown>): PullRequestView {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const state = text(json['state']).toUpperCase()
  const mergeable = text(json['mergeable']).toUpperCase()
  const rollup = Array.isArray(json['statusCheckRollup']) ? (json['statusCheckRollup'] as RollupItem[]) : []
  return {
    title: text(json['title']),
    state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
    head: text(json['headRefName']),
    base: text(json['baseRefName']),
    additions: count(json['additions']),
    deletions: count(json['deletions']),
    changedFiles: count(json['changedFiles']),
    mergeable: mergeable === 'MERGEABLE' ? 'mergeable' : mergeable === 'CONFLICTING' ? 'conflicting' : 'unknown',
    checks: rollup.map(checkOf),
  }
}

function checkOf(item: RollupItem): PullRequestCheck {
  if (item.__typename === 'StatusContext') {
    const state = (item.state ?? '').toUpperCase()
    return {
      name: item.context ?? '',
      workflow: '',
      state: state === 'SUCCESS' ? 'passing' : state === 'FAILURE' || state === 'ERROR' ? 'failing' : 'pending',
      durationMs: null,
    }
  }
  const conclusion = (item.conclusion ?? '').toUpperCase()
  const completed = (item.status ?? '').toUpperCase() === 'COMPLETED'
  const state: PullRequestCheckState = !completed
    ? 'pending'
    : conclusion === 'SUCCESS'
      ? 'passing'
      : conclusion === 'SKIPPED' || conclusion === 'NEUTRAL'
        ? 'skipped'
        : 'failing'
  const started = Date.parse(item.startedAt ?? '')
  const ended = Date.parse(item.completedAt ?? '')
  return {
    name: item.name ?? '',
    workflow: item.workflowName ?? '',
    state,
    durationMs: completed && ended >= started ? ended - started : null,
  }
}

/** `https://github.com/acme/app/pull/42` as its owner, repo and number. */
export function pullRequestParts(url: string): { owner: string; repo: string; number: number } | null {
  const match = /https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url)
  return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null
}

/** `https://github.com/acme/app` as `git@github.com:acme/app.git`. */
export function sshUrlOf(webUrl: string): string {
  const match = /^https?:\/\/([^/]+)\/(.+)$/.exec(webUrl)
  return match ? `git@${match[1]}:${match[2]}.git` : `${webUrl}.git`
}

/** The first PR URL in some output, with its number read off the end. */
function pullRequestAt(text: string): ForgePullRequest | null {
  const url = /https?:\/\/\S+\/pull\/\d+/.exec(text)?.[0] ?? null
  if (!url) return null
  const number = /\/pull\/(\d+)$/.exec(url)?.[1]
  return { url, number: number === undefined ? null : Number(number) }
}
