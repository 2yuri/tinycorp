import type { PullRequestCheck, PullRequestView } from '../../../shared/code'
import type { ForgeCliResult } from '../../../shared/forges/adapter'
import {
  CONFORMANCE_PATCH,
  CONFORMANCE_VIEW,
  type ForgeCall,
  type ForgeWorld,
  type WorldPullRequest,
  type WorldThread,
} from '../forge-conformance'
import { type GraphqlJob, type GraphqlMergeRequest, mergeRequestOf } from './adapter'

/**
 * `glab`, as a function: what it prints for each call the GitLab adapter makes, in the world the
 * conformance suite sets up. No network, no token, no repository.
 *
 * The shapes are the real ones, taken from `glab` 1.106 against gitlab.com and against a local
 * stand-in for an instance: `glab api` prints GitLab's JSON on stdout and its own one-line summary
 * on stderr when GitLab refuses; `glab mr …` draws its errors inside an `ERROR` banner; `glab auth
 * status` writes to stderr.
 */

/** Where the world's project lives, as a merge request URL names it. */
export const FAKE_PROJECT_URL = 'https://gitlab.example/acme/app'

/** The URL of merge request `iid` in the world's project. */
export function fakeMergeRequestUrl(iid: number): string {
  return `${FAKE_PROJECT_URL}/-/merge_requests/${iid}`
}

export function fakeGlab(call: ForgeCall, world: ForgeWorld): ForgeCliResult {
  const { args } = call
  const [verb, sub] = args

  if (verb === 'auth' && sub === 'status') return authStatus(world)
  if (verb === 'api' && sub === 'graphql') return graphql(args, world)
  if (verb === 'api') return api(args, world)
  if (verb === 'mr' && sub === 'diff') return diff(args, world)
  if (verb === 'mr' && sub === 'note' && args[2] === 'create') return note(args, world)
  return banner(`Unknown command "${args.slice(0, 2).join(' ')}" for "glab".`)
}

function authStatus(world: ForgeWorld): ForgeCliResult {
  if (world.login === 'signed-in') {
    return {
      code: 0,
      stdout: '',
      stderr: [
        'gitlab.com',
        `  ✓ Logged in to gitlab.com as ${world.account} (/Users/boss/Library/Application Support/glab-cli/config.yml)`,
        '  ✓ Git operations for gitlab.com configured to use https protocol.',
        '  ✓ API calls for gitlab.com are made over https protocol.',
        '  ✓ Token found: **************************',
        '',
      ].join('\n'),
    }
  }
  return {
    code: 1,
    stdout: '',
    stderr: [
      'gitlab.com',
      '  x gitlab.com: API call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}',
      '  ! No token found (checked config file, keyring, and environment variables).',
      '          ',
      '   ERROR  ',
      '          ',
      '  X could not authenticate to one or more of the configured GitLab instances.',
      '',
    ].join('\n'),
  }
}

