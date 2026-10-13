import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UrlLink } from './UrlLink'

const URL_ = 'https://gitlab.com/acme/web/-/merge_requests/157'
let host: HTMLDivElement
let root: Root
let opened: string[]
let copied: string[]

beforeEach(() => {
  opened = []
  copied = []
  vi.spyOn(window, 'open').mockImplementation((url) => {
    opened.push(String(url))
    return null
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<UrlLink url={URL_} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const link = () => host.querySelector('button')!
const item = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find((b) => b.textContent?.includes(name))

describe('UrlLink (T290)', () => {
  it('asks to open or copy on a click, and copies the whole address', () => {
    act(() => link().click())
    expect(item('Open link')).toBeDefined()
    act(() => item('Copy link')!.click())
    expect(copied).toEqual([URL_])
    expect(opened).toEqual([])
    expect(document.querySelector('[role=menu]')).toBeNull()
  })

  it('opens it in the browser from the menu', () => {
    act(() => link().click())
    act(() => item('Open link')!.click())
    expect(opened).toEqual([URL_])
  })

  it('opens it straight away on a click with Cmd or Ctrl held, with no menu', () => {
    act(() => link().dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    act(() => link().dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })))
    expect(opened).toEqual([URL_, URL_])
    expect(document.querySelector('[role=menu]')).toBeNull()
  })
})
