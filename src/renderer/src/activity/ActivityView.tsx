import { Download, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ActivityActor, ActivityEvent, ActivityGroup } from '../../../shared/activity'
import type { Company } from '../../../shared/company'
import type { SessionInfo } from '../../../shared/session'
import { navigate, SHELL_VIEW, ViewHeader } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import { Button, cx } from '../ui'
import { ActivityFeed } from './ActivityFeed'
import { ActivityRail } from './ActivityRail'
import { activityCsv } from './activity-view'
import '../ui/tailwind.css'

const api = window.tinyCorp

/**
 * The Activity view (decision 36): the Company's append-only event log, newest first, grouped by
 * day, with kind chips, an Employee filter, a search and live updates over IPC.
 */
export function ActivityView({ company }: { company: Company }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [actors, setActors] = useState<ActivityActor[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  // The rail's avatars draw each Employee's own character (T70).
  const employees = useIpcResource(resources.employees)
  const [error, setError] = useState<string | null>(null)
  const [group, setGroup] = useState<ActivityGroup | null>(null)
  const [actorId, setActorId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [peopleOpen, setPeopleOpen] = useState(false)

  const refresh = useCallback(async () => {
    const [list, who] = await Promise.all([
      api.activity.list({
        ...(group && { groups: [group] }),
        ...(actorId && { actorId }),
        ...(search.trim() && { search: search.trim() }),
      }),
      api.activity.actors(),
    ])
    setError(list.ok ? null : list.error)
    if (list.ok) setEvents(list.value)
    if (who.ok) setActors(who.value)
  }, [group, actorId, search])

  useEffect(() => {
    void refresh()
    return api.activity.onChanged(() => void refresh())
  }, [refresh])

  const refreshSessions = useCallback(async () => {
    const result = await api.sessions.list()
    if (result.ok) setSessions(result.value)
  }, [])

  useEffect(() => {
    void refreshSessions()
    return api.sessions.onChanged(() => void refreshSessions())
  }, [refreshSessions])

  return (
    <div className={cx(SHELL_VIEW, 'flex flex-col')}>
      <ViewHeader title="Activity" subtitle="Every action your employees took, newest first.">
        <Button
          variant="ghost"
          size="sm"
          icon={Download}
          disabled={events.length === 0}
          onClick={() => exportLog(company, events)}
        >
          Export log
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={SlidersHorizontal}
          aria-expanded={peopleOpen}
          onClick={() => setPeopleOpen((open) => !open)}
        >
          Filters
        </Button>
      </ViewHeader>

      <div className="flex min-h-0 flex-1 basis-0 items-stretch">
        <ActivityFeed
          events={events}
          group={group}
          onGroup={setGroup}
          actors={actors}
          actorId={actorId}
          onActor={setActorId}
          peopleOpen={peopleOpen}
          search={search}
          onSearch={setSearch}
          error={error}
        />
        <ActivityRail
          events={events}
          sessions={sessions}
          nameOf={(employeeId) => actors.find((actor) => actor.id === employeeId)?.name ?? 'An Employee'}
          people={{ employees, bossInitials: company.boss.initials, bossSprite: company.boss.sprite }}
          onViewAll={() => navigate({ view: 'employees' })}
        />
      </div>
    </div>
  )
}

/** Export log: the events on screen as a CSV file the boss keeps. */
function exportLog(company: Company, events: ActivityEvent[]): void {
  const blob = new Blob([activityCsv(events)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${company.key.toLowerCase()}-activity.csv`
  link.click()
  URL.revokeObjectURL(url)
}
