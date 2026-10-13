// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditor } from './MarkdownEditor'

/**
 * The editor in a document (T225): markdown goes in, the boss sees the page rather than the
 * markers, and what comes back out of `onChange` is the markdown again.
 *
 * What the extension set does with a keystroke is `rich-markdown.dom.test.ts`'s question — it can
 * ask ProseMirror directly. This file is about the component the screen mounts: the toolbar, the
 * name the box carries, and the value handed in from outside.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

function editor(over: { value?: string; hidden?: boolean } = {}) {
  const onChange = vi.fn()
  const render = (value: string, hidden = over.hidden ?? false) =>
    act(() => {
      root.render(
        <MarkdownEditor
          value={value}
          hidden={hidden}
          onChange={onChange}
          placeholder="Say the thing first"
          label="Page"
        />,
      )
    })
  render(over.value ?? '')
  return { onChange, render }
}

const prose = () => host.querySelector<HTMLElement>('.ProseMirror')
const button = (label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find((one) =>
    (one.getAttribute('aria-label') ?? '').startsWith(label),
  )
  if (!found) throw new Error(`No toolbar button called "${label}"`)
  return found
}
const press = (label: string) => {
  const found = button(label)
  act(() => found.click())
  return found
}
const lit = (label: string) => button(label).getAttribute('aria-pressed')

describe('the document', () => {
  it('draws the markdown it was handed as the page it will read as, markers and all gone', () => {
    editor({ value: '## Decision\n\nMoney is stored in minor units.' })

    expect(prose()?.innerHTML).toContain('<h2>Decision</h2>')
    expect(prose()?.textContent).toBe('DecisionMoney is stored in minor units.')
  })

  it('names the box for a screen reader, and carries the placeholder while it is empty', () => {
    editor()

    expect(prose()?.getAttribute('aria-label')).toBe('Page')
    expect(host.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe('Say the thing first')
  })

  it('stays mounted while it is hidden, so a look at the preview costs no undo history', () => {
    const { render } = editor({ value: '## Decision' })
    const before = prose()

    render('## Decision', true)
    expect(host.querySelector('[data-ui="Markdown editor"]')?.className).toContain('hidden')
    expect(prose()).toBe(before)
  })
})

describe('the toolbar', () => {
  it('makes each block the ticket asks for, and says it back as markdown', () => {
    const { onChange } = editor({ value: 'one' })

    press('Bullet list')
    expect(onChange).toHaveBeenLastCalledWith('- one')

    press('Task list')
    expect(onChange).toHaveBeenLastCalledWith('- [ ] one')
  })

  it('makes a quote and a fenced block out of a plain paragraph', () => {
    const { onChange } = editor({ value: 'one' })

    press('Quote')
    expect(onChange).toHaveBeenLastCalledWith('> one')

    press('Quote')
    press('Code block')
    expect(onChange).toHaveBeenLastCalledWith('```\none\n```')
  })

  it('lights the button for the block the caret is in', () => {
    editor({ value: 'one' })

    expect(lit('Bullet list')).toBe('false')
    press('Bullet list')
    expect(lit('Bullet list')).toBe('true')
    press('Bullet list')
    expect(lit('Bullet list')).toBe('false')
  })

  /** The window reads as macOS with no preload, which is what every test and every capture is. */
  it('says its shortcuts in the host’s own words', () => {
    editor()

    expect(button('Bold').getAttribute('aria-label')).toBe('Bold (⌘B)')
    expect(button('Italic').getAttribute('aria-label')).toBe('Italic (⌘I)')
    expect(button('Bold').getAttribute('title')).toBe('Bold (⌘B)')
  })

  it('offers a field for a link rather than a dialog over the page', () => {
    editor({ value: 'one' })
    press('Link')

    const field = host.querySelector<HTMLInputElement>('input[aria-label="Link address"]')
    expect(field).not.toBeNull()
    expect(field?.placeholder).toBe('Paste or type a link…')
  })
})

describe('a value set from outside', () => {
  it('replaces the document, and a value it is already holding changes nothing', () => {
    const { onChange, render } = editor({ value: 'one' })

    render('two')
    expect(prose()?.textContent).toBe('two')

    onChange.mockClear()
    render('two')
    expect(onChange).not.toHaveBeenCalled()
  })
})
