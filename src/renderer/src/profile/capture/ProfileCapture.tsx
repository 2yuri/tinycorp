// A dev-only capture of Your profile against the design's own fixture, so the page can be compared
// with `design/screens/Oykzs.png`. It stands in for the engine; nothing here ships.
import { type ReactNode, useEffect } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { emptyCounts } from '../../../../shared/memory/company-memory'
import { navigate } from '../../chrome/navigate'
import * as fixture from './fixture'

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/** Everything the shell and Your profile read, answered from the fixture. */
function stub(): TinyCorpApi {
  return {
    company: {
      current: () => Promise.resolve(fixture.company),
      list: () => Promise.resolve(fixture.companies),
      temporaryRoots: () => Promise.resolve([]),
      update: () => ok(fixture.company),
      attention: () => Promise.resolve([]),
      onAttentionChanged: never,
      switchTo: () => ok(fixture.company),
      onChanged: never,
    },
    profile: { get: () => ok(fixture.boss), update: () => ok(fixture.boss), onChanged: never },
    launcher: { summaries: () => Promise.resolve(fixture.summaries), setWindowLayout: () => Promise.resolve() },
    staff: {
      employees: () => ok(fixture.employees),
      roles: () => ok([]),
      permissionDefault: () => ok('skip-permissions'),
      setPermissionDefault: (mode: string) => ok(mode),
      onChanged: never,
    },
    chat: {
      channels: () => ok(fixture.channels),
      agentPairs: () => ok([]),
      unread: () => ok(fixture.unread),
      draftedChannels: () => ok([]),
      bossInbox: () => ok([]),
      onChanged: never,
    },
    board: { snapshot: () => Promise.resolve(fixture.board), onChanged: never },
    // The shell starts on the Office and this harness mounts the whole window, so the floor is
    // drawn for a frame before the profile opens over it: an empty room, since nobody is in it here.
    office: {
      facts: () =>
        ok({ room: 'day-office', sessions: [], activity: [], approvals: [], tickets: [], asking: [], routed: [] }),
      room: () => ok('day-office'),
      onChanged: never,
    },
    repos: { list: () => ok(fixture.repos), onChanged: never },
    code: { list: () => ok([]), onChanged: never },
    companyMemory: { counts: () => ok(emptyCounts()), onChanged: never },
    approvals: { list: () => ok([]), level: () => ok('managed'), onChanged: never },
    capacity: { get: () => ok(fixture.capacity), usage: () => ok(fixture.usage), onChanged: never },
    // What the CLIs on this Mac report, for the Providers card (T141). Both reads are cached
    // answers in the real app too — neither costs a subprocess.
    usage: { read: () => ok(fixture.providerUsage()), refresh: () => ok(fixture.providerUsage()), onChanged: never },
    // `status` is what can block the Launcher, and is still scoped to the Providers this Company
    // is hired on (T135); `all` is the whole catalogue, which is what the card draws (T141).
    preflight: {
      status: () => Promise.resolve(fixture.preflightInUse),
      all: () => Promise.resolve(fixture.preflight),
      recheck: () => ok(fixture.preflightInUse),
      onChanged: never,
    },
    // The boss's sign-ins per Provider (T173, frame `A2lOk0`): a label and a directory each, and
    // never a credential — `Add another account` runs the product's own login in a terminal.
    routing: {
      get: () => ok(fixture.routing),
      addAccount: () => ok(fixture.routing),
      renameAccount: () => ok(fixture.routing),
      setDefaultAccount: () => ok(fixture.routing),
      removeAccount: () => ok(fixture.routing),
      login: () => ok(undefined),
      onChanged: never,
    },
    notifications: { enabled: () => ok(true), onFocus: never, onChanged: never },
    answerer: { get: () => ok(fixture.answerer), onChanged: never },
    hiring: { headcount: () => ok(fixture.headcount), onChanged: never },
    sessions: { list: () => ok([]), paused: () => ok(false), onChanged: never },
    // Whether a newer build exists (T130); the fixture has one, so the line and the row both show.
    updates: {
      get: () => Promise.resolve(fixture.update),
      checkNow: () => Promise.resolve(fixture.update),
      openDownloadPage: () => Promise.resolve(),
      onChanged: never,
    },
    // The shell listens for the application menu; the harness has no menu to send one.
    shell: { toggleMaximize: () => Promise.resolve(), onMenuCommand: never },
    // The onboarding gate is read before anything is routed (T59): a Company whose wizard is owed
    // opens into the wizard, and until the mark comes back `App` draws nothing at all. The fixture's
    // Company finished its wizard, so the profile opens behind it.
    onboarding: { progress: () => ok(fixture.onboarding), save: () => ok(null), finish: () => ok(null) },
  } as unknown as TinyCorpApi
}

/** Mounts the whole window on Your profile, as the frame shows it. */
export async function profileCapture(): Promise<ReactNode> {
  // The stub goes in before the view modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  const { App } = await import('../../App')
  return (
    <Frame>
      <App />
    </Frame>
  )
}

function Frame({ children }: { children: ReactNode }) {
  useEffect(() => {
    // The shell starts on the Office; the same event the drawer's boss row sends opens the profile.
    const timer = setTimeout(() => navigate({ view: 'profile' }))
    return () => clearTimeout(timer)
  }, [])
  return (
    <div style={{ position: 'relative', width: 1512, height: 944, overflow: 'hidden' }}>
      {children}
      <TrafficLights />
    </div>
  )
}

/** macOS draws these over the title bar's 120px slot; a browser capture has to stand in for them. */
function TrafficLights() {
  const dot = (background: string) => ({ width: 12, height: 12, borderRadius: '50%', background })
  return (
    <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8 }} aria-hidden>
      <span style={dot('#FF5F57')} />
      <span style={dot('#FEBC2E')} />
      <span style={dot('#28C840')} />
    </div>
  )
}
