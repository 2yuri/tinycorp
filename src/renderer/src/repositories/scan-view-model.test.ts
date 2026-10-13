import { describe, expect, it } from 'vitest'
import { EMPTY_STACK, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import { attachLabel, initialSelection, scanRows, selectionLine } from './scan-view-model'

const now = Date.parse('2026-09-17T12:00:00Z')
const found = (path: string, overrides: Partial<RepoInspection> = {}): RepoInspection => ({
  path,
  isGitRepo: true,
  remote: null,
  defaultBranch: null,
  commitCount: null,
  lastCommitAt: null,
  detected: {},
  ...overrides,
})
const complete = {
  packageManager: 'pnpm',
  install: 'pnpm install',
  build: 'pnpm build',
  test: 'pnpm test',
  lint: 'pnpm lint',
}

describe('Scan a folder rows', () => {
  it('shows each checkout with its remote, detected stack and history', () => {
    const rows = scanRows(
      [
        found('/code/web', {
          remote: 'github.com/acme/web',
          commitCount: 2104,
          lastCommitAt: '2026-09-15T12:00:00Z',
          detected: { language: 'TypeScript', framework: 'React', ...complete },
        }),
        found('/code/infra/'),
      ],
      [],
      now,
    )

    expect(rows).toEqual([
      {
        path: '/code/web',
        name: 'web',
        remote: 'github.com/acme/web',
        meta: 'TypeScript · React · pnpm · 2,104 commits · last push 2d ago',
        checks: [
          { key: 'install', command: 'pnpm install' },
          { key: 'build', command: 'pnpm build' },
          { key: 'test', command: 'pnpm test' },
          { key: 'lint', command: 'pnpm lint' },
        ],
        attached: false,
      },
      { path: '/code/infra/', name: 'infra', remote: 'No origin remote', meta: '', checks: [], attached: false },
    ])
  })

  it('lists only the detected checks, marks repos already attached, and selects only the new ones', () => {
    const attached: Repo = {
      id: 'r1',
      name: 'web',
      path: '/code/web',
      brief: '',
      rung: 'merge',
      stack: EMPTY_STACK,
      addedAt: '',
    }
    const rows = scanRows(
      [found('/code/web', { detected: complete }), found('/code/api', { detected: { test: 'go test ./...' } })],
      [attached],
      now,
    )

    expect(rows.map((row) => [row.name, row.checks.map((check) => check.key), row.attached])).toEqual([
      ['web', ['install', 'build', 'test', 'lint'], true],
      ['api', ['test'], false],
    ])
    expect([...initialSelection(rows)]).toEqual(['/code/api'])
  })

  it('counts the selection on the attach button', () => {
    expect([attachLabel(0), attachLabel(1), attachLabel(3)]).toEqual(['Attach', 'Attach 1 repo', 'Attach 3 repos'])
  })

  it('says how many are selected, or that every found repo is attached already', () => {
    const rows = scanRows([found('/code/web'), found('/code/api')], [], now)
    const attached = rows.map((row) => ({ ...row, attached: true }))

    expect([selectionLine(0, []), selectionLine(1, rows), selectionLine(0, attached)]).toEqual([
      '',
      '1 of 2 selected',
      'All found repos are attached',
    ])
  })
})
