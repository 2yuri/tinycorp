// The boss's reference folder, as frames UohF8, XHkqC and DxNcO draw it: 110 repositories under
// ~/Projects/acme, seven at the top and the rest in group folders, with worktrees and an empty
// folder that the walk skipped. Dev-only: nothing outside the capture harness imports this.
import type { FoundRepo } from '../../../../shared/repos/found-repos'
import { EMPTY_STACK, type Repo, type RepoInspection } from '../../../../shared/repos/repo'

export const FOLDER = '/Users/yuri/Projects/acme'

const TOP = ['core', 'gitops', 'k8s', 'automations', 'terraform', 'skills', 'service-config']

/** The group folders, with the number of repos the frame's badge shows on each. */
const GROUPS: [name: string, repos: number][] = [
  ['payments', 67],
  ['pay-legacy', 19],
  ['hub', 8],
  ['ledger', 6],
  ['web3', 2],
]

/** The three the frame names inside `payments/`, in the frame's order; the rest are filler. */
const PAYMENTS = ['checkout-api', 'refunds', 'subscriptions']

function repoAt(relative: string): FoundRepo {
  return { path: `${FOLDER}/${relative}`, relative, kind: 'repo', parent: null }
}

function worktreeAt(relative: string, parent: string): FoundRepo {
  return { path: `${FOLDER}/${relative}`, relative, kind: 'worktree', parent }
}

export const FOUND: FoundRepo[] = [
  ...TOP.map(repoAt),
  ...GROUPS.flatMap(([group, count]) => {
    const named = group === 'payments' ? PAYMENTS : []
    // `svc-*` sorts after the three the frame names, so the preview draws the frame's own rows.
    const filler = Array.from({ length: count - named.length }, (_, i) => `svc-${i + 1}`)
    return [...named, ...filler].map((name) => repoAt(`${group}/${name}`))
  }),
  // One a level deeper than the rest.
  repoAt('sandbox/tools/fx-cli'),
  // Six worktrees of `subscriptions`: shown under it, never offered.
  ...['retry-backoff', 'proration-fix', 'dunning', 'invoice-pdf', 'tax-eu', 'webhooks'].map((name) =>
    worktreeAt(`payments/subscriptions/worktrees/${name}`, 'subscriptions'),
  ),
]

/** `core` is the one repo the Company already has, so its row reads Already added. */
export const CONNECTED: Repo[] = [
  {
    id: 'r-core',
    name: 'core',
    path: `${FOLDER}/core`,
    brief: 'The platform: shared domain, the database and the migrations everything else builds on.',
    stack: { ...EMPTY_STACK, language: 'TypeScript', packageManager: 'pnpm', install: 'pnpm install' },
    rung: 'merge',
    addedAt: '2026-09-22T08:00:00.000Z',
  },
]

/** The branch each named repo is on in the frame; everything else is `main`. */
const BRANCHES: Record<string, string> = { gitops: 'trunk', subscriptions: 'develop' }

/** What the inspector would have read for the rows the frames draw. */
export const INSPECTIONS: Record<string, RepoInspection> = Object.fromEntries(
  [{ path: FOLDER, relative: 'platform', kind: 'repo' as const, parent: null }, ...FOUND]
    .filter((one) => one.kind === 'repo')
    .map((one) => {
      const name = one.relative.split('/').pop()!
      return [
        one.path,
        {
          path: one.path,
          isGitRepo: true,
          remote: `github.com/acme/${name}`,
          defaultBranch: BRANCHES[name] ?? 'main',
          commitCount: 1_204,
          lastCommitAt: '2026-09-20T08:00:00.000Z',
          detected: {},
        } satisfies RepoInspection,
      ]
    }),
)

/** The 23 the frame shows ticked: two of `payments/`, all of `pay-legacy/`, and two at the top. */
export const SELECTED: ReadonlySet<string> = new Set([
  `${FOLDER}/gitops`,
  `${FOLDER}/k8s`,
  `${FOLDER}/payments/checkout-api`,
  `${FOLDER}/payments/refunds`,
  ...FOUND.filter((one) => one.relative.startsWith('pay-legacy/')).map((one) => one.path),
])
