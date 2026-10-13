import type { ForgeCliResult, RunForge } from '../../shared/forges/adapter'
import { machineWords } from '../../shared/platform/machine-words'
import type { ProviderCheck } from '../../shared/providers/preflight'

/**
 * The part of the contract where a forge answers for its own CLI, in the shape a Provider's
 * preflight answers in (T135) — the same four rows of frame `KB9AX`, filled in by whoever knows
 * the product.
 *
 * What is generic is the card. What only the adapter knows is five things: the command that asks
 * where the boss stands, the two commands that fix it, what the answer means, and who it names.
 *
 * Nothing here opens, closes or changes anything on a forge, and nothing here reads a token: it is
 * one status command with a timeout around it, and the credential stays inside the CLI.
 */

/** The line a forge's card carries: what still works while this is not sorted. */
export const FORGE_STILL_WORKS =
  'Everything else still works — worktrees, branches, diffs and local merges. Only pull requests wait on this.'

/** What only this forge knows about its own CLI. The name and the command come from the catalogue. */
export interface ForgeSignIn {
  /** The args that ask the CLI whether the boss is signed in, e.g. `['auth', 'status']`. */
  statusArgs: readonly string[]
  /** The command that puts the CLI on this machine, as the product documents it. */
  installWith: string
  /** The command that signs the boss in. */
  signInWith: string
  /** Whether that answer says the boss is signed in. An unreadable answer never is. */
  signedIn(result: ForgeCliResult): boolean
  /** Who that same answer names, or null when it names nobody. Never a guess. */
  account?(result: ForgeCliResult): string | null
}

export interface CheckForgeCliOptions {
  /** The forge's full name, from the catalogue. */
  name: string
  /** The command it is driven through, from the catalogue. */
  command: string
  signIn: ForgeSignIn
  /** The cheap answer first: a CLI that is not on `PATH` is never run. */
  installed(): boolean
  runForge: RunForge
  /** Where the status command runs. The app's own folder does as well as any repo. */
  cwd: string
}

/** Asks one forge's CLI whether it can open a pull request, and writes the card. */
export async function checkForgeCli({
  name,
  command,
  signIn,
  installed,
  runForge,
  cwd,
}: CheckForgeCliOptions): Promise<ProviderCheck> {
  const words = { name, command, signIn }
  if (!installed()) return forgeMissingCheck(words)
  const result = await runForge(command, signIn.statusArgs, { cwd })
  if (result.code === null) return forgeMissingCheck(words)
  if (!signIn.signedIn(result)) return forgeSignedOutCheck(words)
  return forgeReadyCheck(words, signIn.account?.(result) ?? null)
}

/** The name, the command and the two fixes: everything the card's words are built out of. */
export interface ForgeWords {
  name: string
  command: string
  signIn: ForgeSignIn
}

/** The command that asks this CLI where it stands, as the boss would type it. */
export function forgeStatusCommand({ command, signIn }: ForgeWords): string {
  return [command, ...signIn.statusArgs].join(' ')
}

/** The CLI is not on this machine at all. */
export function forgeMissingCheck(words: ForgeWords, platform: string = process.platform): ProviderCheck {
  return {
    state: 'missing',
    title: `${words.name} is not installed`,
    body: `TinyCorp could not find the ${words.command} command on ${machineWords(platform).machine}, so it can open no pull request in a repo on ${words.name}.`,
    lead: 'Install it once, in a terminal, and every repo on it works:',
    commands: [words.signIn.installWith, words.signIn.signInWith],
    note: FORGE_STILL_WORKS,
    account: null,
    plan: null,
  }
}

/** The command is there and nobody is signed in. */
export function forgeSignedOutCheck(words: ForgeWords): ProviderCheck {
  return {
    state: 'signed-out',
    title: `${words.name} is not signed in`,
    body: `TinyCorp found the ${words.command} command, but no login, so it can open no pull request in a repo on ${words.name}. The login is that CLI's — TinyCorp never holds a token of yours.`,
    lead: 'Sign in once, in a terminal, and every repo on it works:',
    commands: [words.signIn.signInWith, forgeStatusCommand(words)],
    note: FORGE_STILL_WORKS,
    account: null,
    plan: null,
  }
}

/** Nothing to do. */
export function forgeReadyCheck(words: ForgeWords, account: string | null): ProviderCheck {
  return {
    state: 'ready',
    title: `${words.name} is signed in`,
    body: `Pull requests in repos on ${words.name} are opened through ${words.command}, as you.`,
    lead: '',
    commands: [],
    note: 'Nothing to do.',
    account,
    plan: null,
  }
}
