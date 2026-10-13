import { type CrashEnvironment, type CrashReport, type CrashSource, crashReport } from '../../../../shared/app/crash'

/**
 * Which build the card names. Both halves are known the moment the window opens — the version at
 * build time, the platform from the preload — so a crash during startup reports as fully as a
 * crash an hour in.
 */
export function crashEnvironment(): CrashEnvironment {
  return {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
    platform: window.tinyCorp?.crash?.platform ?? 'unknown',
  }
}

export interface CaughtCrash {
  source: CrashSource
  error: unknown
  componentStack?: string | null
  route?: string | null
}

/** Builds the report for what was just caught, in the build this window is. */
export function caught({ source, error, componentStack, route }: CaughtCrash): CrashReport {
  return crashReport({
    source,
    error,
    componentStack: componentStack ?? null,
    route: route ?? null,
    ...crashEnvironment(),
    at: new Date(),
  })
}

/**
 * Writes the crash to the app's log. A tester who reloads the screen without copying the report is
 * then not the only record of it; a main process that cannot be reached changes nothing here.
 */
export function recordCrash(report: CrashReport): void {
  try {
    void window.tinyCorp?.crash?.record(report)?.catch(() => {})
  } catch {
    // Nothing a crashed screen can do about a crashed channel.
  }
}

/**
 * `window.onerror` and `unhandledrejection`: a throw outside React — an event handler, a promise
 * nobody awaited — is recorded too, instead of reaching a console nobody has open. Returns a
 * function that removes both.
 */
export function installCrashHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => recordCrash(caught({ source: 'window', error: event.error ?? event.message }))
  const onRejection = (event: PromiseRejectionEvent) => recordCrash(caught({ source: 'window', error: event.reason }))
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
