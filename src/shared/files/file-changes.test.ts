import { describe, expect, it } from 'vitest'
import {
  type ChangedFile,
  changedCount,
  changeGroups,
  commitLabel,
  discardQuestion,
  hasCommitBox,
  markOf,
  type PlaceChanges,
  pushLabel,
  stagedCount,
} from './file-changes'
import { type FilePlace, placeId } from './files'

function worktree(extra: Partial<FilePlace> = {}): FilePlace {
  return {
    id: placeId('r-web', 142),
    repoId: 'r-web',
    repoName: 'web-app',
    path: '/tmp/tc-142',
    ticketId: 142,
    ticketKey: 'TC-142',
    ticketTitle: 'the counter speaks',
    holderName: 'Ada Lorne',
    branch: 'ticket-tc-142-usage-chart',
    base: 'main',
    sessionRunning: false,
    ...extra,
  }
}

function repo(extra: Partial<FilePlace> = {}): FilePlace {
  return worktree({
    id: placeId('r-web', null),
    ticketId: null,
    ticketKey: null,
    ticketTitle: null,
    holderName: null,
    branch: null,
    base: null,
    ...extra,
  })
}

function changed(path: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, previousPath: null, staged: null, unstaged: 'modified', conflicted: false, ...extra }
}

function status(id: string, files: ChangedFile[], extra: Partial<PlaceChanges> = {}): PlaceChanges {
  return { placeId: id, files, branch: 'main', ahead: 0, upstream: true, truncated: false, ...extra }
}

describe('The grouping, which is the place', () => {
  it('names a worktree by its holder and its ticket, and a repo by itself', () => {
    const places = [worktree(), repo()]
    const groups = changeGroups(places, [
      status(places[0]!.id, [changed('usage-chart.tsx')], { branch: 'ticket-tc-142-usage-chart' }),
      status(places[1]!.id, [changed('README.md')], { branch: 'main' }),
    ])

    expect(groups.map((group) => [group.name, group.ticketKey, group.where])).toEqual([
      ['Ada Lorne', 'TC-142', 'web-app · ticket-tc-142-usage-chart'],
      ['web-app', null, 'web-app · main'],
    ])
  })

  it('falls back to the repo’s name for a worktree nobody holds', () => {
    const place = worktree({ holderName: null })

    expect(changeGroups([place], [status(place.id, [changed('a.ts')])])[0]?.name).toBe('web-app')
  })

  it('leaves out a place with nothing changed, rather than drawing it empty', () => {
    const places = [worktree(), repo()]

    const groups = changeGroups(places, [status(places[0]!.id, []), status(places[1]!.id, [changed('a.ts')])])

    expect(groups.map((group) => group.place.id)).toEqual([places[1]!.id])
  })

  it('leaves out a place git said nothing about at all — a worktree that has gone', () => {
    expect(changeGroups([worktree()], [])).toEqual([])
  })

  it('counts changed files, not places, so the tab matches the rows below it', () => {
    const places = [worktree(), repo()]
    const groups = changeGroups(places, [
      status(places[0]!.id, [changed('a.ts'), changed('b.ts'), changed('c.ts')]),
      status(places[1]!.id, [changed('d.md'), changed('e.md')]),
    ])

    expect(changedCount(groups)).toBe(5)
    expect(groups.flatMap((group) => group.changes.files)).toHaveLength(5)
  })
})

describe('What a row and a box say', () => {
  it('shows what the working tree has, and the index only where the tree matches it', () => {
    expect(markOf(changed('a.ts', { staged: 'added', unstaged: 'modified' }))).toBe('modified')
    expect(markOf(changed('a.ts', { staged: 'added', unstaged: null }))).toBe('added')
    expect(markOf(changed('a.ts', { staged: null, unstaged: 'removed' }))).toBe('removed')
  })

  it('counts what the next commit would take, which is what the button says', () => {
    const files = [
      changed('a.ts', { staged: 'modified', unstaged: null }),
      changed('b.ts', { staged: 'added', unstaged: 'modified' }),
      changed('c.ts'),
    ]

    expect(stagedCount(files)).toBe(2)
    expect(commitLabel(stagedCount(files))).toBe('Commit 2 staged')
  })

  it('gives a place a box once it has something staged, or something to push', () => {
    expect(hasCommitBox(status('one', [changed('a.ts')]))).toBe(false)
    expect(hasCommitBox(status('one', [changed('a.ts', { staged: 'modified' })]))).toBe(true)
    expect(hasCommitBox(status('one', [changed('a.ts')], { ahead: 1 }))).toBe(true)
    // A branch nobody has ever published has somewhere to go even with nothing ahead of it.
    expect(hasCommitBox(status('one', [changed('a.ts')], { upstream: false }))).toBe(true)
  })

  it('says how far Push would go, and calls the first one publishing', () => {
    expect(pushLabel({ ahead: 0, upstream: true })).toBe('Push')
    expect(pushLabel({ ahead: 3, upstream: true })).toBe('Push 3')
    expect(pushLabel({ ahead: 0, upstream: false })).toBe('Publish')
  })

  it('names the file a discard would take, because a count cannot be read back', () => {
    expect(discardQuestion(['src/usage-chart.tsx'])).toBe('Discard the changes in src/usage-chart.tsx?')
    expect(discardQuestion(['a.ts', 'b.ts'])).toBe('Discard the changes in 2 files?')
  })
})
