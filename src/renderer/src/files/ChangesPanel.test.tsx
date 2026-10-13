import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ChangedFile, ChangedFileDiff, ChangeGroup, PlaceChanges } from '../../../shared/files/file-changes'
import { type FilePlace, placeId } from '../../../shared/files/files'
import type { DiffControls } from '../editor'

let ChangesPanel: typeof import('./ChangesPanel').ChangesPanel
let SidebarTabs: typeof import('./ChangesPanel').SidebarTabs
let ChangeDiff: typeof import('./ChangeDiff').ChangeDiff

beforeAll(async () => {
  ;({ ChangesPanel, SidebarTabs } = await import('./ChangesPanel'))
  ;({ ChangeDiff } = await import('./ChangeDiff'))
})

/** The words a piece of markup says, with the tags taken out. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function worktree(extra: Partial<FilePlace> = {}): FilePlace {
  return {
    id: placeId('r-web', 142),
    repoId: 'r-web',
    repoName: 'web-app',
    path: '/tmp/tc-142',
    ticketId: 142,
    ticketKey: 'TC-142',
    ticketTitle: 'the counter speaks',
    holderName: 'Ada',
    branch: 'ticket-tc-142-usage-chart',
    base: 'main',
    sessionRunning: false,
    ...extra,
  }
}

function changed(path: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, previousPath: null, staged: null, unstaged: 'modified', conflicted: false, ...extra }
}

function group(place: FilePlace, files: ChangedFile[], extra: Partial<PlaceChanges> = {}): ChangeGroup {
  return {
    place,
    name: place.holderName ?? place.repoName,
    ticketKey: place.ticketKey,
    where: `${place.repoName} · ${place.branch ?? 'main'}`,
    changes: {
      placeId: place.id,
      files,
      branch: place.branch ?? 'main',
      ahead: 0,
      upstream: true,
      truncated: false,
      ...extra,
    },
  }
}

const noop = () => {}

function panel(groups: ChangeGroup[], extra: Partial<Parameters<typeof ChangesPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ChangesPanel
      groups={groups}
      pick={null}
      collapsed={new Set()}
      busy={null}
      error={null}
      onToggle={noop}
      onPick={noop}
      onStage={noop}
      onUnstage={noop}
      onDiscard={noop}
      onCommit={noop}
      onPush={noop}
      {...extra}
    />,
  )
}

describe('The Changes list, grouped by who and what', () => {
  it('draws a group per place, with the Employee, the ticket, the repo and the branch', () => {
    const html = panel([
      group(worktree(), [changed('src/usage-chart.tsx'), changed('src/chart.css')]),
      group(worktree({ id: 'repo:r-web', ticketId: null, ticketKey: null, holderName: null, branch: null }), [
        changed('README.md'),
      ]),
    ])

    expect(text(html)).toContain('Ada TC-142')
    expect(text(html)).toContain('web-app · ticket-tc-142-usage-chart')
    expect(text(html)).toContain('web-app · main')
    // The Company's own repo is a group with no holder and no ticket.
    expect(html.match(/files-group__key/g)).toHaveLength(1)
  })

  it('marks each file with what was done to it: A, M, D and R', () => {
    const html = panel([
      group(worktree(), [
        changed('a.ts', { unstaged: 'added' }),
        changed('b.ts', { unstaged: 'modified' }),
        changed('c.ts', { unstaged: 'removed' }),
        changed('d.ts', { staged: 'renamed', unstaged: null, previousPath: 'was.ts' }),
      ]),
    ])

    expect(html).toContain('files-change__mark--added')
    expect(html).toContain('files-change__mark--removed')
    expect(html).toContain('files-change__mark--renamed')
    expect(text(html)).toContain('a.ts A')
    expect(text(html)).toContain('d.ts R')
  })

  it('offers Stage on a file the index has not got, and Unstage on one it has', () => {
    const html = panel([
      group(worktree(), [changed('loose.ts'), changed('ready.ts', { staged: 'modified', unstaged: null })]),
    ])

    expect(html).toContain('aria-label="Stage loose.ts"')
    expect(html).toContain('aria-label="Unstage ready.ts"')
    // Discard is on every row: it is the one that loses work, and every row can lose some.
    expect(html.match(/Discard the changes in/g)).toHaveLength(2)
  })

  it('gives the group that has something staged its own commit box, and says what it would take', () => {
    const html = panel([
      group(worktree(), [
        changed('a.ts', { staged: 'modified', unstaged: null }),
        changed('b.ts', { staged: 'added', unstaged: null }),
        changed('c.ts'),
      ]),
    ])

    expect(text(html)).toContain('Commit 2 staged')
    expect(html).toContain('placeholder="Message (⌘↵ to commit)"')
  })

  it('gives a group with nothing staged and nothing to push no box at all', () => {
    const html = panel([group(worktree(), [changed('a.ts')])])

    expect(html).not.toContain('files-commit')
  })

  it('warns once, in the group whose Employee has a Session running there', () => {
    const html = panel([
      group(worktree({ sessionRunning: true }), [changed('a.ts', { staged: 'modified', unstaged: null })]),
      group(worktree({ id: 'worktree:128:r-web', ticketKey: 'TC-128', holderName: 'Nova' }), [changed('b.ts')]),
    ])

    expect(text(html)).toContain('Ada has a Session running here. Committing now races what they are writing.')
    expect(html.match(/files-session-warning/g)).toHaveLength(1)
  })

  it('says nothing changed rather than drawing an empty list', () => {
    expect(text(panel([]))).toContain('Nothing changed yet')
  })

  it('folds a group away without losing its head', () => {
    const html = panel([group(worktree(), [changed('a.ts')])], { collapsed: new Set([worktree().id]) })

    expect(text(html)).toContain('Ada TC-142')
    expect(html).not.toContain('files-change__open')
  })
})

describe('The two tabs over the sidebar', () => {
  it('counts the changed files on the Changes tab', () => {
    const html = renderToStaticMarkup(<SidebarTabs tab="files" count={7} onTab={noop} />)

    expect(text(html)).toBe('Files Changes 7')
  })

  it('leaves the count off when the whole Company is clean', () => {
    expect(text(renderToStaticMarkup(<SidebarTabs tab="changes" count={0} onTab={noop} />))).toBe('Files Changes')
  })
})

/** The diff's controls, as `useFileChanges` holds them; the hook is what the app builds. */
const controls: DiffControls = {
  layout: 'split',
  setLayout: () => {},
  changes: { current: 1, total: 1 },
  next: () => {},
  previous: () => {},
  bind: { layout: 'split', goTo: { seq: 0, change: 0 }, onChanges: () => {}, onAt: () => {}, onWidth: () => {} },
}

