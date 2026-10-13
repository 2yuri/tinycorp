import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { UpdateState } from '../../../shared/app/updates'

const quiet: UpdateState = { current: '0.3.9', available: null, checkedAt: '2026-09-18T12:00:00Z', checking: false }
const newer: UpdateState = {
  ...quiet,
  available: {
    tag: 'v0.4.0',
    version: '0.4.0',
    publishedAt: '2026-09-18T12:00:00Z',
    url: 'https://github.com/2yuri/tinycorp/releases/tag/v0.4.0',
  },
}

let UpdateNotice: typeof import('./UpdateNotice').UpdateNotice
let VersionRowView: typeof import('./VersionRow').VersionRowView

beforeAll(async () => {
  // Both read the preload API when their module loads; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { updates: {} } }
  ;({ UpdateNotice } = await import('./UpdateNotice'))
  ;({ VersionRowView } = await import('./VersionRow'))
})

const noop = () => {}

describe('the line in the title bar', () => {
  it('says nothing at all when this is the newest build', () => {
    expect(renderToStaticMarkup(<UpdateNotice state={quiet} onOpen={noop} />)).toBe('')
    expect(renderToStaticMarkup(<UpdateNotice state={{ ...quiet, checkedAt: null }} onOpen={noop} />)).toBe('')
  })

  it('names the newer version, and offers the download page', () => {
    const html = renderToStaticMarkup(<UpdateNotice state={newer} onOpen={noop} />)

    expect(html).toContain('Version 0.4.0 available')
    expect(html).toContain('data-ui="Update Notice"')
    expect(html).toContain('title="Open the download page"')
  })
})

describe('the version row of Your profile', () => {
  const render = (state: UpdateState) =>
    renderToStaticMarkup(<VersionRowView state={state} onCheckNow={noop} onOpenDownloadPage={noop} onSignOut={noop} />)

  it('answers "what build are you on?" without a terminal, and offers Check now', () => {
    const html = render(quiet)

    expect(html).toContain('tinycorp 0.3.9')
    expect(html).toContain('Check now')
    expect(html).toContain('This is the newest build the app could find.')
    expect(html).not.toContain('Open the download page')
  })

  // It is the app's build, and Company settings is the Company's (T181).
  it('carries Sign out, as the frame draws the row', () => {
    expect(render(quiet)).toContain('Sign out')
  })

  it('says it is checking, and will not ask twice at once', () => {
    const html = render({ ...quiet, checking: true })

    expect(html).toContain('Checking…')
    expect(html).toContain('disabled=""')
  })

  it('shows the version, the date and the download page when a newer build exists', () => {
    const html = render(newer)

    expect(html).toContain('Version 0.4.0 · Sep 18, 2026')
    expect(html).toContain('Open the download page')
    expect(html).toContain('Download the DMG and drag it over the old app.')
    // The URL never reaches the page: the main process opens the release it read itself.
    expect(html).not.toContain('https://github.com')
  })
})
