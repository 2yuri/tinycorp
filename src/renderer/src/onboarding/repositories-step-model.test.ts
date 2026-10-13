import { describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import { canLeaveRepositories, connectedCards, connectedLabel, foundLabel, repoCounts } from './repositories-step-model'

const ready = {
  ...EMPTY_STACK,
  language: 'TypeScript',
  packageManager: 'pnpm',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'vitest run',
  lint: 'biome check',
}

const company = { createdAt: '2026-09-17T10:00:00.000Z' }

const repo = (name: string, patch: Partial<Repo> = {}): Repo => ({
  id: name,
  name,
  path: `/Users/ada/code/tinycorp/${name}`,
  brief: '',
  rung: 'merge',
  stack: ready,
  addedAt: '2026-09-17T10:00:01.000Z',
  ...patch,
})

const role = (
  name: string,
  repoFilter: string[],
  capabilities: RoleTemplate['capabilities'] = ['code'],
): RoleTemplate => ({
  mcpServers: [],
  skills: [],
  id: name.toLowerCase(),
  name,
  persona: '',
  capabilities,
  repoFilter,
  areas: [],
  seeded: true,
})

const inspection = (path: string, patch: Partial<RepoInspection> = {}): RepoInspection => ({
  path,
  isGitRepo: true,
  remote: null,
  defaultBranch: null,
  commitCount: null,
  lastCommitAt: null,
  detected: {},
  ...patch,
})

describe('Repositories step', () => {
  it('shows a connected repo with its branch, path, stack commands and the roles its filters let in', () => {
    const roles = [
      role('Tech Lead', ['*'], ['plan', 'review']),
      role('Frontend', ['web-*']),
      role('Backend', ['*']),
      role('DevOps', ['infra']),
      role('PM', ['*'], ['intake']),
    ]

    const [card] = connectedCards(
      company,
      [repo('web-app', { brief: 'Customer-facing web app.' })],
      { 'web-app': inspection('/Users/ada/code/tinycorp/web-app', { defaultBranch: 'main' }) },
      roles,
      [] as Employee[],
    )

    expect(card).toEqual({
      id: 'web-app',
      name: 'web-app',
      branch: 'main',
      pathLine: '~/code/tinycorp/web-app · added when you created the company',
      brief: 'Customer-facing web app.',
      checksDetected: true,
      commands: [
        { key: 'install', command: 'pnpm install' },
        { key: 'build', command: 'pnpm build' },
        { key: 'test', command: 'vitest run' },
        { key: 'lint', command: 'biome check' },
      ],
      roles: ['Tech Lead', 'Frontend', 'Backend'],
    })
  })

  it('marks a repo connected later, and one without checks', () => {
    const [card] = connectedCards(
      company,
      [repo('infra', { addedAt: '2026-09-17T11:00:00.000Z', stack: { ...EMPTY_STACK, language: 'Terraform' } })],
      {},
      [],
      [],
    )

    expect(card).toMatchObject({
      branch: null,
      pathLine: '~/code/tinycorp/infra · connected during setup',
      brief: '',
      checksDetected: false,
      commands: [],
      roles: [],
    })
  })

  it('names the folder the tree came from, and the Connected count while the names fit', () => {
    expect(foundLabel('/Users/ada/code/tinycorp', 110)).toBe('FOUND IN ~/code/tinycorp · 110 REPOSITORIES')
    expect(foundLabel('/Users/ada/code/tinycorp', 1)).toBe('FOUND IN ~/code/tinycorp · 1 REPOSITORY')
    expect(connectedLabel([])).toBe('Connected')
    expect(connectedLabel([repo('web-app')])).toBe('Connected (web-app)')
    expect(connectedLabel([repo('web-app'), repo('infra')])).toBe('Connected (web-app, infra)')
    expect(connectedLabel([repo('web-app'), repo('infra'), repo('api')])).toBe('Connected')
  })

  it('counts what is connected, described, ticked and left over, and needs one of them to go on', () => {
    const repos = [repo('web-app', { brief: 'Storefront' }), repo('infra', { brief: '  ' }), repo('api')]

    expect(repoCounts(repos, 109, 23)).toEqual({ connected: 3, described: 1, selected: 23, found: 86 })
    expect(repoCounts(repos, 0, 0)).toEqual({ connected: 3, described: 1, selected: 0, found: 0 })
    expect(canLeaveRepositories(repos.length)).toBe(true)
    expect(canLeaveRepositories(0)).toBe(false)
    // Repos ticked but not yet added are enough to go on: Continue adds them.
    expect(canLeaveRepositories(0, 4)).toBe(true)
  })
})
