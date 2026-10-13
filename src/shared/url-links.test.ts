import { describe, expect, it } from 'vitest'
import { urlSegments } from './url-links'

describe('urlSegments (T290)', () => {
  it('finds a link in a sentence and leaves the full stop after it', () => {
    expect(urlSegments('Retargeted https://gitlab.com/acme/web/-/merge_requests/157. Done')).toEqual([
      { text: 'Retargeted ' },
      {
        text: 'https://gitlab.com/acme/web/-/merge_requests/157',
        url: 'https://gitlab.com/acme/web/-/merge_requests/157',
      },
      { text: '. Done' },
    ])
  })

  it('drops a closing bracket the link never opened, and keeps one it did', () => {
    expect(
      urlSegments('(see https://example.com/a)')
        .map((s) => s.url)
        .filter(Boolean),
    ).toEqual(['https://example.com/a'])
    expect(urlSegments('https://en.wikipedia.org/wiki/Foo_(bar)').at(0)?.url).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('reads http and https only, and text with no link as one run', () => {
    expect(urlSegments('ftp://x.y and file:///etc')).toEqual([{ text: 'ftp://x.y and file:///etc' }])
    expect(urlSegments('http://localhost:5173/x, then')).toEqual([
      { text: 'http://localhost:5173/x', url: 'http://localhost:5173/x' },
      { text: ', then' },
    ])
  })
})
