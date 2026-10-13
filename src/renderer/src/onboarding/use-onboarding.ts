import { useCallback, useEffect, useRef, useState } from 'react'
import type { OnboardingProgress } from '../../../shared/onboarding'

export interface OnboardingGate {
  /** Where the current Company's wizard stands, or null while it is still being read. */
  progress: OnboardingProgress | null
  /** The wizard is owed: the Company opens into it instead of the Office (T59). */
  incomplete: boolean
  /** Nothing can be routed yet — neither the wizard nor the Office should be drawn. */
  loading: boolean
  /** Reads the mark again, e.g. after Finish set it. */
  reload(): void
}

/** The mark of a Company whose wizard could not be read: the Office opens rather than nothing. */
const OPEN_ANYWAY: OnboardingProgress = { completedAt: '', draft: null }

/**
 * Whether a Company still owes its setup wizard. Every way of opening one — a Launcher row, the
 * rail, ⌘N, Open Recent — makes it current, so asking the engine about the current Company is the
 * one gate they all pass through (T59).
 */
export function useOnboarding(companyId: string | null): OnboardingGate {
  const [state, setState] = useState<{ id: string; progress: OnboardingProgress } | null>(null)
  // Every mark read this run, so switching back to a Company draws it at once instead of waiting
  // for the engine again (T287); the read still runs and replaces it.
  const known = useRef(new Map<string, OnboardingProgress>())
  // Switching Companies while a read is in flight must not let the old answer land on the new one.
  const asked = useRef<string | null>(null)

  const load = useCallback(async (id: string) => {
    asked.current = id
    const result = await window.tinyCorp.onboarding.progress()
    if (asked.current !== id) return
    const progress = result.ok ? result.value : OPEN_ANYWAY
    known.current.set(id, progress)
    setState({ id, progress })
  }, [])

  useEffect(() => {
    if (companyId === null) {
      asked.current = null
      setState(null)
      return
    }
    setState(null)
    void load(companyId)
  }, [companyId, load])

  const current =
    state?.id === companyId ? state.progress : companyId === null ? null : (known.current.get(companyId) ?? null)
  return {
    progress: current,
    incomplete: current?.completedAt === null,
    loading: companyId !== null && current === null,
    reload: useCallback(() => {
      if (companyId !== null) void load(companyId)
    }, [companyId, load]),
  }
}
