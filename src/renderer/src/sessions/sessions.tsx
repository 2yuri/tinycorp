import { useCallback, useEffect, useState } from 'react'
import type { SessionRouting, SessionStatus } from '../../../shared/session'
import type { SubSessionInfo } from '../../../shared/sub-sessions'
import type { SubagentInfo } from '../../../shared/subagents'

const api = window.tinyCorp.sessions

/** Session status by Employee id, kept live. `refreshKey` forces a reload, e.g. after hiring. */
export function useSessionStatuses(refreshKey: unknown): {
  statuses: Record<string, SessionStatus>
  /** When each running Session started. */
  startedAt: Record<string, string | null>
  /** Whether each Employee's Provider can be started at all on this machine. */
  providerReady: Record<string, boolean>
  /** The subagents each running Session reports (T162); empty for most. */
  subagents: Record<string, SubagentInfo[]>
  /** The Sessions each Employee started of its own (T163); empty for most. */
  subSessions: Record<string, SubSessionInfo[]>
  /** Where each Employee is working while its own Provider is out (T173); absent when it is on its own. */
  routedTo: Record<string, SessionRouting | null>
  error: string | null
  start(employeeId: string): void
  stop(employeeId: string): void
} {
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({})
  const [startedAt, setStartedAt] = useState<Record<string, string | null>>({})
  const [providerReady, setProviderReady] = useState<Record<string, boolean>>({})
  const [subagents, setSubagents] = useState<Record<string, SubagentInfo[]>>({})
  const [subSessions, setSubSessions] = useState<Record<string, SubSessionInfo[]>>({})
  const [routedTo, setRoutedTo] = useState<Record<string, SessionRouting | null>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await api.list()
    if (result.ok) {
      setStatuses(Object.fromEntries(result.value.map((s) => [s.employeeId, s.status])))
      setStartedAt(Object.fromEntries(result.value.map((s) => [s.employeeId, s.startedAt])))
      setProviderReady(Object.fromEntries(result.value.map((s) => [s.employeeId, s.providerReady])))
      setSubagents(Object.fromEntries(result.value.map((s) => [s.employeeId, s.subagents])))
      setSubSessions(Object.fromEntries(result.value.map((s) => [s.employeeId, s.subSessions])))
      setRoutedTo(Object.fromEntries(result.value.map((s) => [s.employeeId, s.routedTo])))
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` is how a caller asks for a re-read; the effect itself only names `refresh`.
  useEffect(() => {
    void refresh()
    return api.onChanged(() => void refresh())
  }, [refresh, refreshKey])

  const run = (action: typeof api.start) => (employeeId: string) =>
    void action(employeeId).then((result) => {
      setError(result.ok ? null : result.error)
      void refresh()
    })

  return {
    statuses,
    startedAt,
    providerReady,
    subagents,
    subSessions,
    routedTo,
    error,
    start: run(api.start),
    stop: run(api.stop),
  }
}
