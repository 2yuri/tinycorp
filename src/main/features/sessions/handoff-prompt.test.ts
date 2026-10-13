import { describe, expect, it } from 'vitest'
import { HANDOFF_PATHS_SHOWN, HANDOFF_QUOTE_MAX, handoffPrompt, type RoutingHandoff } from './handoff-prompt'

const handoff = (over: Partial<RoutingHandoff> = {}): RoutingHandoff => ({
  employee: { name: 'Vega', title: 'Frontend' },
  from: { provider: 'Claude', model: 'Opus 5' },
  to: { provider: 'Codex', model: 'GPT-6-Sol' },
  reason: 'out-of-budget',
  backAt: '21:00',
  ticket: { code: 'TC-142', title: 'Usage chart', body: 'Draw the 5h window on the Usage page.' },
  plan: '- [x] Read the endpoint\n- [ ] Draw the meter',
  worktree: { path: '/work/acme/worktrees/web/tc-142-usage-chart', branch: 'tc-142-usage-chart' },
  diff: { paths: ['src/usage/Meter.tsx', 'src/usage/meter.css'], truncated: false },
  reviewThreads: [{ file: 'src/usage/Meter.tsx', line: 31, author: 'Iris', text: 'This rounds the wrong way.' }],
  messages: [{ author: 'Yuri', text: 'Ship it after Iris signs off.' }],
  notes: '#12 The meter is 220px wide everywhere.',
  ...over,
})

describe('The handoff prompt', () => {
  it('says why it moved, and that nothing was reset', () => {
    const text = handoffPrompt(handoff())

    expect(text).toContain('Claude hit its usage limit, so this Session continues on Codex.')
    expect(text).toContain('Claude is expected back at 21:00.')
    expect(text).toContain('same worktree and on the same branch')
    expect(text).toContain('nothing was reset')
  })

  it('carries the ticket, the plan, the worktree, the change, the threads, the talk and the memory', () => {
    const text = handoffPrompt(handoff())

    expect(text).toContain('## Ticket TC-142 — Usage chart')
    expect(text).toContain('Draw the 5h window on the Usage page.')
    expect(text).toContain('- [ ] Draw the meter')
    expect(text).toContain('/work/acme/worktrees/web/tc-142-usage-chart on branch tc-142-usage-chart')
    expect(text).toContain('2 files changed: src/usage/Meter.tsx, src/usage/meter.css')
    expect(text).toContain('src/usage/Meter.tsx:31 — Iris: This rounds the wrong way.')
    expect(text).toContain('- Yuri: Ship it after Iris signs off.')
    expect(text).toContain('The meter is 220px wide everywhere.')
    expect(text).toContain('Continue the next unfinished step.')
  })

  it('says plainly when there is nothing rather than leaving a heading empty', () => {
    const text = handoffPrompt(
      handoff({ ticket: null, plan: null, worktree: null, diff: null, reviewThreads: [], messages: [], notes: '' }),
    )

    expect(text).toContain('You are on no ticket right now.')
    expect(text).toContain('Nothing is changed in the worktree yet.')
    expect(text).toContain('## Open review threads\nNone.')
    expect(text).toContain('Nothing recent.')
    expect(text).toContain('You have written no notes yet.')
    expect(text).not.toContain('## The plan you wrote')
  })

  it('names the first paths and counts the rest, so a big change stays one line', () => {
    const paths = Array.from({ length: HANDOFF_PATHS_SHOWN + 3 }, (_, i) => `src/file-${i}.ts`)
    const text = handoffPrompt(handoff({ diff: { paths, truncated: false } }))

    expect(text).toContain(
      `${paths.length} files changed: ${paths.slice(0, HANDOFF_PATHS_SHOWN).join(', ')} and 3 more`,
    )
    expect(text).not.toContain('src/file-11.ts')
  })

  it('clips a quoted comment: a review thread can hold a whole file, and none of it belongs here', () => {
    const long = 'x'.repeat(HANDOFF_QUOTE_MAX * 2)
    const text = handoffPrompt(handoff({ messages: [{ author: 'Yuri', text: long }] }))

    expect(text).toContain(`Yuri: ${'x'.repeat(HANDOFF_QUOTE_MAX - 1)}…`)
  })

  it('turns around when the Provider resets and the Employee goes home', () => {
    const text = handoffPrompt(handoff({ reason: 'moved-back', backAt: null }))

    expect(text).toContain('Claude has reset, so this Session moves back to it from Codex.')
    expect(text).not.toContain('expected back at')
  })
})
