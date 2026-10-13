// @vitest-environment jsdom
import { act, memo, Profiler, type ReactNode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { ContentHeader, type Route, ViewHeader } from '../chrome'
import { RouteView, VIEWS_BY_ID } from './Views'

/**
 * What an engine change event costs the screen the boss is looking at (T211).
 *
 * The shell reads twelve things behind the sidebar and re-renders whenever any of the seven change
 * events fires, and again on every window focus. None of that is the open view's business: a
 * message arriving in a channel used to redraw the whole Board, every ticket card on it, and
 * everything any view had put into the content header.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const acme: Company = {
  id: 'c1',
  name: 'Acme Labs',
  key: 'AL',
  boss: { name: 'Grace Holt', initials: 'GH' },
  folder: '/work/acme',
  createdAt: '',
}
const noop = () => {}
// Held still, the way `App` holds it: the route is the shell's own state and only the boss moves it.
const ACTIVITY: Route = { view: 'activity' }

let root: Root | null = null
let host: HTMLElement | null = null
/** Says what the engine just said, from outside React — a channel read, a repo checked out. */
let event: () => void = noop

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

/**
 * The shell as `App` draws it: a header whose subtitle carries what the engine last said, and
 * whatever is under it. The subtitle moving is what every change event and every focus does.
 *
 * `draw` is called during the render, as `App` writes its tree out in full every time: handing the
 * same element in from outside would be React skipping the subtree for a reason that is not ours.
 */
function Shell({ draw }: { draw: () => ReactNode }) {
  const [said, setSaid] = useState(0)
  event = () => setSaid((n) => n + 1)
  return (
    <ContentHeader title="Activity" subtitle={`${said} Employees`}>
      {draw()}
    </ContentHeader>
  )
}

function mount(draw: () => ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Shell draw={draw} />))
}

describe('the shell, when the engine says something the open view has no part in', () => {
  it('does not draw the open view again', () => {
    let drawn = 0
    const real = VIEWS_BY_ID.activity
    // A view the test can count, in the registry every view is reached through.
    VIEWS_BY_ID.activity = () => {
      drawn += 1
      return <p>Every action your employees took.</p>
    }
    try {
      mount(() => <RouteView route={ACTIVITY} company={acme} onNavigate={noop} />)
      expect(drawn).toBe(1)

      act(() => event())
      act(() => event())

      expect(host!.textContent).toContain('Every action your employees took.')
      expect(drawn).toBe(1)
    } finally {
      VIEWS_BY_ID.activity = real
    }
  })

  it('leaves what a view put in the content header alone', () => {
    const renders: string[] = []
    // Memoised the way the router memoises a view, so the one thing left that can draw `<ViewHeader>`
    // again is the value it reads through the header's own context.
    const View = memo(function View() {
      return (
        <Profiler id="claim" onRender={(_id, phase) => renders.push(phase)}>
          <ViewHeader title="Activity">
            <button type="button">New page</button>
          </ViewHeader>
        </Profiler>
      )
    })

    mount(() => <View />)
    renders.length = 0

    act(() => event())

    expect(renders).toEqual([])
  })
})
