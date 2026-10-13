import {
  hasRuntimeChoice,
  lookedInLine,
  type ProviderPlacement,
  type ProviderRuntime,
  runtimeChoices,
  runtimeLabel,
  WINDOWS_LABEL,
  WINDOWS_RUNTIME,
  WSL_LABEL,
} from '../../shared/platform/wsl'
import { PREFLIGHT_STILL_OPENS, type PreflightStep, type ProviderCheck } from '../../shared/providers/preflight'
import type { CliOutcome, RunCli } from '../platform'

/**
 * The part of the contract where a Provider answers for its own CLI (T135).
 *
 * T129 shipped a preflight that knew one product: it ran `claude auth status` and printed Claude
 * Code's own commands for the fix. That is not something a catalogue entry can supply — it is a
 * subprocess and a set of sentences, both of them the product's — so it belongs on the adapter,
 * beside `installed()`, and this file is the shape every adapter fills in.
 *
 * What is generic is the *card*: frame `KB9AX` draws four rows, and a Provider that is missing
 * reads the same as any other Provider that is missing, with its own name and its own commands in
 * it. So an adapter answers {@link ProviderSignIn} — five things only it can know — and
 * {@link checkProviderCli} turns them into the card. An adapter with a state of its own (Claude
 * Code's API-key warning) wraps the result and replaces the words.
 */

/**
 * Whether a CLI is signed in, and on what. A product that can be signed in on a billed key as well
 * as on a subscription says so: TinyCorp runs on the subscription the boss already pays for
 * (decision 3), and a key that would be billed per token is worth a sentence before the bill is.
 */
export type SignInVerdict = 'subscription' | 'api-key' | 'none'

/**
 * Who a CLI says is signed in, read out of the same answer the verdict was (T141).
 *
 * Your profile's Providers card is about this Mac, so it wants the account under each product —
 * but only a product that says so without being asked twice, and never a guess. An adapter whose
 * CLI names no account simply does not answer this, and the card draws the state alone.
 */
export interface ProviderIdentity {
  /** The account the CLI names — an email, a login, whatever it prints. Null when it names none. */
  account: string | null
  /** The plan the CLI names, e.g. `Max`. Null when it names none. */
  plan: string | null
}

/** What a CLI that says nothing about the account reports, and what every signed-out state is. */
export const NO_IDENTITY: ProviderIdentity = { account: null, plan: null }

/** What only this Provider knows about its own CLI. The name and the command come from the catalogue. */
export interface ProviderSignIn {
  /** The args that ask the CLI whether the boss is signed in, e.g. `['auth', 'status']`. */
  statusArgs: readonly string[]
  /** The command that puts the CLI on this machine, as the product documents it. */
  installWith: string
  /** The command that signs the boss in. */
  signInWith: string
  /** What the CLI's answer means. A timeout or an unreadable answer is never a login. */
  verdict(outcome: CliOutcome): SignInVerdict
  /**
   * Who that same answer says is signed in (T141). Left out by a product whose CLI will not say
   * without spending anything — the card shows the state alone rather than an empty line.
   */
  identity?(outcome: CliOutcome): ProviderIdentity
  /**
   * How the product is installed on Windows itself, when that is not {@link installWith} (T167).
   * Most products document one command that works everywhere; a product with a native Windows
   * installer names it here, so the card offers the thing its own docs offer.
   */
  installOnWindows?: string
  /** How the product is installed inside a Linux distro, when that is not {@link installWith}. */
  installInWsl?: string
}

export interface CheckProviderCliOptions {
  /** The product's full name, from the catalogue. */
  name: string
  /** The command it is installed as, from the catalogue. */
  command: string
  signIn: ProviderSignIn
  /** The cheap answer first: a CLI that is not on `PATH` is never run. */
  installed(): boolean
  runCli: RunCli
  /** The environment the status command runs in — the same one a Session would be spawned with. */
  env?: NodeJS.ProcessEnv
  /**
   * Where this Provider's CLI was found on this Windows and where its Sessions run (T167). Left
   * out on a Mac or a Linux desktop, where there is one place and the card says nothing about it.
   */
  placement?: ProviderPlacement | null
}

/**
 * Asks one Provider's CLI whether it can run an Employee, and writes the card.
 *
 * Nothing here spends usage: it is `installed()` and one status command with a timeout around it.
 * The caller asks once on start and caches, so this is never on a render path.
 */
export async function checkProviderCli({
  name,
  command,
  signIn,
  installed,
  runCli,
  env,
  placement,
}: CheckProviderCliOptions): Promise<ProviderCheck> {
  const words = { name, command, signIn, placement: placement ?? null }
  if (!installed()) return missingCheck(words)
  const outcome = await runCli(command, signIn.statusArgs, { ...(env && { env }) })
  if (outcome.kind === 'missing') return missingCheck(words)
  // Read out of the answer the verdict came from: one status command, never a second subprocess.
  const identity = signIn.identity?.(outcome) ?? NO_IDENTITY
  switch (signIn.verdict(outcome)) {
    case 'subscription':
      return readyCheck(words, identity)
    case 'api-key':
      return apiKeyCheck(words, identity)
    case 'none':
      return signedOutCheck(words)
  }
}

