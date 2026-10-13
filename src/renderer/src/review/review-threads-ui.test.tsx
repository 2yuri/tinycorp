import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import type { Review } from '../../../shared/review'
import type { ReviewThread } from '../../../shared/review/review-threads'
import { LineThreads } from './ReviewThreads'
import { forgeLine, reviewerCardLine, roundTimeline, threadsProgress } from './review-model'

/** The agents' conversation as the Review screen draws it (T170, frame `VtAMR`). */

const DAY = '2026-09-17'
const at = (time: string) => `${DAY}T${time}:00`

const iris: Employee = {
  id: 'e-iris',
  name: 'Iris',
  roleId: 'qa',
  title: 'QA',
  persona: '',
  capabilities: ['review'],
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  overrides: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  desk: 0,
  sprite: 4,
  createdAt: at('08:00'),
}
const vega: Employee = { ...iris, id: 'e-vega', name: 'Vega', roleId: 'frontend', title: 'Frontend', sprite: 1 }

function thread(over: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 1,
    ticketId: 142,
    round: 1,
    repoId: 'r-api',
    path: 'src/format/currency.ts',
    line: 20,
    state: 'open',
    resolvedBy: null,
    resolvedAt: null,
    commit: null,
    url: null,
    createdAt: at('09:44'),
    messages: [
      {
        id: 1,
        threadId: 1,
        round: 1,
        authorId: 'e-iris',
        body: 'Intl throws on an unknown locale.',
        commit: null,
        url: null,
        createdAt: at('09:44'),
      },
    ],
    ...over,
  }
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
  comments: 'Ship it.',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 9,
  requestedAt: at('09:30'),
  decidedAt: at('10:15'),
}

const people = { employees: [iris, vega], bossName: 'Yuri Miguel', reviewerId: 'e-iris' }
const actions = { onReply: () => {}, onResolve: () => {} }
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('a thread in the diff', () => {
  it('collapses to one row once it is resolved, with the commit that fixed it and who closed it', () => {
    const settled = thread({ state: 'resolved', resolvedBy: 'e-iris', commit: '3f2a1c944ab' })

    const html = renderToStaticMarkup(<LineThreads threads={[settled]} people={people} actions={actions} />)

    expect(text(html)).toContain('Intl throws on an unknown locale. 3f2a1c9 Resolved by Iris')
    // The first seven characters, whatever the assignee pasted.
    expect(text(html)).not.toContain('3f2a1c944ab')
    expect(html).not.toContain('review-thread__resolve')
  })

  it('stays expanded while it is open, with a reply box and Resolve', () => {
    const html = renderToStaticMarkup(<LineThreads threads={[thread()]} people={people} actions={actions} />)

    expect(text(html)).toContain('Open thread · line 20 · 0 replies')
    expect(text(html)).toContain('Iris QA 09:44 · round 1')
    expect(html).toContain('Reply on line 20…')
    expect(text(html)).toContain('Resolve')
  })

  it('badges a thread the reviewer left as a note, which never blocks the merge', () => {
    const note = thread({ state: 'non_blocking' })

    expect(text(renderToStaticMarkup(<LineThreads threads={[note]} people={people} actions={actions} />))).toContain(
      'Non-blocking note',
    )
  })

  it('marks the assignee answering without a commit as pushing back', () => {
    const argued = thread({
      messages: [
        ...thread().messages,
        {
          id: 2,
          threadId: 1,
          round: 1,
          authorId: 'e-vega',
          body: 'It is rejected at the boundary already.',
          commit: null,
          url: null,
          createdAt: at('10:02'),
        },
      ],
    })

    const html = text(renderToStaticMarkup(<LineThreads threads={[argued]} people={people} actions={actions} />))

    expect(html).toContain('Vega FRONTEND 10:02 · round 1 Pushed back')
    expect(html).not.toContain('Iris QA 09:44 · round 1 Pushed back')
  })
})

describe('the reviewer card and the round list', () => {
  it('says how many rounds it took and how much of the conversation is settled', () => {
    const threads = [thread({ id: 1, state: 'resolved' }), thread({ id: 2 }), thread({ id: 3, state: 'resolved' })]

    expect(reviewerCardLine(review, threads)).toBe('2 rounds · 2 of 3 threads resolved')
    expect(threadsProgress(threads)).toBeCloseTo(2 / 3)
    expect(reviewerCardLine(review, [])).toBe('2 rounds')
  })

  it('lists each round, what the assignee pushed between them, and where the ticket stands', () => {
    const answered = thread({
      messages: [
        ...thread().messages,
        {
          id: 2,
          threadId: 1,
          round: 1,
          authorId: 'e-vega',
          body: 'Moved it.',
          commit: '3f2a1c9',
          url: null,
          createdAt: at('10:02'),
        },
      ],
    })

    const events = roundTimeline(review, [answered], (id) => (id === 'e-iris' ? 'Iris' : 'Vega'))

    expect(events.map((event) => event.title)).toEqual([
      'Round 1 · changes requested',
      '1 commit pushed',
      'Round 2 · approved',
      'Ready for you',
    ])
    expect(events[0]!.detail).toBe('Iris · 1 thread on 1 file')
    expect(events[1]!.detail).toBe('3f2a1c9')
    expect(events.at(-1)!.detail).toBe('Handed to the boss · round 2 of 3')
  })

  it('says the round limit settled nothing when that is where it ended', () => {
    const stuck: Review = { ...review, status: 'changes_requested', handoff: 'your_call', rounds: 3, roundLimit: 3 }

    const events = roundTimeline(stuck, [], () => 'Iris')

    expect(events.at(-1)).toMatchObject({
      title: 'Your call',
      detail: 'The round limit of 3 was reached and they are still apart',
    })
  })

  it('says the boss is not being asked yet while the agents are still talking', () => {
    const talking: Review = { ...review, status: 'pending', handoff: 'agents', rounds: 2 }

    expect(roundTimeline(talking, [], () => 'Iris').at(-1)).toMatchObject({
      title: 'In review between agents',
      detail: 'Round 2 of 3 · you are not being asked yet',
    })
  })

  it('links the review on the forge, and says so plainly when no forge is carrying it', () => {
    expect(forgeLine({ onForge: true, url: 'https://github.com/acme/app/pull/88#discussion_r1', number: 88 })).toEqual({
      label: 'Also on GitHub · PR #88 · posted as a review',
      url: 'https://github.com/acme/app/pull/88#discussion_r1',
    })
    expect(forgeLine({ onForge: false, url: null, number: null })).toEqual({
      label: 'In this app only · this repo’s forge cannot hold a review thread',
      url: null,
    })
  })
})
