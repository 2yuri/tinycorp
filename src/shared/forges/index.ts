/**
 * Every forge a repo's pull requests can live on, in one file.
 *
 * A **forge** is the product that hosts the repo's `origin` and the pull request TinyCorp opens
 * into it. GitHub is one. GitLab is one. Azure DevOps is one. Which one a repo is on is not a
 * choice the Company makes — it is a fact about the repo's remote, so it is read from the remote,
 * per repo, and a Company can hold repos on several forges at once.
 *
 * Adding a forge is a pull request, and `docs/forges.md` is the guide. It is one folder and two
 * lines, exactly as a Provider is (`shared/providers.ts`):
 *
 * 1. an entry in {@link FORGE_CATALOGUE} below — its name, its CLI, the hosts it answers for;
 * 2. a folder under `src/main/engine/forges/<id>/` whose adapter passes the conformance suite in
 *    `src/main/engine/forge-conformance.ts`, run from its own test file;
 * 3. one line in `src/main/engine/forge-registry.ts`, where the adapter is built.
 *
 * It is two lines rather than one because the catalogue and the adapter live on opposite sides of
 * a process boundary: the renderer draws the repo card from this file and cannot load an adapter,
 * which is node code. The registry line only compiles once the entry exists, and
 * `createForgeAdapters` refuses a set that is missing one — a catalogued forge with no adapter
 * never reaches a repo.
 *
 * Nothing else in the app names a forge — a test asserts it (`no-forge-names.test.ts`). A repo on
 * a forge that is not here still works for everything local: worktrees, branches, diffs and a
 * local merge. It cannot open a PR, and it says so in words rather than failing at the moment an
 * Employee tries.
 */
import { isAbsolutePath } from '../platform/absolute-path'

/**
 * The mark drawn beside a repo's remote on the repo card (design frame `FuDXm`). A name, not a
 * component: the renderer maps it, so the catalogue stays free of React. A forge that names a mark
 * nobody draws gets the plain git mark, so a new forge renders without an edit in the renderer.
 */
export type ForgeIcon = 'cat' | 'fox' | 'infinity' | 'git'

/**
 * How the boss signs a forge's CLI in. TinyCorp never holds a forge token: it never reads one,
 * never writes one into a config of its own and never passes one as an argument. The CLI has the
 * credential, exactly as a Provider's CLI has the subscription login.
 */
export interface ForgeAuth {
  /** The docs table's column, e.g. "GitHub account, through `gh auth login`". */
  how: string
  /** The command that signs the boss out, for the docs table and Your profile. */
  signOut: string
}

export interface ForgeEntry {
  /** What a repo's forge is stored and read as, and the key every other module goes by. */
  id: string
  /** The product's full name: the repo card's title, and the sentence that refuses a PR. */
  name: string
  /** The short name a chip carries. */
  shortName: string
  /** The CLI the adapter runs. A repo whose forge's CLI is missing cannot open a PR. */
  command: string
  /**
   * The remote hosts this forge answers for, lowercase, as `origin` names them —
   * `github.com/acme/app` and `git@github.com:acme/app.git` both read `github.com`.
   *
   * A self-hosted instance is on a host nobody can list here: see {@link instanceLabels}.
   */
  hosts: readonly string[]
  /**
   * How a self-hosted instance of this forge says what it is: the first label of its host.
   * `['gitlab']` reads `gitlab.acme.com` and `git@gitlab.acme.io:team/app.git` as this forge, and
   * leaves `git.acme.com` alone.
   *
   * The host's own name is the only thing a remote carries that says which product answers on it,
   * so it is the only thing detection reads. An instance on a host that does not say so reads as a
   * forge TinyCorp does not know, works locally and says it can open no PR. Naming such a host is
   * a Company setting nobody has asked for yet. Left out, the forge answers for {@link hosts} only.
   */
  instanceLabels?: readonly string[]
  /** The mark the repo card draws. */
  icon: ForgeIcon
  /** How the boss signs its CLI in, and out. */
  auth: ForgeAuth
  /** Who answers for this adapter when it breaks, as `docs/forges.md`'s table names them. */
  maintainer: string
}

export const FORGE_CATALOGUE = [
  {
    id: 'github',
    name: 'GitHub',
    shortName: 'GitHub',
    command: 'gh',
    hosts: ['github.com'],
    icon: 'cat',
    auth: { how: 'GitHub account, through `gh auth login`', signOut: 'gh auth logout' },
    maintainer: 'TinyCorp',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    shortName: 'GitLab',
    command: 'glab',
    hosts: ['gitlab.com'],
    instanceLabels: ['gitlab'],
    icon: 'fox',
    auth: { how: 'GitLab account, through `glab auth login`', signOut: 'glab auth logout' },
    maintainer: 'TinyCorp',
  },
] as const satisfies readonly ForgeEntry[]