/** The name, the command and the two fixes: everything the card's words are built out of. */
export interface PreflightWords {
  name: string
  command: string
  signIn: ProviderSignIn
  /** Where the CLI was looked for, when there was more than one place (T167). */
  placement?: ProviderPlacement | null
}

/** The command that asks this CLI where it stands, as the boss would type it. */
export function statusCommand({ command, signIn }: PreflightWords): string {
  return [command, ...signIn.statusArgs].join(' ')
}

/**
 * The CLI is not on this machine at all.
 *
 * On a Windows with WSL, "at all" means both places: the Windows `PATH` and every distro (T167).
 * The card then offers both installs — either one works — says which shell each is typed in, and
 * lists where it looked, so a boss who *has* installed it somewhere can see which somewhere the
 * app did not find.
 *
 * **Unless the boss already said where** (T258). A place they chose and the CLI is not in is not a
 * machine with two equal answers any more: the card names that place in its title, offers that
 * place's own install command and nothing else, and the body adds the one other way out — run this
 * Provider where the CLI already is. Before T258 this card was never drawn for that machine at all;
 * the app moved the Provider to Windows and said nothing.
 */
export function missingCheck(words: PreflightWords): ProviderCheck {
  const steps = missingSteps(words)
  const chosen = words.placement?.missingAt ?? null
  return {
    state: 'missing',
    title: chosen ? `${words.name} is not installed in ${runtimeLabel(chosen)}` : `${words.name} is not installed`,
    body: missingBody(words),
    lead: chosen
      ? INSTALL_THERE_LEAD
      : steps.length > 0
        ? INSTALL_EITHER_LEAD
        : 'Install it once, in a terminal, and every Company here works:',
    commands: [words.signIn.installWith, words.signIn.signInWith],
    ...(steps.length > 0 && { steps }),
    lookedIn: lookedInLine(words.placement?.lookedIn ?? []),
    note: PREFLIGHT_STILL_OPENS,
    ...NO_IDENTITY,
  }
}

/** The lead when there is one place to install into, because the boss already said which (T258). */
export const INSTALL_THERE_LEAD = 'Install it where you chose to run it:'

/**
 * The other way out of a place the CLI is not in: run this Provider somewhere it already is (T258).
 *
 * Only ever offered for a place the CLI was really found in, so the sentence is never advice to pick
 * an empty one. A machine that has it nowhere gets no sentence at all: there is nothing to pick.
 */
export function pickElsewhereNote(elsewhere: ProviderRuntime): string {
  return `Or pick ${runtimeLabel(elsewhere)} for this Provider in Your profile → Providers.`
}

/** The frame's own sentence (`c8knu`): both places are right, and the boss picks one. */
export const INSTALL_EITHER_LEAD = 'Install it on Windows, or inside WSL — either works:'

/** `Then sign in`, and the thing nobody guesses: the login belongs to the place you installed it. */
export const SIGN_IN_STEP_LABEL = 'Then sign in'
export const SIGN_IN_STEP_HINT = 'where you installed it'

/** PowerShell draws a `>`; every Linux shell draws a `$`. */
const POWERSHELL_PROMPT = '>'
const SHELL_PROMPT = '$'

/**
 * The card's rows when there are two places to install into: Windows, the distros WSL has, and the
 * sign-in that has to happen in whichever of them the boss chose. One distro gets one row; several
 * get one row each, because `wsl -d Debian` and `wsl -d Ubuntu` are two different machines.
 */
function missingSteps(words: PreflightWords): PreflightStep[] {
  const distros = words.placement?.distros ?? []
  const everyDistro = words.placement?.lookedIn.some((where) => where.startsWith(`${WSL_LABEL}:`)) ?? false
  if (!everyDistro) return []
  // The boss has already chosen a place, and the CLI is not in it (T258): the one row that is any
  // use to them is that place's own install command. Offering the other places as equals here is
  // what the silent fallback did in words — the way to another place is the sentence in the body.
  const chosen = words.placement?.missingAt
  if (chosen) return [installStep(words, chosen), signInStep(words)]
  const named = distros.length > 0 ? distros : wslNames(words.placement?.lookedIn ?? [])
  return [
    installStep(words, WINDOWS_RUNTIME),
    ...named.map((distro): PreflightStep => installStep(words, { kind: 'wsl', distro })),
    signInStep(words),
  ]
}

