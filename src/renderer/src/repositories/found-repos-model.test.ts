import { describe, expect, it } from 'vitest'
import type { FoundRepo } from '../../../shared/repos/found-repos'
import { EMPTY_STACK, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import {
  addLabel,
  everyOffered,
  foundCounts,
  foundRows,
  foundSummary,
  foundTree,
  moreLine,
  scanningLine,
  selectionLine,
  withRows,
} from './found-repos-model'

const ROOT = '/Users/boss/Projects/acme'

function found(relative: string, kind: FoundRepo['kind'] = 'repo', parent: string | null = null): FoundRepo {
  return { path: relative ? `${ROOT}/${relative}` : ROOT, relative, kind, parent }
}

/** The reference folder, cut down: repos at the top, two groups, a deeper one, a worktree and a submodule. */
const FOUND: FoundRepo[] = [
  found('core'),
  found('gitops'),
  found('k8s'),
  found('payments/checkout-api'),
  found('payments/refunds'),
  found('payments/subscriptions'),
  found('payments/subscriptions/worktrees/retry-backoff', 'worktree', 'subscriptions'),
  found('payments/subscriptions/vendored', 'submodule', 'subscriptions'),
  found('sandbox/tools/fx-cli'),
  found('hub/docs-site'),
]

function repo(path: string): Repo {
  return { id: path, name: path, path, brief: '', stack: EMPTY_STACK, rung: 'merge', addedAt: '2026-09-22T00:00:00Z' }
}

const rows = (repos: Repo[] = []) => foundRows(FOUND, repos)

describe('The repos found inside a folder', () => {
  it('puts each one where it sits, names it, and says why a worktree is not on offer', () => {
    const list = rows()

    expect(list.map((row) => [row.name, row.where, row.group, row.offered])).toEqual([
      ['core', 'core/', '', true],
      ['gitops', 'gitops/', '', true],
      ['docs-site', 'hub/docs-site', 'hub', true],
      ['k8s', 'k8s/', '', true],
      ['checkout-api', 'payments/checkout-api', 'payments', true],
      ['refunds', 'payments/refunds', 'payments', true],
      ['subscriptions', 'payments/subscriptions', 'payments', true],
      ['vendored', 'payments/subscriptions/vendored', 'payments', false],
      ['retry-backoff', 'payments/subscriptions/worktrees/retry-backoff', 'payments', false],
      ['fx-cli', 'sandbox/tools/fx-cli', 'sandbox', true],
    ])
    expect(list.find((row) => row.name === 'retry-backoff')?.note).toBe('worktree of subscriptions · not offered')
    expect(list.find((row) => row.name === 'vendored')?.note).toBe('submodule of subscriptions · not offered')
  })

  it('marks the repos the Company already has, and never offers one of them', () => {
    const list = rows([repo(`${ROOT}/core`)])

    expect(list.find((row) => row.name === 'core')).toMatchObject({ added: true, offered: false })
    expect(everyOffered(list).has(`${ROOT}/core`)).toBe(false)
    expect(selectionLine(foundCounts(list, null, everyOffered(list)))).toBe('7 selected of 7 new')
  })

  it('carries the remote and the branch once the inspector has read the row, and nothing before', () => {
    const read: Record<string, RepoInspection> = {
      [`${ROOT}/core`]: {
        path: `${ROOT}/core`,
        isGitRepo: true,
        remote: 'github.com/acme/core',
        defaultBranch: 'main',
        commitCount: null,
        lastCommitAt: null,
        detected: {},
      },
    }

    const list = foundRows(FOUND, [], read)

    expect(list[0]).toMatchObject({ name: 'core', remote: 'github.com/acme/core', branch: 'main' })
    expect(list[1]).toMatchObject({ name: 'gitops', remote: null, branch: null })
  })

  it('offers the picked folder itself when it is a repo too, above everything inside it', () => {
    const list = foundRows([found(''), ...FOUND], [])

    const tree = foundTree(list, new Set())

    expect(tree.self).toMatchObject({ path: ROOT, where: '', name: 'acme', offered: true })
    expect(tree.top.map((row) => row.name)).toEqual(['core', 'gitops', 'k8s'])
  })
})

describe('The tree of found repos', () => {
  it('splits top-level repos from group folders and counts the repos in each group', () => {
    const tree = foundTree(rows(), new Set())

    expect(tree.self).toBeNull()
    expect(tree.top.map((row) => row.name)).toEqual(['core', 'gitops', 'k8s'])
    // Biggest folder first, then by name: payments holds three repos, hub and sandbox one each.
    expect(tree.groups.map((group) => [group.label, group.count, group.rows.length])).toEqual([
      ['payments/', 3, 5],
      ['hub/', 1, 1],
      ['sandbox/', 1, 1],
    ])
  })

  it('shows a group as none, some or all, and says how many of it are ticked', () => {
    const list = rows()
    const payments = (selected: Set<string>) => foundTree(list, selected).groups.find((one) => one.key === 'payments')!

    expect(payments(new Set())).toMatchObject({ checked: 'none', selected: 0, line: '0 of 3 selected' })
    expect(payments(new Set([`${ROOT}/payments/refunds`]))).toMatchObject({ checked: 'some', line: '1 of 3 selected' })
    expect(payments(everyOffered(list))).toMatchObject({ checked: 'all', line: 'All 3 selected' })
  })

  it('ticks and unticks a whole group without touching what is outside it', () => {
    const list = rows()
    const payments = foundTree(list, new Set()).groups.find((one) => one.key === 'payments')!

    const on = withRows(new Set([`${ROOT}/core`]), payments.rows, true)
    expect([...on].sort()).toEqual([
      `${ROOT}/core`,
      `${ROOT}/payments/checkout-api`,
      `${ROOT}/payments/refunds`,
      `${ROOT}/payments/subscriptions`,
    ])

    // The worktree and the submodule are in the group and are never ticked by it.
    expect([...on].some((path) => path.includes('worktrees') || path.endsWith('vendored'))).toBe(false)
    expect([...withRows(on, payments.rows, false)]).toEqual([`${ROOT}/core`])
  })

  it('never ticks a repo the Company already has, not even from its group', () => {
    const list = rows([repo(`${ROOT}/payments/refunds`)])
    const payments = foundTree(list, new Set()).groups.find((one) => one.key === 'payments')!

    expect([...withRows(new Set(), payments.rows, true)].sort()).toEqual([
      `${ROOT}/payments/checkout-api`,
      `${ROOT}/payments/subscriptions`,
    ])
    expect(payments.line).toBe('0 of 2 selected')
  })
})

describe('Filtering the found repos', () => {
  it('matches the name or the path, and hides a group where nothing matches', () => {
    const list = rows()

    const tree = foundTree(list, new Set(), 'refunds')

    expect(tree.top).toEqual([])
    expect(tree.groups.map((group) => [group.label, group.rows.map((row) => row.name)])).toEqual([
      ['payments/', ['refunds']],
    ])
  })

  it('matches a group folder by its path, however it is typed', () => {
    const tree = foundTree(rows(), new Set(), 'PAYMENTS/')

    expect(tree.groups.map((group) => group.label)).toEqual(['payments/'])
    expect(tree.groups[0]!.rows).toHaveLength(5)
  })

  it('leaves the tree whole for an empty filter and finds nothing for a miss', () => {
    expect(foundTree(rows(), new Set(), '   ').groups).toHaveLength(3)
    expect(foundTree(rows(), new Set(), 'nothing-like-this')).toMatchObject({ self: null, top: [], groups: [] })
  })

  it('counts the whole walk, not the filtered view, so the header never moves as you type', () => {
    const list = rows()

    expect(foundCounts(list, { emptyFolders: 1 }, new Set())).toEqual({
      repos: 8,
      worktrees: 2,
      emptyFolders: 1,
      added: 0,
      offered: 8,
      selected: 0,
    })
  })
})

describe('What the picker says', () => {
  it('sums up what the walk found, and drops what there is none of', () => {
    const counts = foundCounts(rows(), { emptyFolders: 1 }, new Set())

    expect(foundSummary(counts)).toBe('8 repositories found in this folder · 2 worktrees and 1 empty folder skipped')
    expect(foundSummary({ ...counts, worktrees: 0 })).toBe(
      '8 repositories found in this folder · 1 empty folder skipped',
    )
    expect(foundSummary({ ...counts, worktrees: 1, emptyFolders: 0 })).toBe(
      '8 repositories found in this folder · 1 worktree skipped',
    )
    expect(foundSummary({ ...counts, worktrees: 0, emptyFolders: 0 })).toBe('8 repositories found in this folder')
    expect(foundSummary({ ...counts, repos: 0, worktrees: 0, emptyFolders: 0 })).toBe(
      'No repositories found in this folder',
    )
  })

  it('counts up while it scans, and names the button by what is ticked', () => {
    expect(scanningLine(84)).toBe('Scanning… 84 found')
    expect(addLabel(0)).toBe('Add repositories')
    expect(addLabel(1)).toBe('Add 1 repository')
    expect(addLabel(23)).toBe('Add 23 repositories')
  })

  it('says when there is nothing new left to add', () => {
    const list = rows(FOUND.filter((one) => one.kind === 'repo').map((one) => repo(one.path)))

    expect(selectionLine(foundCounts(list, null, new Set()))).toBe('Every repository here is already added')
    expect(selectionLine(foundCounts([], null, new Set()))).toBe('')
  })

  it('sums up the rows a collapsed group is not drawing', () => {
    const hidden = rows().filter((row) => row.group === 'payments')

    expect(moreLine(hidden)).toBe('2 more worktrees · 3 more repositories')
    expect(moreLine(hidden.filter((row) => row.kind === 'repo'))).toBe('3 more repositories')
    expect(moreLine([])).toBe('')
  })
})
