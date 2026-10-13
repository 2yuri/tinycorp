// A dev-only capture of the four states of `design/screens/I44S1a.png`, each drawn by the real
// component the app uses: the Handoffs filter, the empty state, the Activity capture line and the
// Employee drawer's Memory tab. Nothing here ships.
import type { ReactNode } from 'react'
import type { ActivityEvent } from '../../../../shared/activity'
import type { TinyCorpApi } from '../../../../shared/ipc'
import { emptyCounts } from '../../../../shared/memory/company-memory'
import { ActivityFeed } from '../../activity/ActivityFeed'
import * as drawer from '../../employee-drawer/capture-memory/fixture'
import { DRAWER, PANEL_FLUSH } from '../../employee-drawer/EmployeeDrawer'
import { MemoryList } from '../MemoryList'
import * as fixture from './fixture'
import '../../ui/tailwind.css'

const CAPTURED: ActivityEvent = {
  id: 1,
  kind: 'memory_captured',
  actorId: 'company',
  actorName: 'Memory',
  subject: { kind: 'memory', id: 'TC-142', label: 'TC-142' },
  summary: '3 pages updated from TC-142',
  detail: 'from the plan, review threads and testing · Locale handling in billing',
  code: ['TC-142'],
  badge: { label: 'No model', tone: 'neutral' },
  payload: {},
  createdAt: '2026-09-23T16:02:00.000Z',
}

/** Everything the drawer's Memory tab reads, answered from the design's own fixture. */
function stub(): TinyCorpApi {
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
  return {
    notes: {
      view: () => ok(drawer.view),
      addNote: () => ok(drawer.view),
      zoom: (_id: string, range: unknown) => ok({ range, notes: [], nodes: [] }),
      search: () => ok({ matches: [], total: 0, truncated: false, partial: false }),
      raw: () => ok({ text: drawer.raw, total: drawer.view.notes, truncated: true }),
      budget: () => ok(drawer.view.budget),
      setBudget: (tokens: number) => ok(tokens),
    },
    companyMemory: { counts: () => ok({ ...emptyCounts(), pages: 42 }), onChanged: () => () => {} },
  } as unknown as TinyCorpApi
}

export async function memoryStatesCapture(): Promise<ReactNode> {
  // The stub goes in before the panel module loads: it reads the preload API at import time.
  window.tinyCorp = stub()
  const { NotesPanel } = await import('../../employee-drawer/NotesPanel')

  return (
    <div
      style={{
        width: 760,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
        background: 'var(--background)',
      }}
    >
      <State title="a · Handoffs — work that moved between providers">
        <div style={{ height: 400, width: 440, display: 'flex' }}>
          <MemoryList
            rows={fixture.handoffs}
            counts={fixture.counts}
            search=""
            onSearch={() => {}}
            kind="handoff"
            onKind={() => {}}
            sort="used"
            onSort={() => {}}
            openSlug={null}
            onOpen={() => {}}
            onWriteFirst={() => {}}
            now={fixture.NOW}
          />
        </div>
      </State>

      <State title="b · Empty — a new Company">
        <div style={{ height: 480, width: 440, display: 'flex' }}>
          <MemoryList
            rows={[]}
            counts={emptyCounts()}
            search=""
            onSearch={() => {}}
            kind={null}
            onKind={() => {}}
            sort="used"
            onSort={() => {}}
            openSlug={null}
            onOpen={() => {}}
            onWriteFirst={() => {}}
            now={fixture.NOW}
          />
        </div>
      </State>

      <State title="c · The capture line in Activity">
        <div className="flex flex-col" style={{ display: 'flex', height: 190 }}>
          <ActivityFeed
            events={[CAPTURED]}
            group={null}
            onGroup={() => {}}
            actors={[]}
            actorId={null}
            onActor={() => {}}
            peopleOpen={false}
            search=""
            onSearch={() => {}}
            now={new Date('2026-09-23T17:00:00.000Z')}
          />
        </div>
      </State>

      <State title="d · Employee Drawer · Memory tab">
        <div className={DRAWER} style={{ position: 'static', width: 440, height: 560 }}>
          <div className={PANEL_FLUSH}>
            <NotesPanel
              notes={{
                ...drawer.view,
                employeeName: drawer.employeeName,
                employeeId: drawer.employeeId,
                error: null,
                loaded: true,
                addNote: () => {},
              }}
              now={drawer.NOW}
            />
          </div>
        </div>
      </State>
    </div>
  )
}

function State({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ margin: '0 0 10px', color: 'var(--foreground)', font: '600 13px var(--font-primary)' }}>{title}</h2>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>{children}</div>
    </section>
  )
}
