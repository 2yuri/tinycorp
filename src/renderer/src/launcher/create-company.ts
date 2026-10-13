import type { AutonomyLevel } from '../../../shared/approvals'
import type { Company } from '../../../shared/company'
import type { Result } from '../../../shared/domain/result'
import type { TinyCorpApi } from '../../../shared/ipc'
import {
  type CompanyFolderHints,
  companyFolderRefusal,
  NO_FOLDER_HINTS,
  suggestedCompanyFolder,
} from '../../../shared/platform/company-folder'
import type { DetectedRepo } from '../../../shared/repos/repo'

/** What the Create a Company form holds. */
export interface CompanyDraft {
  name: string
  /** The folder the boss picked. Null while the suggestion under their home is what the form shows. */
  folder: string | null
  /** The first repository and what was detected in it, or null when none was chosen. */
  repo: DetectedRepo | null
  /** "About this repo" for the first repository. */
  repoBrief?: string
  autonomy: AutonomyLevel
  concurrencyCap: number
  notifications: boolean
}

export type CreateApi = Pick<TinyCorpApi, 'company' | 'repos' | 'approvals' | 'capacity' | 'notifications'>

/**
 * The folder the Company will be made in: what the boss picked, or `<home>/TinyCorp/<name>` until
 * they do (T252). Nobody should have to open the picker to create a Company, because the picker
 * opens wherever it was last — for one boss, inside a WSL share where SQLite cannot lock a file.
 */
export function draftFolder(draft: CompanyDraft, hints: CompanyFolderHints = NO_FOLDER_HINTS): string | null {
  return draft.folder ?? suggestedCompanyFolder(hints.home, draft.name)
}

/** Why the draft cannot be created yet, or null when it can. */
export function draftProblem(draft: CompanyDraft, hints: CompanyFolderHints = NO_FOLDER_HINTS): string | null {
  if (!draft.name.trim()) return 'Give the Company a name'
  const folder = draftFolder(draft, hints)
  if (!folder) return 'Choose a folder for the Company'
  // The same refusal the engine gives, said before anything is asked of the folder.
  const refusal = companyFolderRefusal(folder)
  if (refusal) return refusal
  if (draft.repo && !draft.repo.gitRepo) return `${draft.repo.path} is not a git repo`
  return null
}

/**
 * Creates the Company, then applies the rest of the form to it in order. The Company stays created
 * when a later step fails; the result says which step and why.
 */
export async function createCompany(
  api: CreateApi,
  draft: CompanyDraft,
  hints: CompanyFolderHints = NO_FOLDER_HINTS,
): Promise<Result<Company>> {
  const problem = draftProblem(draft, hints)
  if (problem) return { ok: false, error: problem }
  // `draftProblem` has already refused a draft with no folder, picked or suggested.
  const created = await api.company.create({ folder: draftFolder(draft, hints)!, name: draft.name.trim() })
  if (!created.ok) return created
  const steps: (() => Promise<Result<unknown>>)[] = [
    ...(draft.repo
      ? [
          () =>
            api.repos.add({
              path: draft.repo!.path,
              ...(draft.repoBrief?.trim() && { brief: draft.repoBrief }),
              stack: draft.repo!.stack ?? {},
            }),
        ]
      : []),
    () => api.approvals.setLevel(draft.autonomy),
    () => api.capacity.setConcurrencyCap(draft.concurrencyCap),
    () => api.notifications.setEnabled(draft.notifications),
  ]
  for (const step of steps) {
    const result = await step()
    if (!result.ok) return { ok: false, error: `${created.value.name} was created, but: ${result.error}` }
  }
  return created
}
