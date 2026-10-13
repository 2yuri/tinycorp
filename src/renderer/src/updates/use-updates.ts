import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/app/updates'

/**
 * Read when a call is made, not when the module loads: the title bar line is imported by the
 * Launcher frame, which is rendered statically in tests that never stand a preload API up.
 */
const api = () => window.tinyCorp.updates

/**
 * Before the main process has answered: this build is what we know, and nothing else. The version
 * is the one compiled into the bundle, so the version row says which build it is on its first
 * frame rather than the app's bare name.
 */
const UNKNOWN: UpdateState = { current: __APP_VERSION__, available: null, checkedAt: null, checking: false }

/**
 * What the main process found, kept fresh from its change events (T130). Every window draws the
 * same answer to the one request the app made; the renderer never fetches anything itself.
 */
export function useUpdates(): {
  state: UpdateState
  checkNow(): void
  openDownloadPage(): void
} {
  const [state, setState] = useState<UpdateState>(UNKNOWN)

  useEffect(() => {
    void api().get().then(setState)
    return api().onChanged(setState)
  }, [])

  const checkNow = useCallback(() => void api().checkNow().then(setState), [])
  const openDownloadPage = useCallback(() => void api().openDownloadPage(), [])
  return { state, checkNow, openDownloadPage }
}
