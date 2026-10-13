import { PROVIDERS, type Provider } from '../../shared/domain/providers'
import type { ProviderCheck, ProviderPreflight } from '../../shared/providers/preflight'

/**
 * Whether the CLIs this Company runs on can run an Employee, asked once and remembered (T129, T135).
 *
 * T129 asked one product before the Launcher drew. T135 asks every Provider the Company's Employees
 * are actually hired on — and only those: a Company with no Codex Employee is never told about
 * Codex. The question itself belongs to the adapter (`ProviderAdapter.checkCli`), so nothing here
 * knows what any product is called or what its commands are.
 *
 * T169 fixed the other end of it. Before the first Employee there is nothing in use, and this file
 * used to fall back to the catalogue's first Provider — so a boss who runs only Codex opened
 * TinyCorp into a card about a product they had never asked for. With nobody hired every Provider
 * is asked instead, and `blockedProviders` only takes the window when none of them can run an
 * Employee: any one of them is enough.
 *
 * The rules this file keeps: nothing may spend usage, one subprocess per Provider, asked once on
 * start, cached, and re-asked only by `Check again`. Two callers who ask before the first answer
 * lands share one subprocess.
 */

export interface PreflightOptions {
  /** Asks one Provider's adapter where it stands. One subprocess with a timeout around it. */
  check(provider: Provider): Promise<ProviderCheck>
  /**
   * The Providers the Company's Employees are hired on, read fresh at each ask. Empty with no
   * Company open, and empty for a Company nobody has been hired into yet — the first run this file
   * has to get right, and the one where every Provider is asked instead (T169).
   */
  inUse(): readonly Provider[]
  /**
   * Every Provider there is, for {@link Preflight.all}. The catalogue by default; a test hands it
   * a shorter one.
   */
  catalogue?: readonly Provider[]
  now?: () => Date
  /**
   * Run at the start of every `recheck`, before any Provider is asked: whatever else the app
   * caches about this machine has to be thrown away with the answers (T167 — where each CLI is).
   */
  beforeRecheck?(): void
  /** Called after `recheck` lands, so every window redraws the cards — or stops drawing them. */
  onChanged?(preflight: ProviderPreflight[]): void
}

export interface Preflight {
  /**
   * What the app knows about the Providers in use — every one of them before the first hire. The
   * first call asks each of them; every later one reuses the answers, and only a Provider nobody
   * had asked about yet costs a subprocess — so no render path and no Session start ever waits on
   * one.
   */
  status(): Promise<ProviderPreflight[]>
  /** `Check again`: asks every Provider in use once more and replaces the cached answers. */
  recheck(): Promise<ProviderPreflight[]>
  /**
   * `Check again` for one Provider, which is what a finished sign-in asks (T263). Nothing about the
   * machine has changed — only that CLI's login — so no cached probe is thrown away.
   */
  recheckOne(provider: Provider): Promise<ProviderPreflight[]>
  /**
   * Every Provider in the catalogue, in catalogue order, hired here or not (T141).
   *
   * Which CLI is on this Mac and which login it holds is a fact about the machine, so Your
   * profile's Providers card asks for all of them rather than for the ones this Company happens to
   * run on. The answers share {@link status}'s cache and its one-subprocess-per-Provider rule, and
   * the app warms them at start, so this is never what a card waits on. What blocks the Launcher
   * is still {@link status} and still only the Providers in use.
   */
  all(): Promise<ProviderPreflight[]>
  /** One Provider's cached answer without asking, or null while nobody has asked. */
  cached(provider: Provider): ProviderPreflight | null
}

export function createPreflight({
  check,
  inUse,
  catalogue = PROVIDERS,
  now = () => new Date(),
  beforeRecheck,
  onChanged,
}: PreflightOptions): Preflight {
  /** What a CLI said, which is all the cache holds: `hired` is stamped on at each read. */
  type Answer = Omit<ProviderPreflight, 'hired'>
  const answers = new Map<Provider, Answer>()
  /** The checks that are out right now, so two callers at start share one subprocess each. */
  const asking = new Map<Provider, Promise<Answer>>()

  function ask(provider: Provider): Promise<Answer> {
    const out = asking.get(provider)
    if (out) return out
    const started = check(provider)
      .then((result): Answer => ({ ...result, provider, checkedAt: now().toISOString() }))
      .finally(() => asking.delete(provider))
    asking.set(provider, started)
    return started.then((answer) => {
      answers.set(provider, answer)
      return answer
    })
  }

  /**
   * The Providers to ask about: the ones in use, and every one there is when nobody is hired yet.
   *
   * Before the first Employee there is no Provider this boss has chosen, so asking about one of
   * them — the catalogue's first, as this did until T169 — stopped a boss who has only Codex with a
   * card about a product they never asked for. Ask all three; which of the answers stops anything
   * is `blockedProviders`' business, and one that can run an Employee is enough.
   */
  function providers(): readonly Provider[] {
    const hired = [...new Set(inUse())]
    return hired.length > 0 ? hired : catalogue
  }

  /** One cached answer, stamped with whether anyone is hired on it right now. */
  function stamp(answer: Answer, hired: ReadonlySet<Provider>): ProviderPreflight {
    return { ...answer, hired: hired.has(answer.provider) }
  }

  /** Asks (or reads) a list of Providers, and stamps each answer against who is hired today. */
  async function read(wanted: readonly Provider[]): Promise<ProviderPreflight[]> {
    const hired = new Set(inUse())
    const found = await Promise.all(wanted.map((provider) => answers.get(provider) ?? ask(provider)))
    return found.map((answer) => stamp(answer, hired))
  }

  return {
    status: () => read(providers()),
    async recheck() {
      beforeRecheck?.()
      for (const provider of providers()) answers.delete(provider)
      const preflight = await read(providers())
      onChanged?.(preflight)
      return preflight
    },
    async recheckOne(provider) {
      answers.delete(provider)
      await ask(provider)
      const preflight = await read(providers())
      onChanged?.(preflight)
      return preflight
    },
    all: () => read(catalogue),
    cached: (provider) => {
      const answer = answers.get(provider)
      return answer ? stamp(answer, new Set(inUse())) : null
    },
  }
}
