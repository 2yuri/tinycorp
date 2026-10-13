// A dev-only capture of `Your desk` against the design's own chat fixture, so the panel can be
// compared with the `Your Desk Panel` of `design/screens/KP0yY.png`. Nothing here ships.
import { type ReactNode, useEffect, useState } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import * as fixture from '../../chat/capture/fixture'

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/** Everything the panel reads, answered from the fixture. */
function stub(): TinyCorpApi {
  return {
    chat: {
      bossInbox: () => ok(fixture.bossInbox),
      post: () => ok(fixture.messages[0]),
      onChanged: never,
    },
    staff: { employees: () => ok(fixture.employees), roles: () => ok(fixture.roles), onChanged: never },
    board: { snapshot: () => Promise.resolve(fixture.board), onChanged: never },
    code: { list: () => ok(fixture.code), onChanged: never },
    repos: { list: () => ok(fixture.repos), onChanged: never },
    reviews: { list: () => ok(fixture.reviews), threads: () => ok([]), onChanged: never },
    planning: { list: () => ok(fixture.plans), onChanged: never },
    tests: { list: () => ok([]), onChanged: never },
    approvals: {
      list: () => ok(fixture.approvals),
      level: () => ok('managed'),
      decide: () => ok(fixture.approvals[0]),
      onChanged: never,
    },
    // Hera holds `hire` in the fixture and answers the boss, as the frame's composer hint says.
    answerer: { get: () => ok({ answererId: 'e-hera', waitingForId: null }), onChanged: never },
    // The panel's cards are chat's own, so it reads everything `useChatData` reads — including the
    // digest's zone, which arrived after this harness was written and left it rendering an empty
    // root that shot as a flat background nobody looked at twice (T209).
    digest: { schedule: () => ok(fixture.digestSchedule), onChanged: never },
    company: { current: () => Promise.resolve(fixture.company), onChanged: never },
  } as unknown as TinyCorpApi
}

/** Mounts the panel at the 420x836 the frame gives it under the title bar and the top bar. */
export async function deskCapture(): Promise<ReactNode> {
  // The stub goes in before the view modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  const { BossDesk } = await import('../BossDesk')
  return (
    <Frame>
      <BossDesk companyId={fixture.company.id} onClose={() => {}} />
    </Frame>
  )
}

/** The office canvas behind the panel's left border, so the edge reads as it does in the window. */
function Frame({ children }: { children: ReactNode }) {
  // The character sheets decode a frame or two in; the capture waits for them.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 400)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div style={{ display: 'flex', width: 440, height: 836, overflow: 'hidden', background: '#0B1220' }}>
      <div style={{ width: 20, flexShrink: 0 }} />
      <div style={{ display: 'flex', flex: '1 1 0', minWidth: 0 }} data-ready={ready || undefined}>
        {children}
      </div>
    </div>
  )
}
