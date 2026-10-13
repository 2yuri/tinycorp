import {
  ENVIRONMENT_IDS,
  type EnvironmentId,
  type EnvironmentSettings,
  type EnvVariable,
  GUARDED_ENVIRONMENT,
  nameProblem,
  secretProblem,
} from '../../../shared/environments'

/**
 * What the Environments tab works out before it draws (T176, frame `zpvHQ`), kept out of the
 * component so it can be read and tested on its own.
 */

/**
 * The second sentence of *Ask me before every use* in frame `zpvHQ`: which environments start with
 * it on. Read off the catalogue rather than written out, so the line stays true when it grows.
 */
export function askDefaultsLine(): string {
  const others = ENVIRONMENT_IDS.filter((id) => id !== GUARDED_ENVIRONMENT)
  const rest = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others.at(-1)}` : others.join('')
  return `On for ${GUARDED_ENVIRONMENT}, off for ${rest}.`
}

/** The switch's chips: each environment with what it holds. */
export function switchChips(settings: EnvironmentSettings): { id: EnvironmentId; count: number; asks: boolean }[] {
  return ENVIRONMENT_IDS.map((id) => {
    const environment = settings.environments.find((row) => row.id === id)
    return { id, count: environment?.variableCount ?? 0, asks: environment?.askEveryUse ?? false }
  })
}

/** The repo chips one variable shows: the first, and how many more. Empty scope is every repo. */
export function repoChips(
  variable: EnvVariable,
  repos: EnvironmentSettings['repos'],
): { first: string; more: number; all: boolean } {
  if (variable.repoIds.length === 0) return { first: 'every repo', more: 0, all: true }
  const names = variable.repoIds.map((id) => repos.find((repo) => repo.id === id)?.name ?? 'a repo that is gone')
  return { first: names[0]!, more: names.length - 1, all: false }
}

/** `Orion · 18:12`, `Vega · yesterday`, `never used`. The clock is passed in, never read here. */
export function lastUsedLine(
  variable: EnvVariable,
  name: (employeeId: string) => string,
  now: Date,
): { who: string | null; when: string } {
  if (!variable.lastUsed) return { who: null, when: 'never used' }
  const at = new Date(variable.lastUsed.at)
  const days = Math.floor((startOfDay(now) - startOfDay(at)) / 86_400_000)
  const when =
    days <= 0
      ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      : days === 1
        ? 'yesterday'
        : `${days}d ago`
  return { who: name(variable.lastUsed.employeeId), when }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** What the boss is filling in on the Add or Edit form. */
export interface VariableDraft {
  name: string
  /** Empty on Edit means "keep the value that is already in the secret store". */
  value: string
  repoIds: string[]
  /**
   * Which repos may use it, as the modal asks it (T218). The engine has always read an empty
   * scope as *every repo*, and the modal left the boss to work that out from a list with nothing
   * ticked — which reads as *none of them*. Now the question is asked, and the answer starts at
   * every repo; `repoIds` is empty whenever this is `all`.
   */
  scope: RepoScope
}

/** The two answers to *which repos may use it*. A new variable starts on every repo (T218). */
export type RepoScope = 'all' | 'only'

export function emptyDraft(): VariableDraft {
  return { name: '', value: '', repoIds: [], scope: 'all' }
}

export function draftOf(variable: EnvVariable): VariableDraft {
  return {
    name: variable.name,
    value: '',
    repoIds: [...variable.repoIds],
    scope: variable.repoIds.length === 0 ? 'all' : 'only',
  }
}

/** What the draft asks the engine for: `all` is an empty scope, whatever was ticked before it. */
export function draftRepoIds(draft: VariableDraft): string[] {
  return draft.scope === 'all' ? [] : draft.repoIds
}

/** Why the form cannot be submitted yet, or null. `editing` lets an empty value mean "unchanged". */
export function draftProblem(draft: VariableDraft, editing: boolean): string | null {
  const name = nameProblem(draft.name.trim())
  if (name) return name
  // `Only these` with nothing ticked would be saved as every repo, which is the opposite of it.
  if (draft.scope === 'only' && draft.repoIds.length === 0) return 'Tick at least one repo, or choose All repos.'
  if (editing && draft.value === '') return null
  return secretProblem(draft.value)
}

/** What the side panel says beside a repo that does not run this environment. */
export function repoDefaultNote(repo: EnvironmentSettings['repos'][number], environment: EnvironmentId): string | null {
  if (repo.defaultEnvironment === environment) return null
  return repo.defaultEnvironment ? `uses ${repo.defaultEnvironment}` : 'no default yet'
}