/** One place's install row: its own command, in the shell that place's boss types it in. */
function installStep(words: PreflightWords, runtime: ProviderRuntime): PreflightStep {
  const windows = runtime.kind === 'windows'
  return {
    kind: 'install',
    runtime,
    label: windows ? WINDOWS_LABEL : runtimeLabel(runtime),
    hint: windows ? 'PowerShell' : 'bash',
    prompt: windows ? POWERSHELL_PROMPT : SHELL_PROMPT,
    command: windows
      ? (words.signIn.installOnWindows ?? words.signIn.installWith)
      : (words.signIn.installInWsl ?? words.signIn.installWith),
  }
}

/** The sign-in row, which belongs to whichever place the CLI ends up in. */
function signInStep(words: PreflightWords): PreflightStep {
  return {
    kind: 'sign-in',
    runtime: null,
    label: SIGN_IN_STEP_LABEL,
    hint: SIGN_IN_STEP_HINT,
    prompt: SHELL_PROMPT,
    command: words.signIn.signInWith,
  }
}

/** The distro names out of `WSL: Ubuntu, Debian`, for a machine where none of them had the CLI. */
function wslNames(lookedIn: readonly string[]): string[] {
  const line = lookedIn.find((where) => where.startsWith(`${WSL_LABEL}:`))
  if (!line) return []
  return line
    .slice(`${WSL_LABEL}:`.length)
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

/**
 * Where it was not: this machine, or — on a Windows with WSL — neither of the two places.
 *
 * The machine is named the way its own boss would name it (T250). A Mac is "this Mac"; a Windows
 * with one place to look is "Windows", because there the boss knows the distinction and a sentence
 * that ignored it would read as a bug; and everything else — a Linux desktop — is "this computer",
 * which is the only honest word for a machine this app does not otherwise name.
 */
export function missingBody(words: PreflightWords, platform: NodeJS.Platform = process.platform): string {
  const places = missingPlaces(words, platform)
  const first = `TinyCorp could not find the ${words.command} command ${places} — so no Employee on ${words.name} can start.`
  const elsewhere = foundElsewhere(words)
  return elsewhere ? `${first} ${pickElsewhereNote(elsewhere)}` : first
}

/**
 * Where the CLI *is*, when the place the boss chose is not it (T258) — the first place it was found
 * in, which is Windows whenever Windows has it. Null when they chose nothing, and null when the CLI
 * is in no other place either.
 */
function foundElsewhere(words: PreflightWords): ProviderRuntime | null {
  if (!words.placement?.missingAt) return null
  return runtimeChoices(words.placement)[0] ?? null
}

function missingPlaces(words: PreflightWords, platform: NodeJS.Platform): string {
  // The boss's own answer, named back to them: *not there* is the whole of what this card says, and
  // a sentence about "Windows or inside WSL" would be the app answering a question nobody asked.
  const chosen = words.placement?.missingAt
  if (chosen) return `in ${runtimeLabel(chosen)}, where you chose to run it`
  if ((words.placement?.lookedIn.length ?? 0) > 1) return 'on Windows or inside WSL'
  if (platform === 'win32') return 'on Windows'
  return platform === 'darwin' ? 'on this Mac' : 'on this computer'
}

/** The command is there and nobody is signed in. */
export function signedOutCheck(words: PreflightWords): ProviderCheck {
  // Signed in is checked where the CLI runs (T167): a `claude` on Windows and a `claude` in Ubuntu
  // are two installations with two logins, so the card names the one that is signed out.
  const where =
    words.placement?.chosen && hasRuntimeChoice(words.placement) ? ` in ${runtimeLabel(words.placement.chosen)}` : ''
  return {
    state: 'signed-out',
    title: `${words.name} is not signed in`,
    body: `TinyCorp found the command${where}, but no subscription login — so no Employee on ${words.name} can start.`,
    lead: 'Sign in once, in a terminal, and every Company here works:',
    commands: [words.signIn.signInWith, statusCommand(words)],
    note: PREFLIGHT_STILL_OPENS,
    ...NO_IDENTITY,
  }
}

/**
 * Signed in, but on a key that is billed per token rather than on the subscription the boss
 * already pays for. A warning and not a wall: the Employee runs, and the bill is not a surprise.
 */
export function apiKeyCheck(words: PreflightWords, identity: ProviderIdentity = NO_IDENTITY): ProviderCheck {
  return {
    state: 'warning',
    title: `${words.name} is signed in with an API key`,
    body: `TinyCorp found a login, but not a subscription one. Every Employee here runs on the subscription you already pay for (decision 3), so work done on this key is billed per token.`,
    lead: 'Sign in with your subscription instead, if you would rather it were not:',
    commands: [words.signIn.signInWith, statusCommand(words)],
    note: 'Everything still runs — this is here so the bill is never a surprise.',
    ...identity,
  }
}

/** Nothing to do. */
export function readyCheck(words: PreflightWords, identity: ProviderIdentity = NO_IDENTITY): ProviderCheck {
  return {
    state: 'ready',
    title: `${words.name} is signed in`,
    body: `Every Employee on ${words.name} runs as a session on your own subscription.`,
    lead: '',
    commands: [],
    note: 'Nothing to do.',
    ...identity,
  }
}
