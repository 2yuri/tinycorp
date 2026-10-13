import { describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { NETWORK_FOLDER_REFUSAL } from '../../../shared/platform/company-folder'
import { type CompanyDraft, type CreateApi, createCompany, draftFolder, draftProblem } from './create-company'

const acme: Company = {
  id: 'a',
  name: 'Acme',
  key: 'AC',
  boss: { name: 'Ada', initials: 'AD' },
  folder: '/work/acme',
  createdAt: '2026-09-17T00:00:00.000Z',
}
const stack = { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' }

function fakeApi(fail: Partial<Record<string, string>> = {}) {
  const calls: unknown[][] = []
  const reply =
    (name: string, value: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return fail[name] ? { ok: false as const, error: fail[name]! } : { ok: true as const, value }
    }
  const api = {
    company: { create: reply('company.create', acme) },
    repos: { add: reply('repos.add', {}) },
    approvals: { setLevel: reply('approvals.setLevel', 'managed') },
    capacity: { setConcurrencyCap: reply('capacity.setConcurrencyCap', {}) },
    notifications: { setEnabled: reply('notifications.setEnabled', true) },
  } as unknown as CreateApi
  return { api, calls }
}

const draft: CompanyDraft = {
  name: ' Acme ',
  folder: '/work/acme',
  repo: { path: '/work/acme/web', gitRepo: true, stack, commands: ['pnpm install'] },
  repoBrief: 'Storefront; you pick the stack.',
  autonomy: 'supervised',
  concurrencyCap: 3,
  notifications: false,
}

describe('creating a Company from the Launcher', () => {
  it('creates the Company and applies the first repository, autonomy, cap and notifications', async () => {
    const { api, calls } = fakeApi()

    expect(await createCompany(api, draft)).toEqual({ ok: true, value: acme })
    expect(calls).toEqual([
      ['company.create', { folder: '/work/acme', name: 'Acme' }],
      ['repos.add', { path: '/work/acme/web', brief: 'Storefront; you pick the stack.', stack }],
      ['approvals.setLevel', 'supervised'],
      ['capacity.setConcurrencyCap', 3],
      ['notifications.setEnabled', false],
    ])
  })

  it('skips the repository when none was chosen', async () => {
    const { api, calls } = fakeApi()
    await createCompany(api, { ...draft, repo: null })
    expect(calls.map(([name]) => name)).not.toContain('repos.add')
  })

  it('attaches a repository with nothing detected and no brief, without checks', async () => {
    const { api, calls } = fakeApi()
    await createCompany(api, {
      ...draft,
      repoBrief: ' ',
      repo: { path: '/x', gitRepo: true, stack: null, commands: [] },
    })
    expect(calls).toContainEqual(['repos.add', { path: '/x', stack: {} }])
  })

  it('refuses a draft without a name or folder, or with a folder that is not a git repo', async () => {
    const { api, calls } = fakeApi()

    expect(await createCompany(api, { ...draft, name: ' ' })).toEqual({
      ok: false,
      error: 'Give the Company a name',
    })
    expect(await createCompany(api, { ...draft, folder: null })).toMatchObject({ ok: false })
    expect(
      await createCompany(api, { ...draft, repo: { path: '/tmp/x', gitRepo: false, stack, commands: [] } }),
    ).toEqual({ ok: false, error: '/tmp/x is not a git repo' })
    expect(calls).toEqual([])
  })

  it('stops at the first failing step and says the Company exists', async () => {
    const { api, calls } = fakeApi({ 'repos.add': 'A repo named web already exists' })

    expect(await createCompany(api, draft)).toEqual({
      ok: false,
      error: 'Acme was created, but: A repo named web already exists',
    })
    expect(calls).toHaveLength(2)
  })

  it('reports a failed create as is', async () => {
    const { api } = fakeApi({ 'company.create': 'A Company already exists in /work/acme' })

    expect(await createCompany(api, draft)).toEqual({
      ok: false,
      error: 'A Company already exists in /work/acme',
    })
  })
})

describe('the folder a new Company goes in (T252)', () => {
  const hints = { home: 'C:\\Users\\boss', syncedRoots: [] }
  const unpicked: CompanyDraft = { ...draft, folder: null }

  it('follows the name until the boss picks one, and then stops moving', () => {
    expect(draftFolder({ ...unpicked, name: 'Acme' }, hints)).toBe('C:\\Users\\boss\\TinyCorp\\Acme')
    expect(draftFolder({ ...unpicked, name: 'Acme Works' }, hints)).toBe('C:\\Users\\boss\\TinyCorp\\Acme Works')
    // Picked: the pick wins, whatever the name says afterwards.
    expect(draftFolder({ ...unpicked, folder: 'D:\\work\\acme', name: 'Globex' }, hints)).toBe('D:\\work\\acme')
  })

  it('is what Create is given, so nobody has to open the picker at all', async () => {
    const { api, calls } = fakeApi()

    expect(await createCompany(api, { ...unpicked, repo: null, name: 'Acme' }, hints)).toEqual({
      ok: true,
      value: acme,
    })
    expect(calls[0]).toEqual(['company.create', { folder: 'C:\\Users\\boss\\TinyCorp\\Acme', name: 'Acme' }])
  })

  it('asks for a folder when the main process has not said where home is', async () => {
    const { api, calls } = fakeApi()

    expect(await createCompany(api, unpicked)).toEqual({ ok: false, error: 'Choose a folder for the Company' })
    expect(calls).toEqual([])
  })

  it('refuses a network share before the engine is asked anything', async () => {
    const { api, calls } = fakeApi()
    const share = { ...draft, folder: '\\\\nas\\share\\acme' }

    expect(await createCompany(api, share, hints)).toEqual({ ok: false, error: NETWORK_FOLDER_REFUSAL })
    expect(calls).toEqual([])
  })

  it('creates a Company in a WSL folder, whose database goes to AppData rather than the share (T256)', async () => {
    const { api, calls } = fakeApi()
    const folder = '\\\\wsl.localhost\\archlinux\\home\\boss\\TinyCorp\\Acme'

    expect(await createCompany(api, { ...draft, folder, repo: null, name: 'Acme' }, hints)).toEqual({
      ok: true,
      value: acme,
    })
    expect(calls[0]).toEqual(['company.create', { folder, name: 'Acme' }])
  })

  it('suggests the distro’s own home when the team runs there, so the picker is never needed', () => {
    const inWsl = { home: '\\\\wsl.localhost\\archlinux\\home\\boss', syncedRoots: [] }

    expect(draftFolder({ ...unpicked, name: 'Acme' }, inWsl)).toBe(
      '\\\\wsl.localhost\\archlinux\\home\\boss\\TinyCorp\\Acme',
    )
    expect(draftProblem({ ...unpicked, name: 'Acme' }, inWsl)).toBeNull()
    // The team on Windows keeps the home it always had.
    expect(draftFolder({ ...unpicked, name: 'Acme' }, hints)).toBe('C:\\Users\\boss\\TinyCorp\\Acme')
  })
})
