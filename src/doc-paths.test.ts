import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every `src/…` path a document writes down is a file or a folder that is there.
 *
 * The documents are the map — `ARCHITECTURE.md` for the modules, `docs/providers.md` and
 * `docs/forges.md` for the two seams, `CONTRIBUTING.md` for what a pull request must contain — and
 * a map that names a folder nobody moved is worse than no map: a stranger follows it, finds
 * nothing, and stops believing the rest of it. T185 to T188 move most of `src/`, so this is what
 * makes a rename land in the prose in the same pull request as the rename (T185).
 *
 * It reads only backticked spans. A path in running prose is a sentence, and a sentence that has
 * gone stale is a different problem; a path inside backticks is the document pointing at a file.
 *
 * The second half of this file is about the two front pages — `README.md` and `docs/README.md`.
 * They are what a stranger reads first, and every link and image in them is relative, so a moved
 * file turns the landing page into a column of 404s that nobody who works here would ever click
 * (T198). Those two are held to every relative link they carry, not only the `src/…` ones, and
 * `docs/README.md` is held to naming every document under `docs/`.
 */

const ROOT = join(import.meta.dirname, '..')

/** The two pages a stranger reads first, and the only ones every relative link of which is checked. */
const FRONT_PAGES = ['README.md', 'docs/README.md']

/** Sanity floor: a check that found no documents passes every path in them. */
const LEAST_DOCUMENTS = 20

/** Folders with no documents of ours in them: dependencies and build output. */
const NOT_OURS = new Set(['node_modules', 'out', 'release', 'dist', '.git', 'coverage', 'test-results'])

/** One document, as this reads it. */
interface Document {
  file: string
  text: string
}

/** One `src/…` path a document points at, and the line it is on. */
interface DocPath {
  line: number
  path: string
}

/** One relative link or image a front page carries, and the line it is on. */
interface DocLink {
  line: number
  target: string
}

describe('Every document', () => {
  it('names a src/ path that is really there', () => {
    const missing = documents().flatMap(({ file, text }) =>
      paths(text)
        .filter(({ path }) => !existsSync(join(ROOT, path)))
        .map(({ line, path }) => `${file}:${line} names \`${path}\`, which is not in the tree`),
    )

    expect(
      missing,
      'a document is the map somebody reads before their first change. Point it at where the file ' +
        'is now, in the pull request that moved it',
    ).toEqual([])
  })

  it('is read as itself, so the check above cannot pass by finding nothing', () => {
    expect(documents().length).toBeGreaterThan(LEAST_DOCUMENTS)
    expect(documents().map(({ file }) => file)).toContain('ARCHITECTURE.md')
    expect(paths('see `src/main/index.ts` and `src/shared/ipc.ts`')).toEqual([
      { line: 1, path: 'src/main/index.ts' },
      { line: 1, path: 'src/shared/ipc.ts' },
    ])
    // A folder counts, and neither its trailing slash nor a line number is part of the name.
    expect(paths('`src/main/providers/`')).toEqual([{ line: 1, path: 'src/main/providers' }])
    expect(paths('thrown at `src/main/index.ts:12`')).toEqual([{ line: 1, path: 'src/main/index.ts' }])
    // Prose, a placeholder and a glob are not a path this can look up.
    expect(paths('the files under src/main are the app')).toEqual([])
    expect(paths('`src/main/providers/<id>/adapter.ts`')).toEqual([])
    expect(paths('`src/**/*.itest.ts`')).toEqual([])
  })
})

describe('A front page', () => {
  it.each(FRONT_PAGES)('%s links and shows only files that are there', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const from = dirname(join(ROOT, file))

    const broken = links(text)
      .filter(({ target }) => !existsSync(join(from, target)))
      .map(({ line, target }) => `${file}:${line} points at ${target}, which is not in the tree`)

    expect(
      broken,
      'the front page is what a stranger reads first, and every link in it is relative. Point it at ' +
        'where the file is now, in the pull request that moved it',
    ).toEqual([])
  })

  it('reads links as itself, so the check above cannot pass by finding nothing', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(links(readme).map(({ target }) => target)).toContain('LICENSE')
    expect(links(readme).map(({ target }) => target)).toContain('docs/readme/office.png')

    expect(links('[the licence](LICENSE) and <img src="docs/readme/hero.png" alt="x">')).toEqual([
      { line: 1, target: 'LICENSE' },
      { line: 1, target: 'docs/readme/hero.png' },
    ])
    // An anchor on a file is a place in that file; an anchor on its own is a place in this one.
    expect(links('[modules](docs/architecture/modules.md#the-map)')).toEqual([
      { line: 1, target: 'docs/architecture/modules.md' },
    ])
    expect(links('[install](#install)')).toEqual([])
    // Nothing relative about these, so nothing here can look them up.
    expect(links('[pen](https://pen.dev) and [mail](mailto:a@b.c)')).toEqual([])
    expect(links('![badge](https://img.shields.io/badge/license-Apache--2.0-blue.svg)')).toEqual([])
  })

  it('indexes every document under docs/, so a new one is added to the index that names them', () => {
    const index = readFileSync(join(ROOT, 'docs', 'README.md'), 'utf8')
    const linked = new Set(links(index).map(({ target }) => target))

    const unlisted = documents()
      .filter(({ file }) => file.startsWith('docs/') && file !== 'docs/README.md')
      .map(({ file }) => file.slice('docs/'.length))
      .filter((path) => !linked.has(path))

    expect(
      unlisted,
      'docs/README.md is the index of every document in docs/. A document nobody links to from ' +
        'there is one nobody finds',
    ).toEqual([])
  })
})

/**
 * The `src/…` paths a document points at.
 *
 * A path is a backticked span that starts `src/`, with the trailing slash of a folder and the `:12`
 * of a location dropped. Anything holding a placeholder or a glob — `<id>`, `${id}`, `*` — names a
 * shape rather than a file, and there is nothing here to look up.
 */
function paths(text: string): DocPath[] {
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(/`(src\/[^`]+)`/g)].flatMap((match) => {
      const path = (match[1] ?? '').replace(/:\d+$/, '').replace(/\/$/, '')
      return /[<>${}*\s]/.test(path) ? [] : [{ line: index + 1, path }]
    }),
  )
}

/**
 * The relative links and images a front page carries: `[text](target)`, `![alt](target)` and the
 * `src` of the `<img>` tags the header is laid out with.
 *
 * An absolute URL and a `mailto:` are somebody else's to keep working. A bare `#anchor` is a place
 * in this same file; an anchor after a path — `modules.md#the-map` — is a place in *that* file, so
 * the file is what gets looked up. The target is joined against the page's own folder, which is why
 * `docs/README.md` writes `product.md` and the root writes `docs/product.md`.
 */
function links(text: string): DocLink[] {
  return text.split('\n').flatMap((line, index) => {
    const markdown = [...line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/g)]
    const images = [...line.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)]
    return [...markdown, ...images].flatMap((match) => {
      const target = (match[1] ?? '').split('#')[0] ?? ''
      if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return []
      return [{ line: index + 1, target }]
    })
  })
}

/** Every markdown file in the repo that is ours, with `/` on every platform. */
function documents(): Document[] {
  return walk(ROOT, '')
}

function walk(dir: string, prefix: string): Document[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const shown = `${prefix}${name}`
    if (statSync(path).isDirectory()) return NOT_OURS.has(name) ? [] : walk(path, `${shown}/`)
    if (!name.endsWith('.md')) return []
    return [{ file: shown.split(sep).join('/'), text: readFileSync(path, 'utf8') }]
  })
}
