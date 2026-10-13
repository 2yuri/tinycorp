import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every query parameter a capture harness's README tells you to put on its URL is one the harness
 * reads.
 *
 * A harness ignores a parameter it does not know without a word: the page draws its default, the
 * screenshot comes back, and it is byte-identical to the one without the flag. That is how the
 * preflight README came to promise `&in=settings` — "the small card Company settings draws" — for
 * a card no harness could draw (#315): nothing failed, so nothing said so.
 *
 * Only the README's code blocks are read. They are the commands someone copies; the prose around
 * them may name a parameter a harness used to take, to say it is gone.
 */

const RENDERER = join(import.meta.dirname, '..')

describe('The capture harnesses', () => {
  it('read every query parameter their README tells you to pass', () => {
    const offenders = harnesses().flatMap(({ folder, readme, sources }) => {
      const read = new Set([...sources.matchAll(/\.(?:get|getAll|has)\(\s*'([\w-]+)'\s*\)/g)].map((match) => match[1]!))
      return documented(readme)
        .filter((name) => !read.has(name))
        .map((name) => `${folder}/README.md documents \`${name}=\`, which nothing in ${folder} reads`)
    })

    expect(
      offenders,
      'a parameter the harness ignores draws the default screen and passes for the one asked for. Teach the harness to read it, or take it out of the README',
    ).toEqual([])
  })

  it('has harnesses and documented parameters to check, so the test cannot pass by finding none', () => {
    const all = harnesses()
    expect(all.length).toBeGreaterThan(10)
    expect(all.flatMap(({ readme }) => documented(readme)).length).toBeGreaterThan(10)
  })
})

/** The `name` of every `?name=` and `&name=` inside the README's fenced code blocks. */
function documented(readme: string): string[] {
  const code = readme
    .split(/^```.*$/m)
    .filter((_, index) => index % 2 === 1)
    .join('\n')
  return [...new Set([...code.matchAll(/[?&]([\w-]+)=/g)].map((match) => match[1]!))]
}

interface Harness {
  folder: string
  readme: string
  /** Every TypeScript source in the harness's folder, concatenated. */
  sources: string
}

/** Every folder with `capture` in its name and a README beside its sources. */
function harnesses(root = RENDERER, prefix = 'src/renderer'): Harness[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    const shown = `${prefix}/${name}`
    if (!statSync(path).isDirectory() || name === 'node_modules') return []
    const nested = harnesses(path, shown)
    const readme = join(path, 'README.md')
    if (!name.includes('capture') || !exists(readme)) return nested
    const sources = readdirSync(path)
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => readFileSync(join(path, file), 'utf8'))
      .join('\n')
    return [{ folder: shown, readme: readFileSync(readme, 'utf8'), sources }, ...nested]
  })
}

function exists(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
