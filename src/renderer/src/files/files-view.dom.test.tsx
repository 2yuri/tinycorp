// @vitest-environment jsdom
/**
 * The Files view, mounted whole, over a stubbed engine.
 *
 * T214 took the view's thirty-two `useState` apart into five hooks, and every one of these presses
 * a seam between two of them: the tree opening a tab, the tab being read, a draft marking the tab
 * and reaching ⌘S, the ask that stands between an edited tab and its close, and the Changes tab
 * reading a diff of a place the tree is not even on. A refactor that drops a wire passes every unit
 * test in this folder and fails here.
 *
 * **Monaco is stubbed, and only Monaco** (T222, T243). It measures text against a real layout and
 * jsdom has none, so both editors are replaced at the one seam each of them exists to be: their
 * lazy import. Everything above that — the frame, the read-only flag, the wire from a keystroke to
 * the tab's dot and out through ⌘S — is the real thing, and the file stub is a textarea because
 * that is the smallest box a keystroke can be typed into.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceChanges } from '../../../shared/files/file-changes'
import type { FilePlace, OpenedFile } from '../../../shared/files/files'
import { forgetTabs } from './tabs-store'

vi.mock('../editor/CodeMonaco', () => ({
  CodeMonaco: ({
    text,
    readOnly,
    onChange,
  }: {
    text: string
    readOnly?: boolean
    onChange?: (text: string) => void
  }) => <textarea readOnly={readOnly} value={text} onChange={(event) => onChange?.(event.target.value)} />,
}))

vi.mock('../editor/DiffMonaco', () => ({
  DiffMonaco: ({ original, modified }: { original: string; modified: string }) => (
    <pre data-ui="Diff sides">{`${original}---${modified}`}</pre>
  ),
}))

const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

const worktree: FilePlace = {
  id: 'worktree:142:r-web',
  repoId: 'r-web',
  repoName: 'tinycorp',
  path: '/work/acme/worktrees/ticket-142',
  ticketId: 142,
  ticketKey: 'TC-142',
  ticketTitle: 'the counter speaks',
  holderName: 'Ada',
  branch: 'ticket-142-the-counter-speaks',
  base: 'main',
  sessionRunning: false,
}

const ENTRIES = [
  { path: 'src', kind: 'folder' as const, change: null },
  { path: 'src/counter.ts', kind: 'file' as const, change: null },
  { path: 'README.md', kind: 'file' as const, change: null },
]

const CHANGES: PlaceChanges[] = [
  {
    placeId: worktree.id,
    files: [{ path: 'src/counter.ts', previousPath: null, staged: null, unstaged: 'modified', conflicted: false }],
    branch: 'ticket-142-the-counter-speaks',
    ahead: 0,
    upstream: true,
    truncated: false,
  },
]

function opened(path: string, text: string): OpenedFile {
  return {
    path,
    kind: 'code',
    size: text.length,
    text,
    truncated: false,
    lines: text.split('\n').length,
    dataUrl: null,
    language: 'ts',
    changedLines: [],
    change: null,
    digest: `sha:${text.length}`,
  }
}

/** What the boss saved, so a test can say the write really left the view. */
let saved: { path: string; text: string }[]
let created: string[]
let discarded: string[][]

function stub() {
  return {
    company: { onChanged: never },
    files: {
      places: () => ok([worktree]),
      tree: () => ok({ entries: ENTRIES, truncated: false }),
      open: (_placeId: string, path: string) => ok(opened(path, 'const one = 1\n')),
      save: (_placeId: string, request: { path: string; text: string }) => {
        saved.push({ path: request.path, text: request.text })
        return ok({ saved: true, file: opened(request.path, request.text), conflict: null })
      },
      create: (_placeId: string, path: string) => {
        created.push(path)
        return ok(opened(path, ''))
      },
      openInEditor: () => ok(null),
      reveal: () => ok(null),
      changes: () => ok(CHANGES),
      changeDiff: (_placeId: string, path: string) =>
        ok({
          file: { path, previousPath: null, status: 'modified', additions: 1, deletions: 0, binary: false },
          sides: { path, original: 'one\n', modified: 'one\ntwo\n', binary: false },
        }),
      stage: () => ok(null),
      unstage: () => ok(null),
      discard: (_placeId: string, paths: string[]) => {
        discarded.push(paths)
        return ok(null)
      },
      commit: () => ok(null),
      push: () => ok(null),
      onChanged: never,
    },
    reviews: { comments: () => ok([]), comment: () => ok(null), onChanged: never },
    staff: { employees: () => ok([]), onChanged: never },
    profile: { get: () => ok({ name: 'You' }), onChanged: never },
    language: { read: () => ok(null), hover: () => ok(null), definition: () => ok(null) },
    paths: { links: () => ok([]), open: () => ok(null), reveal: () => ok(null), openInEditor: () => ok(null) },
    editors: {
      get: () => Promise.resolve({ found: [], choice: null, using: 'system' }),
      choose: () => ok(null),
      onChanged: never,
    },
    shell: { onCloseRequest: never },
  }
}

