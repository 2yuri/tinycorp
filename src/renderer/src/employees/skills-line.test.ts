import { describe, expect, it } from 'vitest'
import { skillsLine } from './edit-model'

/**
 * The SKILLS row's caption (T137, frame `qC1Gz`), and the caveat on the end of it.
 *
 * Since T253 every Provider in the catalogue reads skill folders, so no Employee the modal can
 * draw carries the caveat — which is exactly why it is tested here, where the answer is an
 * argument. The day a Provider is added that reads none, the Employee is told plainly rather than
 * handed a grant that reaches nothing.
 */
describe('what the SKILLS row says', () => {
  const line = (providerReadsSkills: boolean) =>
    skillsLine({
      who: 'Ada',
      fromRole: ['review-checklist'],
      on: ['review-checklist'],
      providerLabel: 'Quiet',
      providerReadsSkills,
    })

  it('says who can open the folders, and where the grant came from', () => {
    expect(line(true)).toBe('Folders of instructions Ada can open. Its role gives it review-checklist.')
  })

  it('adds the caveat on a Provider whose product reads none, naming it', () => {
    expect(line(false)).toContain('Quiet has no skills, and would not look at them.')
  })
})
