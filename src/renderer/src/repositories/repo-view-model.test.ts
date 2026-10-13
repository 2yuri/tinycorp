import { describe, expect, it } from 'vitest'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { EMPTY_STACK } from '../../../shared/repos/repo'
import {
  accessChanges,
  accessLine,
  accessOf,
  avatarSlots,
  denyRepo,
  historyLine,
  languageLine,
  packageManagerLabel,
  packageManagerOptions,
  parseManagerValue,
  shutOutEmployees,
  stackCommands,
} from './repo-view-model'

const role = (id: string, name: string, repoFilter: string[], capabilities: RoleTemplate['capabilities'] = ['code']) =>
  ({ id, name, repoFilter, capabilities, persona: '', seeded: true }) as RoleTemplate
const employee = (
  id: string,
  roleId: string,
  repoFilter: string[],
  capabilities: Employee['capabilities'] = ['code'],
) => ({ id, name: id, roleId, repoFilter, capabilities }) as Employee

const roles = [
  role('pm', 'PM', [], ['intake', 'plan']),
  role('frontend', 'Frontend', ['*']),
  role('backend', 'Backend', ['api']),
  role('qa', 'QA', ['web'], ['review']),
]
const repos = [{ name: 'web' }, { name: 'api' }, { name: 'docs' }]

describe('Repo card', () => {
  it('lists the commands that are set, in order', () => {
    const stack = { ...EMPTY_STACK, install: 'pnpm install', test: 'vitest run', lint: 'biome check' }

    expect(stackCommands(stack)).toEqual([
      { key: 'install', command: 'pnpm install' },
      { key: 'test', command: 'vitest run' },
      { key: 'lint', command: 'biome check' },
    ])
    expect(stackCommands(EMPTY_STACK)).toEqual([])
  })

  it('joins language and framework, and the package manager with its version', () => {
    expect(languageLine({ ...EMPTY_STACK, language: 'TypeScript', framework: 'React' })).toBe('TypeScript · React')
    expect(languageLine({ ...EMPTY_STACK, language: 'Go' })).toBe('Go')
    expect(packageManagerLabel({ packageManager: 'pnpm', packageManagerVersion: '9' })).toBe('pnpm 9')
    expect(packageManagerLabel({ packageManager: 'npm', packageManagerVersion: '' })).toBe('npm')
  })

  it('says which working roles and Employees may work in a repo', () => {
    const ada = employee('ada', 'backend', ['api'])
    const juno = employee('juno', 'frontend', ['*'])

    const access = accessOf('web', roles, [ada, juno])

    expect(access.roles.map((r) => r.name)).toEqual(['Frontend', 'QA'])
    expect(access.employees).toEqual([juno])
    expect(accessLine(access.roles)).toBe('Frontend · QA')
    expect(accessLine([roles[2]!])).toBe('Backend only')
    expect(accessLine([])).toBe('Nobody yet')
  })

  /**
   * T239: a Company whose one repo is `tinycorp` matched neither seeded engineer filter, and nothing
   * on any screen said so — the work simply went to whoever `*` let in. Repositories names them.
   */
  it('names the Employees no repo on the screen lets in', () => {
    const fran = employee('fran', 'frontend', ['*web*'])
    const ben = employee('ben', 'backend', ['*'])
    const pam = employee('pam', 'pm', [], ['intake', 'plan'])

    expect(shutOutEmployees([{ name: 'tinycorp' }], [fran, ben, pam])).toEqual([fran])
    expect(shutOutEmployees([{ name: 'acme-web' }], [fran, ben, pam])).toEqual([])
    // With no repos attached yet, nobody is shut out of anything.
    expect(shutOutEmployees([], [fran, ben, pam])).toEqual([])
  })

  it('shows four avatars, or three and the rest as a count', () => {
    expect(avatarSlots([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3, 4], more: 0 })
    expect(avatarSlots([1, 2, 3, 4, 5, 6])).toEqual({ shown: [1, 2, 3], more: 3 })
  })

  it('reads history as commits and the last push', () => {
    const now = Date.parse('2026-09-17T12:00:00Z')

    expect(historyLine(1284, '2026-09-17T10:00:00Z', now)).toBe('1,284 commits · last push 2h ago')
    expect(historyLine(1, null, now)).toBe('1 commit')
    expect(historyLine(null, null, now)).toBe('')
  })
})

describe('Who can work here', () => {
  it('keeps a repo out of a glob by listing the other repos it matched', () => {
    expect(denyRepo(['*'], 'web', ['api', 'docs'])).toEqual(['api', 'docs'])
    expect(denyRepo(['web', 'api'], 'WEB', ['api'])).toEqual(['api'])
    const untouched = ['api']
    expect(denyRepo(untouched, 'web', [])).toBe(untouched)
  })

  it('edits only the roles whose access changes', () => {
    expect(accessChanges('web', new Set(['backend', 'qa']), repos, roles)).toEqual([
      { id: 'frontend', repoFilter: ['api', 'docs'] },
      { id: 'backend', repoFilter: ['api', 'web'] },
    ])
  })

  it('changes nothing when the chips match the filters, and never touches non-working roles', () => {
    expect(accessChanges('web', new Set(['frontend', 'qa']), repos, roles)).toEqual([])
    expect(accessChanges('new-repo', new Set(), repos, roles)).toEqual([
      { id: 'frontend', repoFilter: ['web', 'api', 'docs'] },
    ])
  })
})

describe('Package manager select', () => {
  it('offers the current choice first when it is unusual, and asks for one when none is set', () => {
    const custom = packageManagerOptions({ packageManager: 'pnpm', packageManagerVersion: '8' })
    expect(custom[0]).toEqual({ value: 'pnpm|8', label: 'pnpm 8' })
    expect(custom.filter((o) => o.value === 'pnpm|9')).toHaveLength(1)

    const common = packageManagerOptions({ packageManager: 'pnpm', packageManagerVersion: '9' })
    expect(common[0]).toEqual({ value: 'pnpm|10', label: 'pnpm 10' })

    expect(packageManagerOptions({ packageManager: '', packageManagerVersion: '' })[0]).toEqual({
      value: '|',
      label: 'Choose a package manager',
    })
    expect(parseManagerValue('go modules|')).toEqual({ packageManager: 'go modules', packageManagerVersion: '' })
  })
})
