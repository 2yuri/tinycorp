// Serves the renderer on its own, so `files-capture.html` can be screenshotted in a browser:
// `npx vite --config src/renderer/src/files/capture/vite.config.mts`.
// The capture reads a real worktree: this checkout, through the engine's own file reader, behind
// three endpoints that stand in for the Files IPC.
import { cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
// The three readers by name, not through the module's front door: the front door also exports the
// desktop file tools and the wiring, which reach for `electron` — and `electron` in plain Node is
// the path to a binary, not a module with a `shell` on it, so bundling this config brought back
// `Named export 'powerSaveBlocker' not found` and the harness would not start at all. Rule 3 skips
// a capture folder (`src/architecture.test.ts`), which is what makes naming them here allowed.
import { CHANGES_LIMIT, createFileChanges } from '../../../../main/features/files/file-changes'
import { createFiles } from '../../../../main/features/files/files'
import { createLanguage } from '../../../../main/features/files/language'
import type { FilePlace } from '../../../../shared/files/files'

const WORKTREE = fileURLToPath(new URL('../../../../../', import.meta.url)).replace(/\/$/, '')

/**
 * The tree `?fixture` reads instead of this checkout: four files that change only when somebody
 * changes them (T209).
 *
 * The capture is over a real worktree on purpose — that is what makes it worth looking at — and
 * that is exactly what `pnpm design:compare` cannot use: a screen whose content is whatever the
 * branch holds today has no baseline.
 *
 * The files are committed under `./tree`, and they are **copied out of the repo** to be read: the
 * reader marks a tree with what `git status` says, and a folder inside this checkout inherits the
 * checkout's own changes — the branch that deleted a stylesheet had that stylesheet in the fixture
 * tree, drawn as `removed`, opened as a tab and shot. Outside a repository there is nothing for
 * git to say. The path is fixed rather than random, so nothing in the picture depends on where the
 * copy landed.
 */
const FIXTURE = join(tmpdir(), 'tinycorp-files-capture-tree')

const FIXTURE_SOURCE = fileURLToPath(new URL('./tree', import.meta.url)).replace(/\/$/, '')

rmSync(FIXTURE, { recursive: true, force: true })
cpSync(FIXTURE_SOURCE, FIXTURE, { recursive: true })

/** The place the capture is over: this checkout, on the branch it is really on. */
const place: FilePlace = {
  id: 'worktree:113:r-tinycorp',
  repoId: 'r-tinycorp',
  repoName: 'tinycorp',
  path: WORKTREE,
  ticketId: 113,
  ticketKey: 'TC-113',
  ticketTitle: 'files, opened by kind',
  holderName: 'Ada',
  branch: 'T113',
  base: 'main',
  // The capture of the editing frame (T122) is taken with somebody else at work in the worktree.
  sessionRunning: true,
}

/**
 * The Changes frame (`LFdty`) draws three groups — two Employees' worktrees and the Company's own
 * repo — and a capture has no Company behind it. `?groups` declares the same checkout three times
 * so the grouping can be compared; without it the list is the one place the other captures use,
 * so none of them gains a place picker it did not have.
 */
const GROUPS: FilePlace[] = [
  place,
  {
    ...place,
    id: 'worktree:128:r-billing',
    ticketId: 128,
    ticketKey: 'TC-128',
    ticketTitle: 'the card keeps its token',
    holderName: 'Nova',
    branch: 'ticket-tc-128-card-token',
    sessionRunning: false,
  },
  {
    ...place,
    id: 'repo:r-tinycorp',
    ticketId: null,
    ticketKey: null,
    ticketTitle: null,
    holderName: null,
    branch: null,
    base: null,
    sessionRunning: false,
  },
]
let grouped = false

/** The same place, over the fixture tree: same repo, same branch, four files that never move. */
const fixturePlace: FilePlace = { ...place, path: FIXTURE, sessionRunning: false }

let fixed = false

const files = createFiles({ places: () => (fixed ? [fixturePlace] : grouped ? GROUPS : [place]) })
/**
 * The Changes tab (T160) over the same checkout: the engine's own reader, its own `git status`.
 * `?limit` is the reader's real cap, so a capture of a checkout with fifty changed files still
 * shows one group short enough to compare with the frame, and says it stopped short.
 */
const readers = new Map<number, ReturnType<typeof createFileChanges>>()
function changesAt(limit: number) {
  let found = readers.get(limit)
  if (!found) {
    found = createFileChanges({ places: () => (grouped ? GROUPS : [place]), limit })
    readers.set(limit, found)
  }
  return found
}
// The real thing: this checkout's own TypeScript, read as a language server (T115).
const language = createLanguage({ places: () => [place] })

/** The Files IPC over HTTP, for the capture page alone. */
function filesApi(): Plugin {
  return {
    name: 'files-capture-api',
    configureServer(server) {
      server.middlewares.use('/__files-api', (request, response) => {
        const url = new URL(request.url ?? '/', 'http://capture')
        const answer = (value: unknown) => {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ ok: true, value }))
        }
        const asked = (value: Promise<unknown>) =>
          void value.then(answer).catch((error: unknown) => {
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ ok: false, error: String(error) }))
          })
        const path = () => url.searchParams.get('path') ?? ''
        // Which shape the place list has for this request; see `GROUPS`.
        grouped = url.searchParams.has('groups')
        // `?fixture` reads the committed tree beside this config rather than the checkout.
        fixed = url.searchParams.has('fixture')
        const spot = () => ({
          line: Number(url.searchParams.get('line') ?? 1),
          column: Number(url.searchParams.get('column') ?? 1),
        })
        /** The text the viewer is showing, which for the capture is the file as it is on disk. */
        const showing = () => files.open(place.id, path()).text ?? ''
        const changes = changesAt(Number(url.searchParams.get('limit')) || CHANGES_LIMIT)
        try {
          if (url.pathname === '/language/read') return asked(language.read(place.id, path(), showing()))
          if (url.pathname === '/language/hover') {
            return asked(language.hover(place.id, path(), spot(), showing()))
          }
          if (url.pathname === '/language/definition') {
            return asked(language.definition(place.id, path(), spot(), showing()))
          }
          if (url.pathname === '/changes') {
            // Under `?fixture` nothing has changed, ever: the Changes count is this checkout's own
            // `git status`, which is a different number on every branch and would make the tab's
            // badge move under a baseline that is supposed to prove nothing moved (T209).
            if (fixed) return answer([])
            changes.invalidate()
            return answer(changes.list())
          }
          if (url.pathname === '/change-diff') {
            return answer(changes.diff(url.searchParams.get('placeId') ?? place.id, path()))
          }
          if (url.pathname === '/places') return answer(files.places())
          if (url.pathname === '/tree') return answer(files.tree(place.id))
          if (url.pathname === '/open') return answer(files.open(place.id, url.searchParams.get('path') ?? ''))
          // The capture never writes to the checkout it is reading: a save answers as if it had.
          if (url.pathname === '/save') {
            return answer({ saved: true, file: files.open(place.id, url.searchParams.get('path') ?? '') })
          }
          response.statusCode = 404
          response.end('{}')
        } catch (error) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  // The window's own frame is built from Tailwind utilities (T210f), and every harness draws some
  // of it, so each compiles them too — a harness that renders a screen differently from the app is
  // the drift `design:compare` exists to catch.
  plugins: [react(), tailwind(), filesApi()],
  define: { __APP_VERSION__: JSON.stringify('capture') },
  server: { port: 5188, strictPort: true },
})
