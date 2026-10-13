import { APP_NAME } from '../../../shared/app/app-name'
import type { UpdateState } from '../../../shared/app/updates'

/**
 * The words the update check puts on screen (T130). Pure, so what the title bar and Company
 * settings say is decided here and not inside a component.
 */

/** The quiet line in the title bar, or null when there is nothing to say — which is most days. */
export function updateNotice(state: UpdateState): string | null {
  return state.available ? `Version ${state.available.version} available` : null
}

/**
 * Which build this is, in words: `TinyCorp 0.3.9`. The version is empty for the one frame before
 * the main process answers, and the line says the app's name rather than a dangling space.
 */
export function currentBuildLine(state: UpdateState): string {
  return state.current ? `${APP_NAME} ${state.current}` : APP_NAME
}

/**
 * The same fact as a build stamp, which is how frame `Oykzs` writes it at the foot of Your
 * profile: `tinycorp 0.3.9`, in the mono face and lower case, as a version string is written.
 */
export function buildStamp(state: UpdateState): string {
  return currentBuildLine(state).toLowerCase()
}

/** A release date as the app writes one: `Sep 18, 2026`. Empty when the release does not say. */
export function releaseDate(publishedAt: string | null): string {
  if (!publishedAt) return ''
  const at = new Date(publishedAt)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The update row's own line: the version and, when the release carries one, the date. */
export function availableLine(state: UpdateState): string | null {
  if (!state.available) return null
  const date = releaseDate(state.available.publishedAt)
  return date ? `Version ${state.available.version} · ${date}` : `Version ${state.available.version}`
}

/**
 * What the settings row says under the version. A check that found nothing is not an error and
 * never reads like one: it says the build is the newest there is, and a check that failed says
 * exactly what a check that found nothing says, because the app cannot tell the boss more.
 */
export function updateStatus(state: UpdateState): string {
  if (state.checking) return 'Checking for a newer build…'
  if (state.available) return 'A newer build is on GitHub.'
  if (state.checkedAt === null) return 'The build you are running.'
  return 'This is the newest build the app could find.'
}
