// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../shared/domain/result'
import type { FoundRepo, FoundReposEvent } from '../../../shared/repos/found-repos'
import { type AttachScannedResult, EMPTY_STACK, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import { FoundReposPicker } from './FoundRepos'
import { FoundReposModal } from './FoundReposModal'
import { knownFoundRepos } from './found-repos-model'
import { useFoundRepos } from './use-found-repos'

/**
 * The Found repositories picker, driven the way the boss drives it: rows stream in, a group is
 * ticked whole, a filter narrows it, and Stop ends the walk. The walk itself is the engine's
 * (repo-walk.test.ts); here the picker is wired to a stand-in of the IPC it listens on.
 */

const ROOT = '/Users/ada/Projects/acme'

const found = (relative: string, kind: FoundRepo['kind'] = 'repo', parent: string | null = null): FoundRepo => ({
  path: `${ROOT}/${relative}`,
  relative,
  kind,
  parent,
})

const FOUND: FoundRepo[] = [
  found('core'),
  found('gitops'),
  found('hub/docs-site'),
  found('payments/checkout-api'),
  found('payments/refunds'),
  found('payments/subscriptions'),
  found('payments/subscriptions/worktrees/retry-backoff', 'worktree', 'subscriptions'),
]

const repo = (path: string, name: string): Repo => ({
  id: path,
  name,
  path,
  brief: '',
  stack: EMPTY_STACK,
  rung: 'merge',
  addedAt: '2026-09-22T00:00:00Z',
})

let host: HTMLDivElement
let root: Root
let listener: ((event: FoundReposEvent) => void) | null
let started: { folder: string; scan: string }[]
let stopped: string[]
let inspected: string[][]
let attach: (paths: string[]) => Promise<Result<AttachScannedResult>>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  listener = null
  started = []
  stopped = []
  inspected = []
  attach = (_paths) => Promise.resolve({ ok: true, value: { attached: [], failed: [] } as AttachScannedResult })
  ;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
    repos: {
      findRepos: (folder: string, scan: string) => {
        started.push({ folder, scan })
        return Promise.resolve({ ok: true, value: null })
      },
      stopFinding: (scan: string) => {
        stopped.push(scan)
        return Promise.resolve(null)
      },
      inspectMany: (paths: string[]) => {
        inspected.push(paths)
        return Promise.resolve(
          Object.fromEntries(paths.map((path) => [path, inspection(path)])) as Record<string, RepoInspection>,
        )
      },
      attachScanned: (paths: string[]) => attach(paths),
      onFound: (on: (event: FoundReposEvent) => void) => {
        listener = on
        return () => {
          listener = null
        }
      },
    },
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function inspection(path: string): RepoInspection {
  return {
    path,
    isGitRepo: true,
    remote: `github.com/acme/${path.split('/').pop()}`,
    defaultBranch: 'main',
    commitCount: null,
    lastCommitAt: null,
    detected: {},
  }
}

/** The picker over a live walk, exactly as the modal mounts it. */
function Live(props: { folder: string; repos: Repo[] }) {
  const state = useFoundRepos(props.folder, props.repos)
  return <FoundReposPicker state={state} />
}

async function walk(repos: Repo[] = []) {
  await act(async () => {
    root.render(<Live folder={ROOT} repos={repos} />)
  })
  return started.at(-1)!.scan
}

/** One push from the walk in main. */
async function push(patch: Partial<FoundReposEvent>) {
  const scan = started.at(-1)!.scan
  await act(async () => {
    listener?.({ scan, found: [], total: 0, at: '', walk: null, error: null, ...patch })
  })
}

async function finish(stop: 'done' | 'cancelled' | 'timed-out' = 'done', emptyFolders = 1) {
  await push({ walk: { folder: ROOT, found: FOUND, stopped: stop, emptyFolders }, total: FOUND.length })
}

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim()

function rows(): HTMLElement[] {
  return [...document.querySelectorAll('[data-found-row]')] as HTMLElement[]
}

function tick(label: string) {
  const box = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!box) throw new Error(`no checkbox labelled ${label}: ${text()}`)
  act(() => box.click())
  return box
}

function expand(group: string) {
  const chevron = document.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${group}"]`)
  if (!chevron) throw new Error(`${group} is not closed: ${text()}`)
  act(() => chevron.click())
}

