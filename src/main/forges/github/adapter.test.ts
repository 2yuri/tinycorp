import { describe, expect, it } from 'vitest'
import { forgeEntry } from '../../../shared/forges'
import { describeForgeConformance, openForgeConformance } from '../forge-conformance'
import { createGithubAdapter, parsePullRequestView } from './adapter'
import { fakeGh } from './fake-gh'

const entry = forgeEntry('github')

describeForgeConformance({
  forge: entry.id,
  label: entry.name,
  command: entry.command,
  create: (setup) => createGithubAdapter(setup),
  cli: fakeGh,
})

/** What `gh` does that no other forge's CLI does, beside the suite. */
describe('The GitHub adapter', () => {
  const open = () => {
    const run = openForgeConformance({
      forge: entry.id,
      label: entry.name,
      command: entry.command,
      create: (setup) => createGithubAdapter(setup),
      cli: fakeGh,
    })
    return run
  }

  it('creates a repository with gh repo create and no --source, so gh neither adds origin nor pushes', async () => {
    const run = open()
    try {
      const remote = await run.adapter.createRemote!({ cwd: run.cwd, name: 'payments-web', visibility: 'private' })

      expect(run.calls.map((call) => call.args)).toEqual([
        ['repo', 'create', 'payments-web', '--private'],
        ['config', 'get', 'git_protocol'],
      ])
      expect(remote).toEqual({
        webUrl: 'https://forge.example/the-boss/payments-web',
        cloneUrl: 'https://forge.example/the-boss/payments-web.git',
      })
      run.world.cloneProtocol = 'ssh'
      const overSsh = await run.adapter.createRemote!({ cwd: run.cwd, name: 'api', visibility: 'private' })
      expect(overSsh.cloneUrl).toBe('git@forge.example:the-boss/api.git')
    } finally {
      run.close()
    }
  })

  it('asks gh for exactly the fields the review card draws', async () => {
    const run = open()
    try {
      const pr = run.givenPullRequest()

      await run.adapter.readPullRequest({ cwd: run.cwd, url: pr.url })

      expect(run.calls.at(-1)?.args).toEqual([
        'pr',
        'view',
        pr.url,
        '--json',
        'title,state,headRefName,baseRefName,additions,deletions,changedFiles,mergeable,statusCheckRollup',
      ])
    } finally {
      run.close()
    }
  })

  it('anchors a line comment to the PR’s head commit, through gh api', async () => {
    const run = open()
    try {
      const pr = run.givenPullRequest()

      const url = await run.adapter.commentOnLine({
        cwd: run.cwd,
        url: pr.url,
        path: 'currency.ts',
        line: 2,
        body: 'Worth a fallback here.',
      })

      expect(url).toBe(`${pr.url}#discussion_r1`)
      const [head, comment] = run.calls.slice(-2)
      expect(head?.args).toEqual(['pr', 'view', pr.url, '--json', 'headRefOid', '-q', '.headRefOid'])
      expect(comment?.args).toContain('repos/acme/app/pulls/42/comments')
      expect(comment?.args).toContain('commit_id=1a2b3c4d')
      expect(comment?.args).toContain('side=RIGHT')
      expect(comment?.args).toContain('line=2')
    } finally {
      run.close()
    }
  })

  it('refuses a URL that is not a pull request, rather than posting somewhere else', async () => {
    const run = open()
    try {
      await expect(
        run.adapter.commentOnLine({
          cwd: run.cwd,
          url: 'https://github.com/acme/app',
          path: 'a.ts',
          line: 1,
          body: 'x',
        }),
      ).rejects.toThrow(/not a pull request URL/)
    } finally {
      run.close()
    }
  })

  it('carries gh’s own words when a PR cannot be read', async () => {
    const run = open()
    try {
      await expect(
        run.adapter.readPullRequest({ cwd: run.cwd, url: 'https://forge.example/acme/app/pull/4040' }),
      ).rejects.toThrow(/could not resolve to a PullRequest/)
    } finally {
      run.close()
    }
  })

  it('reads gh’s check rollup: a cancelled run is failing, a neutral one is skipped', () => {
    expect(
      parsePullRequestView({
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'CheckRun', name: 'b', status: 'COMPLETED', conclusion: 'CANCELLED' },
          { __typename: 'CheckRun', name: 'c', status: 'COMPLETED', conclusion: 'NEUTRAL' },
          { __typename: 'CheckRun', name: 'd', status: 'QUEUED' },
          { __typename: 'StatusContext', context: 'e', state: 'SUCCESS' },
          { __typename: 'StatusContext', context: 'f', state: 'PENDING' },
        ],
      }).checks.map((check) => check.state),
    ).toEqual(['failing', 'failing', 'skipped', 'pending', 'passing', 'pending'])
  })

  it('maps merged and conflicting PRs, and tolerates missing fields', () => {
    expect(parsePullRequestView({ state: 'MERGED', mergeable: 'CONFLICTING' })).toEqual({
      title: '',
      state: 'merged',
      head: '',
      base: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: 'conflicting',
      checks: [],
    })
    expect(parsePullRequestView({ state: 'CLOSED', mergeable: 'UNKNOWN' })).toMatchObject({
      state: 'closed',
      mergeable: 'unknown',
    })
  })

  it('times a check from its own start and finish', () => {
    const [check] = parsePullRequestView({
      statusCheckRollup: [
        {
          __typename: 'CheckRun',
          name: 'build',
          workflowName: 'CI',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          startedAt: '2026-09-17T09:00:00Z',
          completedAt: '2026-09-17T09:00:28Z',
        },
      ],
    }).checks
    expect(check).toEqual({ name: 'build', workflow: 'CI', state: 'passing', durationMs: 28_000 })
  })

  it('reads the account gh says is logged in', async () => {
    const run = open()
    try {
      run.world.account = 'tinycorp-boss'

      const check = await run.adapter.checkCli()

      expect(check.state).toBe('ready')
      expect(check.account).toBe('tinycorp-boss')
    } finally {
      run.close()
    }
  })
})
