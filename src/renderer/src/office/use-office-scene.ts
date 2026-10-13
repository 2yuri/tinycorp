import { useEffect, useMemo, useState } from 'react'
import type { Employee } from '../../../shared/domain/staff'
import { type OfficeFacts, type OfficeScene, projectOffice } from '../../../shared/office/projection'

const api = window.tinyCorp.office

/**
 * The current Company's office, projected from live engine facts and re-projected when time alone
 * changes it. `bossSprite` is the character Your profile picked (T79); the boss sits at their own
 * desk with it (T86).
 */
export function useOfficeScene(employees: Employee[], bossSprite?: number): OfficeScene {
  const [facts, setFacts] = useState<OfficeFacts | null>(null)
  const [tick, setTick] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the roster changing is when the office facts are worth reading again.
  useEffect(() => {
    let live = true
    const refresh = async () => {
      const result = await api.facts()
      if (live) setFacts(result.ok ? result.value : null)
    }
    void refresh()
    const off = api.onChanged(() => void refresh())
    return () => {
      live = false
      off()
    }
  }, [employees])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-projects when a Talking sprite is out of time, per the comment below.
  const scene = useMemo(
    () => projectOffice({ employees, ...(bossSprite !== undefined && { bossSprite }), ...facts, now: Date.now() }),
    // `tick` re-projects when a Talking sprite's time is up.
    [employees, bossSprite, facts, tick],
  )

  useEffect(() => {
    if (scene.nextChangeAt == null) return
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, scene.nextChangeAt - Date.now()))
    return () => clearTimeout(timer)
  }, [scene.nextChangeAt])

  return scene
}
