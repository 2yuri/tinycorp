import { useCallback, useEffect, useState } from 'react'
import { type Provider, pickDefaultProvider } from '../../../shared/domain/providers'
import { blockedProviders, type ProviderPreflight } from '../../../shared/providers/preflight'

export interface PreflightReading {
  /** One answer per Provider in use, or null until the first read crosses the bridge. */
  preflight: ProviderPreflight[] | null
  /** The Providers nothing can run on, in the order the answers came back. */
  blocked: ProviderPreflight[]
  /** Whether a `Check again` is out right now. */
  checking: boolean
  recheck(): void
}

/**
 * What the app knows about the CLIs this Company is hired on (T129, T135). The main process asked
 * before the window drew, so this read is a cached answer coming back over the bridge, never a
 * subprocess; only `Check again` asks the CLIs, and every window hears what they said.
 */
export function usePreflight(): PreflightReading {
  const [preflight, setPreflight] = useState<ProviderPreflight[] | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const api = window.tinyCorp.preflight
    let live = true
    void api.status().then((first) => live && setPreflight(first))
    const stop = api.onChanged((next) => live && setPreflight(next))
    return () => {
      live = false
      stop()
    }
  }, [])

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      const result = await window.tinyCorp.preflight.recheck()
      if (result.ok) setPreflight(result.value)
    } finally {
      setChecking(false)
    }
  }, [])

  return {
    preflight,
    blocked: preflight ? blockedProviders(preflight) : [],
    checking,
    recheck: () => void recheck(),
  }
}

/**
 * What this Mac holds, whichever Company is open: one answer per Provider in the catalogue (T141).
 *
 * The same cached answers `usePreflight` reads, asked about every Provider rather than only the
 * ones this Company is hired on — Your profile's Providers card is about the machine. Null until
 * the first read comes back; the main process warmed them at start, so it is a read and not a
 * subprocess. A `Check again` anywhere refreshes what it changed.
 */
export function useEveryProvider(): ProviderPreflight[] | null {
  const [preflight, setPreflight] = useState<ProviderPreflight[] | null>(null)

  useEffect(() => {
    const api = window.tinyCorp.preflight
    let live = true
    const read = () => void api.all().then((next) => live && setPreflight(next))
    read()
    const stop = api.onChanged(() => read())
    return () => {
      live = false
      stop()
    }
  }, [])

  return preflight
}

/**
 * The Provider a new Employee starts on, read off this Mac (T169): the first in catalogue order
 * that can run one, then the first that is at least installed, then the catalogue's first.
 *
 * It asks about every Provider rather than the ones this Company is hired on, because what a form
 * should open on is a fact about the machine: a Company already staffed on one product is not a
 * reason to keep offering that product after its CLI has gone.
 */
export function useDefaultProvider(): Provider {
  return pickDefaultProvider(useEveryProvider())
}
