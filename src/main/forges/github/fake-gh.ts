import type { PullRequestCheck, PullRequestView } from '../../../shared/code'
import type { ForgeCliResult } from '../../../shared/forges/adapter'
import type { ForgeCall, ForgeWorld, WorldPullRequest, WorldReview, WorldThread } from '../forge-conformance'

/**
 * `gh`, as a function: what the real CLI prints for the calls this adapter makes.
 *
 * The conformance suite drives the adapter against this and never against a network, a token or a
 * repository. Everything here is the product's own behaviour, including how it refuses — a second
 * PR for a branch that already has one, a merge of a PR that is already merged — because those
 * refusals are exactly what the adapter has to get right.
 */
export function fakeGh(call: ForgeCall, world: ForgeWorld): ForgeCliResult {
  const [group, verb] = call.args
  const flag = (name: string): string | null => {
    const at = call.args.indexOf(name)
    return at === -1 ? null : (call.args[at + 1] ?? null)
  }
  if (group === 'auth' && verb === 'status') {
    return world.login === 'signed-in'
      ? ok(`github.com\n  ✓ Logged in to github.com account ${world.account} (keyring)\n`)
      : fail('You are not logged into any GitHub hosts. Run gh auth login to authenticate.')
  }
  if (group === 'api' && verb === 'graphql') return graphql(call, world)
  if (group === 'api') {
    const path = call.args.find((arg) => arg.startsWith('repos/')) ?? ''
    const field = (name: string) => call.args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
    const prOf = (n: string | undefined) => world.pullRequests.find((open) => open.number === Number(n))

    const review = /\/pulls\/(\d+)\/reviews$/.exec(path)
    if (review) {
      const pr = prOf(review[1])
      if (!pr) return fail(`gh: Not Found (HTTP 404) for ${path}`)
      const body = JSON.parse(call.stdin ?? '{}') as {
        body?: string
        event?: string
        comments?: { path: string; line: number; body: string }[]
      }
      const posted: WorldReview = {
        id: 900 + pr.reviews.length + 1,
        body: body.body ?? '',
        event: body.event ?? '',
        comments: [],
      }
      for (const comment of body.comments ?? []) {
        const thread: WorldThread = {
          id: pr.threads.length + 1,
          path: comment.path,
          line: comment.line,
          body: comment.body,
          resolved: false,
          replies: [],
        }
        pr.threads.push(thread)
        posted.comments.push(thread.id)
      }
      pr.reviews.push(posted)
      return ok(JSON.stringify({ id: posted.id, html_url: `${pr.url}#pullrequestreview-${posted.id}` }))
    }

    const reviewComments = /\/pulls\/(\d+)\/reviews\/(\d+)\/comments$/.exec(path)
    if (reviewComments) {
      const pr = prOf(reviewComments[1])
      const found = pr?.reviews.find((r) => r.id === Number(reviewComments[2]))
      if (!pr || !found) return fail(`gh: Not Found (HTTP 404) for ${path}`)
      return ok(JSON.stringify(found.comments.map((id) => ({ id, html_url: `${pr.url}#discussion_r${id}` }))))
    }

    const reply = /\/pulls\/(\d+)\/comments\/(\d+)\/replies$/.exec(path)
    if (reply) {
      const pr = prOf(reply[1])
      const thread = pr?.threads.find((t) => t.id === Number(reply[2]))
      if (!pr || !thread) return fail(`gh: Not Found (HTTP 404) for ${path}`)
      thread.replies.push(field('body'))
      return ok(`${pr.url}#discussion_r${thread.id}\n`)
    }

    const line = /\/pulls\/(\d+)\/comments$/.exec(path)
    if (line) {
      const pr = prOf(line[1])
      if (!pr) return fail(`gh: Not Found (HTTP 404) for ${path}`)
      pr.lineComments.push({ path: field('path'), line: Number(field('line')), body: field('body') })
      return ok(`${pr.url}#discussion_r${pr.lineComments.length}\n`)
    }
    return fail(`gh: Not Found (HTTP 404) for ${path || '(no path)'}`)
  }
  if (group === 'config' && verb === 'get') {
    return ok(call.args[2] === 'git_protocol' ? `${world.cloneProtocol}\n` : '\n')
  }
  if (group === 'repo' && verb === 'create') {
    const name = call.args[2] ?? ''
    const visibility = call.args.includes('--public') ? 'public' : call.args.includes('--private') ? 'private' : null
    if (!visibility) return fail('--public, --private, or --internal required when not running interactively')
    const webUrl = `https://forge.example/${world.account}/${name}`
    if (world.remotes.some((remote) => remote.name === name)) {
      return fail(`GraphQL: Name already exists on this account (createRepository)`)
    }
    world.remotes.push({ name, visibility, webUrl })
    return ok(`${webUrl}\n`)
  }
  if (group !== 'pr') return fail(`unknown command: gh ${call.args.join(' ')}`)
  const url = call.args[2] ?? ''
  const pr = world.pullRequests.find((open) => open.url === url) ?? null
  switch (verb) {
    case 'create': {
      const branch = flag('--head') ?? ''
      const already = world.pullRequests.find((open) => open.branch === branch)
      if (already) {
        return fail(
          `a pull request for branch "${branch}" into branch "${already.base}" already exists:\n${already.url}`,
        )
      }
      const number = 100 + world.opened.length
      const opened: WorldPullRequest = {
        url: `https://forge.example/acme/app/pull/${number}`,
        number,
        branch,
        base: flag('--base') ?? '',
        title: flag('--title') ?? '',
        body: flag('--body') ?? '',
        view: { ...EMPTY_VIEW, head: branch },
        patch: '',
        merged: false,
        comments: [],
        lineComments: [],
        reviews: [],
        threads: [],
      }
      world.opened.push(opened)
      world.pullRequests.push(opened)
      return ok(`${opened.url}\n`)
    }
    case 'list': {
      const branch = flag('--head') ?? ''
      const found = world.pullRequests.find((open) => open.branch === branch)
      return ok(JSON.stringify(found ? [{ url: found.url }] : []))
    }
    case 'view': {
      if (!pr) return fail(`could not resolve to a PullRequest with the number of ${url.split('/').at(-1)}`)
      if (flag('--json') === 'headRefOid') return ok('1a2b3c4d\n')
      return ok(JSON.stringify(viewJson(pr.view)))
    }
    case 'diff':
      return pr ? ok(pr.patch) : fail('could not find pull request')
    case 'comment': {
      if (!pr) return fail('could not find pull request')
      pr.comments.push(flag('--body') ?? '')
      return ok(`${pr.url}#issuecomment-1\n`)
    }
    case 'merge': {
      if (!pr) return fail('could not find pull request')
      if (pr.merged) return fail(`Pull request acme/app#${pr.number} was already merged`)
      pr.merged = true
      return ok('')
    }
    default:
      return fail(`unknown command: gh ${call.args.join(' ')}`)
  }
}

