// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { focusOnMount } from './autofocus'

/**
 * `focusOnMount` replaced `autoFocus` everywhere a field appears because the boss opened something
 * (T190). It has to behave the same: the caret lands in the new field, once, and staying on the
 * page must not take it back — a re-render that moved the caret would be worse than the attribute.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function draw(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

describe('focusOnMount', () => {
  it('puts the caret in the field as it arrives', () => {
    const host = draw(
      <>
        <input aria-label="first" />
        <input aria-label="second" ref={focusOnMount} />
      </>,
    )

    expect(document.activeElement).toBe(host.querySelector('[aria-label="second"]'))
  })

  it('does not take the caret back on a later render', () => {
    function Box({ value }: { value: string }) {
      return (
        <>
          <input aria-label="first" />
          <input aria-label="second" readOnly value={value} ref={focusOnMount} />
        </>
      )
    }
    const host = draw(<Box value="a" />)
    const first = host.querySelector<HTMLInputElement>('[aria-label="first"]')!
    first.focus()

    act(() => root!.render(<Box value="b" />))

    expect(document.activeElement).toBe(first)
  })
})
