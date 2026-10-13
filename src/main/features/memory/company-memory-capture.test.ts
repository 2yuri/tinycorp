import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { captureDetail, captureSummary } from '../../../shared/memory/company-memory'
import type { Plan } from '../../../shared/planning/planning'
import type { ReviewThread, ThreadMessage } from '../../../shared/review/review-threads'
import { migrate } from '../../core/engine/migrations'
import { createCompanyMemory } from './company-memory'
import { capturePages, captureResult, type FinishedTicket } from './company-memory-capture'
import { inMemoryPageFiles } from './company-memory-files'

const NAMES: Record<string, string> = { 'e-vega': 'Vega', 'e-orion': 'Orion', boss: 'Yuri' }

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 1,
    version: 1,
    ticketId: 142,
    epicId: null,
    plannerId: 'e-orion',
    goal: 'Money is formatted once, at the edge. The account decides the locale, never the browser.',
    approach: 'billing-api returns integers plus a currency code; web-app formats them.',
    acceptanceCriteria: ['An invoice reads the same for everyone who opens it.'],
    repos: ['r-billing'],
    subtasks: [],
    risks: ['The 90d chart still formats on its own.'],
    openQuestions: [],
    status: 'approved',
    approvedBy: 'boss',
    approvedAt: '2026-09-20T09:00:00.000Z',
    replanBy: null,
    replanReason: null,
    replanChanges: [],
    channelId: 'general',
    threadId: null,
    messageId: null,
    createdAt: '2026-09-19T09:00:00.000Z',
    questions: [],
    ...overrides,
  }
}

function message(authorId: string, body: string, commit: string | null = null): ThreadMessage {
  return { id: 0, threadId: 1, round: 1, authorId, body, commit, url: null, createdAt: '2026-09-21T10:00:00.000Z' }
}

function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 7,
    ticketId: 142,
    round: 1,
    repoId: 'r-web',
    path: 'src/format/currency.ts',
    line: 20,
    state: 'resolved',
    resolvedBy: 'e-orion',
    resolvedAt: '2026-09-21T11:00:00.000Z',
    commit: null,
    url: null,
    createdAt: '2026-09-21T10:00:00.000Z',
    messages: [],
    ...overrides,
  }
}

function finished(overrides: Partial<FinishedTicket> = {}): FinishedTicket {
  return {
    ticket: {
      id: 142,
      title: 'Invoice totals disagree for a German account',
      description: '',
      repos: ['r-billing', 'r-web'],
    },
    code: 'TC-142',
    repoNames: { 'r-billing': 'billing-api', 'r-web': 'web-app' },
    plan: plan(),
    threads: [],
    nameOf: (id) => NAMES[id] ?? id,
    by: 'the Company',
    ...overrides,
  }
}

