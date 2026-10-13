// A dev-only capture of the Files view over a real worktree — this checkout, read by the engine's
// own reader behind `/__files-api` — so it can be compared with `design/screens/ZNpqJ.png`.
// Nothing here ships.
import { type ReactNode, useEffect } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { SHELL_MAIN } from '../../chrome'

const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
/**
 * What every read of this page carries: `?groups` declares the frame's three places, and
 * `?fixture` asks the dev server for the committed tree rather than this checkout (T209).
 */
let shape = ''
const ask = (path: string) =>
  fetch(`/__files-api${path}${path.includes('?') ? '&' : '?'}${shape}`).then((response) => response.json())

/** Everything the Files view reads, answered by the dev server's own reader. */
function stub(): TinyCorpApi {
  return {
    company: { onChanged: never },
    files: {
      places: () => ask('/places'),
      tree: () => ask('/tree'),
      open: (_placeId: string, path: string) => ask(`/open?path=${encodeURIComponent(path)}`),
      save: (_placeId: string, request: { path: string }) => ask(`/save?path=${encodeURIComponent(request.path)}`),
      create: (_placeId: string, path: string) => ask(`/open?path=${encodeURIComponent(path)}`),
      openInEditor: () => Promise.resolve({ ok: true, value: null }),
      reveal: () => Promise.resolve({ ok: true, value: null }),
      // The Changes tab (T160), read by the engine's own `git status` over this checkout.
      changes: () => ask('/changes'),
      changeDiff: (placeId: string, path: string) =>
        ask(`/change-diff?placeId=${encodeURIComponent(placeId)}&path=${encodeURIComponent(path)}`),
      // The capture never writes to the checkout it reads: the five actions answer as if they had.
      stage: () => ok(null),
      unstage: () => ok(null),
      discard: () => ok(null),
      commit: () => ok(null),
      push: () => ok(null),
      onChanged: never,
    },
    // A worktree's diff carries the ticket's line comments, which a capture has none of.
    reviews: { comments: () => ok([]), comment: () => ok(null), onChanged: never },
    staff: { employees: () => ok([]), onChanged: never },
    profile: { get: () => ok({ name: 'You' }), onChanged: never },
    // The place's own language server (T115), through the same dev server.
    language: {
      read: (_placeId: string, path: string) => ask(`/language/read?path=${encodeURIComponent(path)}`),
      hover: (_placeId: string, path: string, spot: { line: number; column: number }) =>
        ask(`/language/hover?path=${encodeURIComponent(path)}&line=${spot.line}&column=${spot.column}`),
      definition: (_placeId: string, path: string, spot: { line: number; column: number }) =>
        ask(`/language/definition?path=${encodeURIComponent(path)}&line=${spot.line}&column=${spot.column}`),
    },
    paths: {
      links: () => Promise.resolve({ ok: true, value: [] }),
      open: (path: string) => ask(`/open?path=${encodeURIComponent(path)}`),
      reveal: () => Promise.resolve({ ok: true, value: null }),
      openInEditor: () => Promise.resolve({ ok: true, value: null }),
    },
    // The capture always has the three the design names, whatever this Mac really holds.
    editors: {
      get: () => Promise.resolve({ found: CAPTURE_EDITORS, choice: null, using: 'vscode' }),
      choose: (id: string) => Promise.resolve({ ok: true, value: { found: CAPTURE_EDITORS, choice: id, using: id } }),
      onChanged: never,
    },
    shell: { onCloseRequest: never },
  } as unknown as TinyCorpApi
}

/**
 * Mounts the Files view with the worktree behind it, inside the window the frame draws. Every
 * `path` in the query opens as a tab (T121): the first with the view, the rest the way a path
 * clicked in a message does, through the shell's own router.
 */
