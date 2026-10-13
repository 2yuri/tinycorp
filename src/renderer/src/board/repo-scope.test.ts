import { describe, expect, it } from 'vitest'
import { EMPTY_STACK, type Repo, type StackConstraints } from '../../../shared/repos/repo'
import { initialRepoScope, repoChoices, repoScopeError, toggleRepo } from './repo-scope'

const ready: StackConstraints = {
  ...EMPTY_STACK,
  language: 'TypeScript',
  framework: 'React',
  packageManager: 'pnpm',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'pnpm test',
  lint: 'pnpm lint',
}

function repo(id: string, stack = ready): Repo {
  return {
    id,
    name: `${id}-name`,
    path: `/code/${id}`,
    brief: '',
    rung: 'merge',
    stack,
    addedAt: '2026-09-17T00:00:00Z',
  }
}

const web = repo('web')
const api = repo('api')
const bare = repo('bare', EMPTY_STACK)

describe('repo scope', () => {
  it('offers every repo, with or without checks', () => {
    expect(repoChoices([web, bare, api], []).map((r) => r.id)).toEqual(['web', 'bare', 'api'])
    expect(repoChoices([web, bare], ['bare']).map((r) => r.id)).toEqual(['web', 'bare'])
  })

  it('preselects the only repo of a new ticket, even without checks', () => {
    expect(initialRepoScope([web], null)).toEqual(['web'])
    expect(initialRepoScope([bare], null)).toEqual(['bare'])
  })

  it('preselects nothing when the Company has several repos', () => {
    expect(initialRepoScope([web, api], null)).toEqual([])
    expect(initialRepoScope([web, bare], null)).toEqual([])
  })

  it('starts from the ticket repos when editing', () => {
    expect(initialRepoScope([web], { repos: [] })).toEqual([])
    expect(initialRepoScope([web, api], { repos: ['api'] })).toEqual(['api'])
  })

  it('toggles a repo in and out, in the order picked', () => {
    expect(toggleRepo(['api'], 'web')).toEqual(['api', 'web'])
    expect(toggleRepo(['api', 'web'], 'api')).toEqual(['web'])
  })

  it('requires at least one repo', () => {
    expect(repoScopeError([])).toBe('Pick at least one repo')
    expect(repoScopeError(['web'])).toBeNull()
  })
})