describe('Picking repositories out of a folder', () => {
  it('streams rows in while it scans, and offers Stop until the walk ends', async () => {
    await walk()
    await push({ found: FOUND.slice(0, 2), total: 2 })

    expect(text()).toContain('Scanning… 2 found')
    expect(text()).toContain('core')
    expect(document.querySelector('[data-stop]')).not.toBeNull()

    act(() => document.querySelector<HTMLButtonElement>('[data-stop]')!.click())
    expect(stopped).toContain(started.at(-1)!.scan)

    await finish('cancelled')
    expect(text()).toContain('You stopped the scan.')
    expect(document.querySelector('[data-stop]')).toBeNull()
  })

  it('says when the scan ran out of time, and still shows what it found', async () => {
    await walk()
    await push({ found: FOUND, total: FOUND.length })
    await finish('timed-out')

    expect(text()).toContain('The scan stopped after 15 seconds.')
    expect(text()).toContain('IN GROUP FOLDERS · 4')
    expect(text()).toContain('checkout-api')
  })

  it('ticks a whole group folder from its tri-state box, worktrees left alone', async () => {
    await walk()
    await push({ found: FOUND, total: FOUND.length })
    await finish()

    expect(text()).toContain('0 of 3 selected')

    tick('Select every repository in payments/')
    expect(text()).toContain('All 3 selected')
    expect(text()).toContain('3 selected of 6 new')

    // The worktree is in the group, has no checkbox, and says why.
    expect(document.querySelector('input[aria-label="Add retry-backoff"]')).toBeNull()
    expect(text()).toContain('worktree of subscriptions · not offered')

    tick('Add refunds')
    const group = document.querySelector<HTMLInputElement>('input[aria-label="Select every repository in payments/"]')!
    expect(group.indeterminate).toBe(true)
    expect(group.getAttribute('aria-checked')).toBe('mixed')
    expect(text()).toContain('2 of 3 selected')
  })

  it('never offers a repo the Company already has', async () => {
    await walk([repo(`${ROOT}/core`, 'core')])
    await push({ found: FOUND, total: FOUND.length })
    await finish()

    expect(document.querySelector<HTMLInputElement>('input[aria-label="Add core"]')!.disabled).toBe(true)
    expect(text()).toContain('Already added')
    expect(text()).toContain('0 selected of 5 new')
  })

  it('reads the remote and branch of the rows on screen, and only those', async () => {
    await walk()
    await push({ found: FOUND, total: FOUND.length })
    await finish()

    const asked = inspected.flat()
    expect(asked).toContain(`${ROOT}/core`)
    // Only the biggest group folder is open, so nothing below the closed ones has been read yet.
    expect(asked).toContain(`${ROOT}/payments/refunds`)
    expect(asked).not.toContain(`${ROOT}/hub/docs-site`)

    await act(async () => expand('hub/'))
    expect(inspected.flat()).toContain(`${ROOT}/hub/docs-site`)
    expect(text()).toContain('github.com/acme/docs-site')
  })

  it('stops the walk it started when the folder changes, and starts the new one', async () => {
    const first = await walk()
    await act(async () => {
      root.render(<Live folder="/Users/ada/Projects/other" repos={[]} />)
    })

    expect(stopped).toContain(first)
    expect(started.at(-1)!.folder).toBe('/Users/ada/Projects/other')
    expect(started.at(-1)!.scan).not.toBe(first)
  })

  it('offers to start a repository when the folder holds none', async () => {
    await walk()
    await push({ walk: { folder: ROOT, found: [], stopped: 'done', emptyFolders: 0 } })

    expect(text()).toContain('No repositories inside this folder — start one here?')
    expect(text()).toContain('looked 5 levels deep')
  })
})

describe('Filtering what was found', () => {
  /** The picker over rows that are already in, with the filter the only thing that moves. */
  function Filtered() {
    const [filter, setFilter] = useState('')
    const state = knownFoundRepos(ROOT, FOUND, [], { filter, setFilter })
    return <FoundReposPicker state={state} />
  }

  function typeFilter(value: string) {
    const input = document.querySelector<HTMLInputElement>('[data-filter-input]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('matches the name or the path and hides a group where nothing matches', async () => {
    await act(async () => {
      root.render(<Filtered />)
    })

    typeFilter('refunds')

    expect(text()).toContain('refunds')
    expect(text()).not.toContain('core')
    expect(text()).not.toContain('gitops')
    // A filter opens what survives it, so the match is on screen without a click.
    expect(rows().some((row) => row.textContent?.includes('payments/refunds'))).toBe(true)

    typeFilter('gitops')
    expect(text()).not.toContain('payments/')
  })
})

describe('Adding the repositories that were ticked', () => {
  const noop = () => {}

  async function modal(selected: string[]) {
    const added: AttachScannedResult[] = []
    const state = knownFoundRepos(ROOT, FOUND, [], {
      selected: new Set(selected),
      walk: { folder: ROOT, found: FOUND, stopped: 'done', emptyFolders: 1 },
    })
    await act(async () => {
      root.render(
        <FoundReposModal
          folder={ROOT}
          state={state}
          onCancel={noop}
          onChangeFolder={() => Promise.resolve(null)}
          onStartHere={noop}
          onAdded={(result) => added.push(result)}
        />,
      )
    })
    return added
  }

  async function submit() {
    const button = [...document.querySelectorAll('button')].find((one) => one.textContent?.startsWith('Add '))!
    await act(async () => button.click())
  }

  it('sums up the walk, names the button by what is ticked, and adds them all in one call', async () => {
    const calls: string[][] = []
    attach = (paths) => {
      calls.push(paths)
      return Promise.resolve({ ok: true, value: { attached: [], failed: [] } })
    }
    const added = await modal([`${ROOT}/core`, `${ROOT}/gitops`])

    expect(text()).toContain('6 repositories found in this folder · 1 worktree and 1 empty folder skipped')
    expect(text()).toContain('Add 2 repositories')

    await submit()

    expect(calls).toEqual([[`${ROOT}/core`, `${ROOT}/gitops`]])
    expect(added).toHaveLength(1)
  })

  it('keeps the ones that worked and says why the others did not', async () => {
    attach = (paths) =>
      Promise.resolve({
        ok: true,
        value: {
          attached: [repo(paths[0]!, 'core')],
          failed: [{ path: `${ROOT}/gitops`, error: 'A repo named gitops already exists' }],
        },
      })
    const added = await modal([`${ROOT}/core`, `${ROOT}/gitops`])

    await submit()

    expect(added[0]!.attached).toHaveLength(1)
    expect(text()).toContain('A repo named gitops already exists')
  })

  it('adds nothing when nothing is ticked', async () => {
    await modal([])

    const button = [...document.querySelectorAll('button')].find((one) => one.textContent?.startsWith('Add '))!
    expect(button.getAttribute('disabled')).not.toBeNull()
    expect(text()).toContain('Add repositories')
  })
})
