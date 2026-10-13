import { describe, expect, it } from 'vitest'
import type { EnvironmentSettings, EnvVariable } from '../../../shared/environments'
import {
  draftOf,
  draftProblem,
  draftRepoIds,
  emptyDraft,
  lastUsedLine,
  repoChips,
  repoDefaultNote,
  switchChips,
  type VariableDraft,
} from './environments-model'

/** What the Environments table works out before it draws a row (T176, frame `zpvHQ`). */

const NOW = new Date('2026-09-23T20:00:00')

function variable(over: Partial<EnvVariable> = {}): EnvVariable {
  return { id: 'v-1', environment: 'prod', name: 'DATABASE_URL', repoIds: [], lastUsed: null, ...over }
}

const repos: EnvironmentSettings['repos'] = [
  { id: 'r-api', name: 'billing-api', defaultEnvironment: 'prod' },
  { id: 'r-web', name: 'web-app', defaultEnvironment: 'staging' },
]

describe('The switch', () => {
  it('has the three environments in the frame’s order, with what each holds', () => {
    const chips = switchChips({
      environments: [{ id: 'prod', askEveryUse: true, availableToChecks: true, variableCount: 7 }],
      variables: [],
      repos: [],
      storedAt: '',
      revealFooter: '',
      storageProblem: null,
    })

    expect(chips).toEqual([
      { id: 'dev', count: 0, asks: false },
      { id: 'staging', count: 0, asks: false },
      { id: 'prod', count: 7, asks: true },
    ])
  })
})

describe('The repos column', () => {
  it('names the first repo and counts the rest', () => {
    expect(repoChips(variable({ repoIds: ['r-api', 'r-web'] }), repos)).toEqual({
      first: 'billing-api',
      more: 1,
      all: false,
    })
  })

  it('says every repo when the variable is scoped to none', () => {
    expect(repoChips(variable(), repos)).toEqual({ first: 'every repo', more: 0, all: true })
  })

  it('says so rather than showing an id when a repo was removed from the Company', () => {
    expect(repoChips(variable({ repoIds: ['r-gone'] }), repos).first).toBe('a repo that is gone')
  })
})

describe('The last used column', () => {
  it('reads as a clock time today, yesterday yesterday, and days after that', () => {
    const used = (at: string) => lastUsedLine(variable({ lastUsed: { employeeId: 'e-orion', at } }), () => 'Orion', NOW)

    expect(used('2026-09-23T18:12:00')).toEqual({ who: 'Orion', when: '18:12' })
    expect(used('2026-09-22T23:30:00')).toEqual({ who: 'Orion', when: 'yesterday' })
    expect(used('2026-09-18T09:00:00')).toEqual({ who: 'Orion', when: '5d ago' })
  })

  it('says never used, and names nobody, for a variable nothing has run with', () => {
    expect(lastUsedLine(variable(), () => 'Orion', NOW)).toEqual({ who: null, when: 'never used' })
  })
})

describe('The Add and Edit form', () => {
  it('needs a name and a value, of any length', () => {
    expect(draftProblem({ name: '', value: 'a-long-enough-value', repoIds: [], scope: 'all' }, false)).toMatch(
      /needs a name/,
    )
    expect(draftProblem({ name: 'PORT', value: '3000', repoIds: [], scope: 'all' }, false)).toBeNull()
    expect(
      draftProblem({ name: 'DATABASE_URL', value: 'a-long-enough-value', repoIds: [], scope: 'all' }, false),
    ).toBeNull()
  })

  it('starts on every repo, and asks for a tick once the boss narrows it (T218)', () => {
    expect(emptyDraft().scope).toBe('all')
    expect(emptyDraft().repoIds).toEqual([])
    expect(draftOf(variable({ repoIds: ['r-api'] })).scope).toBe('only')
    expect(draftOf(variable({ repoIds: [] })).scope).toBe('all')
  })

  it('sends an empty scope for All repos, whatever was ticked before it (T218)', () => {
    expect(draftRepoIds({ name: 'A', value: 'a-long-enough-value', repoIds: ['r-api'], scope: 'all' })).toEqual([])
    expect(draftRepoIds({ name: 'A', value: 'a-long-enough-value', repoIds: ['r-api'], scope: 'only' })).toEqual([
      'r-api',
    ])
  })

  it('refuses Only these with nothing ticked, which would have saved as every repo (T218)', () => {
    const draft: VariableDraft = { name: 'DATABASE_URL', value: 'a-long-enough-value', repoIds: [], scope: 'only' }
    expect(draftProblem(draft, false)).toMatch(/Tick at least one repo/)
    expect(draftProblem({ ...draft, repoIds: ['r-api'] }, false)).toBeNull()
  })

  it('takes an empty value on Edit, which means the one already in the keychain', () => {
    expect(draftProblem({ name: 'DATABASE_URL', value: '', repoIds: [], scope: 'all' }, true)).toBeNull()
    expect(draftProblem({ name: 'DATABASE_URL', value: '', repoIds: [], scope: 'all' }, false)).toMatch(/needs a value/)
  })
})

describe('The side panel’s repo list', () => {
  it('says what a repo runs instead, and nothing for the one that runs this', () => {
    expect(repoDefaultNote(repos[0]!, 'prod')).toBeNull()
    expect(repoDefaultNote(repos[1]!, 'prod')).toBe('uses staging')
    expect(repoDefaultNote({ id: 'r-x', name: 'x', defaultEnvironment: null }, 'prod')).toBe('no default yet')
  })
})