function diff(
  extra: Partial<ChangedFileDiff['file']> = {},
  sides: Partial<ChangedFileDiff['sides']> = {},
): ChangedFileDiff {
  const path = 'src/usage-chart.tsx'
  return {
    file: { path, previousPath: null, status: 'modified', additions: 2, deletions: 1, binary: false, ...extra },
    sides: { path, original: 'one\ntwo\n', modified: 'one\nTWO\n', binary: false, ...sides },
  }
}

describe('The diff beside the list', () => {
  it('draws a worktree’s change in the same diff editor the Review screen uses', () => {
    const html = renderToStaticMarkup(<ChangeDiff place={worktree()} diff={diff()} controls={controls} />)

    expect(html).toContain('data-ui="Diff editor"')
    expect(html).toContain('data-path="src/usage-chart.tsx"')
    expect(html).toContain('data-layout="split"')
    expect(text(html)).toContain('+2 −1')
    expect(text(html)).toContain('Read only. Comment on a line to send it to whoever holds the ticket.')
  })

  it('says a binary file has no diff rather than showing an empty one', () => {
    const html = renderToStaticMarkup(
      <ChangeDiff
        place={worktree()}
        diff={diff({ binary: true }, { original: '', modified: '', binary: true })}
        controls={controls}
      />,
    )

    expect(text(html)).toContain('This file is binary; there is nothing to show.')
    expect(html).not.toContain('data-ui="Diff editor"')
  })

  it('tells the Company’s own repo that there is no ticket to comment on', () => {
    const repo = worktree({ id: 'repo:r-web', ticketId: null, ticketKey: null, holderName: null })
    const html = renderToStaticMarkup(
      <ChangeDiff
        place={repo}
        diff={diff({ binary: true }, { original: '', modified: '', binary: true })}
        controls={controls}
      />,
    )

    expect(text(html)).toContain('there is no ticket to comment on')
  })

  it('waits with nothing picked rather than showing a diff of nothing', () => {
    expect(text(renderToStaticMarkup(<ChangeDiff place={worktree()} diff={null} controls={controls} />))).toContain(
      'Pick a changed file to read its diff.',
    )
  })
})
