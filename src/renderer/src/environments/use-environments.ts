import { useEffect, useState } from 'react'
import type { EnvironmentSettings } from '../../../shared/environments'

/**
 * Read at call time and never destructured: a capture harness stubs only the parts of the bridge
 * its own screen uses, and a hook that threw for a missing one would paint a blank window.
 */
const environmentsApi = () => window.tinyCorp.environments as typeof window.tinyCorp.environments | undefined

/**
 * The Company's environments, their variables and its repos, in one read (T176). Null until the
 * first read lands. Nothing here ever holds a value: Reveal and Copy are calls, not state.
 */
export function useEnvironmentSettings(): EnvironmentSettings | null {
  const [settings, setSettings] = useState<EnvironmentSettings | null>(null)
  useEffect(() => {
    const api = environmentsApi()
    if (!api) return
    let live = true
    const read = async () => {
      const result = await api.get()
      if (live && result.ok) setSettings(result.value)
    }
    void read()
    const stop = api.onChanged(() => void read())
    return () => {
      live = false
      stop()
    }
  }, [])
  return settings
}
