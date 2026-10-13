import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No famous person's name in the app, the repo or the frames (T247).
 *
 * Sample data is where real people quietly end up: an assignee in a board fixture, a boss in a
 * settings test, a git author in a repo test. A shipped screenshot of an invented Company then
 * carries somebody's name, and the same name is in the tests that pin the screen. The rule is the
 * boss's and it is standing: the people in this product are invented — Nova, Orion, Vega, Iris,
 * Juno — or they carry a plain first name that belongs to nobody in particular.
 *
 * **This list is a safety net, not a census.** It holds the names that were already in the repo
 * and the ones a tired hand reaches for next; it cannot know the name nobody has typed yet. A
 * green run means none of *these* appeared, not that the repo is clean — that part is still read
 * by a person. Add a name here whenever one is found, rather than only deleting it where it was.
 *
 * A surname alone is listed when it means one person and nothing else; the four whose surname is
 * an ordinary word here are listed in full instead, because `Darwin` is the kernel this app runs
 * on, `jobs` are what CI runs, a supervised ticket `gates` starting work, and `page` is on 1,200
 * lines. `Linus` is listed as a bare given name all the same, because in a repo about coding
 * agents there is only one of him.
 *
 * It reads `src/`, `e2e/` and `docs/` and not the repo root, where `NOTICE` credits the real
 * people and projects this app borrows from — which is the opposite of what this forbids.
 */

const ROOT = join(import.meta.dirname, '..')

/** The folders this holds for: everything that ships, the end-to-end specs and the documents. */
const SCANNED = ['src', 'e2e', 'docs']

const FORBIDDEN = [
  'altman',
  'babbage',
  'beethoven',
  'beyonce',
  'bezos',
  'bill gates',
  'carmack',
  'charles darwin',
  'dijkstra',
  'einstein',
  'feynman',
  'gosling',
  'grace hopper',
  'hawking',
  'hejlsberg',
  'kernighan',
  'knuth',
  'lamarr',
  'larry page',
  'lebron',
  'linus',
  'liskov',
  'lovelace',
  'marie curie',
  'messi',
  'mozart',
  'musk',
  'nadella',
  'picasso',
  'pichai',
  'ritchie',
  'ronaldo',
  'shakespeare',
  'steve jobs',
  'stroustrup',
  'torvalds',
  'turing',
  'zuckerberg',
]

describe('The repo', () => {
  it('names no famous person: the people in the fixtures, the tests and the docs are invented', () => {
    const offenders = sources().flatMap(([file, text]) =>
      lines(text)
        .filter(([, line]) => named(line).length > 0)
        .map(([number, line]) => `${file}:${number} names ${named(line).join(', ')} — ${line.trim()}`),
    )

    expect(
      offenders,
      'the boss’s standing rule: no real or famous person in the app, the repo or the frames. ' +
        'Use an invented name in the style the fixtures already use — Nova, Orion, Vega, Iris, Juno — or a plain first name',
    ).toEqual([])
  })

  it('has something to look for, so the check cannot pass by finding nothing', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(20)
    expect(sources().length).toBeGreaterThan(500)
  })
})

/** The forbidden names `line` holds, as whole words, case-insensitively. */
function named(line: string): string[] {
  return FORBIDDEN.filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(line))
}

function lines(text: string): [number, string][] {
  return text.split('\n').map((line, index) => [index + 1, line])
}

/** Every scanned file as `[path, contents]`. This file is not one: it is the list itself. */
function sources(): [string, string][] {
  return SCANNED.flatMap((folder) => walk(join(ROOT, folder), folder)).filter(
    ([file]) => file !== 'src/no-famous-names.test.ts',
  )
}

function walk(root: string, prefix: string): [string, string][] {
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const path = join(root, name)
      const shown = `${prefix}/${name}`
      if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, shown)
      return /\.(ts|tsx|mts|md|html|css|json)$/.test(name)
        ? [[shown, readFileSync(path, 'utf8')] as [string, string]]
        : []
    })
}
