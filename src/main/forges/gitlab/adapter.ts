import type { Mergeability, PullRequestCheck, PullRequestCheckState, PullRequestView } from '../../../shared/code'
import {
  type ForgeAdapter,
  type ForgeAdapterOptions,
  type ForgeCliResult,
  type ForgePullRequest,
  type ForgeThread,
  forgeFailure,
  type ReviewVerdictOnForge,
  type RunForge,
} from '../../../shared/forges/adapter'
import { onPath } from '../../platform'
import { checkForgeCli, type ForgeSignIn } from '../forge-preflight'
import { runForge as runRealForge } from '../run-forge'

/**
 * GitLab, through `glab`.
 *
 * GitLab has its own words for everything the contract names, and they stop here: a pull request
 * is a **merge request**, numbered by its `iid` within its project; CI is the merge request's head
 * **pipeline**, whose **jobs** run in **stages**; whether it merges cleanly is its **detailed merge
 * status**. Nothing outside this folder learns any of them.
 *
 * Where `glab` has a command that answers in a shape a program can read, the adapter runs it
 * (`glab mr diff --raw`, `glab mr note create`). Where it only prints for a person, it asks the
 * same instance through `glab api` — which is still `glab`, signed in by `glab auth login`, reading
 * its own login where the boss put it. TinyCorp never holds a GitLab token.
 */

/**
 * `glab`'s own switches, laid over the app's environment on every command. By default `glab`
 * posts a usage event to the instance and checks for a new release on every command it runs;
 * the guide's rule is that the only traffic is the forge's own work, so both are off. And it
 * never stops to ask a question nobody is there to answer.
 */
export const GLAB_ENV: Readonly<Record<string, string>> = {
  GLAB_SEND_TELEMETRY: 'false',
  GLAB_CHECK_UPDATE: 'false',
  GLAB_NO_PROMPT: 'true',
  NO_COLOR: '1',
}

/** What `glab` is asked about a merge request on a read: one query, every field the contract draws. */
export const MERGE_REQUEST_QUERY = `query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    mergeRequest(iid: $iid) {
      title
      state
      sourceBranch
      targetBranch
      conflicts
      detailedMergeStatus
      diffStatsSummary { additions deletions fileCount }
      headPipeline { jobs(retried: false) { nodes { name status allowFailure duration stage { name } } } }
    }
  }
}`

/** A merge request, as its URL names it: `https://<host>/<project>/-/merge_requests/<iid>`. */
export interface MergeRequestRef {
  /** The project's URL, which `glab -R` takes: `https://gitlab.acme.com/team/sub/app`. */
  projectUrl: string
  /** The project's full path, groups and subgroups included: `team/sub/app`. */
  project: string
  /** The merge request's number within its project. */
  iid: number
}

