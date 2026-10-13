import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  SKILL_SOURCE_LABEL,
  type SkillFound,
  type SkillFoundGroup,
  type SkillSource,
} from '../../../shared/catalogue/skill-sources'
import { type SkillInput, skillName, skillProblems } from '../../../shared/catalogue/skills'

/**
 * Reading the skill folders the boss already has on this machine (T253).
 *
 * Every agent that reads skills reads them from a folder, and this machine has several: a shared
 * one the cross-agent installers write to, one per product beside it, the plugins the boss
 * installed, and whatever the Company's own repos carry. When the Integrations tab opens, all of
 * them are listed here and each folder becomes a row the boss adds in one click.
 *
 * **Nothing is opened but a `SKILL.md`'s front matter, and only its first few KB.** Nothing is
 * run, nothing is copied and no folder belonging to another product is ever written — the same
 * trust line `SKILL_TRUST_WARNING` draws for a folder the boss picks by hand (T137).
 *
 * **One folder is one row.** Every path is resolved, so `~/.claude/skills/ai-sdk` pointing at
 * `~/.agents/skills/ai-sdk` is the one folder it is, grouped where it lives, with `Claude Code` on
 * it as a chip. The chips are read from the links themselves and never assumed, because which
 * products link a folder is a fact about this machine and not about the catalogue.
 */

/** How much of a `SKILL.md` is read. Front matter is the head of the file or it is nothing. */
export const FRONT_MATTER_BYTES = 4096

/** A folder TinyCorp will not descend into: `.system`, `.curated`, `.git` and the rest. */
const HIDDEN = /^\./

/** How deep a plugin's `skills/` is walked. The marketplaces file them under a category folder. */
const PLUGIN_DEPTH = 4

export interface SkillSources {
  /**
   * Reads every place and groups what it finds, with the Company's own skills — path and name —
   * marking the rows that are in already and the names that are taken. A second scan replaces the
   * first: the paths it offers are the ones `take` will answer for.
   */
  scan(taken: readonly { name: string; path: string }[]): SkillFoundGroup[]
  /**
   * What the catalogue is given for one found folder. Null for a path the last scan did not offer,
   * which is how a renderer that asks for something else gets nothing rather than something.
   */
  take(path: string): SkillInput | null
}

export interface SkillSourcesOptions {
  /** The boss's environment. `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and the XDG variables move folders. */
  env?: NodeJS.ProcessEnv
  /** Which OS's paths to resolve. Injected so one test covers all three. */
  platform?: NodeJS.Platform
  /** The checkouts this Company works in, whose own `.claude/skills` and friends are read too. */
  repos?: () => readonly string[]
  /**
   * The home folders inside WSL to read as well (T249): `\\wsl.localhost\<distro>\home\<user>`.
   * Empty everywhere but a Windows whose team runs in a distro, and injected because finding them
   * is the runtime layer's job and not this module's.
   */
  wslHomes?: () => readonly string[]
}

/** One folder to look in: what kind of place it is, and where. */
interface Place {
  source: SkillSource
  path: string
  /**
   * The folder the group's label shows, when it is not this one. Every installed plugin has a
   * `skills/` of its own and they are one group — the boss installed plugins, not folders.
   */
  groupPath?: string
  /** Walked for a nested `SKILL.md` rather than read one level down. Only the plugins are. */
  deep?: boolean
}

/**
 * Where each product keeps the boss's own skills, on this OS — whether or not the folder is there.
 *
 * `~` is resolved here and nowhere else: the UI writes the `~` back on for the boss to read, and
 * everything the engine holds is the real path.
 */
export function skillPlaces(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Place[] {
  return [
    { source: 'shared', path: join(home, '.agents', 'skills') },
    { source: 'claude-code', path: join(env['CLAUDE_CONFIG_DIR']?.trim() || join(home, '.claude'), 'skills') },
    { source: 'codex', path: join(env['CODEX_HOME']?.trim() || join(home, '.codex'), 'skills') },
    // OpenCode 1.18 reads both spellings of every folder it has — `agent` and `agents`, `command`
    // and `commands`, `skill` and `skills` — so both are places, and whichever the boss has is the
    // one that turns up.
    { source: 'opencode', path: join(configHome(env, platform, home), 'opencode', 'skills') },
    { source: 'opencode', path: join(configHome(env, platform, home), 'opencode', 'skill') },
  ]
}

/** The XDG config home, which OpenCode uses on every platform it runs on. */
function configHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const xdg = env['XDG_CONFIG_HOME']?.trim()
  if (xdg) return xdg
  if (platform === 'win32') return env['APPDATA']?.trim() || join(home, 'AppData', 'Roaming')
  return join(home, '.config')
}

