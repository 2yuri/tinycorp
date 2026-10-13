import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isNearBottom, NEAR_BOTTOM, useStickToBottom } from './use-stick-to-bottom'

/** A list whose box jsdom cannot measure: it is told how tall it is, the way Chromium would say. */
function List(props: { lastId: number | null; hold?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useStickToBottom(scroller, content, props.lastId, props.hold ?? false)
  return (
    <div
      data-testid="scroller"
      ref={(el) => {
        scroller.current = el
        if (el) {
          Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 })
          Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 })
        }
      }}
    >
      <div ref={content} />
    </div>
  )
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const scroller = () => host.querySelector<HTMLDivElement>('[data-testid=scroller]')!

describe('useStickToBottom (T287)', () => {
  it('scrolls to the end when a new message arrives, even when a capped page kept the same count', () => {
    act(() => root.render(<List lastId={40} />))
    scroller().scrollTop = 0
    act(() => root.render(<List lastId={41} />))
    expect(scroller().scrollTop).toBe(2000)
  })

  it('leaves the view alone while a jump holds it', () => {
    act(() => root.render(<List lastId={40} hold />))
    scroller().scrollTop = 300
    act(() => root.render(<List lastId={41} hold />))
    expect(scroller().scrollTop).toBe(300)
  })

  it('reads the end as anything within a line or two of it', () => {
    expect(isNearBottom({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 - NEAR_BOTTOM })).toBe(true)
    expect(isNearBottom({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1000 })).toBe(false)
  })
})
