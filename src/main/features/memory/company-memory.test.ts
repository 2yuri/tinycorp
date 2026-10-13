import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { countsLine, DEFAULT_COLD_DAYS } from '../../../shared/memory/company-memory'
import { migrate } from '../../core/engine/migrations'
import { type CompanyMemory, createCompanyMemory, ftsQuery } from './company-memory'
import { inMemoryPageFiles } from './company-memory-files'
import { parsePage, serializePage } from './company-memory-page'

const DAY = 24 * 60 * 60 * 1000

/** A memory over an in-memory database and an in-memory folder, on a clock the test moves. */
function scratch() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const files = inMemoryPageFiles()
  let clock = Date.parse('2026-09-23T10:00:00.000Z')
  const changes: number[] = []
  const memory = createCompanyMemory({
    db,
    files,
    now: () => new Date(clock),
    onChanged: () => changes.push(clock),
  })
  return {
    db,
    files,
    memory,
    changes,
    /** Moves the clock on by whole days. */
    passDays(days: number) {
      clock += days * DAY
    },
    at: () => clock,
  }
}

function writeDecision(memory: CompanyMemory, title: string, body: string, repos: string[] = ['billing-api']) {
  return memory.write({ kind: 'decision', title, body, repos, sources: ['ticket:TC-142'], by: 'Vega' })
}

describe('a Company memory page', () => {
  it('round trips file → index → file', () => {
    const { memory, files } = scratch()
    const written = memory.write({
      kind: 'decision',
      title: 'Locale handling in billing',
      body: 'Money is stored in minor units.\n\n## Decision\n\n- `DEFAULT_LOCALE=en-US`\n',
      repos: ['billing-api', 'web-app'],
      sources: ['ticket:TC-142', 'pr:billing-api#88', 'review:TC-142 thread 7'],
      by: 'Vega',
    })
    const file = files.read('decisions/locale-handling-in-billing.md')!

    // The file is what the index holds, and what the index holds writes the same file again.
    const reparsed = parsePage('decisions/locale-handling-in-billing.md', file)!
    expect(reparsed).toEqual(written)
    expect(serializePage(reparsed)).toBe(file)
    expect(file).toContain('kind: decision')
    expect(file).toContain('sources: [ticket:TC-142, pr:billing-api#88, review:TC-142 thread 7]')
  })

  it('refuses a page with no title, no body or no letters in its title', () => {
    const { memory } = scratch()
    expect(() => memory.write({ kind: 'gotcha', title: '   ', body: 'x', by: 'Vega' })).toThrow(/needs a title/)
    expect(() => memory.write({ kind: 'gotcha', title: 'Real', body: '  ', by: 'Vega' })).toThrow(/needs a body/)
    expect(() => memory.write({ kind: 'gotcha', title: '←→', body: 'x', by: 'Vega' })).toThrow(/file name/)
  })

  it('appends to a page that already exists, and keeps its sources and repos', () => {
    const { memory } = scratch()
    writeDecision(memory, 'Locale handling in billing', 'First.')
    const second = memory.write({
      kind: 'decision',
      title: 'Locale handling in billing',
      body: 'Second.',
      repos: ['web-app'],
      sources: ['pr:billing-api#88'],
      by: 'Orion',
    })
    expect(second.body).toBe('First.\n\nSecond.')
    expect(second.repos).toEqual(['billing-api', 'web-app'])
    expect(second.sources.map((source) => source.ref)).toEqual(['TC-142', 'billing-api#88'])
    expect(second.updatedBy).toBe('Orion')
  })

  it('refuses to reuse a slug for another kind', () => {
    const { memory } = scratch()
    writeDecision(memory, 'Currency defaults', 'Body.')
    expect(() => memory.write({ kind: 'gotcha', title: 'Currency defaults', body: 'Other.', by: 'Nova' })).toThrow(
      /already exists as a decision/,
    )
  })
})

