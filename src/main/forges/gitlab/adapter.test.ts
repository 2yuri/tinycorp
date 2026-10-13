import { describe, expect, it } from 'vitest'
import { forgeEntry, forgeOf } from '../../../shared/forges'
import type { ForgeCliResult, RunForge, RunForgeOptions } from '../../../shared/forges/adapter'
import { onDisk } from '../../core/testing'
import { CONFORMANCE_VIEW, describeForgeConformance, openForgeConformance } from '../forge-conformance'
import { createGitlabAdapter, GLAB_ENV, type GraphqlMergeRequest, mergeRequestOf, viewOf } from './adapter'
import { fakeGlab, fakeMergeRequestUrl } from './fake-glab'

const entry = forgeEntry('gitlab')

describeForgeConformance({
  forge: entry.id,
  label: entry.name,
  command: entry.command,
  url: fakeMergeRequestUrl,
  // GitLab has no review object: a round is the summary note above its discussions.
  reviewSummaries: (mergeRequest) => mergeRequest.comments,
  create: createGitlabAdapter,
  cli: fakeGlab,
})

/** The adapter over one scripted answer, recording what it ran. */
function scripted(answer: (args: readonly string[]) => ForgeCliResult) {
  const calls: { args: readonly string[]; options: RunForgeOptions }[] = []
  const runForge: RunForge = (_command, args, options) => {
    calls.push({ args, options })
    return Promise.resolve(answer(args))
  }
  const adapter = createGitlabAdapter({ command: 'glab', name: 'GitLab', cwd: '/app', runForge, installed: () => true })
  return { adapter, calls }
}

const MR = 'https://gitlab.acme.com/team/platform/api/-/merge_requests/7'

describe('The GitLab adapter', () => {
  it('reads the project and number out of a merge request URL, subgroups and all', () => {
    expect(mergeRequestOf(MR)).toEqual({
      projectUrl: 'https://gitlab.acme.com/team/platform/api',
      project: 'team/platform/api',
      iid: 7,
    })
    expect(mergeRequestOf(`${MR}#note_12`)?.iid).toBe(7)
    expect(mergeRequestOf('https://github.com/acme/app/pull/7')).toBeNull()
  })

  it('turns off glab’s usage events and update check on every command, and passes no credential', async () => {
    const { adapter, calls } = scripted(() => ({ code: 0, stdout: '[]', stderr: '' }))

    await adapter.findPullRequest({ cwd: onDisk('/repo'), branch: 'ticket-1' })
    await adapter.checkCli()

    expect(calls).toHaveLength(2)
    for (const { options } of calls) {
      expect(options.env).toMatchObject({ GLAB_SEND_TELEMETRY: 'false', GLAB_CHECK_UPDATE: 'false' })
      expect(Object.keys(options.env ?? {}).filter((name) => /TOKEN|PASSWORD|SECRET/i.test(name))).toEqual([])
    }
    expect(Object.keys(GLAB_ENV).sort()).toEqual([
      'GLAB_CHECK_UPDATE',
      'GLAB_NO_PROMPT',
      'GLAB_SEND_TELEMETRY',
      'NO_COLOR',
    ])
  })

  it('merges now or fails, and never leaves auto-merge set on a merge request that is still open', async () => {
    const { adapter, calls } = scripted(() => ({ code: 0, stdout: '{"state":"merged"}', stderr: '' }))

    await adapter.merge({ cwd: onDisk('/repo'), url: MR })

    expect(calls.map((call) => call.args)).toEqual([
      ['api', '--method', 'PUT', 'projects/team%2Fplatform%2Fapi/merge_requests/7/merge', '--field', 'squash=true'],
    ])
    expect(calls.flatMap((call) => call.args).join(' ')).not.toMatch(/auto.?merge|merge_when_pipeline_succeeds/)
  })

  it('fails a merge GitLab refuses with GitLab’s own sentence, not glab’s status line', async () => {
    const { adapter } = scripted((args) =>
      args[2] === 'PUT'
        ? { code: 1, stdout: '{"message":"Branch cannot be merged"}', stderr: 'glab: 406 Not Acceptable (HTTP 406)\n' }
        : { code: 0, stdout: '{"iid":7,"state":"opened"}', stderr: '' },
    )

    await expect(adapter.merge({ cwd: onDisk('/repo'), url: MR })).rejects.toThrow(
      'glab api failed: Branch cannot be merged — glab: 406 Not Acceptable (HTTP 406)',
    )
  })

  it('carries the words of a glab error without the banner it draws for a terminal', async () => {
    const { adapter } = scripted(() => ({
      code: 1,
      stdout: '',
      stderr: '          \n   ERROR  \n          \n  Could not obtain raw diff: 404 Not Found.  \n\n',
    }))

    await expect(adapter.readDiff({ cwd: onDisk('/repo'), url: MR })).rejects.toThrow(
      'glab mr failed: Could not obtain raw diff: 404 Not Found.',
    )
  })

  it('refuses a URL that is not a merge request, rather than acting on the wrong one', async () => {
    const { adapter, calls } = scripted(() => ({ code: 0, stdout: '', stderr: '' }))

    await expect(adapter.readDiff({ cwd: onDisk('/repo'), url: 'https://gitlab.acme.com/team/api' })).rejects.toThrow(
      /not a GitLab merge request/,
    )
    expect(calls).toEqual([])
  })

  it('names every instance glab is signed into, and on which host', async () => {
    const { adapter } = scripted(() => ({
      code: 0,
      stdout: '',
      stderr:
        'gitlab.com\n  ✓ Logged in to gitlab.com as ada (/x/config.yml)\n' +
        'gitlab.acme.com\n  ✓ Logged in to gitlab.acme.com as ada.lorne (/x/config.yml)\n',
    }))

    const check = await adapter.checkCli()

    expect(check.state).toBe('ready')
    expect(check.account).toBe('ada on gitlab.com, ada.lorne on gitlab.acme.com')
  })

  it('reads a still-running pipeline as pending, with no duration yet', async () => {
    const run = openForgeConformance({
      forge: 'gitlab',
      command: 'glab',
      url: fakeMergeRequestUrl,
      create: createGitlabAdapter,
      cli: fakeGlab,
    })
    try {
      const pr = run.givenPullRequest({
        view: {
          ...CONFORMANCE_VIEW,
          checks: [{ name: 'deploy', workflow: 'release', state: 'pending', durationMs: null }],
        },
      })

      const view = await run.adapter.readPullRequest({ cwd: run.cwd, url: pr.url })

      expect(view.checks).toEqual([{ name: 'deploy', workflow: 'release', state: 'pending', durationMs: null }])
    } finally {
      run.close()
    }
  })
})

