// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenedFile } from '../../../shared/files/files'
import type { PathLink } from '../../../shared/files/path-links'

/** What the main process would answer for the text the message carries. */
let links: PathLink[] = []
/** Every path the renderer asked to have read, in order: one read per image, never two. */
const readAt: string[] = []
/** How many times the main process was asked what the links in a piece of text are. */
let asked = 0

let host: HTMLDivElement
let root: Root

function file(overrides: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: 'design/shot.png',
    kind: 'image',
    size: 1024,
    text: null,
    truncated: false,
    lines: null,
    dataUrl: 'data:image/png;base64,AAA',
    language: null,
    changedLines: [],
    change: null,
    digest: null,
    ...overrides,
  }
}

function link(overrides: Partial<PathLink> = {}): PathLink {
  return {
    index: 0,
    text: 'design/shot.png',
    path: 'design/shot.png',
    repo: null,
    line: null,
    column: null,
    full: '/c/web/design/shot.png',
    target: { kind: 'place', placeId: 'repo:r-web', path: 'design/shot.png', line: null, column: null },
    ...overrides,
  }
}

beforeEach(() => {
  // Both the links and the reads are cached in module state for as long as the Company is open,
  // so each test gets its own copy of the module rather than the last test's answers.
  vi.resetModules()
  links = []
  asked = 0
  readAt.splice(0)
  Object.assign(globalThis.window, {
    tinyCorp: {
      company: { onChanged: () => () => {} },
      paths: {
        links: () => {
          asked += 1
          return Promise.resolve({ ok: true, value: links })
        },
        open: (path: string) => {
          readAt.push(path)
          return Promise.resolve({ ok: true, value: file({ path }) })
        },
        reveal: () => Promise.resolve({ ok: true, value: undefined }),
      },
      files: {
        open: (_placeId: string, path: string) => {
          readAt.push(path)
          return Promise.resolve({ ok: true, value: file({ path }) })
        },
      },
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** A fresh module each time: the reads are cached per path for as long as the Company is open. */
async function draw(text: string): Promise<void> {
  const { MessageImages } = await import('./MessageImages')
  await act(async () => {
    root.render(<MessageImages text={text} />)
  })
  // One turn for the links, one for the read they ask for.
  await act(async () => {})
}

describe('An image an Employee only wrote the path of (T236)', () => {
  it('draws it as a thumbnail, read through the place the path is in', async () => {
    links = [link()]
    await draw('The chart is in design/shot.png if you want it.')

    const image = host.querySelector<HTMLImageElement>('[data-ui="Image thumbnail"] img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,AAA')
    expect(image?.getAttribute('alt')).toBe('shot.png')
    expect(readAt).toEqual(['design/shot.png'])
  })

  it('reads a path from outside the Company through the path reader instead', async () => {
    links = [
      link({
        text: '/Users/yuri/shot.png',
        path: '/Users/yuri/shot.png',
        full: '/Users/yuri/shot.png',
        target: { kind: 'outside', path: '/Users/yuri/shot.png' },
      }),
    ]
    await draw('It is at /Users/yuri/shot.png on my machine.')

    expect(readAt).toEqual(['/Users/yuri/shot.png'])
    expect(host.querySelector('[data-ui="Image thumbnail"]')).not.toBeNull()
  })

  it('draws nothing for a path that is not a picture', async () => {
    links = [link({ text: 'src/counter.ts', path: 'src/counter.ts', full: '/c/web/src/counter.ts' })]
    await draw('See src/counter.ts for the rest.')

    expect(readAt).toEqual([])
    expect(host.querySelector('[data-ui="Image thumbnail"]')).toBeNull()
  })

  it('draws the same file named twice only once', async () => {
    links = [link(), link({ index: 40 })]
    await draw('design/shot.png — and again, design/shot.png.')

    expect(host.querySelectorAll('[data-ui="Image thumbnail"]')).toHaveLength(1)
  })
})

describe('What the row asks the main process', () => {
  it('asks what the links are once, however many components draw the same text', async () => {
    links = [link()]
    const { MessageImages } = await import('./MessageImages')
    const text = 'The chart is in design/shot.png if you want it.'
    // The words and the pictures of one message are two components over the same text: the message
    // itself draws it through `Written`, and this row draws the pictures in it.
    await act(async () => {
      root.render(
        <>
          <MessageImages text={text} />
          <MessageImages text={text} />
        </>,
      )
    })
    await act(async () => {})

    expect(asked).toBe(1)
    expect(readAt).toEqual(['design/shot.png'])
  })
})

describe('How many pictures one message draws', () => {
  it('stops at four, so a message full of paths is not a contact sheet', async () => {
    const { imageLinks, MOST_IMAGES } = await import('./MessageImages')
    const many = Array.from({ length: 9 }, (_, i) =>
      link({ index: i, path: `design/${i}.png`, full: `/c/web/design/${i}.png` }),
    )

    expect(imageLinks(many).map((one) => one.path)).toEqual([
      'design/0.png',
      'design/1.png',
      'design/2.png',
      'design/3.png',
    ])
    expect(MOST_IMAGES).toBe(4)
  })
})