/** `glab api <endpoint> [--method M] [--raw-field k=v] [--field k=v]`. */
function api(args: readonly string[], world: ForgeWorld): ForgeCliResult {
  const method = flag(args, '--method') ?? 'GET'
  const endpoint = args.find((arg, index) => index > 0 && !arg.startsWith('-') && !isFlagValue(args, index))!
  const fields = fieldsOf(args)
  const [path, query = ''] = endpoint.split('?')
  const params = new URLSearchParams(query)

  if (path === 'projects/:fullpath/merge_requests' && method === 'POST') {
    const branch = fields['source_branch']!
    const existing = openFor(world, branch)
    if (existing) {
      return refused(
        409,
        'Conflict',
        `{"message":["Another open merge request already exists for this source branch: !${existing.number}"]}`,
      )
    }
    const iid = Math.max(41, ...world.pullRequests.map((pr) => pr.number)) + 1
    const opened: WorldPullRequest = {
      url: fakeMergeRequestUrl(iid),
      number: iid,
      branch,
      base: fields['target_branch']!,
      title: fields['title']!,
      body: fields['description']!,
      view: { ...CONFORMANCE_VIEW, title: fields['title']!, head: branch, base: fields['target_branch']! },
      patch: CONFORMANCE_PATCH,
      merged: false,
      comments: [],
      lineComments: [],
      reviews: [],
      threads: [],
    }
    world.pullRequests.push(opened)
    world.opened.push(opened)
    return ok(JSON.stringify(apiMergeRequest(opened)))
  }

  if (path === 'projects/:fullpath/merge_requests' && method === 'GET') {
    const open = world.pullRequests.filter(
      (pr) => !pr.merged && pr.branch === params.get('source_branch') && params.get('state') === 'opened',
    )
    return ok(JSON.stringify(open.map(apiMergeRequest)))
  }

  const versions = /^projects\/([^/]+)\/merge_requests\/(\d+)\/versions$/.exec(path ?? '')
  if (versions && method === 'GET') {
    const pr = byIid(world, decodeURIComponent(versions[1]!), Number(versions[2]))
    if (!pr) return refused(404, 'Not found', '{"message":"404 Not found"}')
    return ok(
      JSON.stringify([{ base_commit_sha: 'base0000', start_commit_sha: 'start000', head_commit_sha: 'head0000' }]),
    )
  }

  const discussions = /^projects\/([^/]+)\/merge_requests\/(\d+)\/discussions$/.exec(path ?? '')
  if (discussions && method === 'POST') {
    const pr = byIid(world, decodeURIComponent(discussions[1]!), Number(discussions[2]))
    if (!pr) return refused(404, 'Not found', '{"message":"404 Not found"}')
    if (fields['position[head_sha]'] !== 'head0000') {
      return refused(400, 'Bad Request', '{"message":"400 Bad request - Note {:line_code=>["can\'t be blank"]}"}')
    }
    const thread: WorldThread = {
      id: pr.threads.length + 1,
      path: fields['position[new_path]'] ?? '',
      line: Number(fields['position[new_line]']),
      body: fields['body'] ?? '',
      resolved: false,
      replies: [],
    }
    pr.threads.push(thread)
    return ok(JSON.stringify(apiDiscussion(thread)))
  }

  const inThread = /^projects\/([^/]+)\/merge_requests\/(\d+)\/discussions\/([^/]+?)(\/notes)?$/.exec(path ?? '')
  if (inThread) {
    const pr = byIid(world, decodeURIComponent(inThread[1]!), Number(inThread[2]))
    const thread = pr?.threads.find((t) => String(t.id) === inThread[3])
    if (!pr || !thread) return refused(404, 'Not found', '{"message":"404 Discussion Not Found"}')
    if (inThread[4] && method === 'POST') {
      thread.replies.push(fields['body'] ?? '')
      return ok(JSON.stringify({ id: 800 + thread.replies.length, body: fields['body'] ?? '' }))
    }
    if (!inThread[4] && method === 'PUT') {
      // GitLab refuses to resolve a discussion that is already resolved.
      if (thread.resolved)
        return refused(400, 'Bad Request', '{"message":"400 Bad request - Discussion is already resolved"}')
      thread.resolved = fields['resolved'] === 'true'
      return ok(JSON.stringify(apiDiscussion(thread)))
    }
    if (!inThread[4] && method === 'GET') return ok(JSON.stringify(apiDiscussion(thread)))
  }

  const one = /^projects\/([^/]+)\/merge_requests\/(\d+)(\/merge)?$/.exec(path ?? '')
  if (one) {
    const pr = byIid(world, decodeURIComponent(one[1]!), Number(one[2]))
    if (!pr) return refused(404, 'Not found', '{"message":"404 Not found"}')
    if (one[3] && method === 'PUT') {
      if (pr.merged) return refused(405, 'Method Not Allowed', '{"message":"405 Method Not Allowed"}')
      if (fields['squash'] !== 'true')
        return banner('the fake only merges with --field squash=true, as the adapter asks')
      pr.merged = true
      return ok(JSON.stringify({ ...apiMergeRequest(pr), state: 'merged' }))
    }
    if (!one[3] && method === 'GET') return ok(JSON.stringify(apiMergeRequest(pr)))
  }

  return refused(404, 'Not found', '{"message":"404 Not found"}')
}

/** `glab api graphql --raw-field query=… --raw-field fullPath=… --raw-field iid=…`. */
function graphql(args: readonly string[], world: ForgeWorld): ForgeCliResult {
  const { query, fullPath, iid } = fieldsOf(args)
  if (!query?.includes('mergeRequest(iid: $iid)')) {
    return ok(JSON.stringify({ errors: [{ message: 'the fake answers the merge request query only' }] }))
  }
  if (fullPath !== 'acme/app') return ok(JSON.stringify({ data: { project: null } }))
  const pr = byIid(world, fullPath, Number(iid))
  return ok(JSON.stringify({ data: { project: { mergeRequest: pr ? graphqlMergeRequest(pr) : null } } }))
}

/** `glab mr diff <iid> --raw --color=never -R <project>`. */
function diff(args: readonly string[], world: ForgeWorld): ForgeCliResult {
  if (!args.includes('--raw')) return banner('the fake only prints --raw diffs: anything else is a rendering')
  const pr = fromRepoFlag(args, world)
  if (!pr) return banner('Could not obtain raw diff: 404 Not Found.')
  return ok(pr.patch)
}