/**
 * `gh api graphql`, for the one thing GitHub's REST API cannot do: resolving a review thread. The
 * fake answers the two documents the adapter sends and nothing else, so a third one shows up as a
 * failing check rather than a silent pass.
 */
function graphql(call: ForgeCall, world: ForgeWorld): ForgeCliResult {
  const field = (name: string) => call.args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
  const query = field('query')
  const pr = world.pullRequests.find((open) => open.number === Number(field('number')))
  if (/reviewThreads/.test(query)) {
    if (!pr) return ok(JSON.stringify({ data: { repository: { pullRequest: null } } }))
    return ok(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: pr.threads.map((thread) => ({
                  id: `THREAD_${thread.id}`,
                  isResolved: thread.resolved,
                  comments: { nodes: [{ databaseId: thread.id }] },
                })),
              },
            },
          },
        },
      }),
    )
  }
  if (/resolveReviewThread/.test(query)) {
    const id = Number(/^THREAD_(\d+)$/.exec(field('threadId'))?.[1])
    const thread = world.pullRequests.flatMap((open) => open.threads).find((t) => t.id === id)
    if (!thread) return fail('gh: Could not resolve to a node with the global id')
    thread.resolved = true
    return ok(JSON.stringify({ data: { resolveReviewThread: { thread: { isResolved: true } } } }))
  }
  return fail(`unknown graphql document: gh ${call.args.join(' ')}`)
}

function ok(stdout: string): ForgeCliResult {
  return { code: 0, stdout, stderr: '' }
}

function fail(stderr: string): ForgeCliResult {
  return { code: 1, stdout: '', stderr }
}

const EMPTY_VIEW: PullRequestView = {
  title: '',
  state: 'open',
  head: '',
  base: '',
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  mergeable: 'unknown',
  checks: [],
}

/** A PullRequestView as `gh pr view --json` prints it, so the adapter has something to parse. */
function viewJson(view: PullRequestView): Record<string, unknown> {
  return {
    title: view.title,
    state: view.state.toUpperCase(),
    headRefName: view.head,
    baseRefName: view.base,
    additions: view.additions,
    deletions: view.deletions,
    changedFiles: view.changedFiles,
    mergeable: view.mergeable.toUpperCase(),
    statusCheckRollup: view.checks.map(rollupItem),
  }
}

const RUN_STARTED = '2026-09-17T09:00:00Z'

function rollupItem(check: PullRequestCheck): Record<string, unknown> {
  const completed = check.state !== 'pending'
  return {
    __typename: 'CheckRun',
    name: check.name,
    workflowName: check.workflow,
    status: completed ? 'COMPLETED' : 'IN_PROGRESS',
    conclusion:
      check.state === 'passing'
        ? 'SUCCESS'
        : check.state === 'failing'
          ? 'FAILURE'
          : check.state === 'skipped'
            ? 'SKIPPED'
            : '',
    ...(check.durationMs !== null && {
      startedAt: RUN_STARTED,
      completedAt: new Date(Date.parse(RUN_STARTED) + check.durationMs).toISOString(),
    }),
  }
}