describe('the index', () => {
  it('rebuilds from the files alone, and keeps the usage it recorded', () => {
    const { memory, db, files } = scratch()
    writeDecision(memory, 'Locale handling in billing', 'Money is stored in minor units.')
    memory.write({ kind: 'gotcha', title: 'Vitest needs pool threads', body: 'Use --pool=threads.', by: 'Nova' })
    memory.read('locale-handling-in-billing', 'Iris')

    // A page nobody wrote through the app, and one the app wrote and something deleted from the index.
    files.write(
      'glossary/seat-vs-member.md',
      '---\nkind: glossary\ntitle: "“Seat” vs “member”"\nrepos: [billing-api]\n' +
        'sources: []\nlinks: []\ncreated: 2026-09-01T09:00:00.000Z\nupdated: 2026-09-01T09:00:00.000Z\n' +
        'updatedBy: Nova\npinned: false\n---\n\nA seat is billed; a member is not.\n',
    )
    db.exec("DELETE FROM memory_page WHERE slug = 'vitest-needs-pool-threads'")

    const counts = memory.rebuild()
    expect(counts.pages).toBe(3)
    expect(counts.byKind).toMatchObject({ decision: 1, gotcha: 1, glossary: 1 })
    expect(memory.get('seat-vs-member')?.title).toBe('“Seat” vs “member”')
    expect(memory.get('vitest-needs-pool-threads')?.body).toBe('Use --pool=threads.')
    // Usage is the app's own record, not the file's, so a rebuild does not throw it away.
    expect(memory.list()[0]?.slug).toBe('locale-handling-in-billing')
    expect(memory.list().find((row) => row.slug === 'locale-handling-in-billing')?.usesThisWeek).toBe(1)
  })

  it('searches titles and bodies, and every hit counts as a use', () => {
    const { memory } = scratch()
    writeDecision(memory, 'Locale handling in billing', 'Money is stored in minor units.')
    memory.write({ kind: 'gotcha', title: 'Vitest needs pool threads', body: 'The suite hangs at 90%.', by: 'Nova' })

    const found = memory.search({ search: 'minor units' }, 'Iris')
    expect(found.map((row) => row.slug)).toEqual(['locale-handling-in-billing'])
    expect(memory.list()[0]?.usesThisWeek).toBe(1)

    expect(memory.search({ search: 'hangs', kind: 'gotcha' }, 'Iris').map((r) => r.slug)).toEqual([
      'vitest-needs-pool-threads',
    ])
    expect(memory.search({ search: 'nothing here at all' }, 'Iris')).toEqual([])
  })

  it('never lets what the boss typed reach FTS5 as syntax', () => {
    const { memory } = scratch()
    writeDecision(memory, 'Locale handling in billing', 'Money is stored in minor units.')
    expect(ftsQuery('  ')).toBeNull()
    expect(ftsQuery('locale "handling')).toBe('"locale" AND "handling"*')
    for (const nonsense of ['"', 'a AND', 'NEAR(', '-', '*', 'locale OR']) {
      expect(() => memory.search({ search: nonsense }, 'Iris')).not.toThrow()
    }
  })

  it('filters by repo and lists the pages one ticket wrote', () => {
    const { memory } = scratch()
    writeDecision(memory, 'Locale handling in billing', 'One.', ['billing-api'])
    memory.write({
      kind: 'convention',
      title: 'Every price goes through formatPrice',
      body: 'Two.',
      repos: ['web-app'],
      sources: ['ticket:TC-96'],
      by: 'Orion',
    })
    expect(memory.list({ repo: 'web-app' }).map((row) => row.slug)).toEqual(['every-price-goes-through-formatprice'])
    expect(memory.fromTicket('TC-142').map((row) => row.slug)).toEqual(['locale-handling-in-billing'])
  })
})

describe('aging', () => {
  it('marks a page cold after the Company’s threshold and never deletes it', () => {
    const { memory, passDays } = scratch()
    writeDecision(memory, 'Webhook retries with backoff', 'Retry four times.')
    expect(memory.coldDays()).toBe(DEFAULT_COLD_DAYS)
    expect(memory.list()[0]?.cold).toBe(false)

    passDays(DEFAULT_COLD_DAYS + 1)
    expect(memory.list()[0]?.cold).toBe(true)
    expect(countsLine(memory.counts())).toBe('1 page · 1 cold')

    // Reading it is a use, so it is warm again; the page never left.
    memory.read('webhook-retries-with-backoff', 'Iris')
    expect(memory.list()[0]?.cold).toBe(false)
    expect(memory.get('webhook-retries-with-backoff')).not.toBeNull()
  })

  it('takes the Company’s own threshold', () => {
    const { memory, passDays } = scratch()
    writeDecision(memory, 'Legacy invoice PDF renderer', 'It is still there.')
    expect(memory.setColdDays(7)).toBe(7)
    passDays(8)
    expect(memory.list()[0]?.cold).toBe(true)
    memory.setColdDays(90)
    expect(memory.list()[0]?.cold).toBe(false)
  })

  it('archives into archive/ instead of deleting, and leaves it out of the counts', () => {
    const { memory, files } = scratch()
    writeDecision(memory, 'Legacy invoice PDF renderer', 'It is still there.')
    memory.archive('legacy-invoice-pdf-renderer', 'Yuri')
    expect(files.read('decisions/legacy-invoice-pdf-renderer.md')).toBeNull()
    expect(files.read('archive/legacy-invoice-pdf-renderer.md')).toContain('Legacy invoice PDF renderer')
    expect(memory.counts()).toMatchObject({ pages: 0, archived: 1 })
    expect(memory.list()).toEqual([])
    expect(memory.list({ archived: true }).map((row) => row.slug)).toEqual(['legacy-invoice-pdf-renderer'])
  })
})

