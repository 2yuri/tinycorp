import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * jsdom lays nothing out, so xterm and its fit are stood in for: the fit reads `size` for the rows
 * and columns the box would hold, the way the real one measures the box, and `box` is the size the
 * box itself claims — `0` for a drawer open on another tab (TI-3). That the box takes the panel's
 * height rather than its own rows is a matter of layout, which `design/baseline/drawer` sees and
 * this cannot.
 */
const size = { cols: 80, rows: 24 }
const box = { width: 400, height: 600 }
const terminals: FakeTerminal[] = []
let observed: (() => void) | null = null

class FakeTerminal {
  cols = 80
  rows = 24
  options: Record<string, unknown> = {}
  /** Everything xterm was asked to paste, in order: what the right button really did. */
  pasted: string[] = []
  cleared = 0
  selection = ''
  private resized: ((size: { cols: number; rows: number }) => void)[] = []
  constructor() {
    terminals.push(this)
  }
  paste(text: string) {
    this.pasted.push(text)
  }
  clear() {
    this.cleared += 1
  }
  getSelection() {
    return this.selection
  }
  loadAddon(addon: { activate?(term: FakeTerminal): void }) {
    addon.activate?.(this)
  }
  open() {}
  write() {}
  focus() {}
  dispose() {}
  onData = () => ({ dispose() {} })
  onBinary = () => ({ dispose() {} })
  onResize(listener: (size: { cols: number; rows: number }) => void) {
    this.resized.push(listener)
    return { dispose() {} }
  }
  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    for (const listener of this.resized) listener({ cols, rows })
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    term: FakeTerminal | null = null
    activate(term: FakeTerminal) {
      this.term = term
    }
    fit() {
      this.term?.resize(size.cols, size.rows)
    }
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

let host: HTMLDivElement
let root: Root
let sent: [string, number, number][]
let attach: (replay: string) => void
/** What the main process would hand back for a clipboard read, and the profile it would answer with. */
const machine = { clipboard: 'npm test', rightClick: null as string | null, platform: 'win32' }

// Read by LiveTerminal once, when it is imported, so it is set up once and reads the lets above.
;(window as unknown as { tinyCorp: { terminals?: unknown } }).tinyCorp.terminals = {
  attach: () => new Promise((resolve) => (attach = (value: string) => resolve({ ok: true, value }))),
  detach: () => Promise.resolve({ ok: true, value: null }),
  write: () => Promise.resolve({ ok: true, value: null }),
  resize: (id: string, cols: number, rows: number) => {
    sent.push([id, cols, rows])
    return Promise.resolve({ ok: true, value: null })
  },
  onData: () => () => {},
  clipboard: () => Promise.resolve({ ok: true, value: machine.clipboard }),
}
// The right-click setting comes from the boss's profile, and the modifier from the platform (T249).
;(window as unknown as { tinyCorp: Record<string, unknown> }).tinyCorp['profile'] = {
  get: () => Promise.resolve({ ok: true, value: { rightClick: machine.rightClick } }),
  onChanged: () => () => {},
}
;(window as unknown as { tinyCorp: Record<string, unknown> }).tinyCorp['shell'] = {
  get platform() {
    return machine.platform
  },
}

beforeEach(() => {
  vi.useFakeTimers()
  machine.clipboard = 'npm test'
  machine.rightClick = null
  machine.platform = 'win32'
  size.cols = 80
  size.rows = 24
  box.width = 400
  box.height = 600
  terminals.length = 0
  sent = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observed = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => new Promise(() => {}) } })
  // jsdom has no layout: every box claims the size `box` holds, so the fit is allowed to run.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => box.width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => box.height)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount() {
  const { LiveTerminal } = await import('./LiveTerminal')
  await act(async () => root.render(<LiveTerminal employeeId="e-ada" active onError={() => {}} />))
}

/** Past the terminal's resize debounce. */
async function settle() {
  await act(async () => vi.advanceTimersByTime(100))
}

