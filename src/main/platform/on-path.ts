import { cliExists, forgetCliPaths } from './cli-command'

/**
 * Whether a CLI can be run on this machine.
 *
 * It is `cli-command.ts`'s answer and nothing else, so the drawer can never say a Provider is
 * installed and then fail to spawn it (T166): `where codex` finds `codex.ps1`, and nothing here
 * runs a PowerShell script. The answer is cached per command and `PATH`, because it is asked every
 * time the drawer draws an Employee, and a boss who installs a provider mid-session still gets the
 * new answer because the cache key carries the `PATH` that was searched.
 */
export function onPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return cliExists(command, env)
}

/** Forgets every cached answer, so the next ask searches `PATH` again. */
export function forgetInstalled(): void {
  forgetCliPaths()
}