/** `glab mr note create <iid> -R <project> [--file p --line n] --message=… [--resolvable=false]`. */
function note(args: readonly string[], world: ForgeWorld): ForgeCliResult {
  const pr = fromRepoFlag(args, world)
  if (!pr) return banner('Failed to get merge request: 404 Not Found.')
  const body = args.find((arg) => arg.startsWith('--message='))?.slice('--message='.length) ?? flag(args, '--message')
  if (body === undefined) return banner('the fake has no editor: pass --message')
  const file = flag(args, '--file')
  const noteId = 900 + pr.comments.length + pr.lineComments.length
  if (file !== undefined) {
    pr.lineComments.push({ path: file, line: Number(flag(args, '--line')), body })
  } else {
    pr.comments.push(body)
  }
  return ok(`${pr.url}#note_${noteId}\n`)
}

/** The merge request `<iid> -R <project URL>` names, when the project is the world's. */
function fromRepoFlag(args: readonly string[], world: ForgeWorld): WorldPullRequest | undefined {
  const repo = flag(args, '-R')
  const iid = Number(args[args.indexOf('mr') + (args[1] === 'note' ? 3 : 2)])
  if (repo !== FAKE_PROJECT_URL) return undefined
  return byIid(world, 'acme/app', iid)
}

function byIid(world: ForgeWorld, project: string, iid: number): WorldPullRequest | undefined {
  return world.pullRequests.find((pr) => pr.number === iid && mergeRequestOf(pr.url)?.project === project)
}

function openFor(world: ForgeWorld, branch: string): WorldPullRequest | undefined {
  return world.pullRequests.find((pr) => pr.branch === branch && !pr.merged)
}

/** A discussion in GitLab's own words: its id, and the note that opened it. */
function apiDiscussion(thread: WorldThread) {
  return { id: String(thread.id), notes: [{ id: 700 + thread.id, body: thread.body, resolved: thread.resolved }] }
}

function apiMergeRequest(pr: WorldPullRequest) {
  return {
    iid: pr.number,
    web_url: pr.url,
    title: pr.title,
    state: pr.merged ? 'merged' : 'opened',
    source_branch: pr.branch,
    target_branch: pr.base,
  }
}

/** A world PR in GitLab's words: the inverse of the adapter's translation, written from GitLab's side. */
function graphqlMergeRequest(pr: WorldPullRequest): GraphqlMergeRequest {
  const view: PullRequestView = pr.view
  return {
    title: view.title,
    state: pr.merged ? 'merged' : { open: 'opened', merged: 'merged', closed: 'closed' }[view.state],
    sourceBranch: view.head,
    targetBranch: view.base,
    conflicts: view.mergeable === 'conflicting',
    detailedMergeStatus: { mergeable: 'MERGEABLE', conflicting: 'CONFLICT', unknown: 'CHECKING' }[view.mergeable],
    diffStatsSummary: { additions: view.additions, deletions: view.deletions, fileCount: view.changedFiles },
    headPipeline: { jobs: { nodes: view.checks.map(job) } },
  }
}

function job(check: PullRequestCheck): GraphqlJob {
  return {
    name: check.name,
    status: { passing: 'SUCCESS', failing: 'FAILED', pending: 'RUNNING', skipped: 'SKIPPED' }[check.state],
    allowFailure: false,
    duration: check.durationMs === null ? null : check.durationMs / 1000,
    stage: check.workflow ? { name: check.workflow } : null,
  }
}

/** `--raw-field k=v` and `--field k=v`, by key. The value is everything after the first `=`. */
function fieldsOf(args: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  args.forEach((arg, index) => {
    if (arg !== '--raw-field' && arg !== '--field' && arg !== '-f' && arg !== '-F') return
    const pair = args[index + 1] ?? ''
    const at = pair.indexOf('=')
    fields[pair.slice(0, at)] = pair.slice(at + 1)
  })
  return fields
}

const VALUED = new Set(['--method', '--raw-field', '--field', '-f', '-F', '-R', '--file', '--line', '--message'])

function isFlagValue(args: readonly string[], index: number): boolean {
  return VALUED.has(args[index - 1] ?? '')
}

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

function ok(stdout: string): ForgeCliResult {
  return { code: 0, stdout, stderr: '' }
}

/** How `glab api` answers a refusal: GitLab's JSON on stdout, its own summary on stderr. */
function refused(status: number, text: string, body: string): ForgeCliResult {
  return { code: 1, stdout: body, stderr: `glab: ${status} ${text} (HTTP ${status})\n` }
}

/** How `glab mr …` answers a failure: its words inside a banner. */
function banner(words: string): ForgeCliResult {
  return { code: 1, stdout: '', stderr: `          \n   ERROR  \n          \n  ${words}\n\n` }
}
