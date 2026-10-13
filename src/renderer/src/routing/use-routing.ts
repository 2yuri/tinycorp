import { useEffect, useState } from 'react'
import type { RoutingSettings } from '../../../shared/ipc'

/**
 * Read at call time and never destructured: a capture harness stubs only the parts of the bridge
 * its own screen uses, and a hook that threw for a missing one would paint a blank window.
 */
const routingApi = () => window.tinyCorp.routing as typeof window.tinyCorp.routing | undefined

/**
 * The Company's routing rules, its overrides and the boss's accounts, in one read (T173).
 *
 * Company settings, Your profile and the Usage popover all draw from it, so a sign-in added in one
 * shows in the others without a reload. Null until the first read lands.
 */
export function useRoutingSettings(): RoutingSettings | null {
  const [settings, setSettings] = useState<RoutingSettings | null>(null)
  useEffect(() => {
    const api = routingApi()
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
