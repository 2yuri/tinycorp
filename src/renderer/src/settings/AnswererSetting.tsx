import { MessageCircleReply } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Employee, Unavailability } from '../../../shared/domain/staff'
import type { AnswererSetting as Answerer } from '../../../shared/inbox/answerer'
import { resources, useIpcResource } from '../ipc'
import { Select } from '../ui'

/** Automatic, as the select stores it: no Employee id. */
const AUTOMATIC = ''

const away: Record<Unavailability, string> = {
  parked: 'parked, waiting for a slot',
  paused: 'paused',
  stopped: 'not running',
  out_of_budget: 'out of budget',
}

/** What the row says under the select: who answers now, and why it is not the boss's choice. */
export function answererHelp(answerer: Answerer, nameOf: (id: string) => string): string {
  const rule = 'Replies when nobody is @mentioned. Automatic picks intake, then planning, skipping anyone away.'
  if (answerer.stale === 'fired') {
    return `${nameOf(answerer.overrideId!)} has left the Company, so Automatic answers. ${rule}`
  }
  const skipped = answerer.skipped.find((s) => s.employeeId === answerer.overrideId)
  if (answerer.stale === 'unavailable' && skipped) {
    return `${nameOf(skipped.employeeId)} is ${away[skipped.reason]}, so the next in line answers. ${rule}`
  }
  if (!answerer.answererId) {
    const waiting = answerer.waitingForId
    return waiting
      ? `Nobody is available: messages wait for ${nameOf(waiting)}. ${rule}`
      : `Nobody is hired yet: the boss's messages wait for the first hire. ${rule}`
  }
  return rule
}

/** How an Employee reads in the select: `Hera (PM)`, as the design writes it. */
export function personLabel(employee: Pick<Employee, 'name' | 'title'>): string {
  return `${employee.name} (${employee.title})`
}

/** The label of the Automatic option: who the chain picks right now, as `Automatic · Hera (PM)`. */
export function automaticLabel(answerer: Answerer, labelOf: (id: string) => string): string {
  const automatic = answerer.automaticId ?? answerer.waitingForId
  return automatic ? `Automatic · ${labelOf(automatic)}` : 'Automatic'
}

/**
 * "Who answers you" (design/html/company-settings.html; decision 41): Automatic follows the answerer
 * chain, or the boss names one Employee. Saved as it changes, like the maximum headcount.
 */
export function AnswererSetting({ className }: { className?: string }) {
  const api = window.tinyCorp
  const employees = useIpcResource(resources.employees)
  const [answerer, setAnswerer] = useState<Answerer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const setting = await api.answerer.get()
    if (!setting.ok) return setError(setting.error)
    setError(null)
    setAnswerer(setting.value)
  }, [])

  useEffect(() => {
    void refresh()
    return api.answerer.onChanged(() => void refresh())
  }, [refresh])

  if (!answerer) return null
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? 'a former Employee'
  const labelOf = (id: string) => {
    const employee = employees.find((e) => e.id === id)
    return employee ? personLabel(employee) : 'a former Employee'
  }
  // A stale choice still shows as chosen, with the helper saying why somebody else answers.
  const known = answerer.overrideId !== null && employees.some((e) => e.id === answerer.overrideId)

  async function choose(value: string) {
    const result = await api.answerer.set(value === AUTOMATIC ? null : value)
    if (!result.ok) return setError(result.error)
    setError(null)
    setAnswerer(result.value)
  }

  return (
    <Select
      className={className}
      label="Who answers you"
      icon={MessageCircleReply}
      value={known ? answerer.overrideId! : AUTOMATIC}
      error={Boolean(error)}
      helper={error ?? answererHelp(answerer, nameOf)}
      options={[
        { value: AUTOMATIC, label: automaticLabel(answerer, labelOf) },
        ...employees.map((employee) => ({ value: employee.id, label: personLabel(employee) })),
      ]}
      onChange={(event) => void choose(event.target.value)}
    />
  )
}
