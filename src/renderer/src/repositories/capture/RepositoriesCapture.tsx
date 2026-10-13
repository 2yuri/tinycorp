// A dev-only capture of the Repositories view with a rung on each card and the Add repository
// panel open (`repositories-capture.html`), so it can be compared with `design/screens/FuDXm.png`.
// It stands in for the engine with the frame's own repos. Nothing here ships.

import { FolderSearch, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Employee, RoleTemplate } from '../../../../shared/domain/staff'
import { EMPTY_STACK, type Repo, type RepoInspection, type RepoRung } from '../../../../shared/repos/repo'
import {
  HEADER_ACTIONS,
  HEADER_INFO,
  HEADER_SPACER,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  HEADER_TITLE_ROW,
  SHELL_HEADER,
  SHELL_VIEW,
} from '../../chrome'
import { Button, cx } from '../../ui/kit'
import { RepoCard } from '../RepoCard'
import { LIST, SPLIT, VIEW } from '../repo-classes'
import { StackPanel } from '../StackPanel'
import '../../ui/tailwind.css'

const web = { ...EMPTY_STACK, language: 'TypeScript', framework: 'React' }
const api = { ...EMPTY_STACK, language: 'TypeScript', framework: 'Fastify' }
const infra = { ...EMPTY_STACK, language: 'HCL', framework: 'Terraform' }

const checks = { install: 'pnpm install', build: 'pnpm build', test: 'vitest run', lint: 'biome check .' }

function repo(name: string, stack: typeof web, rung: RepoRung, withChecks = true): Repo {
  return {
    id: name,
    name,
    path: `/code/tinycorp/${name}`,
    brief: '',
    rung,
    stack: { ...stack, ...(withChecks ? checks : {}) },
    addedAt: '2026-09-17T08:00:00.000Z',
  }
}

/** The frame's three repos, one on each rung of the ladder. */
const REPOS: Repo[] = [
  repo('web-app', web, 'merge'),
  repo('billing-api', api, 'pr'),
  repo('infra', infra, 'local', false),
]

function inspection(name: string): RepoInspection {
  return {
    path: `/code/tinycorp/${name}`,
    isGitRepo: true,
    remote: `github.com/tinycorp/${name}`,
    defaultBranch: 'main',
    commitCount: 120,
    lastCommitAt: '2026-09-17T08:00:00.000Z',
    detected: {},
  }
}

const ROLES = [
  { id: 'frontend', name: 'Frontend', capabilities: ['code'], repoFilter: ['web-*'] },
  { id: 'tech-lead', name: 'Tech Lead', capabilities: ['code', 'review'], repoFilter: ['*'] },
  { id: 'qa', name: 'QA', capabilities: ['review'], repoFilter: ['*'] },
  { id: 'backend', name: 'Backend', capabilities: ['code'], repoFilter: ['billing-*'] },
  { id: 'devops', name: 'DevOps', capabilities: ['code'], repoFilter: ['infra'] },
] as RoleTemplate[]

const EMPLOYEES = [
  { id: 'e-nova', name: 'Nova Reyes', roleId: 'frontend', repoFilter: ['web-*'], sprite: 0 },
  { id: 'e-vega', name: 'Vega Ito', roleId: 'backend', repoFilter: ['billing-*'], sprite: 1 },
  { id: 'e-orion', name: 'Orion Ray', roleId: 'devops', repoFilter: ['infra'], sprite: 2 },
] as Employee[]

/** The shell's rail (68) and sidebar (276), so the view sits where the window puts it. */
const SHELL_WIDTH = 344

export function repositoriesCapture(): ReactNode {
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden', background: 'var(--background)' }}>
      <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--sidebar, #0F172A)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
        <Header />
        <div className={cx(SHELL_VIEW, VIEW)} style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
          <div className={SPLIT}>
            <div className={LIST}>
              {REPOS.map((one) => (
                <RepoCard
                  key={one.id}
                  repo={one}
                  inspection={inspection(one.name)}
                  worktreeRoot={`~/.tinycorp/wt/${one.name}`}
                  roles={ROLES}
                  employees={EMPLOYEES}
                  onEdit={() => {}}
                  onRemove={() => {}}
                  onRung={() => {}}
                />
              ))}
            </div>
            <StackPanel
              mode="add"
              name="payments-web"
              path="~/code/tinycorp/payments-web"
              inspection={inspection('payments-web')}
              initialBrief="Customer checkout and payments UI. Next.js with Tailwind; keep new pages under app/."
              initialStack={{ ...EMPTY_STACK, packageManager: 'pnpm', packageManagerVersion: '9', ...checks }}
              initialRung="pr"
              roles={ROLES}
              initialAllowed={new Set(['frontend', 'tech-lead', 'qa'])}
              error={null}
              busy={false}
              onCancel={() => {}}
              onSave={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The shell's 64px content header, which the real view fills through `<ViewHeader>`. */
function Header() {
  return (
    <header className={SHELL_HEADER}>
      <div className={HEADER_INFO}>
        <div className={HEADER_TITLE_ROW}>
          <h1 className={HEADER_TITLE}>Repositories</h1>
        </div>
        <div className={HEADER_SUBTITLE}>
          Employees only work inside repos you connect here — describe each one so they know what it is.
        </div>
      </div>
      <div className={HEADER_SPACER} />
      <div className={HEADER_ACTIONS}>
        <Button variant="ghost" size="sm" icon={FolderSearch}>
          Scan a folder
        </Button>
        <Button size="sm" icon={Plus}>
          Add repository
        </Button>
      </div>
    </header>
  )
}