describe('capture from a finished ticket', () => {
  it('turns an approved plan into a Decision, word for word', () => {
    const pages = capturePages(finished())
    expect(pages).toHaveLength(1)
    const [decision] = pages
    expect(decision).toMatchObject({
      kind: 'decision',
      title: 'Money is formatted once, at the edge',
      repos: ['billing-api', 'web-app'],
      sources: ['ticket:TC-142'],
      from: 'the plan',
    })
    expect(decision!.body).toContain('billing-api returns integers plus a currency code')
    expect(decision!.body).toContain('- An invoice reads the same for everyone who opens it.')
    expect(decision!.body).toContain('The plan was approved by Yuri on 2026-09-20')
    expect(decision!.body).toContain('- The 90d chart still formats on its own.')
  })

  it('writes nothing from a plan nobody approved', () => {
    expect(capturePages(finished({ plan: plan({ status: 'waiting' }) }))).toEqual([])
    expect(capturePages(finished({ plan: null }))).toEqual([])
  })

  it('turns a review pushback into a Convention, quoting the thread', () => {
    const pushback = thread({
      messages: [
        message('e-orion', 'Pull this into a helper.'),
        message('e-vega', 'No: the two call sites format differently on purpose. Leave it.'),
      ],
    })
    const [page] = capturePages(finished({ plan: null, threads: [pushback] }))
    expect(page).toMatchObject({
      kind: 'convention',
      title: 'currency.ts convention from TC-142',
      repos: ['web-app'],
      sources: ['ticket:TC-142', 'review:TC-142 thread 7'],
      from: 'review threads',
    })
    expect(page!.body).toContain('> **Orion** — Pull this into a helper.')
    expect(page!.body).toContain('> **Vega** — No: the two call sites format differently')
    expect(page!.body).toContain('Vega pushed back and Orion resolved the thread')
  })

  it('turns a failure answered by a fix commit into a Gotcha', () => {
    const failed = thread({
      id: 9,
      path: 'src/format/currency.test.ts',
      commit: '9f2c1ab',
      messages: [
        message('e-orion', 'The suite hangs at 90% on this machine.'),
        message('e-vega', 'vitest needs --pool=threads here. Fixed.', '9f2c1ab'),
      ],
    })
    const [page] = capturePages(finished({ plan: null, threads: [failed] }))
    expect(page).toMatchObject({
      kind: 'gotcha',
      title: 'currency.test.ts fails on TC-142',
      sources: ['ticket:TC-142', 'review:TC-142 thread 9', 'commit:9f2c1ab'],
      from: 'testing',
    })
    expect(page!.body).toContain('Fixed in 9f2c1ab')
  })

  it('writes nothing from a thread that is open, alone, or only changed a line', () => {
    const open = thread({ state: 'open', messages: [message('e-orion', 'Rename this.'), message('e-vega', 'Done.')] })
    const alone = thread({ messages: [message('e-orion', 'Nice.')] })
    const changed = thread({
      commit: 'abc1234',
      messages: [message('e-orion', 'Rename this.'), message('e-vega', 'Done.', 'abc1234')],
    })
    expect(capturePages(finished({ plan: null, threads: [open, alone, changed] }))).toEqual([])
  })

  it('is deterministic: the same ticket writes the same pages, twice over', () => {
    const input = finished({
      threads: [
        thread({ messages: [message('e-orion', 'Pull this into a helper.'), message('e-vega', 'No. Leave it.')] }),
      ],
    })
    expect(capturePages(input)).toEqual(capturePages(input))
  })
})

describe('the pages a capture writes', () => {
  function memory() {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    return createCompanyMemory({ db, files: inMemoryPageFiles(), now: () => new Date('2026-09-22T12:00:00.000Z') })
  }

  it('lands in the store, and a second capture of the same ticket rewrites and does not double', () => {
    const store = memory()
    const input = finished({
      threads: [
        thread({ messages: [message('e-orion', 'Pull this into a helper.'), message('e-vega', 'No. Leave it.')] }),
      ],
    })
    const write = () =>
      capturePages(input).map((page) => {
        const existed = store.get(page.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()) !== null
        const saved = store.write({ ...page, by: 'the Company' })
        return { slug: saved.slug, title: saved.title, kind: saved.kind, created: !existed }
      })

    const first = write()
    expect(first.map((page) => page.kind)).toEqual(['decision', 'convention'])
    const second = write()
    expect(second.every((page) => !page.created)).toBe(true)
    expect(store.counts().pages).toBe(2)
    // `replace`, so a re-capture rewrites the body instead of appending it a second time.
    const page = store.get(second[1]!.slug)!
    expect(page.body.match(/## The thread/g)).toHaveLength(1)
    expect(store.fromTicket('TC-142')).toHaveLength(2)
  })

  it('earns one Activity line for the ticket, not one per page', () => {
    const input = finished({
      threads: [
        thread({ messages: [message('e-orion', 'Pull this into a helper.'), message('e-vega', 'No. Leave it.')] }),
        thread({
          id: 9,
          commit: '9f2c1ab',
          path: 'src/format/currency.test.ts',
          messages: [message('e-orion', 'It fails here.'), message('e-vega', 'Fixed.', '9f2c1ab')],
        }),
      ],
    })
    const pages = capturePages(input)
    const result = captureResult(
      'TC-142',
      pages.map((page) => ({ slug: page.title, title: page.title, kind: page.kind, created: true })),
      pages,
    )
    expect(captureSummary(result)).toBe('3 pages updated from TC-142')
    expect(captureDetail(result)).toBe('from the plan, review threads and testing')
  })
})
