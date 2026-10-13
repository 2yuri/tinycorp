import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORGE_CATALOGUE } from '../../shared/forges'

/**
 * No screen names a forge.
 *
 * This is the test behind the promise in `docs/forges.md`: a forge is a catalogue entry, a folder
 * and a registry line, and adding one lights it up on the repo card, in the review and in every
 * sentence the app says about a pull request, with nothing else edited. The moment a screen writes
 * `GitHub` into a label, a mark or a tooltip, that stops being true — the next forge lands in some
 * places and not others, and whoever sent it has no way to know which.
 *
 * It is the same test as `no-provider-names.test.ts`, for the other seam, and the same exemptions:
 * fixtures and tests pin one concrete case, and the capture harnesses under `capture/` draw a
 * screenshot of one, so naming a product there is the point.
 *
 * {@link EXEMPT} is the one list of files that may. It has one entry, and it is not about a repo's
 * forge at all: it is where TinyCorp's own builds are published.
 */

const RENDERER = join(import.meta.dirname, '..')

/**
 * Files that name a forge for a reason that has nothing to do with a Company's repos. TinyCorp
 * itself is released on GitHub, and the update row says so — the app's own home, not a repo's.
 */
const EXEMPT = ['src/renderer/src/updates/update-model.ts', 'src/renderer/src/updates/VersionRow.tsx']

/** Every word that belongs to one forge and to no other: its id, its names, its CLI, its hosts. */
const FORGE_WORDS = FORGE_CATALOGUE.flatMap((entry) => [
  entry.id,
  entry.name,
  entry.shortName,
  entry.command,
  ...entry.hosts,
])

const FORBIDDEN = [...new Set(FORGE_WORDS.map((word) => word.toLowerCase()))].sort()

describe('The renderer', () => {
  it('names no forge: every label, mark and sentence comes from the catalogue', () => {
    const offenders = sources().flatMap(([file, text]) =>
      lines(text)
        .filter(([, line]) => named(line).length > 0)
        .map(([number, line]) => `${file}:${number} names ${named(line).join(', ')} — ${line.trim()}`),
    )

    expect(
      offenders,
      'a screen that names a forge is a screen the next forge does not reach. Read it from `shared/forges.ts` instead: FORGE_LABEL, FORGE_COMMAND, forgeOf, forgeLabelOf, or the refusal the main process already put into words',
    ).toEqual([])
  })

  it('has something to look for, so the check cannot pass by finding nothing', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(2)
    expect(sources().length).toBeGreaterThan(20)
  })
})

/** The words of `line` that belong to a forge, as whole words, case-insensitively. */
function named(line: string): string[] {
  return FORBIDDEN.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line))
}

function lines(text: string): [number, string][] {
  return text.split('\n').map((line, index) => [index + 1, line])
}

/** Every renderer source that ships, as `[path, contents]`. Tests and capture harnesses are not. */
function sources(): [string, string][] {
  return walk(RENDERER).filter(
    ([file]) => !/\.test\.tsx?$/.test(file) && !file.includes('/capture/') && !EXEMPT.includes(file),
  )
}

function walk(root: string, prefix = 'src/renderer'): [string, string][] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    const shown = `${prefix}/${name}`
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, shown)
    if (!/\.tsx?$/.test(name)) return []
    return [[shown, readFileSync(path, 'utf8')] as [string, string]]
  })
}
