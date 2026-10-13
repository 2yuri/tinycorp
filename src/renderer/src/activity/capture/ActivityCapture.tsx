// A dev-only capture of the Activity view against the design's own fixture (`?capture=activity`),
// so the feed can be compared with `design/screens/Andvt.png`. Nothing here ships.

import { Download, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ActivityEvent } from '../../../../shared/activity'
import type { Employee } from '../../../../shared/domain/staff'
import type { SessionInfo } from '../../../../shared/session'
import type { People } from '../../people/PersonAvatar'
import { Button, cx } from '../../ui/kit'
import { ActivityFeed } from '../ActivityFeed'
import { ActivityRail } from '../ActivityRail'
import '../../ui/tailwind.css'
import {
  HEADER_ACTIONS,
  HEADER_INFO,
  HEADER_SPACER,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  HEADER_TITLE_ROW,
  SHELL_HEADER,
  SHELL_VIEW,
} from '../../chrome'

const DAY = '2026-09-17'
const YESTERDAY = '2026-09-16'
const NOW = new Date(`${DAY}T16:00:00`)

let nextId = 0
function event(
  at: string,
  actorName: string,
  actorId: string,
  kind: ActivityEvent['kind'],
  summary: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id: ++nextId,
    kind,
    actorId,
    actorName,
    subject: null,
    summary,
    detail: null,
    code: [],
    badge: null,
    payload: {},
    createdAt: at,
    ...extra,
  }
}

/** The rows the design's frame shows, as the engine would have written them. */
const EVENTS: ActivityEvent[] = [
  event(`${DAY}T15:10:00`, 'Yuri', 'boss', 'ticket_created', 'created TC-322', {
    code: ['TC-322'],
    detail: 'Checkout fails when the card token expires mid-session',
  }),
  event(`${DAY}T14:32:00`, 'Ada', 'e-ada', 'pull_request_opened', 'opened a pull request in payments-web #482', {
    code: ['payments-web #482'],
    detail: 'Silent token refresh before submit',
    badge: { label: 'Needs review', tone: 'primary' },
  }),
  event(`${DAY}T14:05:00`, 'Vega', 'e-vega', 'worktree_opened', 'opened a worktree from main in payments-web', {
    code: ['main', 'payments-web'],
    detail: '~/code/tinycorp/.worktrees/tc-318',
  }),
  event(`${DAY}T13:58:00`, 'Hera', 'e-hera', 'hire_proposed', 'proposed hiring Lyra', {
    code: ['Lyra'],
    detail: 'Frontend · pairs with Vega on the component layer',
    badge: { label: 'Pending', tone: 'warning' },
  }),
  event(`${DAY}T13:12:00`, 'Ada', 'e-ada', 'ticket_moved', 'moved TC-318 to Doing', { code: ['TC-318', 'Doing'] }),
  event(`${DAY}T12:40:00`, 'Yuri', 'boss', 'merged', 'merged TC-318 in payments-web', {
    code: ['TC-318', 'payments-web'],
    detail: 'main is green',
    badge: { label: 'Merged', tone: 'success' },
  }),
  event(`${DAY}T11:55:00`, 'Orion', 'e-orion', 'review_submitted', 'approved TC-311', { code: ['TC-311'] }),
  event(`${DAY}T11:02:00`, 'System', 'company', 'concurrency_cap_changed', 'set the concurrency cap to 5'),
  event(`${YESTERDAY}T18:40:00`, 'Orion', 'e-orion', 'ticket_moved', 'closed TC-311', {
    code: ['TC-311'],
    detail: 'Retry billing webhooks with backoff',
  }),
  event(`${YESTERDAY}T17:12:00`, 'Yuri', 'boss', 'repo_connected', 'connected repository billing-api', {
    code: ['billing-api'],
  }),
  event(`${YESTERDAY}T16:30:00`, 'Hera', 'e-hera', 'message_posted', 'posted in #general', { code: ['#general'] }),
  event(
    `${YESTERDAY}T15:05:00`,
    'System',
    'company',
    'budget_exhausted',
    'paused the team: the subscription limit is reached',
    {
      detail: 'The team is in the coffee area until the limit resets',
      badge: { label: 'Paused', tone: 'danger' },
    },
  ),
]

function session(employeeId: string, status: SessionInfo['status'], minutes: number): SessionInfo {
  return {
    employeeId,
    status,
    providerSessionId: null,
    providerReady: true,
    lastHook: null,
    lastHookAt: null,
    startedAt: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
    subagents: [],
    subSessions: [],
    asking: null,
    routedTo: null,
  }
}

const SESSIONS: SessionInfo[] = [
  session('e-ada', 'busy', 42),
  session('e-vega', 'busy', 17),
  session('e-orion', 'idle', 6),
]

const NAMES: Record<string, string> = { 'e-ada': 'Ada', 'e-vega': 'Vega', 'e-orion': 'Orion' }

/** Enough of an Employee for the rail's avatars to draw their character and accent (T70). */
function person(id: string, name: string, sprite: number): Employee {
  return {
    id,
    name,
    roleId: 'backend',
    title: 'Engineer',
    persona: '',
    capabilities: ['code'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    overrides: [],
    provider: 'claude',
    permissionMode: 'skip-permissions',
    model: null,
    desk: sprite,
    sprite,
    createdAt: `${DAY}T08:00:00`,
  }
}

const PEOPLE: People = {
  employees: [person('e-ada', 'Ada', 0), person('e-vega', 'Vega', 1), person('e-orion', 'Orion', 2)],
  bossInitials: 'YM',
}

/** The shell's rail (68) and sidebar (276), so the feed sits where the window puts it. */
const SHELL_WIDTH = 344

export function activityCapture(): ReactNode {
  return (
    <div style={{ display: 'flex', width: 1512, height: 944, overflow: 'hidden', background: 'var(--background)' }}>
      <div style={{ width: SHELL_WIDTH, flexShrink: 0, background: 'var(--sidebar, #0F172A)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
        <Header />
        <div className={cx(SHELL_VIEW, 'flex flex-col')} style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
          <div className="flex min-h-0 flex-1 basis-0 items-stretch">
            <ActivityFeed
              events={EVENTS}
              group={null}
              onGroup={() => {}}
              actors={[]}
              actorId={null}
              onActor={() => {}}
              peopleOpen={false}
              search=""
              onSearch={() => {}}
              now={NOW}
            />
            <ActivityRail
              events={EVENTS}
              sessions={SESSIONS}
              nameOf={(id) => NAMES[id] ?? 'An Employee'}
              people={PEOPLE}
              onViewAll={() => {}}
              now={NOW}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The shell's 64px content header, which the real view fills through `<ViewHeader>`. */
function Header() {
  return (
    <header className={SHELL_HEADER}>
      <div className={HEADER_INFO}>
        <div className={HEADER_TITLE_ROW}>
          <h1 className={HEADER_TITLE}>Activity</h1>
        </div>
        <div className={HEADER_SUBTITLE}>Every action your employees took, newest first.</div>
      </div>
      <div className={HEADER_SPACER} />
      <div className={HEADER_ACTIONS}>
        <Button variant="ghost" size="sm" icon={Download}>
          Export log
        </Button>
        <Button variant="outline" size="sm" icon={SlidersHorizontal}>
          Filters
        </Button>
      </div>
    </header>
  )
}
