// A dev-only capture of the Review screen against the design's own fixture, so it can be compared
// with `design/screens/ZCYGy.png`, and with `?threads` with `VtAMR` — the same screen once the two
// agents have had their conversation on it (T170). Nothing here ships.
import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { SHELL_MAIN } from '../../chrome'
import { DIFF_LAYOUT_KEY } from '../../editor'
import * as fixture from './fixture'

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

/**
 * Whether this capture is of the agents' conversation (`?threads`). Without it the screen draws
 * the boss's own line comments, which is what `ZCYGy` shows; with it, the threads of `VtAMR`.
 */
function withThreads(): boolean {
  return new URLSearchParams(window.location.search).has('threads')
}

/**
 * `?split` reads the same screen side by side (T244), which at this width is a layout the boss has
 * to have asked for. The ask lives in `localStorage`, where `useDiffControls` reads it, and is
 * cleared without the parameter so neither shot of this harness depends on which one ran first.
 */
function chooseLayout(): void {
  const asked = new URLSearchParams(window.location.search).has('split')
  if (asked) window.localStorage.setItem(DIFF_LAYOUT_KEY, 'split')
  else window.localStorage.removeItem(DIFF_LAYOUT_KEY)
}

/** Everything the Review screen reads, answered from the fixture. */
function stub(): TinyCorpApi {
  const threads = withThreads() ? fixture.threads : []
  const comments = withThreads() ? [] : fixture.comments
  return {
    board: { snapshot: () => Promise.resolve(fixture.board), onChanged: never },
    staff: { employees: () => ok(fixture.employees), onChanged: never },
    repos: { list: () => ok(fixture.repos), onChanged: never },
    company: { current: () => Promise.resolve(fixture.company), onChanged: never },
    code: { list: () => ok([]), details: () => ok(fixture.details), onChanged: never },
    reviews: {
      list: () => ok([fixture.review]),
      securityPasses: () => ok([]),
      diff: () => ok(fixture.diffs()),
      fileSides: (_ticketId: number, _repoId: string, path: string) => ok(fixture.sides(path)),
      comments: () => ok(comments),
      comment: () => ok(fixture.comments[0]),
      threads: () => ok(threads),
      threadsOnForge: () => ok(true),
      openThread: () => ok(fixture.threads[0]),
      replyInThread: () => ok(fixture.threads[0]),
      setThreadState: () => ok(fixture.threads[0]),
      roundLimit: () => ok(3),
      setRoundLimit: () => ok(3),
      approve: () => ok(fixture.review),
      requestChanges: () => ok(fixture.review),
      onChanged: never,
    },
  } as unknown as TinyCorpApi
}

/** Mounts the Review screen with the fixture behind it, inside the window the frame draws. */
export async function reviewCapture(): Promise<ReactNode> {
  // Both go in before the screen's modules load: one reads the preload API at import time, and
  // the other reads the remembered layout on its first render.
  window.tinyCorp = stub()
  chooseLayout()
  const { ContentHeader } = await import('../../chrome/ContentHeader')
  const { ReviewScreen } = await import('../ReviewScreen')
  return (
    <Frame>
      <ContentHeader title="Review" subtitle="">
        <ReviewScreen target={{ ticketId: 142, repoId: 'r-api' }} onClose={() => {}} />
      </ContentHeader>
    </Frame>
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
