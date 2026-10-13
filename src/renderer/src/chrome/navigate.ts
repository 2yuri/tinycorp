import type { Route } from './routes'

const EVENT = 'tinycorp:navigate'

/** Asks the shell to show a route, e.g. the drawer's `DM <name>` opening the DM in Chat. */
export function navigate(route: Route): void {
  window.dispatchEvent(new CustomEvent<Route>(EVENT, { detail: route }))
}

/** Called with every route someone asks the shell to show. Returns an unsubscribe function. */
export function onNavigate(listener: (route: Route) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<Route>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
