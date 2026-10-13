// @vitest-environment jsdom
// The security pass's own row in the review panel (T241): what it says, and the one press on it —
// Override, which is drawn only while a high finding is really holding the merge.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Review } from '../../../shared/review'
import type { DiffFile } from '../../../shared/review/review-diff'
import type { SecurityFinding, SecurityPass } from '../../../shared/review/security'
import { ReviewPanel } from './ReviewParts'

const currency: DiffFile = {
  path: 'src/preload/index.ts',
  previousPath: null,
  status: 'modified',
  additions: 4,
  deletions: 1,
  binary: false,
}

const review: Review = {
  id: 2,
  round: 1,
  rounds: 1,
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
  requestedAt: '2026-09-25T09:00:00.000Z',
  decidedAt: '2026-09-25T09:30:00.000Z',
}

const high: SecurityFinding = {
  id: 1,
  passId: 1,
  severity: 'high',
  title: 'The renderer can run any shell command',
  fix: 'Take a command id, not a string, and look it up in the main process.',
  threadId: 4,
  where: 'src/preload/index.ts:20',
  resolved: false,
  createdAt: '2026-09-25T09:10:00.000Z',
}

const pass: SecurityPass = {
  id: 1,
  ticketId: 142,
  reviewId: 2,
  reviewerId: 'e-vega',
  state: 'findings',
  reason: { kind: 'risky', classes: ['ipc'] },
  summary: 'One high on the preload.',
  overriddenBy: null,
  overrideReason: '',
  startedAt: '2026-09-25T09:05:00.000Z',
  finishedAt: '2026-09-25T09:20:00.000Z',
  findings: [high],
}

let host: HTMLDivElement
let root: Root
let overrides: number

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  overrides = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function mount(over: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
  act(() =>
    root.render(
      <ReviewPanel
        repoName="app"
        details={null}
        diff={{ head: 'feat/x', base: 'main', files: [currency], refusal: null }}
        review={review}
        round="app · round 1 of 3"
        summary="Iris approved"
        unresolved={[]}
        threads={[]}
        onForge
        onJumpTo={() => {}}
        employees={[]}
        bossName="Yuri"
        comments=""
        busy={false}
        canDecide
        error={null}
        security={pass}
        onOverrideSecurity={() => {
          overrides += 1
        }}
        onComments={() => {}}
        onApprove={() => {}}
        onRequestChanges={() => {}}
        onClose={() => {}}
        {...over}
      />,
    ),
  )
}

const row = () => host.querySelector('[aria-label="Security"]')
const button = (label: string) => [...host.querySelectorAll('button')].find((one) => one.textContent?.includes(label))

describe('The security row', () => {
  it('says what is open, where it is and what the fix is, and why the change was read', () => {
    mount()

    const text = row()!.textContent ?? ''
    expect(text).toContain('Security: 1 high open')
    expect(text).toContain('src/preload/index.ts:20')
    expect(text).toContain('Fix: Take a command id, not a string, and look it up in the main process.')
    expect(text).toContain('it touches IPC and the window policy')
  })

  it('offers the override only while a high finding is holding the merge', () => {
    mount()
    expect(button('Override')).toBeDefined()

    act(() => button('Override')!.click())
    expect(overrides).toBe(1)

    mount({ security: { ...pass, findings: [{ ...high, resolved: true }] } })
    expect(button('Override')).toBeUndefined()
  })

  it('says the boss overrode it, in their own words, once they have', () => {
    mount({
      security: { ...pass, state: 'overridden', overriddenBy: 'boss', overrideReason: 'Internal build only.' },
    })

    expect(row()!.textContent).toContain('Security overridden')
    expect(row()!.textContent).toContain('Internal build only.')
    expect(button('Override')).toBeUndefined()
  })

  it('is not drawn at all for a ticket that never had a pass', () => {
    mount({ security: null })

    expect(row()).toBeNull()
  })
})
