// @vitest-environment jsdom
import { act, type ReactNode, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReport } from '../../../../shared/app/crash'
import { formatCrashReport } from '../../../../shared/app/crash'
import { installCrashHandlers } from './report'
import { ScreenBoundary } from './ScreenBoundary'

/** A view that throws while it draws, the way a bad render does. */
function Boom({ message = 'destroy_ is not a function' }: { message?: string }): ReactNode {
  throw new TypeError(message)
}

let host: HTMLDivElement
let root: Root
const caught: CrashReport[] = []
/** What the boundary wrote to the app's log, through the preload the window would have. */
const recorded: CrashReport[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  caught.length = 0
  recorded.length = 0
  Object.defineProperty(window, 'tinyCorp', {
    configurable: true,
    value: {
      crash: { platform: 'darwin', record: (report: CrashReport) => (recorded.push(report), Promise.resolve()) },
    },
  })
  // React writes every caught error to the console; the test reads the card, not the noise.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function draw(element: ReactNode) {
  act(() => root.render(<StrictMode>{element}</StrictMode>))
}

/** The shell around the content area, so a crash that took the app with it would be visible. */
function shell(view: ReactNode, route: string, company = 'Tiny Corp') {
  return (
    <div>
      <nav>Sidebar</nav>
      <ScreenBoundary key={route} route={route} where={`${route} · ${company}`} onCrash={(r) => caught.push(r)}>
        {view}
      </ScreenBoundary>
    </div>
  )
}

const text = () => host.textContent ?? ''
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label))!

describe('a view that stops drawing', () => {
  it('draws the card in its own place, and leaves the shell standing', () => {
    draw(shell(<Boom />, 'board'))

    expect(text()).toContain('This screen stopped drawing')
    expect(text()).toContain('TypeError: destroy_ is not a function')
    expect(text()).toContain('board · Tiny Corp. Nothing your Employees did was lost')
    // The shell around the content area never came down with it.
    expect(text()).toContain('Sidebar')
  })

  it('clears when the boss moves to another view', () => {
    draw(shell(<Boom />, 'board'))
    expect(text()).toContain('This screen stopped drawing')

    draw(shell(<p>Every action your employees took</p>, 'activity'))

    expect(text()).not.toContain('This screen stopped drawing')
    expect(text()).toContain('Every action your employees took')
  })

  it('comes back when `Reload this screen` remounts a view that stopped throwing', () => {
    let broken = true
    function Flaky() {
      const [attempt] = useState(0)
      if (broken) throw new TypeError(`still broken on ${attempt}`)
      return <p>The board, drawn</p>
    }
    draw(shell(<Flaky />, 'board'))
    expect(text()).toContain('This screen stopped drawing')

    broken = false
    act(() => button('Reload this screen').click())

    expect(text()).toContain('The board, drawn')
    expect(text()).not.toContain('This screen stopped drawing')
  })

  it('draws the card again when the reloaded view throws once more', () => {
    draw(shell(<Boom message="still gone" />, 'files'))

    act(() => button('Reload this screen').click())

    expect(text()).toContain('This screen stopped drawing')
    expect(text()).toContain('TypeError: still gone')
  })

  it('writes what it caught down, with the screen and the component stack', () => {
    draw(shell(<Boom />, 'board'))

    expect(caught).toHaveLength(1)
    expect(caught[0]).toMatchObject({
      source: 'view',
      route: 'board',
      message: 'TypeError: destroy_ is not a function',
    })
    expect(caught[0]!.stack).toContain('at Boom')
  })

  // A tester who reloads the screen without copying the report is then not the only record of it.
  it('sends it to the app\u2019s log, with nobody watching', () => {
    draw(
      <ScreenBoundary route="board" where="Board · Tiny Corp">
        <Boom />
      </ScreenBoundary>,
    )

    expect(recorded).toEqual([
      expect.objectContaining({ source: 'view', route: 'board', message: 'TypeError: destroy_ is not a function' }),
    ])
  })
})

describe('`Copy report`', () => {
  /**
   * A crash in the Files view of a Company whose folder, whose tickets and whose boss are all on
   * the screen around it — and whose error message names a file in one of the boss's repos.
   */
  function crash() {
    function Files(): ReactNode {
      throw new TypeError("destroy_ is not a function, reading '/Users/grace/work/acme/src/FileTree.tsx'")
    }
    draw(
      <div>
        <nav>Grace Holt · /work/acme</nav>
        <p>Ship the billing dashboard before Friday</p>
        <ScreenBoundary route="files" where="Files · Tiny Corp" onCrash={(report) => caught.push(report)}>
          <Files />
        </ScreenBoundary>
      </div>,
    )
    return formatCrashReport(caught[0]!)
  }

  it('carries the message, the screen and the version', () => {
    const report = crash()

    expect(report).toContain('TypeError: destroy_ is not a function')
    expect(report).toContain('screen files')
    expect(report).toContain('TinyCorp test · darwin')
  })

  it('carries nothing from a repo, a ticket or the boss', () => {
    const report = crash()

    expect(report).toContain("reading '…/FileTree.tsx'")
    expect(report).not.toContain('/Users/grace')
    expect(report).not.toContain('work/acme')
    expect(report).not.toContain('Grace Holt')
    expect(report).not.toContain('Ship the billing dashboard')
  })

  it('puts it on the clipboard when the boss asks for it', () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value: string) => (written.push(value), Promise.resolve()) },
    })
    draw(shell(<Boom />, 'board'))

    act(() => button('Copy report').click())

    expect(written[0]).toContain('TypeError: destroy_ is not a function')
  })
})

/** What the browser sends for a promise nobody awaited; jsdom has no `PromiseRejectionEvent`. */
function rejection(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason })
}

describe('a throw outside React', () => {
  it('is recorded rather than reaching a console nobody has open', () => {
    const stop = installCrashHandlers(window)

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('outside every render') }))
    window.dispatchEvent(rejection(new Error('nobody awaited this')))
    stop()
    window.dispatchEvent(rejection(new Error('after the handlers went')))

    expect(recorded).toHaveLength(2)
    expect(recorded[0]).toMatchObject({ source: 'window', message: 'Error: outside every render' })
    expect(recorded[1]).toMatchObject({ source: 'window', message: 'Error: nobody awaited this' })
  })
})
