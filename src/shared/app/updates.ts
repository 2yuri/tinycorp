/**
 * Whether a newer build of TinyCorp exists (T130). The app ships as an unsigned DMG (#226), so
 * there is nothing to install: the check reads a public endpoint, compares two version strings
 * and says so. Nothing is downloaded and nothing is replaced.
 *
 * Everything here is pure, so the comparison the main process trusts is the one the tests run.
 */

/** The public repo whose releases the check reads. The only name the request ever carries. */
export const RELEASES_REPO = '2yuri/tinycorp'

/** That same repo as a page, which is where the menu's Help sends the boss (#223). */
export const REPO_URL = `https://github.com/${RELEASES_REPO}`

/** How long the app waits between two requests, however many things ask it to look. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** A release worth telling the boss about: what it is, when it landed, and where to get it. */
export interface ReleaseNews {
  /** The tag as the release carries it, `v0.4.0` and all. */
  tag: string
  /** What the tag parses to, normalised: `0.4.0`. */
  version: string
  /** When the release was published, ISO 8601, or null when the release does not say. */
  publishedAt: string | null
  /** The release's own page, which `Open the download page` opens in the system browser. */
  url: string
}

/** What the title bar line and the Company settings row draw, whichever window asks. */
export interface UpdateState {
  /** `app.getVersion()`: the build this window is running. */
  current: string
  /** The newer release, or null — same build, an older or malformed tag, or nothing read yet. */
  available: ReleaseNews | null
  /** When the last request finished, whatever it found; null before the first one. */
  checkedAt: string | null
  /** Whether a request is in flight, so `Check now` can say so. */
  checking: boolean
}

/** A version broken into the parts the comparison orders by. Build metadata is dropped. */
export interface Version {
  major: number
  minor: number
  patch: number
  /** The dot-separated identifiers after `-`; empty for a release. `1.0.0-beta.1` → `['beta', 1]`. */
  prerelease: (string | number)[]
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * A tag read as a version, or null when it is not one. Null is the whole of the app's answer to a
 * malformed tag: a release called `nightly` is ignored, never guessed at and never trusted.
 */
export function parseVersion(tag: string): Version | null {
  const match = VERSION.exec(tag.trim())
  if (!match) return null
  const [, major, minor, patch, prerelease] = match
  const parts = prerelease === undefined ? [] : prerelease.split('.')
  // An empty identifier (`1.0.0-` or `1.0.0-a..b`) is not a version; the regex lets both through.
  if (parts.some((part) => part === '')) return null
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
  }
}

/** Negative when `a` is older, zero when they are the same build, positive when `a` is newer. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  // Semver 11: a prerelease is older than the release it leads to. `1.0.0-rc.1` < `1.0.0`.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    // Numbers sort below strings, and numerically among themselves.
    if (typeof left === 'number' && typeof right === 'number') return left - right
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

/** The version a tag names, written the way the app shows it: `v0.4.0` → `0.4.0`. */
export function normaliseVersion(version: Version): string {
  const base = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease.length ? `${base}-${version.prerelease.join('.')}` : base
}

/**
 * Whether `tag` is a build the boss does not have. It refuses to go backwards — an older tag, the
 * same one, or one that does not parse all mean no — so a retagged or hand-written release can
 * never talk anyone into a downgrade.
 */
export function isNewerTag(tag: string, current: string): boolean {
  const latest = parseVersion(tag)
  const running = parseVersion(current)
  if (!latest || !running) return false
  return compareVersions(latest, running) > 0
}
