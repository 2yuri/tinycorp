import { describe, expect, it } from 'vitest'
import type { RestoreLoss, RestorePoint } from '../../../shared/restore-points'
import { goBackBody, goBackTitle, pointLine, retentionNote } from './restore-points-model'

const point = (over: Partial<RestorePoint> = {}): RestorePoint => ({
  id: 'p1',
  ticketId: 12,
  repoId: 'r1',
  employeeId: 'e1',
  reason: 'commit',
  note: 'Add the form',
  commit: '1a2b3c4d5e6f7890',
  branch: 'ticket-12-login',
  hadUncommitted: false,
  takenAt: '2026-09-21T09:30:00.000Z',
  ...over,
})

const loss = (over: Partial<RestoreLoss> = {}): RestoreLoss => ({
  commits: [],
  uncommitted: false,
  stops: null,
  ...over,
})

describe('restore point rows', () => {
  it('says when it was taken, what kind it is and what the Employee said', () => {
    const now = new Date('2026-09-21T18:00:00.000Z')

    expect(pointLine(point(), now)).toEqual({
      when: expect.stringMatching(/^\d\d:\d\d$/),
      kind: 'Committed',
      note: 'Add the form',
    })
  })

  it('leaves the note off a point nobody wrote a commit message for', () => {
    const now = new Date('2026-09-21T18:00:00.000Z')

    expect(pointLine(point({ reason: 'start', note: 'Login page' }), now)).toMatchObject({
      kind: 'Before the work started',
      note: '',
    })
  })

  it('dates a point taken on another day', () => {
    expect(pointLine(point(), new Date('2026-09-25T18:00:00.000Z')).when).toMatch(/^Sep \d+, \d\d:\d\d$/)
  })

  it('says the list does not grow forever', () => {
    expect(retentionNote(7)).toBe('Kept for 7 days, and dropped when the ticket is done.')
    expect(retentionNote(1)).toBe('Kept for 1 day, and dropped when the ticket is done.')
  })
})

describe('going back, asked for', () => {
  it('asks by what the Employee said it was doing', () => {
    expect(goBackTitle(point())).toBe('Go back to “Add the form”?')
  })

  it('falls back to the kind of point when nothing was said', () => {
    expect(goBackTitle(point({ reason: 'start', note: '' }))).toBe('Go back to before the work started?')
  })

  it('names who stops, where the worktree lands and everything that is lost', () => {
    const body = goBackBody(
      point(),
      loss({
        commits: ['Wire the submit', 'Ruin it'],
        uncommitted: true,
        stops: { employeeId: 'e1', name: 'Ada' },
      }),
      'web',
    )

    expect(body).toBe(
      'This stops Ada’s Session and puts the web worktree back at 1a2b3c4. ' +
        'It loses 2 commits (“Wire the submit”, “Ruin it”) and the uncommitted work there. ' +
        'A restore point of what is there now is kept, so you can come back.',
    )
  })

  it('leaves the Session out of it when nobody holds the ticket', () => {
    const body = goBackBody(point(), loss({ commits: ['Ruin it'] }), 'web')

    expect(body).toBe(
      'This puts the web worktree back at 1a2b3c4. It loses 1 commit (“Ruin it”). ' +
        'A restore point of what is there now is kept, so you can come back.',
    )
  })

  it('says plainly when there is nothing to lose', () => {
    expect(goBackBody(point(), loss(), 'web')).toContain('Nothing is lost: the worktree is already there.')
  })
})
