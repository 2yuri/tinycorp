/**
 * The skill folders already on the boss's machine, as the Integrations tab lists them (T253,
 * frame `LBKv1`).
 *
 * T137 gave the Company one folder at a time, through the picker. Meanwhile the machine already
 * holds plenty: a shared folder every cross-agent installer writes to, each product's own folder
 * beside it, the skills of the plugins the boss installed, and whatever the Company's own repos
 * carry. This reads all of them when the tab opens and makes each one a row the boss adds in one
 * click.
 *
 * **One folder is one row.** A folder linked from several places is the folder it really is,
 * grouped where it really lives, and the places that link to it are named on it as chips. Nothing
 * is copied, nothing is run, and no file inside a skill folder is read but the first few KB of its
 * `SKILL.md` front matter — the same trust line {@link SKILL_TRUST_WARNING} draws.
 */

/**
 * The kinds of place a skill folder is found in.
 *
 * It is a list, and a reader is one entry here plus one case in `main/features/catalogue/
 * skill-sources.ts`. Three of them are Providers and three are not, which is why this is its own
 * catalogue rather than the Provider one: what a Session is spawned with and where the boss's own
 * skills happen to sit are two different questions.
 */
export const SKILL_SOURCES = ['shared', 'claude-code', 'codex', 'opencode', 'plugins', 'repo'] as const

export type SkillSource = (typeof SKILL_SOURCES)[number]

/**
 * What each place is called, in the boss's words. It lives here rather than in the screen because
 * three of these are Providers, and no renderer file may name one (`no-provider-names.test.ts`).
 */
export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  shared: 'Shared',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  plugins: 'Claude Code plugins',
  repo: 'In this Company’s repos',
}

/** One skill folder found on this machine, as the row draws it. */
export interface SkillFound {
  /** The folder's real path — every link resolved. It is what the row is, and what `Add` takes. */
  path: string
  /** The name the Company would take it under: its front matter's, normalised. */
  name: string
  /** Its front matter's description, whole. The row shows one line of it and titles the rest. */
  description: string
  /**
   * The tools whose own skill folder links to this one, in the words {@link SKILL_SOURCE_LABEL}
   * uses. Read from the links themselves — a place that holds the folder rather than pointing at
   * it is where the row is grouped, and says nothing here.
   */
  seenBy: string[]
  /** This Company already has a skill at this same folder, so the row says so instead of adding. */
  added: boolean
  /** Why it cannot be added at all, or null. A row with one offers no button. */
  problem: string | null
}

/** One place's skills, as the card groups them. */
export interface SkillFoundGroup {
  source: SkillSource
  /** The folder that was read, as the boss sees it: `~/.agents/skills`. */
  path: string
  skills: SkillFound[]
  /**
   * How many of this folder's entries are links to a folder that really lives somewhere else and
   * are grouped there instead. It is why the count line can say `7 of its own`.
   */
  elsewhere: number
}

/** How many rows a group draws before the boss asks for the rest. */
export const SKILLS_FOUND_PREVIEW = 3

/** What the card says it is (frame `LBKv1`). */
export const SKILLS_FOUND_SUB =
  'Folders with a SKILL.md, in the places your agents read them. Adding one names it in this Company — nothing is ' +
  'copied, and nothing in it is run by TinyCorp.'

/** What the card says when nowhere TinyCorp looks holds a skill folder. */
export const SKILLS_FOUND_EMPTY =
  'Nothing found. Your agents’ own skill folders and this Company’s repos hold no folder with a SKILL.md in it.'

/** What the plugins group says while it is shut, because it is the long one nobody asked for. */
export const SKILLS_FOUND_PLUGINS_TOGGLE = 'Show plugin skills'

/** Whether this group opens shut: the plugins' does, and no other. */
export function opensCollapsed(group: Pick<SkillFoundGroup, 'source'>): boolean {
  return group.source === 'plugins'
}

/**
 * The count at the right of a group's label.
 *
 * A place whose entries mostly point somewhere else says how many are really its own, because
 * `86 skills` over seven rows would be a lie about a folder that is 79 links deep.
 */
export function skillsFoundCountLine(group: Pick<SkillFoundGroup, 'skills' | 'elsewhere'>): string {
  const own = group.skills.length
  if (group.elsewhere > 0) return `${own} of its own`
  return own === 1 ? '1 skill' : `${own} skills`
}

/** What the line under a long group says: the rest of it, by count. */
export function showAllLine(total: number): string {
  return `Show all ${total}`
}

/** How many folders were found across every place, for the tab's count line. */
export function skillsFoundTotal(groups: readonly SkillFoundGroup[]): number {
  return groups.reduce((total, group) => total + group.skills.length, 0)
}

/** What the search field matches on a found skill: its name and what it says it does. */
export function skillFoundMatches(skill: Pick<SkillFound, 'name' | 'description'>, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return true
  return `${skill.name} ${skill.description}`.toLowerCase().includes(wanted)
}

/** `3 in this Company · 7 servers and 86 skills found`, as frame `LBKv1` writes it. */
export function integrationsCountLine(mine: number, servers: number, skills: number): string {
  return `${mine} in this Company · ${servers} servers and ${skills} skills found`
}

/** What the Integrations toolbar's search says it searches, now that it searches skills too. */
export const INTEGRATIONS_SEARCH_PLACEHOLDER = 'Search servers, skills, sources and presets'
