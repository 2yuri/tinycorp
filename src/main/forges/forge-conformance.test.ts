import { describe, expect, it } from 'vitest'
import type { ForgeAdapter } from '../../shared/forges/adapter'
import {
  FORGE_CONFORMANCE_CHECKS,
  type ForgeConformanceSetup,
  type ForgeContractPart,
  runForgeConformance,
} from './forge-conformance'
import { createGithubAdapter } from './github/adapter'
import { fakeGh } from './github/fake-gh'

/**
 * The suite's own test: proof that it bites.
 *
 * A conformance suite nobody has watched fail is a suite that might be asserting nothing, and the
 * second forge would discover that the expensive way. So this drives it over adapters that are
 * broken on purpose — each one in a way a real adapter could plausibly be broken — and checks that
 * the right part of the contract is the part that fails, with a sentence a stranger can act on.
 */

/** The GitHub adapter, with one method replaced by a plausible mistake. */
function broken(over: (adapter: ForgeAdapter, setup: ForgeConformanceSetup) => Partial<ForgeAdapter>) {
  return {
    forge: 'github',
    label: 'a broken adapter',
    command: 'gh',
    create: (setup: ForgeConformanceSetup) => {
      const real = createGithubAdapter(setup)
      return { ...real, ...over(real, setup) }
    },
    cli: fakeGh,
  }
}

/** Which parts of the contract failed, without repeats. */
async function failing(spec: ReturnType<typeof broken>): Promise<ForgeContractPart[]> {
  const failures = await runForgeConformance(spec)
  return [...new Set(failures.map((failure) => failure.contract))]
}

describe('The forge conformance suite', () => {
  it('passes a finished adapter', async () => {
    const failures = await runForgeConformance({
      forge: 'github',
      command: 'gh',
      create: createGithubAdapter,
      cli: fakeGh,
    })

    expect(failures).toEqual([])
  })

  it('catches an adapter that opens a second PR for a branch that already has one', async () => {
    const spec = broken((real) => ({
      // The mistake: treat "already exists" as any other failure, and open another one.
      openPullRequest: (request) =>
        real.openPullRequest({ ...request, branch: `${request.branch}-again` }).catch(() => ({
          url: 'https://forge.example/acme/app/pull/1',
          number: 1,
        })),
    }))

    expect(await failing(spec)).toContain('open')
  })

  it('catches an adapter that cannot find the PR a branch already has', async () => {
    const spec = broken(() => ({ findPullRequest: () => Promise.resolve(null) }))

    expect(await failing(spec)).toContain('find')
  })

  it('catches an adapter that trims or truncates the patch', async () => {
    const spec = broken((real) => ({
      readDiff: (request) => real.readDiff(request).then((patch) => patch.trim()),
    }))

    const failures = await runForgeConformance(spec)

    expect(failures.map((failure) => failure.contract)).toContain('diff')
    expect(failures.find((failure) => failure.contract === 'diff')?.message).toMatch(/hand it back untouched/)
  })

  it('catches an adapter that swallows a comment', async () => {
    const spec = broken(() => ({ comment: () => Promise.resolve() }))

    expect(await failing(spec)).toContain('comment')
  })

  it('catches an adapter that fails a PR somebody already merged', async () => {
    const spec = broken((real, setup) => ({
      // The mistake: any non-zero exit is a failure, including "was already merged".
      merge: async (request) => {
        const result = await setup.runForge(setup.command, ['pr', 'merge', request.url, '--squash'], {
          cwd: request.cwd,
        })
        if (result.code !== 0) throw new Error(result.stderr)
        await real.merge({ ...request, url: 'https://forge.example/nowhere/pull/0' }).catch(() => {})
      },
    }))

    expect(await failing(spec)).toContain('merge')
  })

  it('catches an adapter that puts a credential on the command line', async () => {
    const spec = broken((real, setup) => ({
      openPullRequest: async (request) => {
        await setup.runForge(setup.command, ['auth', 'token=hunter2-super-secret'], { cwd: request.cwd })
        return real.openPullRequest(request)
      },
    }))

    const failures = await runForgeConformance(spec)

    expect(failures.map((failure) => failure.contract)).toContain('auth')
    expect(failures.find((failure) => failure.contract === 'auth')?.message).toMatch(/never holds a forge token/)
  })

  it('catches an adapter that hands its CLI a credential through the environment', async () => {
    const spec = broken((real, setup) => ({
      findPullRequest: async (request) => {
        await setup.runForge(setup.command, ['pr', 'list'], { cwd: request.cwd, env: { GH_TOKEN: 'hunter2' } })
        return real.findPullRequest(request)
      },
    }))

    const failures = await runForgeConformance(spec)

    expect(failures.find((failure) => failure.contract === 'auth')?.message).toMatch(/in the environment/)
  })

  it('catches an adapter that says it is ready when its CLI is not even installed', async () => {
    const spec = broken(() => ({
      checkCli: () =>
        Promise.resolve({
          state: 'ready' as const,
          title: 'All good',
          body: '',
          lead: '',
          commands: [],
          note: '',
          account: null,
          plan: null,
        }),
    }))

    expect(await failing(spec)).toContain('preflight')
  })

  it('catches an adapter that makes every new repository public', async () => {
    const spec = broken((real) => ({
      createRemote: (request) => real.createRemote!({ ...request, visibility: 'public' }),
    }))

    expect(await failing(spec)).toEqual(['remote'])
  })

  it('catches an adapter that adds origin and pushes itself', async () => {
    const spec = broken((real, setup) => ({
      createRemote: async (request) => {
        const remote = await real.createRemote!(request)
        await setup.runForge('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: request.cwd })
        return remote
      },
    }))

    expect(await failing(spec)).toEqual(['remote'])
  })

  it('catches an adapter that ignores the protocol the boss clones with', async () => {
    const spec = broken((real) => ({
      createRemote: async (request) => {
        const remote = await real.createRemote!(request)
        return { ...remote, cloneUrl: `${remote.webUrl}.git` }
      },
    }))

    expect(await failing(spec)).toEqual(['remote'])
  })

  it('passes an adapter that cannot create a remote at all: the method is optional', async () => {
    const spec = {
      ...broken(() => ({})),
      // Not `createRemote: undefined`: an adapter that cannot create a remote has no such method.
      create: (setup: ForgeConformanceSetup) => {
        const { createRemote: _cannot, ...rest } = createGithubAdapter(setup)
        return rest
      },
    }

    expect(await failing(spec)).toEqual([])
  })

  it('names the part of the guide every check belongs to, and asks one thing each', () => {
    for (const check of FORGE_CONFORMANCE_CHECKS) {
      expect(check.contract).toMatch(/^(open|find|read|diff|comment|review|merge|remote|auth|install|preflight)$/)
      expect(check.title.length).toBeGreaterThan(20)
    }
    expect(FORGE_CONFORMANCE_CHECKS.length).toBeGreaterThan(10)
  })
})
