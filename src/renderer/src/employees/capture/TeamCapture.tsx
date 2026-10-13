// A dev-only capture of the Team screen — the grid of Employee cards, its header and its side
// panel — over the chat fixture's Company (`team-capture.html`, T209). Nothing here ships.
//
// The screen had no harness at all until T209, which is why `employees.css` was the largest
// stylesheet in the renderer that no capture drew. It has no Pen frame of its own either, so it is
// in the baseline table and not in the audit's: what it is for is a picture of the screen as the
// app draws it today, to hold a Tailwind migration to.
import { type ReactNode, useState } from 'react'
import type { Company } from '../../../../shared/company'
import type { TinyCorpApi } from '../../../../shared/ipc'
import * as chat from '../../chat/capture/fixture'
import { roles, servers, skills } from './EditCapture'

/** A subscription that never fires: the fixture does not change while capturing. */
const never = () => () => {}
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })

const COMPANY: Company = chat.company

/**
 * Everything the Team screen reads.
 *
 * The lists that carry their own screen — the team load, the standing hire requests, the former
 * Employees — answer empty, which is the state a Company is in most of the time and the one the
 * grid is drawn for. What matters here is the grid, the header and the side panel.
 */
function stub(): TinyCorpApi {
  return {
    staff: {
      employees: () => ok(chat.employees),
      roles: () => ok(roles),
      permissionDefault: () => ok('skip-permissions'),
      onChanged: never,
    },
    hiring: {
      former: () => ok([]),
      requests: () => ok([]),
      teamLoad: () => ok(null),
      headcount: () => ok({ current: chat.employees.length, max: 12 }),
    },
    capacity: {
      get: () => ok({ concurrencyCap: 3, running: 2, parked: [], budget: null }),
      onChanged: never,
    },
    mcp: { list: () => ok(servers), onChanged: never },
    skills: { list: () => ok(skills), onChanged: never },
    repos: { list: () => ok(chat.repos), onChanged: never },
    approvals: { list: () => ok([]), level: () => ok('managed'), onChanged: never },
    board: { snapshot: () => Promise.resolve(chat.board), onChanged: never },
    chat: { channels: () => ok(chat.channels), onChanged: never },
    sessions: { list: () => ok([]), onChanged: never },
    // No facts: the office projects the roster alone, which is all the cards read of it.
    office: { facts: () => Promise.resolve({ ok: false as const, error: 'no office in a capture' }), onChanged: never },
    preflight: { all: () => Promise.resolve([]), status: () => Promise.resolve(null), onChanged: never },
    company: { current: () => Promise.resolve(COMPANY), onChanged: never },
  } as unknown as TinyCorpApi
}

/**
 * Which side panel the page opens on (T240). `?panel=roles` is the Roles list (frame `ffZp1`),
 * `?panel=role-editor` the editor of the role it names (`g0D3Ua`), and `?panel=new-role` the
 * New role dialog over the list (`s1iawl`). Without one, the screen opens as it always did.
 */
function openPanel(): { view: 'employees'; editRole?: string } {
  const panel = new URLSearchParams(window.location.search).get('panel')
  if (panel === 'roles') return { view: 'employees', editRole: 'roles' }
  if (panel === 'new-role') return { view: 'employees', editRole: 'new' }
  if (panel === 'role-editor') return { view: 'employees', editRole: 'qa' }
  return { view: 'employees' }
}

/** Mounts the Team screen in the window the shell gives it, less the rail and the sidebar. */
export async function teamCapture(): Promise<ReactNode> {
  // The stub goes in before the view's modules load: they read the preload API at import time.
  window.tinyCorp = stub()
  const { ContentHeader } = await import('../../chrome/ContentHeader')
  const { EmployeesView } = await import('../EmployeesView')
  return (
    <Frame>
      {(route, onNavigate) => (
        <ContentHeader title="Team" subtitle={COMPANY.name}>
          <EmployeesView company={COMPANY} route={route} onNavigate={onNavigate} />
        </ContentHeader>
      )}
    </Frame>
  )
}

/** The content area of the 1512x944 window: the shell's rail and Company drawer stand in as a block. */
function Frame(props: {
  children(
    route: { view: 'employees'; editRole?: string },
    onNavigate: (route: { view: 'employees'; editRole?: string }) => void,
  ): ReactNode
}) {
  const [route, setRoute] = useState<{ view: 'employees'; editRole?: string }>(openPanel)
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden', background: '#0b1220' }}>
      <div style={{ width: 344, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {props.children(route, setRoute)}
      </div>
    </div>
  )
}
