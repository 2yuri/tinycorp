import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { crashReport } from '../../../../shared/app/crash'
import { CrashCard } from './CrashCard'

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The crash the frame draws: `destroy_ is not a function`, out of the Files view's tree. */
function report() {
  return crashReport({
    source: 'view',
    error: new TypeError('destroy_ is not a function'),
    componentStack: '    at FileTree (files/FileTree.tsx:48)\n    at FilesView',
    route: 'board',
    version: '1.4.0',
    platform: 'darwin',
    at: new Date(2026, 8, 21, 12, 41),
  })
}

function card() {
  return renderToStaticMarkup(<CrashCard report={report()} where="Board · Tiny Corp" onReload={() => {}} />)
}

describe('the Something Broke card (frame `Y6xWi`)', () => {
  it('says what stopped, that the work is safe, what broke and where it came from', () => {
    expect(text(card())).toBe(
      'This screen stopped drawing ' +
        'Board · Tiny Corp. Nothing your Employees did was lost — this is the window, not the work. ' +
        'TypeError: destroy_ is not a function ' +
        'at FileTree (files/FileTree.tsx:48) · 21 Sep 2026, 12:41 ' +
        'Reload this screen Copy report ' +
        'The report carries the message above, the screen you were on and the app’s version — nothing from your ' +
        'repos. Send it to whoever gave you this build.',
    )
  })

  it('builds from the kit: the primary action and the secondary one', () => {
    const html = card()

    expect(html).toContain('data-variant="primary"')
    expect(html).toContain('data-variant="secondary"')
    // The content area carries it, so whoever is reading the screen is told first.
    expect(html).toContain('role="alert"')
  })
})