/** The project and number a merge request URL carries, or null when it is not one. */
export function mergeRequestOf(url: string): MergeRequestRef | null {
  const match = /^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)(?:[/?#].*)?$/.exec(url.trim())
  if (!match) return null
  return { projectUrl: `${match[1]}/${match[2]}`, project: match[2]!, iid: Number(match[3]) }
}

/** What `glab` answers for, in the preflight's words. */
export const GLAB_SIGN_IN: ForgeSignIn = {
  // Every instance `glab` is signed into, not only the one the folder it runs in points at: the
  // preflight runs in the app's own folder, and a boss's repos can be on gitlab.com and on their
  // employer's instance at once.
  statusArgs: ['auth', 'status', '--all'],
  installWith: 'brew install glab',
  signInWith: 'glab auth login',
  signedIn: (result) => signedInAs(result).length > 0,
  account(result) {
    const accounts = signedInAs(result)
    return accounts.length > 0 ? accounts.map(({ user, host }) => `${user} on ${host}`).join(', ') : null
  },
}

/** Every `Logged in to <host> as <user>` line `glab auth status` printed, on either stream. */
function signedInAs(result: ForgeCliResult): { host: string; user: string }[] {
  const said = `${result.stdout}\n${result.stderr}`
  return [...said.matchAll(/Logged in to (\S+) as (\S+)/g)].map((match) => ({ host: match[1]!, user: match[2]! }))
}

export function createGitlabAdapter({
  command,
  name,
  cwd: appCwd = process.cwd(),
  runForge = runRealForge,
  installed = () => onPath(command),
}: ForgeAdapterOptions): ForgeAdapter {
  const run: RunForge = (cmd, args, options) =>
    runForge(cmd, args, { ...options, env: { ...GLAB_ENV, ...options.env } })

  async function glab(args: readonly string[], cwd: string): Promise<string> {
    const result = await run(command, args, { cwd })
    if (result.code !== 0) throw glabFailure(command, args, result)
    return result.stdout
  }

  function refOf(url: string): MergeRequestRef {
    const ref = mergeRequestOf(url)
    if (!ref) throw new Error(`${url} is not a ${name} merge request: its address has no /-/merge_requests/<number>`)
    return ref
  }

  const projectApi = (ref: MergeRequestRef) => `projects/${encodeURIComponent(ref.project)}/merge_requests/${ref.iid}`

  return {
    async openPullRequest({ cwd, branch, base, title, body }) {
      // A branch that already has an open merge request is refused by GitLab in its own words
      // ("Another open merge request already exists for this source branch"), and the engine then
      // asks findPullRequest, which answers the one that is there.
      const stdout = await glab(
        [
          'api',
          '--method',
          'POST',
          'projects/:fullpath/merge_requests',
          '--raw-field',
          `source_branch=${branch}`,
          '--raw-field',
          `target_branch=${base}`,
          '--raw-field',
          `title=${title}`,
          '--raw-field',
          `description=${body}`,
        ],
        cwd,
      )
      return pullRequestOf(parse<ApiMergeRequest>(stdout, 'the merge request it opened'))
    },

    async findPullRequest({ cwd, branch }) {
      const stdout = await glab(
        ['api', `projects/:fullpath/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`],
        cwd,
      )
      const open = parse<ApiMergeRequest[]>(stdout, `the merge requests of ${branch}`)
      return open[0] ? pullRequestOf(open[0]) : null
    },

    async readPullRequest({ cwd, url }) {
      const ref = refOf(url)
      const stdout = await glab(
        [
          'api',
          'graphql',
          '--raw-field',
          `query=${MERGE_REQUEST_QUERY}`,
          '--raw-field',
          `fullPath=${ref.project}`,
          '--raw-field',
          `iid=${ref.iid}`,
        ],
        cwd,
      )
      const answer = parse<GraphqlAnswer>(stdout, `merge request !${ref.iid}`)
      const said = answer.errors?.map((error) => error.message).join('; ')
      if (said) throw new Error(`${command} could not read merge request !${ref.iid} in ${ref.project}: ${said}`)
      const mergeRequest = answer.data?.project?.mergeRequest
      if (!mergeRequest) {
        throw new Error(
          `${command} found no merge request !${ref.iid} in ${ref.project}: it does not exist, or the account ${command} is signed in with cannot see it`,
        )
      }
      return viewOf(mergeRequest)
    },

    async readDiff({ cwd, url }) {
      const ref = refOf(url)
      // `--raw` is GitLab's own patch of the whole merge request, `diff --git` headers and all,
      // rather than glab's per-file rendering of it.
      return glab(['mr', 'diff', String(ref.iid), '--raw', '--color=never', '-R', ref.projectUrl], cwd)
    },

    async comment({ cwd, url, body }) {
      const ref = refOf(url)
      // Not a thread: a thread is resolvable, and a project that requires every thread resolved
      // would refuse to merge until somebody resolved TinyCorp's own summary.
      await glab(
        ['mr', 'note', 'create', String(ref.iid), '-R', ref.projectUrl, '--resolvable=false', `--message=${body}`],
        cwd,
      )
    },

    async commentOnLine({ cwd, url, path, line, body }) {
      const ref = refOf(url)
      // A diff note on the new side of the latest version of the merge request's diff; glab reads
      // the version's commits itself.
      const stdout = await glab(
        [
          'mr',
          'note',
          'create',
          String(ref.iid),
          '-R',
          ref.projectUrl,
          '--file',
          path,
          '--line',
          String(line),
          `--message=${body}`,
        ],
        cwd,
      )
      return lastUrl(stdout)
    },

    /**
     * GitLab has no single "review" object the way GitHub does: a round is the summary note plus
     * one **discussion** per thread, each pinned to a position in the merge request's latest diff
     * version. So the round goes up as one burst of calls rather than one call, and what the boss
     * opens is a merge request with the reviewer's note at the top and a resolvable thread on each
     * line it named — which is what "one review" means here.
     *
     * The position needs the version's three SHAs, so they are read once for the whole round.
     */
    async postReview({ cwd, url, summary, verdict, threads }) {
      const ref = refOf(url)
      const said = summary.trim()
      if (said) {
        await glab(
          [
            'mr',
            'note',
            'create',
            String(ref.iid),
            '-R',
            ref.projectUrl,
            '--resolvable=false',
            `--message=${VERDICT_LEAD[verdict]}${said}`,
          ],
          cwd,
        )
      }
      if (threads.length === 0) return { url: null, threads: [] }
      const versions = parse<ApiVersion[]>(
        await glab(['api', `${projectApi(ref)}/versions`], cwd),
        'the merge request’s diff versions',
      )
      const version = versions[0]
      if (!version) throw new Error(`${command} found no diff version of merge request !${ref.iid} to comment on`)
      const opened: ForgeThread[] = []
      for (const thread of threads) {
        const discussion = parse<ApiDiscussion>(
          await glab(
            [
              'api',
              '--method',
              'POST',
              `${projectApi(ref)}/discussions`,
              '--raw-field',
              `body=${thread.body}`,
              '--raw-field',
              `position[position_type]=text`,
              '--raw-field',
              `position[base_sha]=${version.base_commit_sha}`,
              '--raw-field',
              `position[start_sha]=${version.start_commit_sha}`,
              '--raw-field',
              `position[head_sha]=${version.head_commit_sha}`,
              '--raw-field',
              `position[new_path]=${thread.path}`,
              '--raw-field',
              `position[new_line]=${thread.line}`,
            ],
            cwd,
          ),
          `the discussion on ${thread.path}:${thread.line}`,
        )
        const note = discussion.notes?.[0]?.id
        opened.push({ id: discussion.id, url: note === undefined ? null : `${url}#note_${note}` })
      }
      return { url: null, threads: opened }
    },

    async replyToThread({ cwd, url, threadId, body }) {
      const ref = refOf(url)
      const note = parse<{ id?: number }>(
        await glab(
          [
            'api',
            '--method',
            'POST',
            `${projectApi(ref)}/discussions/${threadId}/notes`,
            '--raw-field',
            `body=${body}`,
          ],
          cwd,
        ),
        'the reply it posted',
      )
      return note.id === undefined ? null : `${url}#note_${note.id}`
    },

    async resolveThread({ cwd, url, threadId }) {
      const ref = refOf(url)
      const args = [
        'api',
        '--method',
        'PUT',
        `${projectApi(ref)}/discussions/${threadId}`,
        '--raw-field',
        'resolved=true',
      ]
      const result = await run(command, args, { cwd })
      if (result.code === 0) return
      // A thread the boss resolved on the web while TinyCorp was asking is resolved, not failed.
      const now = await run(command, ['api', `${projectApi(ref)}/discussions/${threadId}`], { cwd })
      if (now.code === 0 && tryParse<ApiDiscussion>(now.stdout)?.notes?.[0]?.resolved === true) return
      throw glabFailure(command, args, result)
    },

    async merge({ cwd, url }) {
      const ref = refOf(url)
      // The API rather than `glab mr merge`: that command turns on auto-merge whenever a pipeline
      // is running, and answers success for a merge request that is then still open. By the time
      // this is called the merge gate has already said yes; this merges now, or fails.
      const args = ['api', '--method', 'PUT', `${projectApi(ref)}/merge`, '--field', 'squash=true']
      const result = await run(command, args, { cwd })
      if (result.code === 0) return
      // Merged on the web while TinyCorp was asking, or asked twice: GitLab refuses to merge a
      // merged merge request, so ask it what the merge request is before calling this a failure.
      const now = await run(command, ['api', projectApi(ref)], { cwd })
      if (now.code === 0 && tryParse<ApiMergeRequest>(now.stdout)?.state === 'merged') return
      throw glabFailure(command, args, result)
    },

    installed,

    checkCli() {
      return checkForgeCli({ name, command, signIn: GLAB_SIGN_IN, installed, runForge: run, cwd: appCwd })
    },
  }
}

/**
 * GitLab's merge requests have an approval of their own, which a project may or may not have
 * turned on and which TinyCorp is not the one to spend. So the verdict of a round is said in the
 * summary note, in one line above it, and nothing is approved on the reviewer's behalf.
 */
const VERDICT_LEAD: Record<ReviewVerdictOnForge, string> = {
  approve: '**Approved.**\n\n',
  changes: '**Changes requested.**\n\n',
  comment: '',
}

/** A merge request as GitLab's REST API answers one. Only the fields the adapter reads. */
interface ApiMergeRequest {
  iid: number
  web_url: string
  state?: string
}

/** One version of a merge request's diff: the three SHAs a diff note's position is pinned to. */
interface ApiVersion {
  base_commit_sha: string
  start_commit_sha: string
  head_commit_sha: string
}

/** A discussion — GitLab's word for a review thread — and the notes in it. */
interface ApiDiscussion {
  id: string
  notes?: { id: number; resolved?: boolean }[]
}

function pullRequestOf(mergeRequest: ApiMergeRequest): ForgePullRequest {
  return { url: mergeRequest.web_url, number: typeof mergeRequest.iid === 'number' ? mergeRequest.iid : null }
}

/** What the read's query answers. */
interface GraphqlAnswer {
  data?: { project?: { mergeRequest?: GraphqlMergeRequest | null } | null } | null
  errors?: { message: string }[]
}

export interface GraphqlMergeRequest {
  title: string
  /** `opened`, `closed`, `locked` or `merged`. */
  state: string
  sourceBranch: string
  targetBranch: string
  conflicts: boolean | null
  /** `MERGEABLE`, `CONFLICT`, `CHECKING`, `NOT_APPROVED`, `CI_MUST_PASS`, … */
  detailedMergeStatus: string | null
  diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
  headPipeline: { jobs: { nodes: GraphqlJob[] } | null } | null
}

export interface GraphqlJob {
  name: string
  /** `SUCCESS`, `FAILED`, `RUNNING`, `MANUAL`, `SKIPPED`, … */
  status: string
  allowFailure: boolean
  /** Seconds, once it has run. */
  duration: number | null
  stage: { name: string } | null
}

/** A merge request, in the contract's words. */
export function viewOf(mergeRequest: GraphqlMergeRequest): PullRequestView {
  return {
    title: mergeRequest.title,
    state: stateOf(mergeRequest.state),
    head: mergeRequest.sourceBranch,
    base: mergeRequest.targetBranch,
    additions: mergeRequest.diffStatsSummary?.additions ?? 0,
    deletions: mergeRequest.diffStatsSummary?.deletions ?? 0,
    changedFiles: mergeRequest.diffStatsSummary?.fileCount ?? 0,
    mergeable: mergeabilityOf(mergeRequest),
    checks: (mergeRequest.headPipeline?.jobs?.nodes ?? []).map(checkOf),
  }
}

function stateOf(state: string): PullRequestView['state'] {
  if (state === 'merged') return 'merged'
  if (state === 'closed') return 'closed'
  // `locked` is a merge request GitLab is merging right now: still open until it says merged.
  return 'open'
}

/** Still being worked out by GitLab: nothing to say yet about whether it merges cleanly. */
const STILL_CHECKING = new Set(['CHECKING', 'UNCHECKED', 'PREPARING', 'APPROVALS_SYNCING', 'NOT_OPEN'])

/**
 * Whether the merge request merges cleanly — the contract's question, which is about conflicts.
 * GitLab's detailed merge status also carries its own policy (not approved, a draft, a pipeline
 * that must pass, threads to resolve); those are not conflicts, and whether TinyCorp may merge is
 * the merge gate's question, asked from the checks. GitLab says them again, in its own words, if
 * a merge is tried anyway.
 */
function mergeabilityOf({ conflicts, detailedMergeStatus }: GraphqlMergeRequest): Mergeability {
  if (conflicts || detailedMergeStatus === 'CONFLICT') return 'conflicting'
  if (!detailedMergeStatus || STILL_CHECKING.has(detailedMergeStatus)) return 'unknown'
  return 'mergeable'
}

/** A pipeline job, as a check: the stage it runs in stands where a workflow would. */
function checkOf(job: GraphqlJob): PullRequestCheck {
  const state = jobState(job)
  return {
    name: job.name,
    workflow: job.stage?.name ?? '',
    state,
    durationMs: state === 'pending' || job.duration === null ? null : Math.round(job.duration * 1000),
  }
}

function jobState({ status, allowFailure }: GraphqlJob): PullRequestCheckState {
  switch (status) {
    case 'SUCCESS':
      return 'passing'
    // A job that is allowed to fail does not fail the pipeline: GitLab draws it as a warning.
    case 'FAILED':
      return allowFailure ? 'skipped' : 'failing'
    case 'CANCELED':
    case 'CANCELING':
      return 'failing'
    case 'SKIPPED':
      return 'skipped'
    // A manual job nobody has to run is not waited on; one the pipeline is blocked on is.
    case 'MANUAL':
      return allowFailure ? 'skipped' : 'pending'
    default:
      return 'pending'
  }
}

/** The last URL `glab` printed, which is where the note it created lives. */
function lastUrl(stdout: string): string | null {
  const urls = stdout.match(/https?:\/\/\S+/g)
  return urls ? urls[urls.length - 1]! : null
}

function parse<T>(stdout: string, what: string): T {
  const parsed = tryParse<T>(stdout)
  if (parsed === null)
    throw new Error(`glab answered something that is not JSON for ${what}: ${stdout.trim().slice(0, 200)}`)
  return parsed
}

function tryParse<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout) as T
  } catch {
    return null
  }
}

