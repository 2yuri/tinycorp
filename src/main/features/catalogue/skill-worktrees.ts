import type { DatabaseSync } from 'node:sqlite'
import type { Employee, Provider } from '../../../shared/domain/staff'
import type { ProviderAdapter } from '../../providers'
import { employeeSkillGrants, folderExists, grantedSkills } from './skills'

/**
 * Keeping every ticket worktree holding exactly the skills its Employee was granted (T137).
 *
 * A grant follows the role and can change at any time — the boss edits a role, takes a skill off
 * the catalogue, or moves a ticket to someone else — so this is a reconcile rather than an install:
 * it is run after a worktree is created, after the catalogue changes and after the staff changes,
 * and every time it says what the worktree should hold now.
 *
 * Every Provider that reads skills at all is asked about every worktree, with an empty grant for
 * all but the assignee's own. That is what takes a skill away from a worktree whose ticket changed
 * hands, or whose new holder runs on a product that reads none.
 */
export interface WorktreeSkillsOptions {
  db: DatabaseSync
  /** Every ticket worktree of this Company now. */
  worktrees(): { ticketId: number; path: string }[]
  /** Who is on this ticket now, or null when nobody is. */
  assignee(ticketId: number): Employee | null
  /** Every Provider's adapter; the ones that install no skills are skipped. */
  adapters: Partial<Record<Provider, ProviderAdapter>>
  /** Whether a skill folder is on this Mac. Injected for the tests. */
  exists?: (path: string) => boolean
  /** Where a failure goes. A worktree that refuses its skills must not break the board. */
  log?: (line: string) => void
}

export function syncWorktreeSkills({
  db,
  worktrees,
  assignee,
  adapters,
  exists = folderExists,
  log = () => {},
}: WorktreeSkillsOptions): void {
  const installers = Object.entries(adapters).filter(([, adapter]) => adapter?.installSkills) as [
    Provider,
    ProviderAdapter,
  ][]
  if (installers.length === 0) return

  for (const worktree of worktrees()) {
    const employee = assignee(worktree.ticketId)
    const granted = employee ? grantedSkills(db, employeeSkillGrants(db, employee.id), exists) : []
    for (const [provider, adapter] of installers) {
      try {
        adapter.installSkills!(worktree.path, provider === employee?.provider ? granted : [])
      } catch (error) {
        log(`skills: ${worktree.path} on ${provider}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
