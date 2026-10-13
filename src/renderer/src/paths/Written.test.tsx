import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PathLink, PathTarget } from '../../../shared/files/path-links'

let WrittenText: typeof import('./Written').WrittenText

beforeAll(async () => {
  // The module reads the preload API when a link is clicked; static rendering never gets that far.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: {} }
  ;({ WrittenText } = await import('./Written'))
})

function link(text: string, index: number, target: PathTarget, line: number | null = null): PathLink {
  return {
    index,
    text,
    path: text,
    repo: null,
    line,
    column: null,
    full: target.kind === 'place' ? `/work/tinycorp/${target.path}` : target.path,
    target,
  }
}

const draw = (text: string, links: PathLink[]) => renderToStaticMarkup(<WrittenText text={text} links={links} />)

describe('The text an Employee wrote', () => {
  it('draws a path inside the Company as a link, with the whole path on hover', () => {
    const markup = draw('I changed src/counter.ts:19 today', [
      link(
        'src/counter.ts:19',
        10,
        { kind: 'place', placeId: 'repo:1', path: 'src/counter.ts', line: 19, column: null },
        19,
      ),
    ])

    // The hook leads the class list, with the link's utilities behind it (T210e).
    expect(markup).toContain('class="path-link ')
    expect(markup).toContain('title="/work/tinycorp/src/counter.ts:19"')
    expect(markup).toContain('src/counter.ts:19')
    expect(markup).toContain('I changed ')
    expect(markup).toContain(' today')
  })

  it('offers Reveal in Finder beside a path from outside the Company, and not beside one inside it', () => {
    const shot = '/Users/yuri/shots/menu-portrait.png'
    const outside = draw(`compare ${shot} please`, [link(shot, 8, { kind: 'outside', path: shot })])
    const inside = draw('README.md', [
      link('README.md', 0, { kind: 'place', placeId: 'repo:1', path: 'README.md', line: null, column: null }),
    ])

    expect(outside).toContain('data-outside="true"')
    expect(outside).toContain(`aria-label="Reveal ${shot} in Finder"`)
    expect(inside).not.toContain('path-link__reveal')
  })

  it('leaves text with no path in it as it was', () => {
    expect(draw('the counter speaks now', [])).toBe('the counter speaks now')
  })

  it('lets the view draw what is left its own way', () => {
    const markup = renderToStaticMarkup(
      <WrittenText
        text="see src/counter.ts for #12"
        links={[
          link('src/counter.ts', 4, {
            kind: 'place',
            placeId: 'repo:1',
            path: 'src/counter.ts',
            line: null,
            column: null,
          }),
        ]}
        plain={(part, key) => <em key={key}>{part}</em>}
      />,
    )

    expect(markup).toContain('<em>see </em>')
    expect(markup).toContain('<em> for #12</em>')
  })
})
