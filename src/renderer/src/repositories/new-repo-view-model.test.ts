import { describe, expect, it } from 'vitest'
import { newRepoPath, planLine, remoteLine, repoNameProblem } from './new-repo-view-model'

describe('A new repo’s name and folder', () => {
  it('joins the location and the name into one folder', () => {
    expect(newRepoPath('/Users/ada/code/', ' payments-web ')).toBe('/Users/ada/code/payments-web')
    expect(newRepoPath('', 'payments-web')).toBeNull()
    expect(newRepoPath('/Users/ada/code', '')).toBeNull()
  })

  it('refuses a name that is not one folder', () => {
    expect(repoNameProblem('apps/web')).toMatch(/one folder/)
    expect(repoNameProblem('..')).toMatch(/cannot be a folder name/)
    expect(repoNameProblem('  ')).toBe('Name the repository')
    expect(repoNameProblem('payments-web')).toBeNull()
    expect(newRepoPath('/code', 'a/b')).toBeNull()
  })
})

describe('What the panel says starting there does', () => {
  it('says which of the four it is doing, and only a refusal cannot start', () => {
    expect(planLine({ kind: 'new-folder', path: '/c/app' })).toMatchObject({
      tone: 'local',
      startable: true,
      sub: expect.stringContaining('A new, empty folder'),
    })
    expect(planLine({ kind: 'empty', path: '/c/app' })).toMatchObject({
      tone: 'local',
      sub: expect.stringContaining('An empty folder'),
    })
    expect(planLine({ kind: 'in-place', path: '/c/notes', files: 12 })).toMatchObject({
      tone: 'in-place',
      badge: 'In place',
      sub: 'Starts the repo in place · 12 files kept as they are and committed',
    })
    expect(planLine({ kind: 'in-place', path: '/c/notes', files: 1 }).sub).toContain('1 file kept')
    expect(planLine({ kind: 'refused', path: '/c/web/x', reason: 'inside the repository at /c/web' })).toMatchObject({
      tone: 'refused',
      startable: false,
      sub: 'inside the repository at /c/web',
    })
  })

  it('offers the remote under the signed-in account, and says how to fix a CLI that is not ready', () => {
    const ready = remoteLine({ forge: 'f', name: 'Forge', ready: true, account: 'ada', fix: null })
    expect(ready.title).toBe('Also create it on Forge')
    expect(ready.sub).toMatch(/^A private repository under ada, set as origin/)

    const signedOut = remoteLine({ forge: 'f', name: 'Forge', ready: false, account: null, fix: 'forge auth login' })
    expect(signedOut.sub).toContain('Run forge auth login')
  })
})