describe('the live terminal’s size (TI-3)', () => {
  it('tells the Session its size once the terminal is open, and again once the replay is in', async () => {
    size.rows = 44
    await mount()
    await settle()
    expect(sent).toEqual([['e-ada', 80, 44]])

    await act(async () => attach('earlier output'))
    await settle()
    expect(sent).toEqual([
      ['e-ada', 80, 44],
      ['e-ada', 80, 44],
    ])
  })

  it('refits when the panel changes size, and the Session gets the new size', async () => {
    await mount()
    await settle()

    size.rows = 16
    act(() => observed?.())
    await settle()

    expect(terminals[0]?.rows).toBe(16)
    expect(sent.at(-1)).toEqual(['e-ada', 80, 16])
  })

  it('tells a Session nothing while its panel has no layout, and its size once it has one', async () => {
    // A drawer open on another tab: the box is hidden, so nothing has measured it and xterm still
    // says the 80×24 it was constructed with. Sending that would shrink the Session to a size
    // nothing is showing.
    box.height = 0
    size.rows = 44
    await mount()
    await act(async () => attach('earlier output'))
    await settle()
    expect(sent).toEqual([])

    box.height = 600
    act(() => observed?.())
    await settle()
    expect(sent).toEqual([['e-ada', 80, 44]])
  })
})

/**
 * The right mouse button (T249).
 *
 * The bug these are written against is a terminal where one of the two behaviours is unreachable:
 * a boss on Windows who cannot paste, or a boss on a Mac whose right-click swallows the menu. So
 * each case asserts both what the plain click did **and** what the modified one did.
 */
describe('the terminal’s right button', () => {
  /** A right-click on the terminal's box, with the modifier held or not. */
  function rightClick(modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
    // The screen itself, never the menu that opens over it — the menu is a sibling with a testid.
    const box = host.querySelector('[data-testid="live-terminal"] > div:not([data-testid])') ?? host
    act(() => {
      box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...modifiers }))
    })
  }

  const menu = () => host.querySelector('[data-testid="terminal-menu"]')

  it('pastes the clipboard on Windows, where that is the habit, and draws no menu', async () => {
    await mount()
    rightClick()
    await act(async () => {})

    expect(terminals[0]?.pasted).toEqual(['npm test'])
    expect(menu()).toBeNull()
  })

  it('opens the menu instead when Ctrl is held, so pasting never costs the menu', async () => {
    await mount()
    rightClick({ ctrlKey: true })
    await act(async () => {})

    expect(menu()).not.toBeNull()
    expect(terminals[0]?.pasted).toEqual([])
  })

  it('opens the menu on a Mac, where that is the habit, and pastes on Cmd+right-click', async () => {
    machine.platform = 'darwin'
    await mount()
    rightClick()
    await act(async () => {})
    expect(menu()).not.toBeNull()

    rightClick({ metaKey: true })
    await act(async () => {})
    expect(terminals[0]?.pasted).toEqual(['npm test'])
  })

  /**
   * On a Mac `Ctrl`-click *is* the secondary click, so it must not be the modifier there: taking
   * it would leave a Mac boss with a right button that never opens the menu.
   */
  it('does not read Ctrl as the modifier on a Mac', async () => {
    machine.platform = 'darwin'
    await mount()
    rightClick({ ctrlKey: true })
    await act(async () => {})

    expect(menu()).not.toBeNull()
    expect(terminals[0]?.pasted).toEqual([])
  })

  it('honours the boss’s own answer over the platform’s habit', async () => {
    machine.rightClick = 'menu'
    await mount()
    // The profile is read over the bridge, so the first answer lands after a tick.
    await act(async () => {})
    rightClick()
    await act(async () => {})

    expect(menu()).not.toBeNull()
    expect(terminals[0]?.pasted).toEqual([])
  })

  it('pastes from the menu, and clears from it', async () => {
    await mount()
    rightClick({ ctrlKey: true })
    await act(async () => {})

    const rows = [...(menu()?.querySelectorAll('[data-slot=menu-item]') ?? [])]
    const paste = rows.find((row) => row.textContent?.includes('Paste'))
    act(() => (paste as HTMLButtonElement).click())
    await act(async () => {})
    expect(terminals[0]?.pasted).toEqual(['npm test'])
    // The menu closes behind whichever row was pressed.
    expect(menu()).toBeNull()

    rightClick({ ctrlKey: true })
    await act(async () => {})
    const clear = [...(menu()?.querySelectorAll('[data-slot=menu-item]') ?? [])].find((row) =>
      row.textContent?.includes('Clear'),
    )
    act(() => (clear as HTMLButtonElement).click())
    expect(terminals[0]?.cleared).toBe(1)
  })

  it('pastes nothing when the clipboard is empty, rather than a blank line into the Session', async () => {
    machine.clipboard = ''
    await mount()
    rightClick()
    await act(async () => {})

    expect(terminals[0]?.pasted).toEqual([])
  })
})
