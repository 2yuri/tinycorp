import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `pnpm knip` has to answer the same on every machine (T238).
 *
 * knip reads git's ignore rules, and those are not only `.gitignore`: `.git/info/exclude` belongs
 * to the clone, and a desktop agent IDE writes its own scratch paths into it. One line of it,
 * `memory/`, became a pattern matching every folder named `memory`, and took
 * `src/renderer/src/memory` and `src/main/features/memory` out of knip's graph. knip does not say which files it dropped — it
 * said the exports those folders import were unused, and the same commit was red on a laptop and
 * green in CI. `--no-gitignore` is what makes the answer the repo's rather than the clone's.
 *
 * It is safe only while knip looks at nothing that git generates, so that is checked here too:
 * the flag and the reason it costs nothing are one decision, and a `project` glob reaching into
 * `out/` would quietly undo it.
 */
const ROOT = join(import.meta.dirname, '..')

const knipScript = (): string => {
  const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
    .scripts
  return scripts.knip ?? ''
}

/** `knip.json` is jsonc: the comments are the file's own reasons and have to come off to parse it. */
const knipConfig = (): { entry: string[]; project: string[] } => {
  const text = readFileSync(join(ROOT, 'knip.json'), 'utf8')
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as { entry: string[]; project: string[] }
}

/** Every path `.gitignore` keeps out, as a prefix: `out/`, `coverage/`, `e2e/.results/`. */
const ignoredPaths = (): string[] =>
  readFileSync(join(ROOT, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!') && !line.startsWith('*'))
    .map((line) => (line.endsWith('/') ? line : `${line}/`))

describe('pnpm knip', () => {
  it('does not read git ignore rules, so a clone-local exclude cannot drop a folder from the graph', () => {
    expect(knipScript()).toContain('--no-gitignore')
  })

  it('says beside the flag why it is there', () => {
    const reason = readFileSync(join(ROOT, 'knip.json'), 'utf8').split('\n')
    const comment = reason.slice(0, reason.indexOf('{'))
    expect(comment.every((line) => line === '' || line.startsWith('//'))).toBe(true)
    expect(comment.join(' ')).toContain('--no-gitignore')
    expect(comment.join(' ')).toContain('.git/info/exclude')
  })

  it('looks at no path git generates, which is what makes the flag free', () => {
    const { entry, project } = knipConfig()
    const generated = ignoredPaths()
    for (const glob of [...entry, ...project]) {
      // What a glob names before its first wildcard is the deepest folder it is certain to open.
      const literal = `${glob.split('*')[0]}`
      const offender = generated.find((path) => literal.startsWith(path))
      expect(offender, `knip.json's "${glob}" reaches into ${offender}, which git ignores`).toBeUndefined()
    }
  })
})
