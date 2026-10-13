import { machineWords } from '../platform/machine-words'
import type { RevealProtection } from './ipc'

/**
 * Environments: the secrets an Employee uses without ever seeing them (T176, frames `zpvHQ`,
 * `aD50i`).
 *
 * A Company has three of them — dev, staging and prod — because that is what a team has and a
 * free-form list would only become three with worse names. Each holds variables: a name, the repos
 * allowed to use it, and a value that lives in the OS secret store and nowhere else. Not in the
 * Company database, not in a log, not in a repo, not in an Activity line, not in a crash report.
 *
 * The only way an Employee uses one is `env_run`: the app runs the command with the values in its
 * own child process and hands back the output with every value redacted. The Employee never holds
 * a value, so it cannot print one, commit one, or be talked into repeating one. What it can still
 * do is write code that sends a value somewhere — that is the {@link NOT_A_SANDBOX} line, and it
 * stays on the screen.
 */

/** The three environments every Company has. Order is the switch's order in frame `zpvHQ`. */
export const ENVIRONMENT_IDS = ['dev', 'staging', 'prod'] as const
export type EnvironmentId = (typeof ENVIRONMENT_IDS)[number]

export function isEnvironmentId(value: unknown): value is EnvironmentId {
  return ENVIRONMENT_IDS.includes(value as EnvironmentId)
}

/** The one that asks before every use until the boss says otherwise. */
export const GUARDED_ENVIRONMENT: EnvironmentId = 'prod'

/** One environment's two toggles, and how many variables it holds. */
export interface Environment {
  id: EnvironmentId
  /** Every `env_run` with it raises an approval card first. On for prod, off for the others. */
  askEveryUse: boolean
  /** Testing's Run it and the repo checks get these values too. On by default. */
  availableToChecks: boolean
  variableCount: number
}

/** What an environment is before the boss changes anything. */
export function defaultEnvironment(id: EnvironmentId): Omit<Environment, 'variableCount'> {
  return { id, askEveryUse: id === GUARDED_ENVIRONMENT, availableToChecks: true }
}

/** One variable, as everything outside the secret store knows it: a name, never a value. */
export interface EnvVariable {
  id: string
  environment: EnvironmentId
  name: string
  /** The repos allowed to use it. Empty means every repo of the Company. */
  repoIds: string[]
  /** Who last used it through `env_run`, and when; null while it has never been used. */
  lastUsed: { employeeId: string; at: string } | null
}

/**
 * What the table draws in the VALUE column. A fixed run of dots, the same for every variable: the
 * length of a secret is a fact about the secret, and nothing here is in the business of leaking one.
 */
export const MASKED_VALUE = '•'.repeat(12)

/** Everything the Environments tab draws, in one read. */
export interface EnvironmentSettings {
  environments: Environment[]
  variables: EnvVariable[]
  /** The Company's repos, for the repo scopes and the side panel's DEFAULT FOR list. */
  repos: { id: string; name: string; defaultEnvironment: EnvironmentId | null }[]
  /** Where the values are kept on this machine, in one sentence for the side panel. */
  storedAt: string
  /** What the table's footer says about Reveal and Copy on this platform. */
  revealFooter: string
  /**
   * Why this machine cannot keep a secret at all, or null when it can: a Linux desktop with no
   * keyring, where `safeStorage` would "encrypt" with a key that is in its own source. The tab
   * says so and refuses to add anything, rather than drawing a lock over nothing.
   */
  storageProblem: string | null
}

/** Why this value cannot be stored, or null when it can. */
export function secretProblem(value: string): string | null {
  if (value === '') return 'A variable needs a value.'
  if (/[\r\n]/.test(value)) {
    // The secret store writes one line per command, so a newline here is an injection rather than
    // a value (T199-H3). The store refuses it too; this is so the boss reads it in the preview
    // before the write.
    return (
      'A value cannot contain a line break: the secret store writes one line, and a value with a ' +
      'newline in it would end that line early. A value copied out of a secrets manager often ' +
      'carries a trailing one — paste it again without it.'
    )
  }
  return null
}

/** Why this is not a variable name, or null when it is. `.env` names, and nothing else. */
export function nameProblem(name: string): string | null {
  if (name === '') return 'A variable needs a name.'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return 'A name is letters, digits and underscores, and does not start with a digit.'
  }
  return null
}

/**
 * Prefixes a build tool hands to the browser. A key with one of these is not a secret — it is in
 * the bundle the moment it is built — so Import .env leaves it unticked and says why.
 */
export const PUBLIC_PREFIXES = [
  'NEXT_PUBLIC_',
  'VITE_',
  'PUBLIC_',
  'REACT_APP_',
  'EXPO_PUBLIC_',
  'GATSBY_',
  'NUXT_PUBLIC_',
  'VUE_APP_',
] as const

/** Names that are configuration rather than a secret, whatever they hold. */
export const NOT_SECRET_NAMES = ['NODE_ENV', 'PORT', 'HOST', 'LOG_LEVEL', 'TZ', 'CI'] as const

