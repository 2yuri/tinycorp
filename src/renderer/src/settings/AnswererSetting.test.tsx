import { describe, expect, it } from 'vitest'
import type { AnswererSetting } from '../../../shared/inbox/answerer'
import { answererHelp, automaticLabel, personLabel } from './AnswererSetting'

const names: Record<string, string> = { pam: 'Pam', ada: 'Ada' }
const titles: Record<string, string> = { pam: 'PM', ada: 'Backend' }
const nameOf = (id: string) => names[id] ?? 'a former Employee'
const labelOf = (id: string) => {
  const name = names[id]
  return name ? personLabel({ name, title: titles[id] ?? '' }) : 'a former Employee'
}

const automatic: AnswererSetting = {
  overrideId: null,
  automaticId: 'pam',
  answererId: 'pam',
  waitingForId: null,
  stale: null,
  skipped: [],
}

describe('The "Who answers you" row', () => {
  it('names who Automatic picks, as the design writes it', () => {
    expect(personLabel({ name: 'Pam', title: 'PM' })).toBe('Pam (PM)')
    expect(automaticLabel(automatic, labelOf)).toBe('Automatic · Pam (PM)')
    expect(answererHelp(automatic, nameOf)).toMatch(/replies when nobody is @mentioned/i)
  })

  it('names the one a waiting message is for when nobody is available', () => {
    const waiting = { ...automatic, automaticId: null, answererId: null, waitingForId: 'pam' }

    expect(automaticLabel(waiting, labelOf)).toBe('Automatic · Pam (PM)')
    expect(answererHelp(waiting, nameOf)).toMatch(/nobody is available: messages wait for Pam/i)
  })

  it('says the Company has nobody yet', () => {
    const empty = { ...automatic, automaticId: null, answererId: null }

    expect(automaticLabel(empty, labelOf)).toBe('Automatic')
    expect(answererHelp(empty, nameOf)).toMatch(/nobody is hired yet/i)
  })

  it('says a fired choice fell back to Automatic', () => {
    const fired = { ...automatic, overrideId: 'gone', stale: 'fired' as const }

    expect(answererHelp(fired, nameOf)).toMatch(/a former employee has left the company, so automatic answers/i)
  })

  it('says why an unavailable choice is not answering', () => {
    const parked: AnswererSetting = {
      ...automatic,
      overrideId: 'ada',
      stale: 'unavailable',
      skipped: [{ employeeId: 'ada', reason: 'parked' }],
    }

    expect(answererHelp(parked, nameOf)).toMatch(/Ada is parked, waiting for a slot, so the next in line answers/i)
  })
})
