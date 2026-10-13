import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { EMPTY_STACK, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import { RepoCard } from './RepoCard'

const ready = {
  ...EMPTY_STACK,
  language: 'TypeScript',
  framework: 'React',
  packageManager: 'pnpm',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'vitest run',
  lint: 'biome check',
}
const repo = (stack = ready): Repo => ({
  id: 'r1',
  name: 'web-app',
  path: '/code/web-app',
  brief: '',
  rung: 'merge',
  stack,
  addedAt: '',
})
const inspection: RepoInspection = {
  path: '/code/web-app',
  isGitRepo: true,
  remote: 'github.com/acme/web-app',
  defaultBranch: 'trunk',
  commitCount: 3,
  lastCommitAt: null,
  detected: {},
}
const roles = [{ id: 'frontend', name: 'Frontend', capabilities: ['code'], repoFilter: ['*'] } as RoleTemplate]
const employees = [{ id: 'e1', name: 'Nova Reyes', roleId: 'frontend', repoFilter: ['web-*'] } as Employee]
const noop = () => {}

function card(stack = ready, found: RepoInspection | undefined = inspection) {
  return renderToStaticMarkup(
    <RepoCard
      repo={repo(stack)}
      inspection={found}
      worktreeRoot="~/acme/worktrees/web-app"
      roles={roles}
      employees={employees}
      onEdit={noop}
      onRemove={noop}
    />,
  )
}

describe('Repo card', () => {
  it('shows a repo with its checks, remote, branch, worktree root and who may work there', () => {
    const html = card()

    expect(html).toContain('TypeScript · React')
    expect(html).toContain('github.com/acme/web-app')
    expect(html).toContain('Ready')
    for (const text of ['CHECKS', 'pnpm install', 'pnpm build', 'vitest run', 'biome check'])
      expect(html).toContain(text)
    for (const text of ['trunk', '~/acme/worktrees/web-app', '1 PR per repo', 'Frontend only', 'NR']) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('No checks yet')
  })

  it('shows a repo without checks as Ready, with the soft No checks yet hint and its worktree root', () => {
    const html = card({ ...ready, install: '', build: '', test: '', lint: '' }, undefined)

    expect(html).toContain('Ready')
    expect(html).not.toContain('Stack required')
    expect(html).toContain('No checks yet — Employees can work here; whoever sets it up records them')
    expect(html).toContain('Add checks')
    expect(html).not.toContain('CHECKS<')
    expect(html).toContain('~/acme/worktrees/web-app')
    expect(html).toContain('/code/web-app')
  })

  it('lists only the checks a repo has', () => {
    const html = card({ ...ready, install: '', build: '', lint: '' })

    expect(html).toContain('CHECKS')
    expect(html).toContain('vitest run')
    expect(html).not.toContain('pnpm install')
    expect(html).not.toContain('No checks yet')
  })

  it('says a repo without a remote has No remote', () => {
    const html = card(ready, { ...inspection, remote: null })

    expect(html).toContain('No remote · /code/web-app')
  })

  it('draws the forge its remote is on, and says which one it is', () => {
    const html = card()

    // The mark carries the forge as a name, so the card says it without a screen spelling it out.
    expect(html).toContain('GitHub — pull requests are opened with gh')
  })

  it('says, on a repo whose forge it has no adapter for, that the PR is the boss’s to open', () => {
    const html = card(ready, { ...inspection, remote: 'code.example.com/acme/infra' })

    expect(html).toContain('code.example.com/acme/infra')
    expect(html).toContain('No adapter for code.example.com')
    expect(html).toContain('everything local works here')
  })

  it('says a repo with no remote pushes nothing', () => {
    const html = card(ready, { ...inspection, remote: null })

    expect(html).toContain('No remote — nothing is pushed from here')
  })
})
