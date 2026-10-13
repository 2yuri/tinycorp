import type { CompanyContext } from '../../core'
import { createSandbox, type SandboxMachine, type SandboxService } from './sandbox'

/** What the boss's app hands in, and a test leaves out. */
export interface SandboxOptions {
  /**
   * What this machine has of ai-jail (T260). Left out, `ai-jail` is looked for on `PATH` like any
   * other CLI and nothing is asked of it until something asks for the status, so a test that is not
   * about the add-on starts no process.
   */
  sandbox?: SandboxMachine
}

/** The Sandbox feature, once it is wired. */
export interface SandboxFeature {
  sandbox: SandboxService
}

/**
 * Wires the Sandbox add-on to the Company the boss is looking at (T260, T186).
 *
 * It keeps nothing per Company in memory: the switch is a row in that Company's database. Nothing
 * here installs anything either — ai-jail is GPL-3.0-only, so the boss runs one line in their own
 * terminal and the app finds it or says it cannot.
 */
export function register(ctx: CompanyContext, deps: SandboxOptions): SandboxFeature {
  const machine = deps.sandbox ?? {}
  const sandbox = createSandbox({
    current: () => ctx.currentEntry().db,
    ...(machine.runCli && { runCli: machine.runCli }),
    ...(machine.resolve && { resolve: machine.resolve }),
    ...(machine.distro && { distro: machine.distro }),
    ...(machine.resolveInDistro && { resolveInDistro: machine.resolveInDistro }),
    ...(machine.platform && { platform: machine.platform }),
    ...(machine.readOsRelease && { readOsRelease: machine.readOsRelease }),
  })
  return { sandbox }
}

/** The Add-ons tab's face. */
export interface SandboxFacade {
  /**
   * The Sandbox add-on (T260): where ai-jail stands on this machine, and whether this Company's
   * Employees are jailed. Read at every spawn and nowhere else.
   */
  sandbox: SandboxService
}
