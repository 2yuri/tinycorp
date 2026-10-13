import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { repoChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { FoundReposEvent } from '../../../shared/repos/found-repos'
import type { AttachScannedResult, NearbyRepos, Repo, RepoInspection } from '../../../shared/repos/repo'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { type RepoIpcOptions, registerRepoIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const stack = readyStack()

const inspection: RepoInspection = {
  path: onDisk('/code/web'),
  isGitRepo: true,
  remote: 'github.com/acme/web',
  defaultBranch: 'main',
  commitCount: 12,
  lastCommitAt: '2026-09-17T08:00:00Z',
  detected: { packageManager: 'pnpm' },
}

function setup({ withCompany = true, ...options }: { withCompany?: boolean } & Partial<RepoIpcOptions> = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: (path) => path.startsWith(onDisk('/code') + sep),
  })
  engines.push(engine)
  if (withCompany) engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  let changes = 0
  registerRepoIpc({
    ipc,
    engine,
    pickFolder: async () => onDisk('/code/picked'),
    inspect: (path) => ({ ...inspection, path }),
    home: onDisk('/work'),
    broadcastChanged: () => changes++,
    ...options,
  })
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler(...args)
  }
  return { invoke, changes: () => changes }
}

function valueOfResult<T>(result: unknown): T {
  const r = result as Result<T>
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('Repo IPC', () => {
  it('adds, lists, updates and removes repos', async () => {
    const { invoke } = setup()

    const web = valueOfResult<Repo>(
      await invoke(repoChannels.add, { path: onDisk('/code/web'), brief: 'Storefront', stack }),
    )
    expect(web.brief).toBe('Storefront')
    const api = valueOfResult<Repo>(await invoke(repoChannels.add, { path: onDisk('/code/api'), stack }))
    expect(valueOfResult<Repo[]>(await invoke(repoChannels.list))).toEqual([web, api])

    const updated = await invoke(repoChannels.update, web.id, {
      name: 'frontend',
      brief: 'Storefront in Vue',
      stack: { framework: 'Vue' },
    })
    expect(updated).toMatchObject({
      ok: true,
      value: { name: 'frontend', brief: 'Storefront in Vue', stack: { ...stack, framework: 'Vue' } },
    })

    expect(await invoke(repoChannels.remove, api.id)).toEqual({ ok: true, value: null })
    expect(valueOfResult<Repo[]>(await invoke(repoChannels.list))).toEqual([
      expect.objectContaining({ name: 'frontend' }),
    ])
  })

  it('carries the rung from the renderer, both when attaching and when changing it', async () => {
    const { invoke } = setup()

    const web = valueOfResult<Repo>(await invoke(repoChannels.add, { path: onDisk('/code/web'), stack, rung: 'pr' }))
    const api = valueOfResult<Repo>(await invoke(repoChannels.add, { path: onDisk('/code/api'), stack }))
    const locked = await invoke(repoChannels.update, api.id, { rung: 'local' })

    expect(web.rung).toBe('pr')
    expect(api.rung).toBe('merge')
    expect(locked).toMatchObject({ ok: true, value: { rung: 'local' } })
    expect(await invoke(repoChannels.update, api.id, { rung: 'push' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown repo rung/i),
    })
    expect(valueOfResult<Repo[]>(await invoke(repoChannels.list))[1]!.rung).toBe('local')
  })

  it('returns engine refusals as errors instead of throwing', async () => {
    const { invoke } = setup()

    expect(await invoke(repoChannels.add, { path: '/notes', stack })).toEqual({
      ok: false,
      error: expect.stringMatching(/not a git/i),
    })
    expect(await invoke(repoChannels.remove, 'nope')).toEqual({
      ok: false,
      error: expect.stringMatching(/unknown repo/i),
    })
  })

  it('reports that no Company is open', async () => {
    const { invoke } = setup({ withCompany: false })

    expect(await invoke(repoChannels.list)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company/i),
    })
  })

  it('rejects malformed input from the renderer', async () => {
    const { invoke } = setup()
    const web = valueOfResult<Repo>(await invoke(repoChannels.add, { path: onDisk('/code/web'), stack }))

    const malformed = [
      await invoke(repoChannels.add, null),
      await invoke(repoChannels.add, { path: 42, stack }),
      await invoke(repoChannels.add, { path: onDisk('/code/api'), brief: 7, stack }),
      await invoke(repoChannels.add, { path: onDisk('/code/api'), stack: 'pnpm' }),
      await invoke(repoChannels.add, { path: onDisk('/code/api'), name: 7, stack }),
      await invoke(repoChannels.add, { path: onDisk('/code/api'), stack: { ...stack, language: 1 } }),
      await invoke(repoChannels.update, undefined, { name: 'x' }),
      await invoke(repoChannels.update, web.id, 'x'),
      await invoke(repoChannels.update, web.id, { stack: { framework: null } }),
      await invoke(repoChannels.remove, 3),
    ]

    for (const result of malformed) expect(result).toMatchObject({ ok: false })
    expect(valueOfResult<Repo[]>(await invoke(repoChannels.list))).toEqual([web])
  })

  it('adds a repo without a stack, and a partial one', async () => {
    const { invoke } = setup()

    const bare = valueOfResult<Repo>(await invoke(repoChannels.add, { path: onDisk('/code/web') }))
    const partial = valueOfResult<Repo>(
      await invoke(repoChannels.add, {
        path: onDisk('/code/api'),
        stack: { packageManager: 'pnpm', lint: 'eslint .' },
      }),
    )

    expect(bare.stack.install).toBe('')
    expect(partial.stack).toMatchObject({ packageManager: 'pnpm', lint: 'eslint .', test: '' })
  })

  it('tells windows when repos change, and only then', async () => {
    const { invoke, changes } = setup()

    const web = valueOfResult<Repo>(await invoke(repoChannels.add, { path: onDisk('/code/web'), stack }))
    await invoke(repoChannels.update, web.id, { stack: { lint: 'biome check .' } })
    await invoke(repoChannels.add, { path: '/notes' })
    await invoke(repoChannels.list)
    await invoke(repoChannels.remove, web.id)

    expect(changes()).toBe(3)
  })

  it('inspects a folder, and answers nothing known for a blank path', async () => {
    const { invoke } = setup()

    expect(await invoke(repoChannels.inspect, onDisk('/code/web'))).toEqual(inspection)
    expect(await invoke(repoChannels.inspect, 42)).toMatchObject({ isGitRepo: false, remote: null, detected: {} })
  })

  it('says where each repo’s worktrees go, under the Company folder', async () => {
    const { invoke } = setup()
    const web = valueOfResult<Repo>(
      await invoke(repoChannels.add, { path: onDisk('/code/web'), name: 'Web App', stack }),
    )

    expect(await invoke(repoChannels.worktreeRoots)).toEqual({
      ok: true,
      value: { [web.id]: join('~', 'acme', 'worktrees', 'web-app') },
    })
  })

  it('hands back the folder the user picked', async () => {
    const { invoke } = setup()

    expect(await invoke(repoChannels.pickFolder)).toBe(onDisk('/code/picked'))
  })

  it('hands back the folder picked for a scan', async () => {
    const { invoke } = setup({ pickScanFolder: async () => onDisk('/code') })

    expect(await invoke(repoChannels.pickScanFolder)).toBe(onDisk('/code'))
  })
})

