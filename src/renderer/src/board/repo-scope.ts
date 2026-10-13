import type { Ticket } from '../../../shared/domain/board'
import type { Repo } from '../../../shared/repos/repo'

/** The repos a ticket can pick: every attached repo, with or without checks (decision 40). */
export function repoChoices(repos: Repo[], _selected: string[]): Repo[] {
  return repos
}

/** A new ticket in a Company with a single repo starts with that repo picked. */
export function initialRepoScope(repos: Repo[], ticket: Pick<Ticket, 'repos'> | null): string[] {
  if (ticket) return ticket.repos
  const [only, ...others] = repos
  return only && others.length === 0 ? [only.id] : []
}

export function toggleRepo(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id]
}

/** A ticket works in at least one repo. */
export function repoScopeError(selected: string[]): string | null {
  return selected.length === 0 ? 'Pick at least one repo' : null
}