/** The forge a repo's `origin` is on. */
export type Forge = (typeof FORGE_CATALOGUE)[number]['id']

/** Every forge, in catalogue order. */
export const FORGES: readonly Forge[] = FORGE_CATALOGUE.map((entry) => entry.id)

export function forgeEntry(forge: Forge): ForgeEntry {
  return FORGE_CATALOGUE.find((entry) => entry.id === forge)!
}

/**
 * The host of a remote as the catalogue matches it: `git@github.com:acme/app.git`,
 * `https://github.com/acme/app` and the shown `github.com/acme/app` all read `github.com`.
 */
export function remoteHost(remote: string): string | null {
  const trimmed = remote.trim()
  if (!trimmed) return null
  // A folder on this machine is a perfectly good `origin`, and it names no forge. On Windows its
  // drive letter would otherwise read as the host: `D:\repos\app.git` is not a host called `d`.
  if (isAbsolutePath(trimmed)) return null
  const scp = /^[\w.-]+@([^:/]+):/.exec(trimmed)
  const bare = scp ? scp[1]! : trimmed.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '')
  const host = bare.split(/[/:]/)[0]?.toLowerCase()
  return host ? host.replace(/^ssh\./, '') : null
}

/**
 * The forge a remote is on, or null when its host is on no entry in `catalogue` — an instance
 * whose host does not say what it is, a forge nobody has written an adapter for, or a path on
 * this Mac.
 *
 * A host an entry lists wins over one an entry's {@link ForgeEntry.instanceLabels} reads, so a
 * listed host is never claimed by another forge's naming habit.
 */
export function forgeOfRemote(
  remote: string | null | undefined,
  catalogue: readonly ForgeEntry[] = FORGE_CATALOGUE,
): string | null {
  const host = remote ? remoteHost(remote) : null
  if (!host) return null
  const listed = catalogue.find((entry) => entry.hosts.some((h) => h.toLowerCase() === host))
  if (listed) return listed.id
  const label = host.split('.')[0]
  if (!label || label === host) return null
  return catalogue.find((entry) => entry.instanceLabels?.some((l) => l.toLowerCase() === label))?.id ?? null
}

/** {@link forgeOfRemote} over the app's own catalogue. */
export function forgeOf(remote: string | null | undefined): Forge | null {
  return forgeOfRemote(remote) as Forge | null
}

/**
 * What the boss calls the forge a remote or a PR URL is on, or null when no catalogued forge
 * answers for its host. Every screen that names a forge reads it from here.
 */
export function forgeLabelOf(remote: string | null | undefined): string | null {
  const forge = forgeOf(remote)
  return forge ? FORGE_LABEL[forge] : null
}

/**
 * Every table the app draws, from one catalogue.
 *
 * It takes the catalogue rather than reading it, so the promise this file makes can be tested:
 * `forge-registry.test.ts` builds these from a catalogue with one extra forge in it and checks the
 * repo card and the detection carry it, with no other file touched.
 */
export interface ForgeTables {
  /** Every forge, in catalogue order. */
  forges: readonly string[]
  /** What the boss sees each one called. */
  label: Record<string, string>
  /** The short name a chip carries. */
  shortName: Record<string, string>
  /** The CLI each one is driven through. */
  command: Record<string, string>
  /** The mark each one is drawn with. */
  icon: Record<string, ForgeIcon>
  /** How each one is signed in and out. */
  auth: Record<string, ForgeAuth>
}

export function forgeTables(catalogue: readonly ForgeEntry[]): ForgeTables {
  const by = <T>(read: (entry: ForgeEntry) => T): Record<string, T> =>
    Object.fromEntries(catalogue.map((entry) => [entry.id, read(entry)]))
  return {
    forges: catalogue.map((entry) => entry.id),
    label: by((entry) => entry.name),
    shortName: by((entry) => entry.shortName),
    command: by((entry) => entry.command),
    icon: by((entry) => entry.icon),
    auth: by((entry) => entry.auth),
  }
}

/** The app's own tables. */
const TABLES = forgeTables(FORGE_CATALOGUE)

/** What the boss sees a forge called. */
export const FORGE_LABEL = TABLES.label as Record<Forge, string>

/** The forge a form starts on: the first in the catalogue. */
export const DEFAULT_FORGE: Forge = FORGE_CATALOGUE[0].id

/** The CLI each forge is driven through. */
export const FORGE_COMMAND = TABLES.command as Record<Forge, string>

/** The mark each forge is drawn with. */
export const FORGE_ICON = TABLES.icon as Record<Forge, ForgeIcon>
