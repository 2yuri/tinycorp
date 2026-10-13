// A dev-only capture of the Testing screen against the design's own fixture, so it can be compared
// with `design/screens/BRzY6.png`, and with `?cards` the three evidence cards of `vKIwf`. Nothing
// here ships.
import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { SHELL_MAIN } from '../../chrome'
import * as fixture from './fixture'

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/** Whether this capture is of the three evidence cards (`vKIwf`) rather than the screen (`BRzY6`). */
function cardsOnly(): boolean {
  return new URLSearchParams(window.location.search).has('cards')
}

/** Everything the Testing screen reads, answered from the fixture. */
function stub(): TinyCorpApi {
  return {
    board: { snapshot: () => Promise.resolve(fixture.board), onChanged: never },
    staff: { employees: () => ok(fixture.employees), onChanged: never },
    repos: { list: () => ok(fixture.repos), onChanged: never },
    company: { current: () => Promise.resolve(fixture.company), onChanged: never },
    code: { list: () => ok(fixture.code), details: () => ok([]), onChanged: never },
    reviews: { list: () => ok([fixture.review]), securityPasses: () => ok([]), onChanged: never },
    tests: {
      of: () => ok(fixture.run),
      list: () => ok([fixture.run]),
      runnable: () => ok(fixture.runnable),
      appLog: () => ok(fixture.log),
      startApp: () => ok(fixture.app),
      stopApp: () => ok(fixture.app),
      addStep: () => ok(fixture.run),
      setStep: () => ok(fixture.run),
      attach: () => ok(fixture.run),
      capture: () => ok(fixture.run),
      // The thumbnail is drawn from the bytes the engine hands back; the capture draws its frame.
      openAttachment: () => ok({ id: 10, name: 'tc142-90d.png', size: 84_000, path: '', dataUrl: null }),
      pass: () => ok(fixture.run),
      reportBug: () => ok(fixture.run),
      settings: () => ok({ mode: 'both', repos: [] }),
      setMode: () => ok({ mode: 'both', repos: [] }),
      setRepo: () => ok({ mode: 'both', repos: [] }),
      onChanged: never,
    },
  } as unknown as TinyCorpApi
}

/** Mounts the Testing screen with the fixture behind it, inside the window the frame draws. */
export async function testingCapture(): Promise<ReactNode> {
  // The stub goes in before the screen's modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  if (cardsOnly()) return cards()
  const { ContentHeader } = await import('../../chrome/ContentHeader')
  const { TestingScreen } = await import('../TestingScreen')
  return (
    <Frame>
      <ContentHeader title="Testing" subtitle="">
        <TestingScreen target={{ ticketId: fixture.TICKET }} onClose={() => {}} />
      </ContentHeader>
    </Frame>
  )
}

/** The three states of the evidence card, stacked as `vKIwf` stacks them. */
async function cards(): Promise<ReactNode> {
  const { TestEvidenceCard } = await import('../TestEvidenceCard')
  const states = [
    { key: 'a', title: 'a · Mode Both — Iris tested, your turn to confirm', run: fixture.evidence.both },
    { key: 'b', title: 'b · Mode QA agent — Iris passed it, merge goes ahead', run: fixture.evidence.agent },
    { key: 'c', title: 'c · Iris found a failure — back to Doing', run: fixture.evidence.failed },
  ]
  return (
    <div style={{ width: 480, padding: 20, background: 'var(--background)' }}>
      {states.map((state) => (
        <section key={state.key} style={{ marginBottom: 28 }}>
          <h2 style={{ margin: '0 0 8px', font: '600 13px/1.4 Inter, sans-serif', color: 'var(--foreground)' }}>
            {state.title}
          </h2>
          <TestEvidenceCard run={state.run} ticketLabel="TC-142" agentName="Iris" />
        </section>
      ))}
    </div>
  )
}

/** The shell's rail (68) and sidebar (276), so the split sits where the window puts it. */
const SHELL_WIDTH = 344

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden', background: 'var(--background)' }}>
      <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--card)' }} />
      <main className={SHELL_MAIN} style={{ display: 'flex', flex: '1 1 0', minWidth: 0, flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  )
}
