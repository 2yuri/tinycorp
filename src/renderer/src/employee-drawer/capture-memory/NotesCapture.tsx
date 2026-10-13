// A dev-only capture of the drawer's Memory tab against the design's own fixture, so the panel can
// be compared with the Memory panel of `design/screens/x40RJd.png`. It stands in for the engine;
// nothing here ships.
import type { ReactNode } from 'react'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { emptyCounts } from '../../../../shared/memory/company-memory'
import { DRAWER, PANEL_FLUSH } from '../EmployeeDrawer'
import type { NotesModel } from '../NotesPanel'
import * as fixture from './fixture'

/** What the frame gives the panel: 440 wide, from under the tab rule down to the drawer footer. */
const PANEL_HEIGHT = 634
const DRAWER_WIDTH = 440

/** Everything the panel reads, answered from the fixture; its writes go nowhere. */
function stub(): TinyCorpApi {
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
  return {
    notes: {
      view: () => ok(fixture.view),
      addNote: () => ok(fixture.view),
      zoom: (_id: string, range: unknown) => ok({ range, notes: [], nodes: [] }),
      search: () => ok({ matches: [], total: 0, truncated: false, partial: false }),
      raw: () => ok({ text: fixture.raw, total: fixture.view.notes, truncated: true }),
      budget: () => ok(fixture.view.budget),
      setBudget: (tokens: number) => ok(tokens),
    },
    companyMemory: { counts: () => ok({ ...emptyCounts(), pages: 42 }), onChanged: () => () => {} },
  } as unknown as TinyCorpApi
}

/** Mounts the panel as the frame shows it, at the drawer's own width. */
export async function notesCapture(): Promise<ReactNode> {
  // The stub goes in before the panel module loads: it reads the preload API at import time.
  window.tinyCorp = stub()
  const { NotesPanel } = await import('../NotesPanel')
  const notes: NotesModel = {
    ...fixture.view,
    employeeName: fixture.employeeName,
    employeeId: fixture.employeeId,
    error: null,
    loaded: true,
    addNote: () => {},
  }
  return (
    <div className={DRAWER} style={{ position: 'static', width: DRAWER_WIDTH, height: PANEL_HEIGHT }}>
      <div className={PANEL_FLUSH}>
        <NotesPanel notes={notes} now={fixture.NOW} />
      </div>
    </div>
  )
}