/** The folders a checkout keeps its own skills in — one per product that reads a repo's. */
export function repoSkillFolders(repo: string): string[] {
  return [
    join(repo, '.claude', 'skills'),
    join(repo, '.agents', 'skills'),
    join(repo, '.codex', 'skills'),
    join(repo, '.opencode', 'skills'),
    join(repo, '.opencode', 'skill'),
  ]
}

export function createSkillSources({
  env = process.env,
  platform = process.platform,
  repos = () => [],
  wslHomes = () => [],
}: SkillSourcesOptions = {}): SkillSources {
  /** What the last scan offered, by real path. Nothing else in the app can reach it. */
  let held = new Map<string, SkillInput>()

  return {
    scan(taken) {
      held = new Map()
      const groups = readPlaces(placesToRead(env, platform, repos(), wslHomes()), taken)
      for (const group of groups) {
        for (const skill of group.skills) {
          if (skill.problem === null && !skill.added) held.set(skill.path, { name: skill.name, path: skill.path })
        }
      }
      return groups
    },

    take: (path) => held.get(path) ?? null,
  }
}

/** Every folder this machine is asked about, in the order the card draws them. */
function placesToRead(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  repos: readonly string[],
  wslHomes: readonly string[],
): Place[] {
  const home = env['HOME'] ?? env['USERPROFILE'] ?? homedir()
  return [
    ...skillPlaces(home, env, platform),
    // A distro's home is read with the same layout and none of the environment: the variables
    // above are this Windows process's, and mean nothing inside a distro (T167, T249).
    ...wslHomes.flatMap((distroHome) => skillPlaces(distroHome, {}, 'linux')),
    ...pluginPlaces(home, env),
    ...repos.flatMap((repo) => repoSkillFolders(repo).map((path): Place => ({ source: 'repo', path }))),
  ]
}

/**
 * The skills of the plugins the boss has actually installed.
 *
 * `~/.claude/plugins` holds every marketplace it has ever fetched, which is hundreds of skills
 * nobody asked for. The installed list is the one the CLI keeps, and each entry says where its
 * copy is — so only what the boss installed is offered.
 */
function pluginPlaces(home: string, env: NodeJS.ProcessEnv): Place[] {
  const root = join(env['CLAUDE_CONFIG_DIR']?.trim() || join(home, '.claude'), 'plugins')
  const parsed = parseJson(readIfThere(join(root, 'installed_plugins.json')))
  if (!isRecord(parsed) || !isRecord(parsed['plugins'])) return []
  const paths = Object.values(parsed['plugins']).flatMap((installs) =>
    (Array.isArray(installs) ? installs : [])
      .map((install) => (isRecord(install) ? text(install['installPath']) : ''))
      .filter((path) => path !== ''),
  )
  return [...new Set(paths)].map(
    (path): Place => ({ source: 'plugins', path: join(path, 'skills'), groupPath: root, deep: true }),
  )
}

/**
 * Every place read, in order, with each folder appearing exactly once.
 *
 * The order is what decides where a linked folder is grouped: the shared folder is read first, so
 * `~/.claude/skills/ai-sdk` pointing into it is a chip on the shared row rather than a second row
 * of its own. A place whose entry went elsewhere counts it in `elsewhere`, which is what lets its
 * label say `7 of its own` about a folder holding 86 entries.
 */
function readPlaces(places: readonly Place[], taken: readonly { name: string; path: string }[]): SkillFoundGroup[] {
  const byPath = new Map<string, SkillFound>()
  const groups = new Map<string, SkillFoundGroup>()
  const names = taken.map((skill) => ({ name: skill.name, path: realOrSelf(skill.path) }))
  const takenPaths = new Set(names.map((skill) => skill.path))

  for (const place of places) {
    const shown = place.groupPath ?? place.path
    // Two places can be one group: OpenCode reads both spellings of its folder, every installed
    // plugin has a `skills/` of its own, and a Company may list one checkout twice.
    const key = `${place.source}\u0000${shown}`
    const group = groups.get(key) ?? { source: place.source, path: shown, skills: [], elsewhere: 0 }
    for (const folder of foldersIn(place)) {
      const real = realOrSelf(folder)
      const already = byPath.get(real)
      if (already) {
        // The same folder, reached by another name. This place links to it rather than holding it.
        const label = SKILL_SOURCE_LABEL[place.source]
        if (real !== folder && !already.seenBy.includes(label)) already.seenBy.push(label)
        group.elsewhere += 1
        continue
      }
      const head = frontMatter(join(folder, 'SKILL.md'))
      // No `SKILL.md`, or one whose front matter says nothing: not a skill, and never counted.
      if (!head) continue
      const found = rowOf(real, head, names, takenPaths)
      byPath.set(real, found)
      group.skills.push(found)
    }
    if (group.skills.length > 0) groups.set(key, group)
  }
  // A place that found nothing is not a group; one that found only links is not one either, and
  // its `elsewhere` went with it, because there is nothing left for that count to be about.
  return [...groups.values()]
}

