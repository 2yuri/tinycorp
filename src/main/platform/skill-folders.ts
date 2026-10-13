import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { excludeFromGit } from './git-exclude'

/**
 * Putting the boss's skill folders where an Employee's product looks for them (T137).
 *
 * The folder is never copied into the Company and never read here — TinyCorp does not parse,
 * validate or run anything in it. What lands in the worktree is a link to the boss's own folder,
 * so an edit there is an edit every Employee holding it sees.
 */

/**
 * A folder TinyCorp copied rather than linked, on a platform that refused the link. The marker is
 * what makes a copy removable later: nothing without it is ever deleted, so a skill folder the
 * repo tracks itself is safe from us.
 */
export const SKILL_COPY_MARKER = '.tinycorp-skill'

/**
 * A folder of the boss's own to put somewhere: the name it is seen under, and where it really is.
 *
 * Structurally a `GrantedSkill` without the grant. The machine may not name a seam, and it does not
 * need to: what it does here is the same whatever asked for it.
 */
export interface LinkableFolder {
  name: string
  path: string
}

/** What a skill's folder name may be: one segment, never `.`, `..` or a path of its own. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Makes `<worktree>/<folder>` hold exactly the granted skills, and returns the names it installed.
 *
 * A symlink where the platform allows one, so the boss edits the folder once and every Employee
 * holding it sees the edit, and nothing is duplicated; a marked copy where it does not. A grant
 * that is gone is taken out again, and everything that lands is git-excluded — the app writes into
 * a worktree and never commits (decision 45).
 *
 * It removes only what it could have put there: a link, or a copy carrying {@link SKILL_COPY_MARKER}.
 * A folder of the repo's own with the same name is left alone and not shadowed.
 */
export function syncSkillFolder(worktree: string, folder: string, skills: readonly LinkableFolder[]): string[] {
  if (!folderExists(worktree)) return []
  const dir = join(worktree, folder)
  // A name is one folder inside `folder` and never a way out of it: this function removes what it
  // finds, so a name that walks up the tree is refused here as well as in the catalogue.
  const wanted = skills.filter((skill) => SAFE_NAME.test(skill.name) && folderExists(skill.path))
  if (wanted.length === 0 && !existsSync(dir)) return []

  const byName = new Map(wanted.map((skill) => [skill.name, resolve(skill.path)]))
  const already = new Set<string>()
  for (const entry of ours(dir)) {
    const target = byName.get(entry.name)
    // A link that no longer points where the grant does is stale, and is made again below.
    if (target !== undefined && (entry.target === null || entry.target === target)) {
      already.add(entry.name)
      continue
    }
    rmSync(join(dir, entry.name), { recursive: true, force: true })
  }

  const installed: string[] = []
  let made = 0
  if (wanted.length > 0) mkdirSync(dir, { recursive: true })
  for (const skill of wanted) {
    if (already.has(skill.name)) {
      installed.push(skill.name)
      continue
    }
    const at = join(dir, skill.name)
    // Anything left at this name is the repo's own, and is not shadowed.
    if (existsSync(at) || isLink(at)) continue
    if (link(resolve(skill.path), at) || copy(resolve(skill.path), at)) {
      installed.push(skill.name)
      made++
    }
  }
  // Only when something new landed: the exclusion is idempotent and stays, and this runs a `git`
  // of its own, which a reconcile that changed nothing has no reason to pay for.
  if (made > 0) excludeFromGit(worktree, [`${folder.split('/')[0]!}/`])
  return installed
}

/**
 * Everything in `dir` TinyCorp put there: a link, with where it points, or a copy carrying the
 * marker, whose `target` is null because there is nothing to compare it to.
 */
function ours(dir: string): { name: string; target: string | null }[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name): { name: string; target: string | null }[] => {
    const at = join(dir, name)
    if (isLink(at)) {
      try {
        return [{ name, target: resolve(dir, readlinkSync(at)) }]
      } catch {
        return [{ name, target: '' }]
      }
    }
    return existsSync(join(at, SKILL_COPY_MARKER)) ? [{ name, target: null }] : []
  })
}

/** Whether `path` is a folder on this machine. `platform`'s own, so nothing here names a feature. */
function folderExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function link(from: string, at: string): boolean {
  try {
    symlinkSync(from, at, 'dir')
    return true
  } catch {
    return false
  }
}

/** The fallback where a link is refused: a copy that says it is ours, so it can be taken away again. */
function copy(from: string, at: string): boolean {
  try {
    cpSync(from, at, { recursive: true })
    writeFileSync(join(at, SKILL_COPY_MARKER), 'Put here by TinyCorp. Edit the original folder instead.\n')
    return true
  } catch {
    rmSync(at, { recursive: true, force: true })
    return false
  }
}
