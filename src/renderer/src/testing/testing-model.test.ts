import { describe, expect, it } from 'vitest'
import type { TestRun, TestStep } from '../../../shared/testing'
import {
  actionBarLine,
  canPassNow,
  modeLine,
  passRefusal,
  runMeta,
  scriptSource,
  stepTag,
  stepVerdictLine,
  testingBadge,
  testingSubtitle,
} from './testing-model'

const nameOf = (id: string) => (id === 'e-iris' ? 'Iris' : id === 'boss' ? 'you' : id)
const clock = (iso: string) => iso.slice(11, 16)

function step(overrides: Partial<TestStep> = {}): TestStep {
  return {
    id: 1,
    runId: 1,
    title: 'Picker offers 7d, 30d, 90d',
    detail: '',
    criterion: 1,
    addedBy: null,
    result: 'pending',
    note: '',
    testedBy: null,
    testedAt: null,
    attachments: [],
    ...overrides,
  }
}

function run(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 1,
    ticketId: 142,
    attempt: 1,
    mode: 'both',
    state: 'you',
    agentId: 'e-iris',
    agentVerdict: 'pass',
    agentSummary: 'All four pass.',
    checks: [],
    startedAt: '2026-09-22T10:31:00',
    finishedAt: null,
    steps: [],
    ...overrides,
  }
}

describe('the header', () => {
  it('says who Testing is waiting on', () => {
    expect(testingBadge(run({ state: 'you' }), 'Iris')).toBe('Testing · waiting on you')
    expect(testingBadge(run({ state: 'agent' }), 'Iris')).toBe('Testing · Iris is on it')
    expect(testingBadge(run({ state: 'passed' }), 'Iris')).toBe('Testing · passed')
    expect(testingBadge(run({ state: 'failed' }), 'Iris')).toBe('Testing · back to Doing')
    expect(testingBadge(null, null)).toBe('Testing')
  })

  it('names the PR, the branch, who approved the review and what the merge waits for', () => {
    expect(
      testingSubtitle({
        prs: [{ repoName: 'web-app', number: 91 }],
        worktree: { branch: 'feat/usage-range-picker', base: 'main', path: '/wt' },
        approvedBy: 'Iris',
        run: run(),
      }),
    ).toBe('web-app #91 · feat/usage-range-picker → main · approved by Iris · merge waits for testing')
  })

  it('drops the merge line once Testing has passed', () => {
    expect(testingSubtitle({ prs: [], worktree: null, approvedBy: null, run: run({ state: 'passed' }) })).toBe('')
  })
})

describe('a step', () => {
  it('tags its criterion, and says who added one the plan never wrote', () => {
    expect(stepTag(step({ criterion: 2 }), nameOf)).toBe('Criterion 2')
    expect(stepTag(step({ criterion: 4, addedBy: 'e-iris' }), nameOf)).toBe('Criterion 4 · step added by Iris')
    expect(stepTag(step({ criterion: null, addedBy: 'boss' }), nameOf)).toBe('Step added by you')
  })

  it('says who passed or failed it, and when', () => {
    expect(
      stepVerdictLine(step({ result: 'pass', testedBy: 'boss', testedAt: '2026-09-22T10:36:00' }), nameOf, clock),
    ).toBe('Passed by you · 10:36')
    expect(
      stepVerdictLine(step({ result: 'fail', testedBy: 'e-iris', testedAt: '2026-09-22T10:41:00' }), nameOf, clock),
    ).toBe('Failed by Iris · 10:41')
    expect(stepVerdictLine(step(), nameOf, clock)).toBeNull()
  })
})

describe('the script header', () => {
  it('says the steps came from the plan, and names whoever added one', () => {
    expect(scriptSource(run({ steps: [step()] }), 'Iris')).toBe('from the plan’s criteria')
    expect(scriptSource(run({ steps: [step(), step({ id: 2, addedBy: 'e-iris' })] }), 'Iris')).toBe(
      'from the plan’s criteria + Iris',
    )
  })
})

describe('passing testing', () => {
  const passed = step({ result: 'pass' })
  const failed = step({ id: 2, result: 'fail' })
  const pending = step({ id: 3 })

  it('is off while a step failed or is untested, and says which', () => {
    expect(canPassNow(run({ steps: [passed, failed] }))).toBe(false)
    expect(passRefusal(run({ steps: [passed, failed] }))).toBe('1 failed')
    expect(passRefusal(run({ steps: [passed, pending] }))).toBe('1 still to test')
    expect(passRefusal(run({ steps: [failed, pending] }))).toBe('1 failed and 1 still to test')
  })

  it('is on once every step passed, and off while the agent still holds it', () => {
    expect(canPassNow(run({ steps: [passed] }))).toBe(true)
    expect(passRefusal(run({ steps: [passed] }))).toBeNull()
    expect(canPassNow(run({ state: 'agent', steps: [passed] }))).toBe(false)
    expect(passRefusal(run({ state: 'agent', steps: [passed] }))).toBe('The QA agent is still testing it')
  })

  it('counts what is left in the action bar', () => {
    expect(actionBarLine(run({ steps: [passed, failed, pending] }))).toBe('1 failed · 1 to test')
    expect(actionBarLine(run({ steps: [passed] }))).toBe('1 of 1 passed')
  })
})

describe('the panel’s mode strip', () => {
  it('names the agent this attempt really has', () => {
    expect(modeLine(run({ mode: 'both' }), 'Iris')).toBe('Both — Iris tests first, then you confirm')
    expect(modeLine(run({ mode: 'agent' }), 'Iris')).toBe('QA agent — Iris’s pass is the go-ahead')
    expect(modeLine(run({ mode: 'you' }), null)).toBe('You — nothing merges until you pass it')
  })
})

describe('the Run it row', () => {
  it('says where the app answers, when it started and who started it', () => {
    expect(
      runMeta(
        {
          ticketId: 142,
          repoId: 'r-web',
          repoName: 'web-app',
          command: 'pnpm dev',
          cwd: '/wt',
          port: 5173,
          url: 'http://localhost:5173',
          state: 'running',
          startedAt: '2026-09-22T10:34:00',
          startedBy: 'boss',
          exitCode: null,
          lastLine: '',
          lines: 0,
        },
        nameOf,
        clock,
      ),
    ).toBe('running on localhost:5173 · started 10:34 by you')
  })
})