export async function filesCapture(): Promise<ReactNode> {
  // The stub goes in before the view's modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  const { ContentHeader } = await import('../../chrome/ContentHeader')
  const { navigate } = await import('../../chrome/navigate')
  const { FilesView } = await import('../FilesView')
  const query = new URLSearchParams(window.location.search)
  // `?changes` opens on the Changes tab, with the frame's three groups behind it (T160).
  const changes = query.has('changes')
  // `?limit` is the reader's real cap, so a checkout with fifty changed files still shows a group
  // short enough to compare with the frame — and the list says it stopped short.
  const asked = [
    ...(query.has('fixture') ? ['fixture=1'] : []),
    ...(changes ? ['groups=1', `limit=${query.get('limit') ?? ''}`] : []),
  ]
  shape = asked.join('&')
  const [first, ...rest] = query.getAll('path')
  const edited = query.get('edited')
  // `?openWith` draws the list behind the chevron, to compare with `design/screens/CwBoJ.png`.
  const openWith = query.has('openWith')
  // `?find=<text>` types into the tree's search, so the state where nothing matches can be shot.
  const find = query.get('find')

  /** The view, with every further path sent to it the way a path clicked in a message is. */
  function Opened() {
    // A parent's effect runs after its children's, so the view is already listening by now.
    useEffect(() => {
      // `?changes` clicks the Changes tab once the places have arrived, and opens the nth row's
      // diff beside it, so the frame `LFdty` can be shot by a browser that cannot click.
      if (changes) {
        const row = Number(query.get('changes')) || 0
        const tick = setInterval(() => {
          const tab = [...document.querySelectorAll<HTMLButtonElement>('.files-side-tab')][1]
          if (!tab) return
          if (tab.getAttribute('aria-selected') !== 'true') return tab.click()
          const file = document.querySelectorAll<HTMLButtonElement>('.files-change__open')[row]
          if (!file) return
          clearInterval(tick)
          file.click()
        }, 150)
        return () => clearInterval(tick)
      }
      for (const path of rest) navigate({ view: 'files', placeId: CAPTURE_PLACE, path })
      // The tree's search takes what it is given the way a keystroke does, through React.
      if (find !== null) {
        const tick = setInterval(() => {
          const box = document.querySelector<HTMLInputElement>('input[aria-label="Find a file"]')
          if (!box) return
          clearInterval(tick)
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(box, find)
          box.dispatchEvent(new Event('input', { bubbles: true }))
        }, 100)
        return () => clearInterval(tick)
      }
      // The chevron is disabled until the places arrive, so the click waits for a live one.
      if (openWith) {
        const tick = setInterval(() => {
          const chevron = document.querySelector<HTMLButtonElement>('.open-with__chevron')
          if (!chevron || chevron.disabled) return
          clearInterval(tick)
          chevron.click()
        }, 100)
        return () => clearInterval(tick)
      }
      // `?edited=…` types into the editor, so the editing frame (T122) can be shot dirty by a
      // headless browser that cannot type. It goes in as one edit of the boss's, so the view sees
      // the same change it would see from a keystroke.
      if (edited === null) return
      // Markdown reads as Markdown until Edit is clicked, which is what the boss does too.
      const toggle = setTimeout(() => {
        if (document.querySelector('[data-ui="Code editor"]') === null) {
          document.querySelector<HTMLButtonElement>('.files-chip--toggle')?.click()
        }
      }, 500)
      const timer = setTimeout(() => {
        void onTheEditor((editor, monaco) => {
          editor.executeEdits('capture', [{ range: new monaco.Range(1, 1, 1, 1), text: `${edited}\n` }])
        })
      }, 900)
      return () => {
        clearTimeout(toggle)
        clearTimeout(timer)
      }
    }, [])
    return <FilesView companyId="capture" placeId={CAPTURE_PLACE} path={first} />
  }

  return (
    <Frame>
      <ContentHeader title="Files" subtitle="">
        <Opened />
      </ContentHeader>
    </Frame>
  )
}

/**
 * The Monaco instance the view built, for the one trick a headless browser needs: typing into the
 * file. It is reached through Monaco's own registry rather than through anything the app exports
 * for it — a capture is dev-only, and the screen owes it no back door.
 */
async function onTheEditor(
  act: (
    editor: import('monaco-editor/editor/editor.api').editor.ICodeEditor,
    monaco: typeof import('../../editor/monaco').monaco,
  ) => void,
): Promise<void> {
  const { monaco } = await import('../../editor/monaco')
  const editor = monaco.editor.getEditors()[0]
  if (editor !== undefined) act(editor, monaco)
}

/** What `design/screens/CwBoJ.png` shows in the `Open with` list, whatever this Mac has. */
const CAPTURE_EDITORS = [
  { id: 'vscode', name: 'VS Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'zed', name: 'Zed' },
]

/** The id the capture's dev server answers for; the same one `vite.config.mts` declares. */
const CAPTURE_PLACE = 'worktree:113:r-tinycorp'

/** The frame draws the view alone, at the window's own size. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden', background: 'var(--background)' }}>
      <main className={SHELL_MAIN} style={{ display: 'flex', flex: '1 1 0', minWidth: 0, flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  )
}