describe('handoffs', () => {
  let memory: CompanyMemory
  beforeEach(() => {
    memory = scratch().memory
  })

  it('is claimed exactly once', () => {
    const page = memory.writeHandoff({
      title: 'Vega → Codex · TC-146',
      body: 'Where the work stands.',
      by: 'the Company',
      sources: ['ticket:TC-146'],
    })
    expect(page.handoff).toMatchObject({ state: 'open', claimedBy: null })

    const claimed = memory.claimHandoff(page.slug, 'Vega')
    expect(claimed.handoff).toMatchObject({ state: 'claimed', claimedBy: 'Vega' })
    expect(claimed.handoff?.claimedAt).not.toBeNull()

    expect(() => memory.claimHandoff(page.slug, 'Iris')).toThrow(/already claimed — Vega has it/)
    expect(memory.get(page.slug)?.handoff?.claimedBy).toBe('Vega')
  })

  it('closes with the ticket, and a closed handoff cannot be claimed', () => {
    const page = memory.writeHandoff({ title: 'Iris → Codex · TC-131', body: 'Stands here.', by: 'the Company' })
    memory.closeHandoff(page.slug, 'the Company')
    expect(memory.get(page.slug)?.handoff?.state).toBe('done')
    expect(() => memory.claimHandoff(page.slug, 'Vega')).toThrow(/already done/)
  })

  it('is left out of a Session’s brief: it is one Session’s note, not the Company’s', () => {
    memory.writeHandoff({
      title: 'Vega → Codex · TC-146',
      body: 'Stands here.',
      by: 'the Company',
      repos: ['billing-api'],
    })
    memory.write({
      kind: 'decision',
      title: 'Locale handling in billing',
      body: 'Minor units.',
      repos: ['billing-api'],
      by: 'Vega',
    })
    expect(memory.brief(['billing-api']).map((page) => page.slug)).toEqual(['locale-handling-in-billing'])
  })
})

describe('the bounded brief', () => {
  it('names pinned pages first, then the most used, and stops at its cap', () => {
    const { memory } = scratch()
    for (let i = 0; i < 20; i++) {
      memory.write({
        kind: 'convention',
        title: `Rule number ${i}`,
        body: `Body ${i}.`,
        repos: ['billing-api'],
        by: 'Vega',
      })
    }
    memory.write({ kind: 'decision', title: 'Something elsewhere', body: 'Body.', repos: ['other-repo'], by: 'Vega' })
    for (let i = 0; i < 3; i++) memory.read('rule-number-7', 'Iris')
    memory.pin('rule-number-19', true, 'Yuri')

    const brief = memory.brief(['billing-api'])
    expect(brief).toHaveLength(12)
    expect(brief[0]?.slug).toBe('rule-number-19')
    expect(brief[1]?.slug).toBe('rule-number-7')
    expect(brief.map((page) => page.slug)).not.toContain('something-elsewhere')
  })
})

describe('links', () => {
  it('links two pages both ways, and reads `[[slug]]` out of a body', () => {
    const { memory } = scratch()
    writeDecision(memory, 'Locale handling in billing', 'See [[currency-defaults]].')
    memory.write({ kind: 'convention', title: 'Currency defaults', body: 'EUR unless set.', by: 'Orion' })
    expect(memory.get('locale-handling-in-billing')?.links).toEqual(['currency-defaults'])

    memory.write({ kind: 'convention', title: 'Prices use formatPrice', body: 'Always.', by: 'Orion' })
    memory.link('locale-handling-in-billing', 'prices-use-formatprice', 'Yuri')
    expect(memory.get('prices-use-formatprice')?.links).toEqual(['locale-handling-in-billing'])
    expect(memory.get('locale-handling-in-billing')?.links).toEqual(['currency-defaults', 'prices-use-formatprice'])

    expect(() => memory.link('locale-handling-in-billing', 'nothing-there', 'Yuri')).toThrow(/no memory page/)
    expect(() => memory.link('a', 'a', 'Yuri')).toThrow(/linked to itself/)
  })
})
