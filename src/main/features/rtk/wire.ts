import type { Provider } from '../../../shared/domain/providers'
import type { CompanyContext } from '../../core'
import type { ProviderAdapter } from '../../providers'
import { createRtk, type RtkMachine, type RtkService } from './rtk'

/** What RTK needs of the rest of the app, and of this machine. */
export interface RtkDeps extends RtkOptions {
  /** Every Provider's adapter, so the Tokens tab can say how each of them hooks in. */
  providers: Partial<Record<Provider, ProviderAdapter>>
}

/** What the boss's app hands in, and a test leaves out. */
export interface RtkOptions {
  /**
   * What this machine has of RTK (T179), and where its per-Company history files go — never a
   * Company folder, so one Company's savings are never mixed with another's, or with the boss's own
   * terminal. Left out, `rtk` is looked for on `PATH` like any other CLI and nothing is asked of it
   * until something asks for the status, so a test that is not about RTK starts no process.
   */
  rtk?: RtkMachine
}

/** The RTK feature, once it is wired. */
export interface RtkFeature {
  rtk: RtkService
}

/**
 * Wires RTK to the Company the boss is looking at (T179, T186).
 *
 * RTK keeps nothing per Company in memory: the switches are rows in that Company's database and the
 * history is a file. Nothing here installs anything either — the boss runs one line in their own
 * terminal, and the app finds RTK or says it cannot.
 */
export function register(ctx: CompanyContext, deps: RtkDeps): RtkFeature {
  const machine = deps.rtk ?? {}
  const rtk = createRtk({
    current: () => ctx.currentEntry().db,
    currentId: () => ctx.currentEntry().company.id,
    dataDir: machine.dir ?? 'rtk',
    providers: deps.providers,
    ...(machine.runCli && { runCli: machine.runCli }),
    ...(machine.resolve && { resolve: machine.resolve }),
    ...(machine.distros && { distros: machine.distros }),
    ...(machine.platform && { platform: machine.platform }),
    ...(machine.now && { now: machine.now }),
  })
  return { rtk }
}

/** The Tokens tab's face. */
export interface RtkFacade {
  /**
   * RTK (T179): where it stands on this machine, what this Company does with it, and what it says
   * it saved. Every Session's hook is read from here at spawn and nowhere else.
   */
  rtk: RtkService
}
