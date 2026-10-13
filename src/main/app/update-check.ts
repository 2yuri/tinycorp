import { APP_NAME } from '../../shared/app/app-name'
import {
  CHECK_EVERY_MS,
  isNewerTag,
  normaliseVersion,
  parseVersion,
  RELEASES_REPO,
  type ReleaseNews,
  type UpdateState,
} from '../../shared/app/updates'

/**
 * The app asking GitHub whether a newer build exists (T130), and nothing more than asking.
 *
 * ## Why this is a check and not an update
 *
 * TinyCorp ships unsigned (decision 54, #226). `electron-updater` on macOS hands the downloaded
 * build to Squirrel.Mac, which validates the code signature before swapping it in, so an unsigned
 * app cannot auto-update: the honest version is a check and a link.
 *
 * ## When there is a Developer ID certificate
 *
 * Sign and notarise in `src/build/packaging.ts` (`mac.identity` and a `notarize` block), then
 * `electron-updater` replaces this module: `autoUpdater.checkForUpdates()` in place of
 * `readLatestRelease`, its `update-downloaded` event in place of `UpdateState.available`, and the
 * same Company settings row becomes `Restart to update` calling `autoUpdater.quitAndInstall()`.
 * The renderer's shape does not have to change — `UpdateState` says what is there, not how it got
 * there — and `Open the download page` is what the row falls back to while a build is unsigned.
 *
 * ## What leaves this machine
 *
 * One unauthenticated GET of a public endpoint. No Company, no repo of the boss's, no boss name,
 * no installation id, no query string. The only name in it is the public repo being read, and the
 * `User-Agent` is the product name, which GitHub's API requires of every caller and which says
 * nothing about who is asking.
 */

/** Reads the newest release of a public repo. Returns null for every failure, loudly for none. */
export type ReadLatestRelease = (repo: string) => Promise<ReleaseNews | null>

export interface UpdateCheckOptions {
  /** `app.getVersion()`, read through a function so a test never needs Electron. */
  currentVersion(): string
  /** Defaults to the GitHub read below; tests hand one that never touches the network. */
  readLatest?: ReadLatestRelease
  now?(): number
  /** Called whenever the state changes, so every window redraws the line and the row. */
  onChanged?(state: UpdateState): void
  repo?: string
}

export interface UpdateCheck {
  state(): UpdateState
  /**
   * Start-up and the six-hourly timer: a request goes out only when the last one was longer ago
   * than that, so however many windows and views ask, the app reads GitHub once.
   */
  check(): Promise<UpdateState>
  /** Company settings' `Check now`: the boss asked, so the gate does not apply. */
  checkNow(): Promise<UpdateState>
}

export function createUpdateCheck(options: UpdateCheckOptions): UpdateCheck {
  const now = options.now ?? (() => Date.now())
  const readLatest = options.readLatest ?? readLatestRelease
  const repo = options.repo ?? RELEASES_REPO

  let available: ReleaseNews | null = null
  /** When the last request finished, on the same clock as the gate; null before the first one. */
  let checkedAt: number | null = null
  /** The request in flight, so two callers at once are one request and one answer. */
  let inFlight: Promise<UpdateState> | null = null

  const state = (): UpdateState => ({
    current: options.currentVersion(),
    available,
    checkedAt: checkedAt === null ? null : new Date(checkedAt).toISOString(),
    checking: inFlight !== null,
  })

  function announce() {
    options.onChanged?.(state())
  }

  async function run(): Promise<UpdateState> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        // A failure is silence: no network, rate limited, no releases yet — all read as null, and
        // the boss is told nothing. What was already found stays; a check that failed knows less.
        // A `readLatest` that throws rather than returning null is the same silence, so a caller
        // is never left waiting on a promise that rejects and a button never sticks on `Checking…`.
        const latest = await readLatest(repo).catch(() => null)
        if (latest) available = isNewerTag(latest.tag, options.currentVersion()) ? latest : null
        checkedAt = now()
      } finally {
        inFlight = null
      }
      return state()
    })()
    announce()
    const settled = await inFlight
    announce()
    return settled
  }

  return {
    state,
    check() {
      if (checkedAt !== null && now() - checkedAt < CHECK_EVERY_MS) return Promise.resolve(state())
      return run()
    },
    checkNow: run,
  }
}

/**
 * The one request: `GET /repos/<repo>/releases/latest`, unauthenticated. Every way it can fail —
 * offline, rate limited (403/429), a repo with no releases at all (404), a body that is not the
 * shape it claims — comes back as null, because the app has nothing useful to say about any of them.
 */
export async function readLatestRelease(repo: string, fetcher: typeof fetch = fetch): Promise<ReleaseNews | null> {
  try {
    const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub's API rejects a caller with no User-Agent. The product name is a constant.
        'User-Agent': APP_NAME,
      },
    })
    if (!response.ok) return null
    return releaseNews(await response.json())
  } catch {
    return null
  }
}

/** What the app keeps of a release body, and null for anything it cannot read as one. */
export function releaseNews(body: unknown): ReleaseNews | null {
  if (typeof body !== 'object' || body === null) return null
  const release = body as Record<string, unknown>
  if (release['draft'] === true) return null
  const tag = typeof release['tag_name'] === 'string' ? release['tag_name'] : null
  if (tag === null) return null
  const version = parseVersion(tag)
  // A tag that is not a version is ignored rather than trusted: nothing here guesses at `nightly`.
  if (!version) return null
  const url =
    typeof release['html_url'] === 'string' ? release['html_url'] : `https://github.com/${RELEASES_REPO}/releases`
  // Only GitHub's own release pages are ever handed to the browser, whatever the body says.
  if (!/^https:\/\/github\.com\//.test(url)) return null
  return {
    tag,
    version: normaliseVersion(version),
    publishedAt: typeof release['published_at'] === 'string' ? release['published_at'] : null,
    url,
  }
}
