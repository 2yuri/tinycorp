// Mounts a capture harness in jsdom, so a stub that has fallen behind the screen it stands in for
// fails `pnpm test` rather than quietly shooting a blank page. Harness-only: nothing here ships.
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/** What a mounted harness put on the page, and the teardown its test owes React. */
export interface MountedCapture {
  /** Everything the harness drew, as text — what a blank capture has none of. */
  text: string
  host: HTMLElement
  unmount(): void
}

/** jsdom leaves these unimplemented as a getter-only property, so they are defined, not assigned. */
function define(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value, configurable: true, writable: true })
}

/**
 * The browser APIs these screens reach for that jsdom does not have. All of them are real in the
 * browser the captures are shot in; standing in for them keeps a missing-API crash from reading as
 * a broken harness — and keeps jsdom's "Not implemented" noise out of the test run.
 */
function fillJsdomGaps() {
  // React only drives effects inside `act` when the environment says it is a test one.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // xterm asks for the device pixel ratio the moment the drawer's terminal opens.
  if (typeof window.matchMedia !== 'function') {
    define(window, 'matchMedia', (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      // xterm still uses the pre-2019 pair on the list it watches the pixel ratio with.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
  }
  // Your profile's character picker scrolls the chosen sprite into view on mount.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    define(Element.prototype, 'scrollIntoView', () => {})
  }
  // The drawer's terminal refits itself whenever its box changes size.
  if (typeof globalThis.ResizeObserver !== 'function') {
    define(
      globalThis,
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  }
  // …and waits for its monospace face before it measures a cell.
  if (document.fonts === undefined) define(document, 'fonts', { load: () => Promise.resolve([]) })
  // The pixel characters draw into a canvas; jsdom has no 2D context and says so, loudly.
  define(HTMLCanvasElement.prototype, 'getContext', () => null)
}

/**
 * Renders a harness's exported entry and lets its mount effects settle. The harness installs its
 * own `window.tinyCorp` stub before importing the screen, so each one needs its own test file: the
 * screens bind the preload API at import time, and a module registry is shared within a file.
 *
 * What the stub is laid over is an empty bridge: the capture pages install one in a plain `<script>`
 * before any module runs, and `vitest.setup.ts` does the same here, so a screen that only gets
 * imported — which, since T202, is every screen in the folder next door — binds nothing rather than
 * throwing on an undefined `window.tinyCorp`.
 */
export async function mountCapture(capture: () => Promise<ReactNode>): Promise<MountedCapture> {
  fillJsdomGaps()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const element = await capture()
  await act(async () => {
    root.render(element)
  })
  // The harnesses open their screen from a `setTimeout`, as a click would.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    text: host.textContent ?? '',
    host,
    unmount() {
      act(() => root.unmount())
      host.remove()
    },
  }
}