describe('Repo IPC: Scan a folder', () => {
  /** `${onDisk('/code')}` holds `web` and `clients/billing` (checkouts) and `notes` (a plain folder). */
  const disk: Record<string, string[]> = {
    [onDisk('/code')]: ['web', 'clients', 'notes'],
    [onDisk('/code/clients')]: ['billing'],
  }
  const checkouts: Record<string, Partial<RepoInspection>> = {
    [onDisk('/code/web')]: { remote: 'github.com/acme/web', detected: stack },
    [onDisk('/code/clients/billing')]: {
      remote: 'github.com/acme/billing',
      detected: { language: 'Go', packageManager: 'go modules' },
    },
  }
  const scanSetup = () =>
    setup({
      folders: (path) => disk[path] ?? [],
      inspect: (path) => ({ ...inspection, path, isGitRepo: path in checkouts, detected: {}, ...checkouts[path] }),
    })

  it('lists the checkouts under a folder with their remote and detected stack', async () => {
    const { invoke, changes } = scanSetup()

    const found = valueOfResult<RepoInspection[]>(await invoke(repoChannels.scan, onDisk('/code')))

    expect(found.map((repo) => [repo.path, repo.remote, repo.detected.packageManager])).toEqual([
      [onDisk('/code/clients/billing'), 'github.com/acme/billing', 'go modules'],
      [onDisk('/code/web'), 'github.com/acme/web', 'pnpm'],
    ])
    expect(changes()).toBe(0)
  })

  it('attaches the selected checkouts at once with their briefs, with or without detected checks', async () => {
    const { invoke, changes } = scanSetup()

    const result = valueOfResult<AttachScannedResult>(
      await invoke(repoChannels.attachScanned, [onDisk('/code/web'), onDisk('/code/clients/billing')], {
        [onDisk('/code/clients/billing')]: 'Billing service in Go',
      }),
    )

    expect(result.failed).toEqual([])
    const repos = valueOfResult<Repo[]>(await invoke(repoChannels.list))
    expect(result.attached).toEqual(repos)
    expect(repos.map((repo) => [repo.name, repo.brief])).toEqual([
      ['web', ''],
      ['billing', 'Billing service in Go'],
    ])
    expect(repos[0]!.stack).toEqual(stack)
    expect(repos[1]!.stack).toMatchObject({ language: 'Go', packageManager: 'go modules', install: '', lint: '' })
    expect(changes()).toBe(1)
  })

  it('reports the checkouts it could not attach and refuses malformed input', async () => {
    const { invoke } = scanSetup()
    await invoke(repoChannels.attachScanned, [onDisk('/code/web')])

    const again = valueOfResult<AttachScannedResult>(
      await invoke(repoChannels.attachScanned, [onDisk('/code/web'), onDisk('/code/clients/billing')]),
    )
    expect(again.attached.map((repo) => repo.name)).toEqual(['billing'])
    expect(again.failed).toEqual([{ path: onDisk('/code/web'), error: `${onDisk('/code/web')} is already attached` }])

    for (const bad of [undefined, [], [onDisk('/code/web'), 3], onDisk('/code/web')]) {
      expect(await invoke(repoChannels.attachScanned, bad)).toMatchObject({ ok: false })
    }
    expect(await invoke(repoChannels.attachScanned, [onDisk('/code/x')], { [onDisk('/code/x')]: 5 })).toMatchObject({
      ok: false,
    })
    expect(await invoke(repoChannels.scan, 42)).toMatchObject({ ok: false })
    expect(await invoke(repoChannels.scan, 'code')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/absolute/),
    })
  })
})