let host: HTMLDivElement
let root: Root
let FilesView: typeof import('./FilesView').FilesView
let ContentHeader: typeof import('../chrome/ContentHeader').ContentHeader

beforeEach(async () => {
  saved = []
  created = []
  discarded = []
  forgetTabs()
  // jsdom has no layout, so the tree and the tabs scrolling their chosen row into view is a no-op.
  Element.prototype.scrollIntoView = () => {}
  // …and it has no `ResizeObserver` either, which the diff's frame watches itself with to pick a
  // layout (T244). A box that never changes size never calls back.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  // The view reads the preload API when its modules load, so the stub goes in before the import.
  ;(window as unknown as { tinyCorp: unknown }).tinyCorp = stub()
  ;({ FilesView } = await import('./FilesView'))
  ;({ ContentHeader } = await import('../chrome/ContentHeader'))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.resetModules()
})

/**
 * Mounts the view under the shell's own header, because the header is where New file, Open in and
 * Reveal are drawn: `ViewHeader` fills a slot of `ContentHeader` through a portal.
 */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <ContentHeader title="Files">
        <FilesView companyId="acme" />
      </ContentHeader>,
    )
  })
  await act(async () => {})
  await act(async () => {})
}

const find = <T extends Element>(selector: string): T => {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`nothing matched ${selector}`)
  return found
}

const button = (label: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === label)
  if (!found) throw new Error(`no button says ${label}`)
  return found
}

const click = async (element: Element) =>
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

const type = async (area: HTMLTextAreaElement, text: string) =>
  await act(async () => {
    // React listens through its own value setter, so the native one is what a real keystroke moves.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('The Files view, wired together', () => {
  it('opens the place on its first file, as a tab with the file under it', async () => {
    await mount()

    expect(host.textContent).toContain('counter.ts')
    expect(find('[data-ui="File tabs"]')).toBeTruthy()
    expect(find('[data-ui="Code editor"]').getAttribute('data-language')).toBe('typescript')
    expect(find<HTMLTextAreaElement>('textarea').value).toBe('const one = 1\n')
  })

  it('carries a draft from the editor to the tab’s dot and out through ⌘S', async () => {
    await mount()
    await type(find<HTMLTextAreaElement>('textarea'), 'const one = 2\n')

    expect(host.querySelector('.files-tab__dot')).toBeTruthy()
    expect(host.textContent).toContain('Edited, not saved')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
    })

    expect(saved).toEqual([{ path: 'src/counter.ts', text: 'const one = 2\n' }])
    expect(host.querySelector('.files-tab__dot')).toBeNull()
  })

  it('asks before a tab with unsaved work closes, and lets it go on Discard', async () => {
    await mount()
    await type(find<HTMLTextAreaElement>('textarea'), 'const one = 2\n')
    await click(find('[aria-label="Close counter.ts"]'))

    expect(host.textContent).toContain('Save counter.ts first?')
    expect(find('[data-ui="File tabs"]')).toBeTruthy()

    await click(button('Discard changes'))

    expect(saved).toEqual([])
    expect(host.querySelector('[data-ui="File tabs"]')).toBeNull()
    expect(host.textContent).toContain('No file open')
  })

  it('reads a change’s diff from the Changes tab, which the tree is not on', async () => {
    await mount()
    await click(button('Changes1'))

    expect(find('[aria-label="Changes"]')).toBeTruthy()
    expect(host.textContent).toContain('counter.ts')

    await click(find('.files-change__open'))

    expect(host.textContent).toContain('ticket-142')
  })

  it('names the folder the tree has chosen when the boss asks for a new file', async () => {
    await mount()
    await click(button('src'))
    await click(button('New file'))

    expect(find<HTMLInputElement>('input[value^="src/"]').value).toBe('src/')

    const path = find<HTMLInputElement>('input[value^="src/"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(path, 'src/desk.ts')
      path.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button('Create file'))

    expect(created).toEqual(['src/desk.ts'])
  })
})
