import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateRemote } from '../../../shared/forges/adapter'
import { type FakeForge, fakeForge } from '../../forges/testing'
import { initialiseRepo } from './repo-init'
import { createRemoteFor, remoteOffers } from './repo-remote'

/**
 * Giving a started repo a remote (T144), on disk against real git. The "forge" is a bare repository
 * in a temp folder: the adapter creates it, and the engine adds it as `origin` and pushes to it.
 */

const scratch: string[] = []
let root = ''
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'repo-remote-')))
  scratch.push(root)
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = Ada\n\temail = ada@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A forge whose repositories are bare repos under `root/forge`. */
function bareForge(): FakeForge & { created: CreateRemote[] } {
  const created: CreateRemote[] = []
  mkdirSync(join(root, 'forge'), { recursive: true })
  return Object.assign(fakeForge(), {
    created,
    async createRemote(request: CreateRemote) {
      created.push(request)
      await Promise.resolve()
      const bare = join(root, 'forge', `${request.name}.git`)
      git(join(root, 'forge'), 'init', '--quiet', '--bare', bare)
      return { webUrl: `https://forge.example/ada/${request.name}`, cloneUrl: bare }
    },
  })
}

function startedRepo(): string {
  const path = join(root, 'payments-web')
  initialiseRepo(path, { author: 'Ada' })
  return path
}

describe('Give a started repo a remote', () => {
  it('creates it on the forge, sets it as origin and pushes the first commit', async () => {
    const path = startedRepo()
    const forge = bareForge()

    const inspection = await createRemoteFor(path, {
      adapters: { github: forge },
      forge: 'github',
      name: 'payments-web',
      visibility: 'private',
    })

    expect(forge.created).toEqual([{ cwd: path, name: 'payments-web', visibility: 'private' }])
    const bare = join(root, 'forge', 'payments-web.git')
    expect(git(path, 'remote', 'get-url', 'origin')).toBe(bare)
    expect(git(bare, 'rev-parse', 'main')).toBe(git(path, 'rev-parse', 'HEAD'))
    expect(git(path, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main')
    expect(inspection.remote).toBe(bare.replace(/\.git$/, ''))
  })

  it('refuses a repo that already has an origin, and never asks the forge', async () => {
    const path = startedRepo()
    git(path, 'remote', 'add', 'origin', 'git@github.com:acme/web.git')
    const forge = bareForge()

    await expect(
      createRemoteFor(path, { adapters: { github: forge }, forge: 'github', name: 'x', visibility: 'private' }),
    ).rejects.toThrow('already has a remote: github.com/acme/web')
    expect(forge.created).toEqual([])
  })

  it('refuses a forge whose adapter cannot create a repository', async () => {
    const path = startedRepo()

    await expect(
      createRemoteFor(path, { adapters: { github: fakeForge() }, forge: 'github', name: 'x', visibility: 'private' }),
    ).rejects.toThrow('cannot create a repository on GitHub')
  })

  it('says where the repository was created when the first push fails, so it is not created twice', async () => {
    const path = startedRepo()
    const forge = Object.assign(fakeForge(), {
      createRemote: () =>
        Promise.resolve({ webUrl: 'https://forge.example/ada/gone', cloneUrl: join(root, 'nowhere.git') }),
    })

    await expect(
      createRemoteFor(path, { adapters: { github: forge }, forge: 'github', name: 'gone', visibility: 'private' }),
    ).rejects.toThrow('Created https://forge.example/ada/gone, but the first push failed')
  })
})

describe('Where a remote can be created', () => {
  it('offers only forges whose adapter can create one, with whether the CLI is ready', async () => {
    const ready = bareForge()
    expect(await remoteOffers({ github: ready })).toEqual([
      { forge: 'github', name: 'GitHub', ready: true, account: null, fix: null },
    ])

    ready.setInstalled(false)
    expect(await remoteOffers({ github: ready })).toMatchObject([{ forge: 'github', ready: false }])

    expect(await remoteOffers({ github: fakeForge() })).toEqual([])
  })
})
