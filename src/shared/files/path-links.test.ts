import { describe, expect, it } from 'vitest'
import { type PathLink, pathMentions, pathSegments, pathTitle } from './path-links'

/** What the matcher found, in the short shape the expectations read in. */
const found = (text: string, repos: string[] = []) =>
  pathMentions(text, repos).map((m) => [m.text, m.path, m.repo, m.line, m.column])

describe('The paths written in a piece of text', () => {
  it('finds a repo-relative path', () => {
    expect(found('look at src/shared/office/counter.ts for it')).toEqual([
      ['src/shared/office/counter.ts', 'src/shared/office/counter.ts', null, null, null],
    ])
  })

  it('finds a line, and a line with a column', () => {
    expect(found('counter.ts:19 and counter.ts:19:8')).toEqual([
      ['counter.ts:19', 'counter.ts', null, 19, null],
      ['counter.ts:19:8', 'counter.ts', null, 19, 8],
    ])
  })

  it('takes the repo written in front of a path, and only one it knows', () => {
    expect(found('web src/format/currency.ts:19', ['web', 'api'])).toEqual([
      ['web src/format/currency.ts:19', 'src/format/currency.ts', 'web', 19, null],
    ])
    expect(found('in src/format/currency.ts:19', ['web'])).toEqual([
      ['src/format/currency.ts:19', 'src/format/currency.ts', null, 19, null],
    ])
  })

  it('finds an absolute path, and one under the boss’s home', () => {
    expect(found('compare /Users/yuri/shots/menu-portrait.png with ~/shots/menu.png')).toEqual([
      ['/Users/yuri/shots/menu-portrait.png', '/Users/yuri/shots/menu-portrait.png', null, null, null],
      ['~/shots/menu.png', '~/shots/menu.png', null, null, null],
    ])
  })

  it('leaves the sentence around a path alone', () => {
    expect(found('I changed (src/main.ts), then src/other.ts.')).toEqual([
      ['src/main.ts', 'src/main.ts', null, null, null],
      ['src/other.ts', 'src/other.ts', null, null, null],
    ])
  })

  it('never takes a bare word, a number or a URL for a path', () => {
    expect(found('the Employee finished, e. g. version 2.0 shipped')).toEqual([])
    expect(found('see https://example.com/src/counter.ts for the reason')).toEqual([])
  })

  it('stops after a text full of them, rather than reading a whole essay off disk', () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`).join(' ')

    expect(pathMentions(many)).toHaveLength(32)
  })
})

const link = (text: string, index: number): PathLink => ({
  index,
  text,
  path: text,
  repo: null,
  line: null,
  column: null,
  full: `/repo/${text}`,
  target: { kind: 'place', placeId: 'repo:1', path: text, line: null, column: null },
})

describe('Cutting the text around the links', () => {
  it('keeps every character, with the links in place', () => {
    const segments = pathSegments('see src/a.ts now', [link('src/a.ts', 4)])

    expect(segments).toEqual([
      { text: 'see ' },
      { text: 'src/a.ts', link: expect.objectContaining({ index: 4 }) },
      { text: ' now' },
    ])
  })

  it('drops a link that no longer sits where it says it does', () => {
    expect(pathSegments('nothing here', [link('src/a.ts', 4)])).toEqual([{ text: 'nothing here' }])
  })

  it('shows the whole path on hover, with the line when there is one', () => {
    expect(pathTitle(link('src/a.ts', 0))).toBe('/repo/src/a.ts')
    expect(pathTitle({ ...link('src/a.ts', 0), line: 19 })).toBe('/repo/src/a.ts:19')
  })
})
