import { useCallback, useEffect, useState } from 'react'
import { resumeAllProblem } from '../../../shared/session'

/** Whether the current Company is paused (decision 38), kept live, with Pause all and Resume all. */
export function usePaused(): {
  paused: boolean
  error: string | null
  pauseAll(): void
  resumeAll(): void
} {
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.tinyCorp.sessions.paused()
    if (result.ok) setPaused(result.value)
  }, [])

  useEffect(() => {
    void refresh()
    return window.tinyCorp.sessions.onChanged(() => void refresh())
  }, [refresh])

  return {
    paused,
    error,
    pauseAll: () =>
      void window.tinyCorp.sessions.pauseAll().then((result) => {
        setError(result.ok ? null : result.error)
        if (result.ok) setPaused(result.value)
      }),
    /*
     * The button flips to `Pause all` from the outcome the engine answers with, and whatever that
     * outcome has to say is shown beside it (T217): a resume that brought nobody back used to look
     * exactly like one that brought the whole team.
     */
    resumeAll: () =>
      void window.tinyCorp.sessions.resumeAll().then((result) => {
        if (!result.ok) return setError(result.error)
        setPaused(result.value.paused)
        setError(resumeAllProblem(result.value))
      }),
  }
}