describe('GitLab’s words, translated', () => {
  const mergeRequest = (over: Partial<GraphqlMergeRequest>): GraphqlMergeRequest => ({
    title: 'Pipelines',
    state: 'opened',
    sourceBranch: 'ticket-1',
    targetBranch: 'main',
    conflicts: false,
    detailedMergeStatus: 'MERGEABLE',
    diffStatsSummary: { additions: 3, deletions: 1, fileCount: 2 },
    headPipeline: null,
    ...over,
  })

  it('reads a merge request GitLab is merging right now as still open', () => {
    expect(viewOf(mergeRequest({ state: 'locked' })).state).toBe('open')
    expect(viewOf(mergeRequest({ state: 'merged' })).state).toBe('merged')
    expect(viewOf(mergeRequest({ state: 'closed' })).state).toBe('closed')
  })

  it('calls only a conflict conflicting: approvals, drafts and pipeline rules are the merge gate’s', () => {
    expect(viewOf(mergeRequest({ detailedMergeStatus: 'CONFLICT' })).mergeable).toBe('conflicting')
    expect(viewOf(mergeRequest({ conflicts: true, detailedMergeStatus: 'CHECKING' })).mergeable).toBe('conflicting')
    expect(viewOf(mergeRequest({ detailedMergeStatus: 'CHECKING' })).mergeable).toBe('unknown')
    expect(viewOf(mergeRequest({ detailedMergeStatus: null })).mergeable).toBe('unknown')
    expect(viewOf(mergeRequest({ detailedMergeStatus: 'NOT_APPROVED' })).mergeable).toBe('mergeable')
    expect(viewOf(mergeRequest({ detailedMergeStatus: 'DRAFT_STATUS' })).mergeable).toBe('mergeable')
  })

  it('reads a job allowed to fail as not failing the pipeline, and a cancelled one as failing it', () => {
    const job = (status: string, allowFailure = false) => ({
      name: status.toLowerCase(),
      status,
      allowFailure,
      duration: 12.4,
      stage: { name: 'test' },
    })
    const view = viewOf(
      mergeRequest({
        headPipeline: {
          jobs: {
            nodes: [
              job('SUCCESS'),
              job('FAILED'),
              job('FAILED', true),
              job('CANCELED'),
              job('MANUAL', true),
              job('MANUAL'),
              job('RUNNING'),
            ],
          },
        },
      }),
    )

    expect(view.checks.map((check) => [check.name, check.state, check.durationMs])).toEqual([
      ['success', 'passing', 12_400],
      ['failed', 'failing', 12_400],
      ['failed', 'skipped', 12_400],
      ['canceled', 'failing', 12_400],
      ['manual', 'skipped', 12_400],
      ['manual', 'pending', null],
      ['running', 'pending', null],
    ])
    expect(view.checks.every((check) => check.workflow === 'test')).toBe(true)
  })

  it('leaves a size GitLab does not report at zero rather than inventing one', () => {
    expect(viewOf(mergeRequest({ diffStatsSummary: null }))).toMatchObject({
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    })
  })
})

describe('A repo on GitLab', () => {
  it('is detected on gitlab.com, over https and ssh', () => {
    expect(forgeOf('https://gitlab.com/acme/app.git')).toBe('gitlab')
    expect(forgeOf('git@gitlab.com:acme/sub/app.git')).toBe('gitlab')
  })

  it('is detected on a self-hosted instance whose host says it is GitLab', () => {
    expect(forgeOf('https://gitlab.acme.com/team/app.git')).toBe('gitlab')
    expect(forgeOf('git@gitlab.acme.io:team/app.git')).toBe('gitlab')
    expect(forgeOf('ssh://git@gitlab.internal.acme.com:2222/team/app.git')).toBe('gitlab')
  })

  it('is not guessed from a host that does not say so, nor from a path on this Mac', () => {
    expect(forgeOf('https://git.acme.com/team/app.git')).toBeNull()
    expect(forgeOf('https://code.acme.com/gitlab/app.git')).toBeNull()
    expect(forgeOf(onDisk('/Users/boss/gitlab/app'))).toBeNull()
    expect(forgeOf('gitlab/app')).toBeNull()
  })
})
