// @vitest-environment jsdom
// The panel's two decisions, pressed for real: the frame draws both live, and Request changes has
// to answer a press it cannot carry out rather than sitting dead until the boss types.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PullRequestDetails } from '../../../shared/code'
import type { Review } from '../../../shared/review'
import type { DiffFile } from '../../../shared/review/review-diff'
import { ReviewPanel } from './ReviewParts'

const currency: DiffFile = {
  path: 'src/format/currency.ts',
  previousPath: null,
  status: 'modified',
  additions: 64,
  deletions: 4,
  binary: false,
}

const details: PullRequestDetails = {
  ticketId: 142,
  repoId: 'r-api',
  url: 'https://github.com/acme/app/pull/131',
  number: 131,
  title: 'Currency + locale formatting helper',
  state: 'open',
  head: 'feat/locale-format',
  base: 'main',
  additions: 142,
  deletions: 38,
  changedFiles: 6,
  mergeable: 'mergeable',
  checks: [],
}

const review: Review = {
  id: 2,
  round: 2,
  rounds: 2,
  handoff: 'ready',
  roundLimit: 3,
  ticketId: 142,
  reviewerId: 'e-iris',
  status: 'approved',
  decidedBy: 'e-iris',
  comments: '',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 9,
  requestedAt: '2026-09-17T09:00:00.000Z',
  decidedAt: '2026-09-17T09:50:00.000Z',
}

let host: HTMLDivElement
let root: Root
let sentBack: number

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  sentBack = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function mount(over: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
  act(() =>
    root.render(
      <ReviewPanel
        repoName="billing-api"
        details={details}
        diff={{ head: 'feat/locale-format', base: 'main', files: [currency], refusal: null }}
        review={review}
        round="billing-api #131 · round 2 of 2"
        summary="Iris (QA) approved · 1 unresolved comment"
        unresolved={[]}
        threads={[]}
        onForge
        onJumpTo={() => {}}
        employees={[]}
        bossName="Yuri Miguel"
        comments=""
        busy={false}
        canDecide
        error={null}
        onComments={() => {}}
        onApprove={() => {}}
        onRequestChanges={() => {
          sentBack += 1
        }}
        onClose={() => {}}
        {...over}
      />,
    ),
  )
}

/** The decisions read as what they say, and the hint speaks to a screen reader as a status. */
const button = (label: string) => [...host.querySelectorAll('button')].find((one) => one.textContent?.includes(label))!
const changes = () => button('Send back')
const box = () => host.querySelector<HTMLTextAreaElement>('textarea')!
const hint = () => host.querySelector('[role="status"]')?.textContent ?? null

describe('Request changes', () => {
  it('is live on load, and a press with nothing written puts the caret where the reason goes', () => {
    mount()

    expect(changes().disabled).toBe(false)
    act(() => changes().click())

    expect(sentBack).toBe(0)
    expect(document.activeElement).toBe(box())
    expect(hint()).toBe('Say what to change, then send it back.')
  })

  it('sends the ticket back once there is a reason to send it back with', () => {
    mount({ comments: 'Rename the helper' })

    act(() => changes().click())

    expect(sentBack).toBe(1)
    expect(hint()).toBe(null)
  })

  it('is dead only where there is no decision to make: a round the boss may not decide', () => {
    mount({ canDecide: false })

    expect(changes().disabled).toBe(true)
    expect(button('Approve').disabled).toBe(true)
  })
})

describe('Merging without waiting for the review (T248)', () => {
  const underway: Review = {
    ...review,
    round: 1,
    rounds: 1,
    handoff: 'agents',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
  }

  it('lets the boss merge while the agents are still reviewing, after asking once more', () => {
    let approved = 0
    mount({ review: underway, onApprove: () => (approved += 1) })

    expect(button('Approve').disabled).toBe(true)
    act(() => button('Merge now, without waiting').click())
    expect(host.textContent).toContain('Round 1 of 3 is still with the agents')
    expect(approved).toBe(0)

    act(() => button('Merge now').click())
    expect(approved).toBe(1)
  })

  it('keeps waiting when the boss says so, and offers nothing to someone who may not decide', () => {
    let approved = 0
    mount({ review: underway, onApprove: () => (approved += 1) })
    act(() => button('Merge now, without waiting').click())
    act(() => button('Keep waiting').click())
    expect(approved).toBe(0)
    expect(button('Merge now, without waiting')).toBeDefined()

    mount({ review: underway, canDecide: false })
    expect(host.textContent).not.toContain('Merge now, without waiting')
  })
})
