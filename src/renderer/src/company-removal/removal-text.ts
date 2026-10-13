import type { Company } from '../../../shared/company'

/** What `Delete company…` removes from the Company folder (the engine's `COMPANY_DATA`). */
export const DELETED_DATA = ['company.sqlite', 'memory/', 'worktrees/', 'attachments/'] as const

export const REMOVE_LABEL = 'Remove from launcher'
export const DELETE_LABEL = 'Delete company…'

/** The confirmation's title: `Delete Acme?`. */
export function deleteTitle(company: Pick<Company, 'name'>): string {
  return `Delete ${company.name}?`
}

/** The confirmation's body, naming the folder and what leaves it. */
export function deleteBody(company: Pick<Company, 'name' | 'folder'>): string {
  const [last, ...rest] = [...DELETED_DATA].reverse()
  return (
    `This stops ${company.name}’s Sessions and deletes its data in ${company.folder}: ` +
    `${rest.reverse().join(', ')} and ${last}. ` +
    'Connected repos and every other file in the folder stay. This cannot be undone.'
  )
}
