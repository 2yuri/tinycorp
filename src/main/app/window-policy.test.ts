import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { onDisk } from '../core/testing'
import { CONTENT_SECURITY_POLICY, grantsPermission, isAppDocument } from './window-policy'

/**
 * The window had no navigation guard at all (T199, finding H2): whatever it was navigated to
 * inherited the preload script and every channel on it. The page that did the navigating was an
 * HTML file an Employee had written into its own worktree and asked the boss to drag onto the
 * office — a `file:` document, on the same disk as the app's own, with `terminals.write()` in it.
 */

const html = readFileSync(join(import.meta.dirname, '../../renderer/index.html'), 'utf8')

const builtPage = pathToFileURL(onDisk('/Applications/TinyCorp.app/out/renderer/index.html')).href
const devServer = 'http://localhost:5173'

describe('the app’s own document', () => {
  it('is the built page itself', () => {
    expect(isAppDocument(builtPage, builtPage)).toBe(true)
  })

  it('is still itself with a query and a hash on it', () => {
    expect(isAppDocument(`${builtPage}?company=acme#office`, builtPage)).toBe(true)
  })

  it('is the dev server’s, wherever on it the page being written lives', () => {
    expect(isAppDocument(`${devServer}/src/main.tsx`, devServer)).toBe(true)
  })
})

describe('everything else', () => {
  it('is not the app because it is a file too: the dropped page is the exploit', () => {
    const dropped = pathToFileURL(onDisk('/Users/boss/work/acme/worktrees/ada/report.html')).href

    expect(isAppDocument(dropped, builtPage)).toBe(false)
  })

  it('is not the app because it sits beside the app’s own page', () => {
    expect(isAppDocument(builtPage.replace('index.html', 'evil.html'), builtPage)).toBe(false)
  })

  it('is not the app because it is on the web', () => {
    expect(isAppDocument('https://example.com/', builtPage)).toBe(false)
    expect(isAppDocument('https://example.com/', devServer)).toBe(false)
  })

  it('is not the app because it is another server, however alike', () => {
    expect(isAppDocument('http://localhost:5174/', devServer)).toBe(false)
    expect(isAppDocument('https://localhost:5173/', devServer)).toBe(false)
  })

  it('is not the app because it is not a document at all', () => {
    expect(isAppDocument('about:blank', builtPage)).toBe(false)
    expect(isAppDocument('data:text/html,<script>fetch(1)</script>', builtPage)).toBe(false)
    expect(isAppDocument('javascript:void 0', builtPage)).toBe(false)
    expect(isAppDocument('not a url', builtPage)).toBe(false)
  })
})

describe('what a document may ask for (T272)', () => {
  it('grants the app’s own page full screen, which the Office’s Full screen button is', () => {
    expect(grantsPermission('fullscreen', builtPage, builtPage)).toBe(true)
    expect(grantsPermission('fullscreen', `${devServer}/`, devServer)).toBe(true)
  })

  it('grants the app nothing else: the main process has the camera, the microphone and the rest', () => {
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal']) {
      expect(grantsPermission(permission, builtPage, builtPage)).toBe(false)
    }
  })

  it('grants a page that is not the app nothing, not even full screen', () => {
    const dropped = pathToFileURL(onDisk('/Users/boss/work/acme/worktrees/ada/report.html')).href

    expect(grantsPermission('fullscreen', dropped, builtPage)).toBe(false)
    expect(grantsPermission('fullscreen', 'https://example.com/', builtPage)).toBe(false)
  })
})

describe('the content security policy', () => {
  it('is word for word the one the document carries, so the header and the tag cannot drift', () => {
    const tag = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1]

    expect(tag).toBe(CONTENT_SECURITY_POLICY)
  })
})
