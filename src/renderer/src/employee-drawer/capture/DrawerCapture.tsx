// A dev-only capture of the Employee drawer (`drawer-capture.html`): its Chats tab, to compare with
// `design/screens/VkcVg.png`, and with `?view=subagents` its Terminal tab's subagent strip, to
// compare with `design/screens/CuLyV.png`. It stands in for the engine with the design's fixture.
import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { emptyCounts } from '../../../../shared/memory/company-memory'
import { rememberChecklistOpen } from '../checklist-fold'
import { DRAWER_WIDTH } from '../drawer-width'
import * as fixture from './fixture'

/** The Memory tab is not on screen here; it only needs an answer that parses. */
const EMPTY_NOTES = { recent: [], earlier: [], tokens: 0, budget: 4_000, notes: 0, summaries: 0, due: null }

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/** Every terminal the drawer attached, in order: which Session's terminal is on screen. */
export const attachedTerminals: string[] = []

/** Everything the drawer put on the clipboard, in order; see the stand-in in `drawerCapture`. */
export const copiedText: string[] = []

/**
 * The two switches that are not a view: RTK compressing, and an Employee that has been woken.
 * Both are off in the frames, and both are the only state one stylesheet is ever drawn in, so the
 * baseline asks for them by query rather than by a fixture of its own (T209).
 */
let compressing = false
let woken = false
let working = false

function stub(replay: (id: string) => string = () => ''): TinyCorpApi {
  return {
    chat: {
      conversations: () => ok(fixture.conversations),
      read: () => ok(fixture.messages),
      markRead: () => ok(true),
      post: () => ok(fixture.messages[0]),
      onChanged: never,
    },
    staff: { employees: () => ok(fixture.employees), onChanged: never },
    // The terminal header carries the RTK chip (T179). The drawer's own frames were drawn before
    // it, so the harness answers with RTK off and the chip draws nothing — unless `?rtk=on` asks
    // for the Company that is compressing, which is the only state `rtk-chip.css` is drawn in.
    rtk: {
      read: () => ok(compressing ? fixture.rtkOn : fixture.rtkOff),
      savings: () => ok(compressing ? fixture.rtkSavings : null),
      onChanged: never,
    },
    // The drawer asks for the command that opens this Session in a terminal (T164). A Provider
    // that builds none answers null and the strip draws no button at all.
    sessions: { handoffCommand: () => ok(fixture.handoff), onChanged: never },
    // `useInbox` runs on every mount of the drawer, not only on the Chats tab, and reads the
    // Company for the boss's tile and the key its ticket ids carry (T79, TC-142). Without it the
    // drawer throws while React renders and the page comes back as bare background.
    company: { current: () => Promise.resolve(fixture.company), onChanged: never },
    inbox: { list: () => ok(woken ? fixture.wokenWakes : fixture.wakes), onChanged: never },
    // `?ticket` gives Nova a ticket in Doing with a checklist long enough to cover the terminal,
    // which is what the card under it folds away (TI-2).
    board: { snapshot: () => Promise.resolve(working ? fixture.longTicket : null), onChanged: never },
    notes: {
      view: () => ok(EMPTY_NOTES),
      addNote: () => ok(EMPTY_NOTES),
      zoom: (_id: string, range: unknown) => ok({ range, notes: [], nodes: [] }),
      search: () => ok({ matches: [], total: 0, truncated: false, partial: false }),
      raw: () => ok({ text: '', total: 0, truncated: false }),
      budget: () => ok(EMPTY_NOTES.budget),
      setBudget: (tokens: number) => ok(tokens),
    },
    companyMemory: { counts: () => ok({ ...emptyCounts(), pages: 42 }), onChanged: () => () => {} },
    // The terminal is mounted but hidden behind the Chats tab; it needs no data. `attach` still
    // answers with a replay, even an empty one: xterm throws on anything else — and `write`,
    // `resize` and `detach` answer with a Result, because the view reads what comes back. The
    // terminal debounces its first `resize` by 300ms, so one that answered with an unsubscribe
    // function threw `.then is not a function` after the harness had already drawn, which failed
    // the whole run at random.
    terminals: {
      attach: (id: string) => {
        attachedTerminals.push(id)
        return ok(replay(id))
      },
      detach: () => ok(null),
      write: () => ok(null),
      resize: () => ok(null),
      onData: never,
    },
  } as unknown as TinyCorpApi
}

