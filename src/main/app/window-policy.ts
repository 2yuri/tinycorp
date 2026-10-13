import { type BrowserWindow, shell } from 'electron'

/**
 * What the app's window is allowed to load, and what it is allowed to ask for (T199, finding H2).
 *
 * `webPreferences` belong to the `webContents`, not to the document: whatever this window navigates
 * to inherits the preload script, and with it the whole `window.tinyCorp` bridge — `files.save()`,
 * `tests.startApp()`, `terminals.write()` into a live Session's PTY. Chromium navigates a page that
 * does not handle a drop to whatever was dropped, so an HTML file an Employee wrote into its own
 * worktree, dragged onto the office by a curious boss, was a document with all of that in it.
 *
 * So nothing replaces the app's own page. `setWindowOpenHandler` is not that guard: it only ever
 * sees `window.open` and `target="_blank"`, never a top-level navigation.
 */

/**
 * The policy the app's document already carries in its `<meta>` tag, sent again as a response
 * header so the *session* enforces it rather than the tag — a tag belongs to one document and the
 * next document does not carry it. `window-policy.test.ts` holds the two to the same words.
 *
 * `worker-src 'self' blob:` is the Files editor's (T222). Chromium will not start a worker from a
 * `file:` URL, which is what a packaged renderer is served over, so Monaco's worker is bundled into
 * the chunk and started from a `blob:` URL; without this directive `script-src` is the fallback and
 * Chromium refuses it outright. Nothing is fetched for it: there is no CDN in the editor's path and
 * no network at runtime. `blob:` here buys a worker the app itself shipped the bytes of, and is not
 * a licence for `script-src`, which stays `'self'` alone.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:"

/**
 * Whether `target` is the app's own page.
 *
 * A `file:` URL has no origin — every file on the disk is as same-origin as the next, which is the
 * whole exploit — so the built page is named by its exact path and nothing beside it passes. A dev
 * server does have one, and everything it serves is the app being written.
 */
export function isAppDocument(target: string, appUrl: string): boolean {
  const to = URL.parse(target)
  const app = URL.parse(appUrl)
  if (!to || !app) return false
  if (app.protocol === 'file:') return to.protocol === 'file:' && to.host === app.host && to.pathname === app.pathname
  return to.origin === app.origin
}

/**
 * Whether a permission a document asks for is granted: only `fullscreen`, and only to the app's own
 * page (T272). The Office's *Full screen* is the HTML Fullscreen API, which Electron routes through
 * the same handler as a camera — denied with everything else, the button did nothing at all. The
 * app needs no camera, microphone, geolocation or notification from the renderer — it has the main
 * process for all four — so a document in this window may ask for none of them.
 */
export function grantsPermission(permission: string, requestingUrl: string, appUrl: string): boolean {
  return permission === 'fullscreen' && isAppDocument(requestingUrl, appUrl)
}

/** Keeps the window on `appUrl`: attach before it is loaded. */
export function applyWindowPolicy(window: BrowserWindow, appUrl: string): void {
  // Links such as PR URLs open in the system browser, never in an app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A drop, an anchor without `target`, a form posting off-origin, `location.href` in a code path
  // that took agent-written text: every one of them arrives here.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppDocument(url, appUrl)) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame && !isAppDocument(details.url, appUrl)) details.preventDefault()
  })
  // Full screen for the app's own page, and nothing else for anybody (see `grantsPermission`).
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(grantsPermission(permission, details.requestingUrl ?? contents.getURL(), appUrl)),
  )
  // Over the built document only. A header covers the whole document, and the page `pnpm dev`
  // serves is Vite's, which writes its React preamble as an inline script *above* the `<meta>` tag
  // — above it, so the tag never applied to it, and a header would stop the dev app drawing at all.
  if (URL.parse(appUrl)?.protocol === 'file:') {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CONTENT_SECURITY_POLICY] },
      })
    })
  }
}
