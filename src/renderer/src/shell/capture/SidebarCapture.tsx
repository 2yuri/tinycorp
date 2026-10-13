// A dev-only capture of the shell's sidebar (`sidebar-capture.html`), so its nav can be compared
// with `design/screens/rPfPD.png`. It stands in for the engine with the design's fixture.
import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { SHELL, SHELL_BODY } from '../../chrome'
import { CompanyRail } from '../CompanyRail'
import * as fixture from './fixture'

const noUsage = { providers: [], readAt: null }

function stub(): TinyCorpApi {
  // The sidebar is handed its data; only the modules it pulls in read the preload API at import time.
  // The Usage button is one of them, and asks for numbers the moment it mounts.
  return {
    company: {},
    companies: {},
    usage: {
      read: () => Promise.resolve({ ok: true, value: noUsage }),
      refresh: () => Promise.resolve({ ok: true, value: noUsage }),
      onChanged: () => () => {},
    },
  } as unknown as TinyCorpApi
}

const noop = () => {}

/** The sidebar's own width, the Company rail left out. */
export const SIDEBAR_WIDTH = 276
/**
 * What the app gives the sidebar: the 944 window less the 44px title bar. The nav is a scroller
 * with a spacer that pins Company settings above the footer, so a harness that draws it taller
 * than the app hides whatever overflows at the real height (T147).
 */
export const SIDEBAR_HEIGHT = 944 - 44

/** The sidebar at the size and inside the wrapper the app gives it. */
/** `drafts` leaves a message unsent in `#tech` and in a DM, so the rows carry the draft pencil (TI-1). */
export async function sidebarCapture({ drafts = false }: { drafts?: boolean } = {}): Promise<ReactNode> {
  window.tinyCorp = stub()
  const { Sidebar } = await import('../Sidebar')
  // `.shell` carries the tokens the sidebar's own labels are coloured with — `--shell-text-soft`
  // among them — so a sidebar drawn outside it is captured at the wrong colours (App.tsx wraps it
  // inside the window's own frame over the body, and so is this).
  return (
    <div data-ui="Capture Window" className={SHELL} style={{ width: SIDEBAR_WIDTH, height: SIDEBAR_HEIGHT }}>
      <div className={SHELL_BODY}>
        <Sidebar
          company={fixture.company}
          companies={[fixture.company]}
          data={drafts ? fixture.drafted : fixture.data}
          route={{ view: 'chat' }}
          onNavigate={noop}
          onSwitch={noop}
          onCreate={noop}
          onOpen={noop}
        />
      </div>
    </div>
  )
}

/** The rail's own width, which is what frame `u9sLao` measures its marks against. */
export const RAIL_WIDTH = 68

/**
 * The Company rail on its own (`?rail`), at the size the window gives it: one Company with a
 * one-digit badge and a working dot, one with a two-digit badge, one only working and one idle —
 * the four tiles of frame `u9sLao`, which is what `design:compare` holds this state to (T251).
 */
export async function railCapture(): Promise<ReactNode> {
  window.tinyCorp = stub()
  return (
    <div
      data-ui="Capture Window"
      className={SHELL}
      style={{ width: RAIL_WIDTH, height: fixture.RAIL_HEIGHT, background: '#080d18' }}
    >
      <CompanyRail
        companies={fixture.railCompanies}
        currentId={fixture.company.id}
        onSwitch={noop}
        onCreate={noop}
        attention={fixture.railAttention}
      />
    </div>
  )
}
