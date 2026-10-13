import { describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import {
  addableRepos,
  canHire,
  draftForRole,
  type HireDraft,
  hireInput,
  nextDesk,
  openOn,
  rerollLook,
  seatLine,
  selectedRepos,
  stepLook,
  walkInNote,
  withoutRepo,
  withRepo,
} from './hire-model'

const frontend: RoleTemplate = {
  id: 'frontend',
  name: 'Frontend',
  persona: 'You build the screens users touch.',
  capabilities: ['code'],
  repoFilter: ['*web*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
}

const backend: RoleTemplate = { ...frontend, id: 'backend', name: 'Backend', repoFilter: ['*api*'] }

const REPOS = ['payments-web', 'web-app', 'billing-api']

describe('the role the modal opens on', () => {
  it('is the one `/hire <role>` named', () => {
    expect(openOn([frontend, backend], 'backend')).toBe(backend)
  })

  it('falls back to the catalog\u2019s first when nobody named one, or named one that is gone', () => {
    expect(openOn([frontend, backend], undefined)).toBe(frontend)
    expect(openOn([frontend, backend], 'designer')).toBe(frontend)
    expect(openOn([], 'backend')).toBeUndefined()
  })
})

const employee = (over: Partial<Employee>): Employee => ({
  id: 'e1',
  name: 'Vega',
  roleId: 'frontend',
  title: 'Frontend',
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 0,
  sprite: 0,
  createdAt: '',
  ...over,
})

const draft = (over: Partial<HireDraft> = {}): HireDraft => ({
  roleId: 'frontend',
  name: 'Lyra',
  permissionMode: null,
  provider: 'claude',
  model: 'opus-5-balanced',
  persona: 'Pairs with Vega on the component layer.',
  repoFilter: ['*web*'],
  areas: [],
  mcpServers: [],
  skills: [],
  sprite: 1,
  ...over,
})

describe('the hire draft', () => {
  it('takes persona and repo access from the role, keeping name, model and look', () => {
    const next = draftForRole(frontend, { name: 'Lyra', model: 'opus-5-balanced', sprite: 3 }, 'claude')

    expect(next).toEqual({
      roleId: 'frontend',
      mcpServers: [],
      skills: [],
      name: 'Lyra',
      provider: 'claude',
      permissionMode: null,
      model: 'opus-5-balanced',
      sprite: 3,
      persona: 'You build the screens users touch.',
      repoFilter: ['*web*'],
      areas: [],
    })
  })

  it('keeps the Provider the model picker chose when the role changes', () => {
    const onCodex = draft({ provider: 'codex', model: 'gpt-6-astra-deep' })

    expect(draftForRole(frontend, onCodex, 'claude')).toMatchObject({ provider: 'codex', model: 'gpt-6-astra-deep' })
  })

  it('sends the chosen character with the hire', () => {
    expect(hireInput(draft({ sprite: 4, name: '  Lyra  ' }))).toEqual({
      name: 'Lyra',
      mcpServers: [],
      skills: [],
      roleId: 'frontend',
      persona: 'Pairs with Vega on the component layer.',
      repoFilter: ['*web*'],
      areas: [],
      provider: 'claude',
      model: 'opus-5-balanced',
      sprite: 4,
    })
  })

  /** The model carries its Provider, so a hire is never made onto a product without its model. */
  it('hires onto the Provider that owns the chosen model', () => {
    expect(hireInput(draft({ provider: 'codex', model: 'gpt-5-6-sol-fast' }))).toMatchObject({
      provider: 'codex',
      model: 'gpt-5-6-sol-fast',
    })
  })

  it('needs a role and a name nobody on staff already has', () => {
    const staff = [employee({ name: 'Vega' })]

    expect(canHire(draft(), staff)).toBe(true)
    expect(canHire(draft({ name: '  ' }), staff)).toBe(false)
    expect(canHire(draft({ roleId: '' }), staff)).toBe(false)
    expect(canHire(draft({ name: 'vega' }), staff)).toBe(false)
  })
})

describe('what the modal says', () => {
  it('writes the seat out of the maximum headcount', () => {
    expect(seatLine('Tiny Corp', { current: 6, max: 12 })).toBe('Tiny Corp · seat 7 of 12')
    expect(seatLine('Tiny Corp', { current: 6, max: null })).toBe('Tiny Corp · seat 7')
    expect(seatLine('Tiny Corp', null)).toBe('Tiny Corp')
  })

  it('numbers the desk the hire takes, counting the desks fired Employees keep', () => {
    expect(nextDesk([], [])).toBe(1)
    expect(nextDesk([employee({ desk: 0 }), employee({ desk: 2 })], [employee({ desk: 1 })])).toBe(4)
  })

  it('says what hiring does', () => {
    expect(walkInNote('Lyra', 7)).toBe('Lyra walks in, takes desk 7 and says hello in #general.')
    expect(walkInNote('  ', 1)).toBe('They walks in, takes desk 1 and says hello in #general.')
  })
})

describe('repository access', () => {
  it('shows one chip per repo the role’s filter lets in', () => {
    expect(selectedRepos(['*web*'], REPOS)).toEqual(['payments-web', 'web-app'])
    expect(selectedRepos(['*'], REPOS)).toEqual(REPOS)
    expect(selectedRepos([], REPOS)).toEqual([])
    expect(addableRepos(['*web*'], REPOS)).toEqual(['billing-api'])
  })

  it('pins the filter to the repos on show when a chip is removed or added', () => {
    expect(withoutRepo(['*web*'], REPOS, 'web-app')).toEqual(['payments-web'])
    expect(withRepo(['*web*'], REPOS, 'billing-api')).toEqual(['payments-web', 'web-app', 'billing-api'])
    expect(withRepo([], REPOS, 'web-app')).toEqual(['web-app'])
  })
})

describe('the look', () => {
  it('wraps around the six sheets', () => {
    expect(stepLook(0, -1, 6)).toBe(5)
    expect(stepLook(5, 1, 6)).toBe(0)
    expect(stepLook(2, 1, 6)).toBe(3)
    expect(stepLook(2, 1, 0)).toBe(2)
  })

  it('rerolls to a character that is not the one showing', () => {
    for (const random of [0, 0.35, 0.99]) expect(rerollLook(2, 6, random)).not.toBe(2)
    expect(rerollLook(2, 1, 0.5)).toBe(2)
  })
})
