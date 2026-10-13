import type { PathLink } from '../../../shared/files/path-links'
import type { Route } from '../chrome'
import { navigate } from '../chrome'

/** Everything a click on a path link may do. Nothing here runs anything: it only goes to Files. */
export interface PathOpenDeps {
  /** Every file opens in the Files view, as a tab of its own (T121). */
  navigate(route: Route): void
}

/**
 * What the boss's click on a path comes to (T114, T121). Every path goes to the Files view, which
 * opens it as a tab: one inside the Company at the file and the line it was written with, one
 * outside under its whole path. Nothing floats over the view it was written in any more.
 */
export function openPathLink(link: PathLink, deps: PathOpenDeps): void {
  if (link.target.kind === 'place') {
    const { placeId, path, line } = link.target
    deps.navigate({ view: 'files', placeId, path, ...(line === null ? {} : { line }) })
    return
  }
  deps.navigate({ view: 'files', outside: link.target.path, ...(link.line === null ? {} : { line: link.line }) })
}

/** The real thing: the shell's own router. */
export const desktopPathOpenDeps: PathOpenDeps = { navigate }

/** Reveals the file a link points at in Finder — what a path from outside offers beside opening it. */
export async function revealPath(link: PathLink, fail: (message: string) => void): Promise<void> {
  const result = await window.tinyCorp.paths.reveal(link.full)
  if (!result.ok) fail(result.error)
}