describe('Repo IPC: repos near the first one', () => {
  const disk: Record<string, string[]> = {
    [onDisk('/code')]: ['web', 'api', 'notes'],
    [onDisk('/work/acme')]: ['site'],
  }
  const checkouts = new Set([onDisk('/code/web'), onDisk('/code/api'), onDisk('/work/acme/site')])
  const nearbySetup = (withCompany = true) =>
    setup({
      withCompany,
      folders: (path) => disk[path] ?? [],
      inspect: (path) => ({ ...inspection, path, isGitRepo: checkouts.has(path) }),
    })

  it('lists the unconnected checkouts beside the first repo, or in the Company folder before any', async () => {
    const { invoke, changes } = nearbySetup()

    const before = valueOfResult<NearbyRepos>(await invoke(repoChannels.nearby))
    expect(before.folder).toBe(onDisk('/work/acme'))
    expect(before.found.map((repo) => repo.path)).toEqual([onDisk('/work/acme/site')])

    valueOfResult(await invoke(repoChannels.add, { path: onDisk('/code/web'), stack }))
    const after = valueOfResult<NearbyRepos>(await invoke(repoChannels.nearby))
    expect(after).toMatchObject({
      folder: onDisk('/code'),
      found: [{ path: onDisk('/code/api'), defaultBranch: 'main' }],
    })
    expect(after.found).toHaveLength(1)
    expect(changes()).toBe(1)
  })

  it('fails without an open Company', async () => {
    const { invoke } = nearbySetup(false)

    expect(await invoke(repoChannels.nearby)).toMatchObject({ ok: false })
  })
})

