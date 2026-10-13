import { useCallback, useEffect, useState } from 'react'
import { KEEP_AWAKE_DEFAULT, type KeepAwakeMode, type KeepAwakeState } from '../../../shared/app/keep-awake'

/** What the map's coffee cup draws before the main process has answered: nothing held, no cup. */
const UNKNOWN: KeepAwakeState = { mode: KEEP_AWAKE_DEFAULT, holding: false, supported: false }

/**
 * The cup's state and its menu's choice (T99). The main process owns both the boss's mode and the
 * assertion; this only reads it and passes the boss's pick along.
 */
export function useKeepAwake(): { state: KeepAwakeState; setMode(mode: KeepAwakeMode): void } {
  const [state, setState] = useState<KeepAwakeState>(UNKNOWN)

  useEffect(() => {
    const api = window.tinyCorp.keepAwake
    let live = true
    void api.get().then((current) => {
      if (live) setState(current)
    })
    const off = api.onChanged((next) => setState(next))
    return () => {
      live = false
      off()
    }
  }, [])

  const setMode = useCallback((mode: KeepAwakeMode) => {
    // The broadcast follows, but the cup answers the click at once.
    setState((current) => ({ ...current, mode }))
    void window.tinyCorp.keepAwake.setMode(mode).then((result) => {
      if (result.ok) setState(result.value)
    })
  }, [])

  return { state, setMode }
}
