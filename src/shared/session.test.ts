/**
 * The line the boss reads after `Resume all`, wherever they pressed it (T217). One sentence, shared
 * by the office header, the application menu, the menu-bar item and `/resume`, so the four cannot
 * say four different things about the same attempt.
 */
import { describe, expect, it } from 'vitest'
import { type ResumeAll, resumeAllNote, resumeAllProblem } from './session'

const outcome = (over: Partial<ResumeAll> = {}): ResumeAll => ({
  paused: false,
  resumed: [],
  failed: [],
  from: 'held',
  ...over,
})

describe('what Resume all says it came to', () => {
  it('counts the Sessions coming back, and has nothing else to say', () => {
    const one = outcome({ resumed: ['ada'] })
    const two = outcome({ resumed: ['ada', 'grace'] })

    expect(resumeAllNote(one)).toBe('Resuming 1 Session.')
    expect(resumeAllNote(two)).toBe('Resuming 2 Sessions.')
    expect(resumeAllProblem(one)).toBeNull()
    expect(resumeAllProblem(two)).toBeNull()
  })

  /*
   * The ticket's own case: a pause that held nobody used to lift the pause, start nothing and say
   * nothing, which reads as a button that does not work.
   */
  it('says a pause that held nobody brought nobody back, and that the pause is lifted', () => {
    const nobody = outcome({ from: 'nobody' })

    expect(resumeAllNote(nobody)).toMatch(/^Nothing to resume/)
    expect(resumeAllNote(nobody)).toMatch(/pause is lifted/)
    // Not silence: this is the one the boss has to read.
    expect(resumeAllProblem(nobody)).toBe(resumeAllNote(nobody))
  })

  it('names each Employee that could not start, beside the ones that did', () => {
    const some = outcome({
      resumed: ['grace'],
      failed: [{ employeeId: 'ada', name: 'Ada', reason: 'claude is not on this machine' }],
    })

    expect(resumeAllNote(some)).toBe('Resuming 1 Session. Ada could not start: claude is not on this machine.')
    expect(resumeAllProblem(some)).toBe(resumeAllNote(some))
  })

  it('says nothing came back when every Employee failed', () => {
    const none = outcome({
      failed: [
        { employeeId: 'ada', name: 'Ada', reason: 'claude is not on this machine' },
        { employeeId: 'grace', name: 'Grace', reason: 'Acme is at its cap' },
      ],
    })

    expect(resumeAllNote(none)).toBe(
      'Nothing came back. Ada could not start: claude is not on this machine; Grace could not start: Acme is at its cap.',
    )
  })
})
