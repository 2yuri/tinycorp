import { describe, expect, it } from 'vitest'
import { APPROVAL_KIND_LABEL, APPROVAL_SUMMARY_RULE, APPROVE_LABEL, approvalSentence } from './approval-summary'
import { GATED_ACTIONS } from './index'

describe('approvalSentence', () => {
  it('keeps the requester’s own sentence', () => {
    expect(approvalSentence('merge', '#5 Invoice pagination', 'PR #128 on billing-api is reviewed and green.')).toBe(
      'PR #128 on billing-api is reviewed and green.',
    )
  })

  it('strips @boss and folds the sentence onto one line', () => {
    expect(approvalSentence('hire', 'a QA engineer', '@boss Billing is short a reviewer,\n  so I need a QA.')).toBe(
      'Billing is short a reviewer, so I need a QA.',
    )
    expect(approvalSentence('hire', 'a QA engineer', 'Ping @boss: I need a QA.')).toBe('Ping I need a QA.')
  })

  it('writes one for every kind when the requester sent none', () => {
    for (const action of GATED_ACTIONS) {
      const sentence = approvalSentence(action, '#5 Invoice pagination')
      expect(sentence).not.toContain('@')
      expect(sentence).not.toContain('Approval needed')
      expect(sentence.endsWith('.')).toBe(true)
    }
    expect(approvalSentence('merge', '#5 Invoice pagination')).toBe('#5 Invoice pagination is ready to merge.')
    expect(approvalSentence('hire', 'a QA engineer', '   ')).toBe("I'd like to bring on a QA engineer.")
  })

  it('has a card title and an Approve label for every kind', () => {
    for (const action of GATED_ACTIONS) {
      expect(APPROVAL_KIND_LABEL[action]).toBeTruthy()
      expect(APPROVE_LABEL[action]).toBeTruthy()
    }
  })

  it('tells the Employee the facts go on the card', () => {
    expect(APPROVAL_SUMMARY_RULE).toContain('one human sentence')
  })
})
