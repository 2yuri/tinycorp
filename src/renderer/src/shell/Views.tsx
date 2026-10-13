import { type ComponentType, memo, Suspense } from 'react'
import type { Company } from '../../../shared/company'
import { ActivityView } from '../activity'
import { Board } from '../board'
import { Chat } from '../chat'
import { type Route, VIEW_LABEL, type ViewId } from '../chrome'
import { EmployeesView } from '../employees'
import { FilesView } from '../files'
import { MemoryView } from '../memory'
import { OfficeView } from '../office-view'
import { YourProfile } from '../profile'
import { Repositories } from '../repositories'
import { CompanySettings } from '../settings'
import type { ShellData } from './nav-model'

/** The content header's default title and subtitle for a route; views may replace them. */
export function viewHeading(route: Route, company: Company, data: ShellData): { title: string; subtitle: string } {
  const n = data.employees.length
  const employees = `${n} ${n === 1 ? 'Employee' : 'Employees'}`
  switch (route.view) {
    case 'office':
      return { title: VIEW_LABEL.office, subtitle: `${company.name} · ${employees}` }
    case 'chat':
      return route.inbox
        ? { title: 'Inbox', subtitle: `${company.name} · everything waiting on you` }
        : { title: VIEW_LABEL.chat, subtitle: `${company.name} · channels and direct messages` }
    case 'board': {
      const tickets = data.board?.tickets.length ?? 0
      const epics = data.board?.epics.length ?? 0
      return {
        title: VIEW_LABEL.board,
        subtitle: `${tickets} ${tickets === 1 ? 'ticket' : 'tickets'} · ${epics} ${epics === 1 ? 'epic' : 'epics'}`,
      }
    }
    case 'employees':
      return { title: VIEW_LABEL.employees, subtitle: `${employees} · ${data.roles.length} roles in the catalog` }
    case 'repositories': {
      const repos = data.repos.length
      return { title: VIEW_LABEL.repositories, subtitle: `${repos} ${repos === 1 ? 'repository' : 'repositories'}` }
    }
    case 'files':
      return { title: VIEW_LABEL.files, subtitle: 'Read what an Employee is working on, file by file.' }
    case 'memory':
      return { title: VIEW_LABEL.memory, subtitle: `What ${company.name} knows, kept in git.` }
    case 'activity':
      return { title: VIEW_LABEL.activity, subtitle: 'Every action your employees took, newest first.' }
    case 'settings':
      return { title: VIEW_LABEL.settings, subtitle: company.folder }
    case 'profile':
      return { title: VIEW_LABEL.profile, subtitle: 'This is you — it follows you into every Company you run.' }
  }
}

/** What every view receives from the shell. */
export interface ViewProps<R extends Route = Route> {
  route: R
  company: Company
  onNavigate(route: Route): void
}

type RouteOf<V extends ViewId> = Extract<Route, { view: V }>

/**
 * The router's single registry: one component per view. Mounting a rebuilt view is a one-line change here.
 * A view fills the content area below the header and scrolls on its own; `<ViewHeader>` fills the header.
 */
export const VIEWS_BY_ID: { [V in ViewId]: ComponentType<ViewProps<RouteOf<V>>> } = {
  office: ({ company, onNavigate }) => <OfficeView company={company} onNavigate={onNavigate} />,
  chat: ({ company, route, onNavigate }) => (
    <Chat
      companyId={company.id}
      channelId={route.channelId}
      inbox={route.inbox}
      onChannelChange={(channelId) => onNavigate({ view: 'chat', channelId })}
    />
  ),
  board: ({ company, route, onNavigate }) => <Board company={company} route={route} onNavigate={onNavigate} />,
  employees: ({ company, route, onNavigate }) => (
    <EmployeesView company={company} route={route} onNavigate={onNavigate} />
  ),
  repositories: ({ company, route }) => <Repositories company={company} repoId={route.repoId} />,
  files: ({ company, route, onNavigate }) => (
    <FilesView
      companyId={company.id}
      placeId={route.placeId}
      path={route.path}
      line={route.line}
      outside={route.outside}
      onOpen={(placeId, path) => onNavigate({ view: 'files', placeId, ...(path !== null && { path }) })}
    />
  ),
  memory: ({ company, route, onNavigate }) => (
    <MemoryView company={company} slug={route.slug} kind={route.kind} ticket={route.ticket} onNavigate={onNavigate} />
  ),
  activity: ({ company }) => <ActivityView company={company} />,
  settings: ({ company, route, onNavigate }) => (
    <CompanySettings company={company} tab={route.tab} onTabChange={(tab) => onNavigate({ view: 'settings', tab })} />
  ),
  profile: ({ company, onNavigate }) => <YourProfile company={company} onNavigate={onNavigate} />,
}

/**
 * The router: renders the registered view, keyed by Company so switching Companies starts fresh.
 *
 * Memoised because the shell around it re-renders on every engine change event and every window
 * focus — the sidebar's counts are read again — and the open view has no part in any of that. Its
 * three props are all stable while the boss stays where they are: `route` is the shell's own state,
 * `company` only moves when the Company does, and `onNavigate` is bound once (T211).
 */
export const RouteView = memo(function RouteView(props: ViewProps) {
  const View = VIEWS_BY_ID[props.route.view] as ComponentType<ViewProps>
  // A view may come in its own chunk — the Office does (T211). Nothing is drawn while it is on the
  // way: the content header keeps the route's own title, which is what the boss just asked for.
  return (
    <Suspense fallback={null}>
      <View key={`${props.company.id}:${props.route.view}`} {...props} />
    </Suspense>
  )
})
