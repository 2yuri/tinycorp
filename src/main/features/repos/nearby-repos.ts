import type { Company } from '../../../shared/company'
import { folderOfInterest } from '../../../shared/repos/found-repos'
import type { NearbyRepos, Repo } from '../../../shared/repos/repo'
import { type ScanDeps, scanForRepos } from './repo-scan'

/**
 * The checkouts beside the Company's first repo (the one connected at Create Company), one level
 * deep, leaving out the ones already connected. Without a repo, the Company folder is scanned.
 */
export function nearbyRepos(company: Pick<Company, 'folder'>, repos: Repo[], deps: ScanDeps): NearbyRepos {
  const folder = folderOfInterest(company.folder, repos[0]?.path ?? null)
  const connected = new Set(repos.map((repo) => repo.path))
  const found = scanForRepos(folder, deps, 1).filter((inspection) => !connected.has(inspection.path))
  return { folder, found }
}