describe('Finding the repos inside a folder', () => {
  /** A folder tree in memory: which folders hold which entries, and which of those are checkouts. */
  function fakeWalk(tree: Record<string, string[]>, repos: string[] = []) {
    return {
      entries: (path: string) =>
        Promise.resolve([
          ...(repos.includes(path) ? [{ name: '.git', folder: true, symlink: false }] : []),
          ...(tree[path] ?? []).map((name) => ({ name, folder: true, symlink: false })),
        ]),
      readGitFile: () => Promise.resolve(null),
      now: () => Date.now(),
    }
  }

  const settled = async (events: FoundReposEvent[]) => {
    for (let tries = 0; tries < 200 && !events.at(-1)?.walk && !events.at(-1)?.error; tries++) {
      await new Promise((done) => setTimeout(done, 5))
    }
    return events.at(-1)!
  }

  it('streams what it finds and ends with the whole walk', async () => {
    const events: FoundReposEvent[] = []
    const { invoke } = setup({
      walkDeps: fakeWalk({ [onDisk('/code')]: ['acme', 'notes'], [onDisk('/code/acme')]: ['web', 'api'] }, [
        onDisk('/code/acme/web'),
        onDisk('/code/acme/api'),
      ]),
      broadcastFound: (event) => events.push(event),
    })

    const scan = 'walk-1'
    valueOfResult(await invoke(repoChannels.findRepos, onDisk('/code'), scan))
    const last = await settled(events)

    expect(events.every((event) => event.scan === scan)).toBe(true)
    expect(last.walk).toMatchObject({ folder: onDisk('/code'), stopped: 'done', emptyFolders: 1 })
    expect(last.walk!.found.map((one) => one.relative)).toEqual(['acme/web', 'acme/api'])
    expect(events.flatMap((event) => event.found.map((one) => one.relative))).toEqual(['acme/web', 'acme/api'])
  })

  it('stops a walk that is asked to stop', async () => {
    const events: FoundReposEvent[] = []
    // A folder that always holds one more folder: without Stop this walk runs to its depth.
    const endless = {
      entries: (path: string) =>
        Promise.resolve([
          { name: '.git', folder: true, symlink: false },
          { name: `in${path.length}`, folder: true, symlink: false },
        ]),
      readGitFile: () => Promise.resolve(null),
      now: () => Date.now(),
    }
    const { invoke } = setup({ walkDeps: endless, broadcastFound: (event) => events.push(event) })

    const scan = 'walk-2'
    valueOfResult(await invoke(repoChannels.findRepos, onDisk('/code'), scan))
    await invoke(repoChannels.stopFinding, scan)
    const last = await settled(events)

    expect(last.walk).toMatchObject({ stopped: 'cancelled' })
    expect(last.walk!.found.length).toBeLessThan(6)
  })

  it('refuses a folder it was not given', async () => {
    const { invoke } = setup()

    expect(await invoke(repoChannels.findRepos, '', 'walk-3')).toMatchObject({ ok: false })
    expect(await invoke(repoChannels.findRepos, onDisk('/code'), '')).toMatchObject({ ok: false })
  })

  it('reads several checkouts at once and ignores what is not a path', async () => {
    const { invoke } = setup()

    const read = await invoke(repoChannels.inspectMany, [onDisk('/code/web'), onDisk('/code/api'), '', 7])

    expect(Object.keys(read as object)).toEqual([onDisk('/code/web'), onDisk('/code/api')])
  })
})
