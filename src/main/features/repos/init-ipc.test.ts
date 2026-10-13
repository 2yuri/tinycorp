import { describe, expect, it } from 'vitest'
import { repoChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { RepoInspection } from '../../../shared/repos/repo'
import { createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type RepoIpcOptions, registerRepoIpc } from './ipc'

function setup(options: Partial<RepoIpcOptions> = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  registerRepoIpc({ ipc, engine, pickFolder: async () => null, ...options })
  return (...args: unknown[]) => handlers.get(repoChannels.initialise)!(...args) as Promise<Result<RepoInspection>>
}

describe('Initialise repository over IPC', () => {
  it('initialises the folder, even before a Company is open, and answers the new inspection', async () => {
    const asked: string[] = []
    const initialise = setup({
      initialise: (path) => {
        asked.push(path)
        return {
          path,
          isGitRepo: true,
          remote: null,
          defaultBranch: 'main',
          commitCount: 1,
          lastCommitAt: null,
          detected: {},
        }
      },
    })

    const result = await initialise(` ${onDisk('/code/notes')} `)

    expect(asked).toEqual([onDisk('/code/notes')])
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ isGitRepo: true, defaultBranch: 'main' }) })
  })

  it('answers why initialising failed', async () => {
    const initialise = setup({
      initialise: (path) => {
        throw new Error(`${path} is already a git repository`)
      },
    })

    expect(await initialise(onDisk('/code/web'))).toEqual({
      ok: false,
      error: `${onDisk('/code/web')} is already a git repository`,
    })
    expect(await initialise(42)).toEqual({ ok: false, error: expect.stringContaining('folder') })
  })
})

function handlers(options: Partial<RepoIpcOptions> = {}) {
  const registered = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => registered.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  registerRepoIpc({ ipc, engine, pickFolder: async () => null, ...options })
  return (channel: string, ...args: unknown[]) => registered.get(channel)!(...args)
}

describe('Start a repo over IPC (T144)', () => {
  it('answers what starting would do for a trimmed path, and refuses an empty one without asking', () => {
    const asked: string[] = []
    const call = handlers({
      planStart: (path) => {
        asked.push(path)
        return { kind: 'in-place', path, files: 3 }
      },
    })

    expect(call(repoChannels.planStart, ` ${onDisk('/code/notes')} `)).toEqual({
      kind: 'in-place',
      path: onDisk('/code/notes'),
      files: 3,
    })
    expect(call(repoChannels.planStart, '  ')).toMatchObject({ kind: 'refused' })
    expect(asked).toEqual([onDisk('/code/notes')])
  })

  it('creates a remote with the details it was sent, private unless told otherwise', async () => {
    const asked: unknown[] = []
    const call = handlers({
      createRemote: (path, remote) => {
        asked.push([path, remote])
        return Promise.resolve({
          path,
          isGitRepo: true,
          remote: 'github.com/ada/app',
          defaultBranch: 'main',
          commitCount: 1,
          lastCommitAt: null,
          detected: {},
        })
      },
    })

    const result = await call(repoChannels.createRemote, onDisk('/code/app'), { forge: 'github', name: ' app ' })

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ remote: 'github.com/ada/app' }) })
    expect(asked).toEqual([[onDisk('/code/app'), { forge: 'github', name: 'app', visibility: 'private' }]])
    expect(
      await call(repoChannels.createRemote, onDisk('/code/app'), {
        forge: 'github',
        name: 'app',
        visibility: 'secret',
      }),
    ).toEqual({
      ok: false,
      error: 'Unknown visibility: secret',
    })
  })

  it('answers a refused remote as a failed result, in the forge’s words', async () => {
    const call = handlers({
      createRemote: () => Promise.reject(new Error('GraphQL: Name already exists on this account')),
    })

    expect(await call(repoChannels.createRemote, onDisk('/code/app'), { forge: 'github', name: 'app' })).toEqual({
      ok: false,
      error: 'GraphQL: Name already exists on this account',
    })
  })

  it('offers no remote at all by default', async () => {
    expect(await handlers()(repoChannels.remoteOffers)).toEqual({ ok: true, value: [] })
  })
})
