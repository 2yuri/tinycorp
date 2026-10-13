import { readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { AddRepoInput, AttachScannedResult, RepoInspection } from '../../../shared/repos/repo'
import type { InspectRepo } from './repo-inspector'
import type { RepoRegistry } from './repos'

/** How far below the chosen folder the scan looks: its children and grandchildren. */
export const SCAN_DEPTH = 2

/** What the scan may read: the sub-folders of a folder, empty when it cannot be read. */
export interface ScanDeps {
  folders(path: string): string[]
  inspect: InspectRepo
}

export const diskFolders: ScanDeps['folders'] = (path) => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Folders the scan never enters. */
function skipped(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

/**
 * The git checkouts in `root` and up to `depth` levels below it (two by default), sorted by path, each read by the
 * repo inspector. The scan does not look inside a checkout, nor into node_modules or hidden folders.
 */
export function scanForRepos(root: string, deps: ScanDeps, depth = SCAN_DEPTH): RepoInspection[] {
  if (!isAbsolute(root)) throw new Error(`A folder to scan must be absolute: ${root}`)
  const found: RepoInspection[] = []
  const visit = (path: string, level: number) => {
    const inspection = deps.inspect(path)
    if (inspection.isGitRepo) {
      found.push(inspection)
      return
    }
    if (level >= depth) return
    for (const name of deps.folders(path)) {
      if (!skipped(name)) visit(join(path, name), level + 1)
    }
  }
  visit(resolve(root), 0)
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Attaches several checkouts at once, each with the brief given for its path and the stack and Checks
 * the inspector detected, whatever they are. Names clash-free: `web`, then `acme-web`, then `web-2`.
 *
 * Every one of them lands on a single commit (T168): the boss ticks 23 repos out of a folder of 110
 * and the Company gains 23 repos or, if the process dies mid-way, none — never a half-filled list.
 * A checkout that refuses is reported with its reason and does not stop the rest.
 */
export function attachRepos(
  paths: readonly string[],
  registry: RepoRegistry,
  inspect: InspectRepo,
  briefs: Readonly<Record<string, string>> = {},
): AttachScannedResult {
  const refused: AttachScannedResult['failed'] = []
  const taken = new Set(registry.list().map((repo) => repo.name))
  const inputs: AddRepoInput[] = []
  for (const path of paths) {
    try {
      const inspection = inspect(path)
      if (!inspection.isGitRepo) throw new Error(`${path} is not a git repo`)
      const name = freeName(path, taken)
      taken.add(name)
      const brief = briefs[path]
      inputs.push({ path, name, ...(brief !== undefined && { brief }), stack: inspection.detected })
    } catch (caught) {
      refused.push({ path, error: caught instanceof Error ? caught.message : String(caught) })
    }
  }
  const result = registry.addMany(inputs)
  // The order the boss ticked them in, refusals of both kinds together.
  return { attached: result.attached, failed: [...result.failed, ...refused].sort(byGiven(paths)) }
}

function byGiven(paths: readonly string[]) {
  return (a: { path: string }, b: { path: string }) => paths.indexOf(a.path) - paths.indexOf(b.path)
}

function freeName(path: string, taken: Set<string>): string {
  const name = basename(path)
  const parent = basename(dirname(path))
  const candidates = [name, parent ? `${parent}-${name}` : name]
  const free = candidates.find((candidate) => !taken.has(candidate))
  if (free) return free
  let n = 2
  while (taken.has(`${name}-${n}`)) n++
  return `${name}-${n}`
}