/** Why a key is unticked in the Import preview, or null when it is ticked. */
export function importSkipReason(name: string): string | null {
  if (PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'public — skipped'
  if ((NOT_SECRET_NAMES as readonly string[]).includes(name)) return 'not a secret — skipped'
  return null
}

/** One key of a parsed `.env`, as the preview draws it. The value is never part of this. */
export interface ImportKey {
  name: string
  /** Ticked by default; a public or non-secret key is not. */
  chosen: boolean
  /** `public — skipped`, `not a secret — skipped`, or null. */
  skipReason: string | null
  /** `new`, or `replaces staging’s` when the environment already holds this name. */
  note: string
  /** Why it cannot be imported at all (a name that is not a name, a value with a line break). */
  problem: string | null
}

/** What the Import .env preview shows: the file, its keys, and not one value. */
export interface ImportPreview {
  /** The file as the boss sees it in the dialog, e.g. `web-app/.env.local`. */
  file: string
  environment: EnvironmentId
  keys: ImportKey[]
}

/**
 * Parses a `.env` file. Handles `export `, `#` comments, blank lines, single and double quotes and
 * the escapes a double-quoted value carries. A line that is not `NAME=value` is skipped rather than
 * guessed at: the preview lists what it understood, and the boss sees what is missing.
 */
export function parseEnvFile(text: string): { name: string; value: string }[] {
  const found: { name: string; value: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    found.push({ name: match[1]!, value: unquote(match[2]!) })
  }
  return found
}

function unquote(value: string): string {
  const double = /^"((?:[^"\\]|\\.)*)"/.exec(value)
  if (double) {
    return double[1]!
      .replaceAll('\\n', '\n')
      .replaceAll('\\r', '\r')
      .replaceAll('\\t', '\t')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
  }
  const single = /^'([^']*)'/.exec(value)
  if (single) return single[1]!
  // Unquoted: a trailing comment is a comment, and the value stops before it.
  return value.replace(/\s+#.*$/, '').trim()
}

/** The preview of one parsed file against what an environment already holds. */
export function importPreview(
  file: string,
  environment: EnvironmentId,
  entries: readonly { name: string; value: string }[],
  existing: readonly string[],
): ImportPreview {
  const held = new Set(existing)
  return {
    file,
    environment,
    keys: entries.map(({ name, value }) => {
      const skipReason = importSkipReason(name)
      const problem = nameProblem(name) ?? secretProblem(value)
      return {
        name,
        chosen: skipReason === null && problem === null,
        skipReason,
        note: held.has(name) ? `replaces ${environment}’s` : 'new',
        problem,
      }
    }),
  }
}

/** How long a copied value stays on the clipboard before the app takes it back (frame `zpvHQ`). */
export const CLIPBOARD_CLEAR_MS = 30_000

/** How long a revealed value stays on screen before it masks itself again (frame `aD50i`, d). */
export const REVEAL_MS = 15_000

/** The footer under the variables table, word for word from frame `zpvHQ`. The Mac's sentence. */
export const REVEAL_FOOTER =
  'Reveal and Copy ask for Touch ID or your password every time. Copy clears the clipboard after 30 seconds.'

/**
 * That sentence on the platform the boss is actually on. Touch ID is a Mac affordance, and a
 * screen that promises one on a machine that has none is the app lying about its own locks; the
 * main process reads the platform and the renderer draws what it is given.
 */
export function revealFooter(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return REVEAL_FOOTER
  return 'Reveal and Copy ask you to confirm every time. Copy clears the clipboard after 30 seconds.'
}

/** What Reveal says where the OS has nothing better than a confirmation to ask with. */
export const UNPROTECTED_REVEAL =
  'This machine has no Touch ID prompt for TinyCorp to use, so Reveal and Copy here are protected ' +
  'by that confirmation and by nothing else.'

/** The honesty line, which never leaves the screen (frame `zpvHQ`). */
export const NOT_A_SANDBOX = {
  title: 'Not a sandbox',
  body: 'Code an Employee writes could still send a value somewhere. Keep prod behind approval.',
} as const

/** The explainer's three steps, in the order frame `zpvHQ` draws them. */
export function howItWorks(platform: string): readonly { title: string; body: string }[] {
  return [
    { title: 'env_run', body: 'an Employee asks TinyCorp to run a command' },
    { title: machineWords(platform).secretStoreTitle, body: 'TinyCorp injects the values into that one process' },
    { title: '‹NAME›', body: 'output comes back with every value replaced' },
  ]
}

/** How long a command gets before `env_run` gives up on it. */
export const ENV_RUN_TIMEOUT_MS = 10 * 60 * 1000

/** How much of a command's output comes back. Beyond this it is cut, and the answer says so. */
export const ENV_RUN_MAX_BYTES = 64 * 1024

/** What `env_run` answers with. Every value in `stdout` and `stderr` is already redacted. */
export interface EnvRunResult {
  status: 'ran' | 'pending' | 'denied'
  exitCode: number | null
  stdout: string
  stderr: string
  /** How many values were swapped out of the output. */
  redacted: number
  /** The names it ran with, which is what an Employee is allowed to know. */
  variables: string[]
  timedOut: boolean
  truncated: boolean
}

/**
 * What asking who is there came to. `cancelled` is the boss saying no, which is not an error.
 *
 * The prompt itself is the machine's — Touch ID where there is a sensor, a confirmation dialog
 * where there is not — so it is implemented in the composition root and injected. What the shape
 * of it is has to be nameable from both sides, so it lives here (T188).
 */
export type RevealDecision =
  | { ok: true; protection: RevealProtection }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string }

/** Asks the OS. Injected everywhere it is used, so no test and no engine calls into Electron. */
export type AskWhoIsThere = (reason: string) => Promise<RevealDecision>