/**
 * `glab`'s own words for a failure, without the frame it draws around them for a terminal. `glab
 * api` prints GitLab's answer on stdout (`{"message":["Another open merge request already
 * exists…"]}`) and its own summary on stderr (`glab: 409 Conflict (HTTP 409)`); GitLab's is the
 * sentence the boss can act on, so it goes first.
 */
export function glabFailure(command: string, args: readonly string[], result: ForgeCliResult): Error {
  if (result.code === null) return forgeFailure(command, args, result)
  const said = [messageOf(result.stdout), plain(result.stderr)].filter(Boolean).join(' — ')
  return forgeFailure(command, args, { ...result, stderr: said, stdout: '' })
}

/** GitLab's `message` or `error`, when stdout is one of its JSON answers. */
function messageOf(stdout: string): string {
  const answer = tryParse<{ message?: unknown; error?: unknown }>(stdout)
  const said = answer?.message ?? answer?.error
  if (said === undefined || said === null) return ''
  if (typeof said === 'string') return said
  if (Array.isArray(said)) return said.join('; ')
  return Object.entries(said as Record<string, unknown>)
    .map(([field, words]) => `${field} ${Array.isArray(words) ? words.join(', ') : String(words)}`)
    .join('; ')
}

/** stderr as one line: no `ERROR` banner, no padding, no blank lines. */
function plain(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'ERROR')
    .join(' ')
}
