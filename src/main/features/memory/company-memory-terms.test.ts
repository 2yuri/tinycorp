import { describe, expect, it } from 'vitest'
import { claimsIn, findContradictions, type TermPage } from './company-memory-terms'

function page(slug: string, body: string, extra: Partial<TermPage> = {}): TermPage {
  return { slug, title: slug, kind: 'convention', repos: ['billing-api'], body, ...extra }
}

describe('the terms a page states', () => {
  it('reads a config key written the three ways people write one', () => {
    expect(claimsIn('We set `DEFAULT_CURRENCY=EUR` at the edge.')).toEqual([{ key: 'DEFAULT_CURRENCY', value: 'EUR' }])
    expect(claimsIn('- retry_backoff: 4 seconds')).toEqual([{ key: 'retry_backoff', value: '4 seconds' }])
    expect(claimsIn('`WEBHOOK_TIMEOUT` is 30s, always.')).toEqual([{ key: 'WEBHOOK_TIMEOUT', value: '30s' }])
  })

  it('leaves ordinary prose alone', () => {
    expect(claimsIn('Note: this is a sentence with a colon in it.')).toEqual([])
    expect(claimsIn('The sum a = b is arithmetic, not configuration.')).toEqual([])
    expect(claimsIn('## Why\n\nBecause it was wrong.')).toEqual([])
  })

  it('holds a page to the first value it gives a key', () => {
    expect(claimsIn('`MODE=strict` … later, `MODE=loose`.')).toEqual([{ key: 'MODE', value: 'strict' }])
  })
})

describe('the contradiction heuristic', () => {
  it('flags two pages of one kind that share a repo and give a key two values', () => {
    const found = findContradictions([
      page('locale-handling', 'Totals use `DEFAULT_CURRENCY=USD` from the account.'),
      page('currency-defaults', 'Unless it is set, `DEFAULT_CURRENCY=EUR`.'),
    ])
    expect(found.get('locale-handling')).toEqual({
      slug: 'currency-defaults',
      title: 'currency-defaults',
      term: 'DEFAULT_CURRENCY',
      values: ['USD', 'EUR'],
    })
    // Both sides carry the banner, each naming the other.
    expect(found.get('currency-defaults')?.values).toEqual(['EUR', 'USD'])
  })

  it('does not flag pages of different kinds, or pages that share no repo', () => {
    expect(
      findContradictions([
        page('a', '`DEFAULT_CURRENCY=USD`', { kind: 'decision' }),
        page('b', '`DEFAULT_CURRENCY=EUR`', { kind: 'gotcha' }),
      ]).size,
    ).toBe(0)
    expect(
      findContradictions([
        page('a', '`DEFAULT_CURRENCY=USD`', { repos: ['billing-api'] }),
        page('b', '`DEFAULT_CURRENCY=EUR`', { repos: ['web-app'] }),
      ]).size,
    ).toBe(0)
  })

  it('does not flag two pages that agree, or two that talk about different keys', () => {
    expect(findContradictions([page('a', '`DEFAULT_CURRENCY=EUR`'), page('b', '`default_currency: eur`')]).size).toBe(0)
    expect(findContradictions([page('a', '`RETRY_MAX=4`'), page('b', '`PAGE_SIZE=50`')]).size).toBe(0)
  })

  it('names one page per side, however many pages clash', () => {
    const found = findContradictions([
      page('a', '`RETRY_MAX=4`'),
      page('b', '`RETRY_MAX=8`'),
      page('c', '`RETRY_MAX=16`'),
    ])
    expect([...found.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(found.get('a')?.slug).toBe('b')
    expect(found.get('c')?.slug).toBe('a')
  })
})
