// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangedFile, PlaceChanges } from '../../../../shared/files/file-changes'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import { filesCapture } from './FilesCapture'

/**
 * The cheapest question a capture harness can be asked: did it draw its screen? A stub that has
 * fallen behind the view throws on mount, React unmounts the tree and the harness shoots an empty
 * window — which the next auditor compares with the frame. The Files harness reads its worktree
 * over HTTP, so the fetch is answered here with what the real dev server answers with.
 *
 * Monaco is stubbed the way `files-view.dom.test.tsx` stubs it (T243): it measures text against a
 * real layout and jsdom has none, so the two editors are replaced at their lazy imports and
 * everything the harness itself does stays real.
 */
vi.mock('../../editor/CodeMonaco', () => ({
  CodeMonaco: ({ text }: { text: string }) => <pre>{text}</pre>,
}))

vi.mock('../../editor/DiffMonaco', () => ({
  DiffMonaco: ({ modified }: { modified: string }) => <pre>{modified}</pre>,
}))
const PLACE = {
  id: 'worktree:113:r-tinycorp',
  repoId: 'r-tinycorp',
  repoName: 'tinycorp',
  path: '/repo',
  ticketId: 113,
  ticketKey: 'TC-113',
  ticketTitle: 'files, opened by kind',
  holderName: 'Ada',
  branch: 'T113',
  base: 'main',
  sessionRunning: true,
}

function changed(path: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, previousPath: null, staged: null, unstaged: 'modified', conflicted: false, ...extra }
}

const CHANGES: PlaceChanges[] = [
  {
    placeId: PLACE.id,
    files: [changed('AGENTS.md', { staged: 'modified', unstaged: null }), changed('src/shared/files.ts')],
    branch: 'T113',
    ahead: 0,
    upstream: true,
    truncated: false,
  },
]

/** What the dev server's `/__files-api` answers, by path, for the harness under test. */
function answer(url: string): unknown {
  if (url.includes('/places')) return [PLACE]
  if (url.includes('/changes')) return CHANGES
  if (url.includes('/change-diff')) {
    return {
      file: { path: 'AGENTS.md', previousPath: null, status: 'modified', additions: 1, deletions: 0, binary: false },
      sides: {
        path: 'AGENTS.md',
        original: '# TinyCorp\n',
        modified: '# TinyCorp\na line the boss added\n',
        binary: false,
      },
    }
  }
  if (url.includes('/tree'))
    return { placeId: PLACE.id, entries: [{ path: 'AGENTS.md', kind: 'file', change: null }], truncated: false }
  if (url.includes('/open')) {
    return {
      path: 'AGENTS.md',
      kind: 'markdown',
      size: 12,
      text: '# TinyCorp',
      truncated: false,
      lines: 1,
      dataUrl: null,
      language: null,
      changedLines: [],
      change: null,
      digest: 'sha',
    }
  }
  return null
}

let mounted: MountedCapture
beforeEach(() => {
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve({ json: () => Promise.resolve({ ok: true, value: answer(url) }) } as Response),
  )
})
afterEach(() => {
  mounted?.unmount()
  vi.unstubAllGlobals()
})

describe('the Files capture harness', () => {
  it('draws the view over its worktree, not an empty window', async () => {
    window.history.replaceState({}, '', '/files-capture.html?path=AGENTS.md')
    mounted = await mountCapture(filesCapture)

    expect(mounted.text).toContain('Files')
    expect(mounted.text).toContain('AGENTS.md')
    expect(mounted.text).not.toContain('This screen stopped drawing')
  })

  it('opens on the Changes tab with the groups behind it, for the frame LFdty', async () => {
    window.history.replaceState({}, '', '/files-capture.html?changes=0')
    mounted = await mountCapture(filesCapture)
    // The harness clicks the tab on a timer, as the boss would.
    await new Promise((resolve) => setTimeout(resolve, 400))

    const tabs = [...mounted.host.querySelectorAll('.files-side-tab')]
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    // One group per place, its files under it, and the diff of the row the query asked for.
    expect(mounted.host.querySelectorAll('.files-change__open')).toHaveLength(2)
    expect(mounted.host.textContent).toContain('tinycorp · T113')
    // Monaco arrives lazily and draws the diff itself; what the pane promises on the first tick
    // is the file it is about (T243).
    expect(mounted.host.querySelector('[data-ui="Diff editor"]')?.getAttribute('data-path')).toBe('AGENTS.md')
  })
})