/** The drawer at its designed 440x836: the window's 944 less the title bar and the content header. */
const DRAWER_HEIGHT = 944 - 44 - 64

/**
 * Which of the drawer's frames to draw: its Chats tab, its Terminal tab with the strip of `CuLyV`
 * — as Claude Code's own subagents (T162), or as Sessions Nova started of her own (T163), which is
 * what the frame draws — the meta strip with a stopped Session, where the handoff button of
 * `zOVl6` can be pressed, or the routing chip of `tdI8o` (a), which says where an Employee is
 * working while its own Provider is out (T173).
 */
export type DrawerView = 'chats' | 'subagents' | 'sessions' | 'handoff' | 'routed'

/** What the drawer is drawn over, beside which tab it is on. */
export interface DrawerExtras {
  /** The Company is compressing, so the terminal header draws its RTK chip. */
  rtk?: boolean
  /** The Employee has been woken, so the Chats tab has a `Wakes` list to fold away. */
  wakes?: boolean
  /** Nova holds a ticket with a long checklist, folded under the terminal or opened (TI-2). */
  ticket?: 'folded' | 'open'
}

export async function drawerCapture(view: DrawerView = 'chats', extras: DrawerExtras = {}): Promise<ReactNode> {
  compressing = extras.rtk === true
  woken = extras.wakes === true
  working = extras.ticket !== undefined
  // Through the drawer's own writer, so the key is written in one place; a capture with storage off
  // draws the card folded, which is its default anyway.
  rememberChecklistOpen(extras.ticket === 'open')
  const subagents = view === 'subagents'
  const sessions = view === 'sessions'
  // `zOVl6`'s first half: a stopped Session, so the handoff button is on and can be clicked.
  const stopped = view === 'handoff'
  // `tdI8o` (a): Vega is working on the fallback Provider until her own resets at 21:00.
  const routed = view === 'routed' ? fixture.routedTo() : null
  // Headless Chrome refuses `navigator.clipboard.writeText` on an unfocused document, and a
  // capture cannot press a button the browser will not let through — so the harness stands in for
  // the clipboard the way it stands in for the engine. The app itself uses the real one.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copiedText.push(text)
        return Promise.resolve()
      },
    },
  })
  // The stub goes in before the view modules load: they read the preload API at import time.
  // With Sessions, the frame's terminal is `tests`' own, and Nova's is another.
  window.tinyCorp = stub((id) =>
    subagents
      ? fixture.terminalReplay
      : sessions
        ? id === 'sub-tests'
          ? fixture.terminalReplay
          : fixture.parentReplay
        : '',
  )
  // The terminal comes in a chunk of its own (T211). A capture stands exactly where the screen
  // stands, so it waits for that chunk here rather than shooting an empty terminal box.
  await import('../../terminal/LiveTerminal')
  const { EmployeeDrawer } = await import('../EmployeeDrawer')
  return (
    // `.employee-drawer` is `position: fixed`, and a transformed ancestor is what a fixed box is
    // laid out against — so the drawer fills this 440x836 box rather than the window's right edge.
    // Without it the capture is off by however much wider the window is, and on macOS Chrome will
    // not open one narrower than 500px.
    <div
      style={{
        position: 'relative',
        width: DRAWER_WIDTH,
        height: DRAWER_HEIGHT,
        transform: 'translateZ(0)',
        background: 'var(--background)',
      }}
    >
      <EmployeeDrawer
        employee={fixture.nova}
        status={stopped ? 'off' : 'busy'}
        startedAt={stopped ? null : new Date(Date.now() - (4 * 60 + 12) * 60_000).toISOString()}
        state={stopped ? 'off' : 'working'}
        defaultTab={subagents || sessions ? 'terminal' : 'chats'}
        subagents={subagents ? fixture.subagents(Date.now()) : []}
        subSessions={sessions ? fixture.subSessions(Date.now()) : []}
        concurrencyCap={5}
        routedTo={routed}
        onStart={() => {}}
        onStop={() => {}}
        onClose={() => {}}
        onDm={() => {}}
      />
    </div>
  )
}