/** One found folder as the row draws it, and what would be wrong with adding it. */
function rowOf(
  path: string,
  head: { name: string; description: string },
  taken: readonly { name: string; path: string }[],
  takenPaths: ReadonlySet<string>,
): SkillFound {
  const name = skillName(head.name)
  const added = takenPaths.has(path)
  const others = taken.filter((skill) => skill.path !== path).map((skill) => skill.name)
  return {
    path,
    name,
    description: head.description,
    seenBy: [],
    added,
    problem: added ? null : (skillProblems({ name, path }, others).name ?? null),
  }
}

/** The folders in one place: one level down, or walked, and never a hidden one. */
function foldersIn(place: Place): string[] {
  return place.deep ? walk(place.path, PLUGIN_DEPTH) : entriesIn(place.path)
}

/**
 * Every folder directly inside `dir`, in the order the OS lists it, hidden ones left out.
 *
 * A link is followed — `~/.claude/skills` is 79 of them here — and `withFileTypes` reports one as
 * a link rather than a folder, so what a name points at is what decides.
 */
function entriesIn(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return []
  }
  return names
    .filter((name) => !HIDDEN.test(name))
    .map((name) => join(dir, name))
    .filter(isFolder)
}

/** The folders under `dir` holding a `SKILL.md`, at most `depth` levels down. */
function walk(dir: string, depth: number): string[] {
  if (depth <= 0) return []
  return entriesIn(dir).flatMap((folder) => (isFile(join(folder, 'SKILL.md')) ? [folder] : walk(folder, depth - 1)))
}

/**
 * A `SKILL.md`'s front matter: its name and its description, or null when there is none to read.
 *
 * Only the head of the file is opened — {@link FRONT_MATTER_BYTES} — because a skill's body is the
 * Employee's to read and not this app's. A file with no `---` fence, or a fence with no `name` in
 * it, is a folder that is not offered: skipped quietly, and never counted.
 */
export function frontMatter(file: string): { name: string; description: string } | null {
  const head = readHead(file)
  if (head === null) return null
  const fenced = /^﻿?-{3,}[ \t]*\r?\n([\s\S]*?)\r?\n-{3,}[ \t]*(?:\r?\n|$)/.exec(head)
  if (!fenced) return null
  const fields = yamlFields(fenced[1]!)
  const name = fields['name'] ?? ''
  if (!name) return null
  return { name, description: fields['description'] ?? '' }
}

/**
 * The scalar fields at the top level of a front matter block.
 *
 * Deliberately not a YAML parser: two keys are read out of somebody else's file, the value may be
 * quoted or folded over the following indented lines, and anything nested belongs to whoever wrote
 * it. A line this does not understand is a line it steps over.
 */
function yamlFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let key: string | null = null
  for (const line of block.split(/\r?\n/)) {
    const entry = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line)
    if (entry) {
      key = entry[1]!
      fields[key] = unquote(entry[2]!)
      continue
    }
    // An indented line continues the value above it, which is how a long description is written.
    const folded = /^[ \t]+(\S.*)$/.exec(line)
    if (folded && key && fields[key] !== undefined) {
      fields[key] = `${fields[key]} ${unquote(folded[1]!)}`.trim()
      continue
    }
    key = null
  }
  return fields
}

/** `|`, `>-`, `|+2`: YAML's way of saying the value is the indented lines under it, not this one. */
const BLOCK_SCALAR = /^[|>][-+]?\d*$/

function unquote(value: string): string {
  const text = value.trim().replace(/[ \t]+#.*$/, '')
  if (BLOCK_SCALAR.test(text)) return ''
  const quoted = /^(["'])([\s\S]*)\1$/.exec(text)
  return (quoted ? quoted[2]! : text).trim()
}

/** The first {@link FRONT_MATTER_BYTES} of a file, or null when it is not a file we can read. */
function readHead(file: string): string | null {
  let handle: number
  try {
    handle = openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const buffer = Buffer.alloc(FRONT_MATTER_BYTES)
    const read = readSync(handle, buffer, 0, FRONT_MATTER_BYTES, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return null
  } finally {
    closeSync(handle)
  }
}

/**
 * Where a folder really is, links resolved. A path that cannot be resolved — a broken link, a
 * distro that is not running — is itself, so the row is still drawn and still says where it points.
 */
function realOrSelf(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readIfThere(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** That file belongs to another program, which may write anything into it. */
function parseJson(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
