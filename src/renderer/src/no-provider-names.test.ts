import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE } from '../../shared/domain/providers'
import { UNSUPPORTED_PROVIDERS } from '../../shared/usage/provider-usage'

/**
 * No screen names a Provider.
 *
 * This is the test behind the promise in `docs/providers.md`: a Provider is a catalogue entry, a
 * folder and a registry line, and adding one lights it up in hiring, in the drawer and on the
 * Usage page with nothing else edited. The moment a screen writes `claude` into a default, a
 * label or a tooltip, that stops being true — the next Provider lands in some tables and not
 * others, and whoever sent it has no way to know which.
 *
 * Fixtures and tests are exempt: they exist to pin one concrete case, and the capture harnesses
 * under `capture/` draw a screenshot of one, so naming a product there is the point.
 *
 * Nothing else is. The preflight (T129) was exempt for one release: it asked a single product's CLI
 * whether it was signed in and printed that product's own commands to fix it, which is not
 * something a catalogue entry can supply. T135 moved that question onto the adapter
 * (`ProviderAdapter.checkCli`), so the words arrive in `src/renderer/src/preflight/` as data like
 * every other label, the exemption came out, and this test now covers every screen the app has.
 */

const RENDERER = join(import.meta.dirname, '..')

/** Every word that belongs to one Provider and to no other: its id, its names, its CLI. */
const PROVIDER_WORDS = [
  ...PROVIDER_CATALOGUE.flatMap((entry) => [entry.id, entry.name, entry.shortName, entry.command]),
  ...UNSUPPORTED_PROVIDERS.flatMap((entry) => [entry.id, entry.name]),
]

const FORBIDDEN = [...new Set(PROVIDER_WORDS.map((word) => word.toLowerCase()))].sort()

describe('The renderer', () => {
  it('names no Provider: every label, default and mark comes from the catalogue', () => {
    const offenders = sources().flatMap(([file, text]) =>
      lines(text)
        .filter(([, line]) => named(line).length > 0)
        .map(([number, line]) => `${file}:${number} names ${named(line).join(', ')} — ${line.trim()}`),
    )

    expect(
      offenders,
      'a screen that names a Provider is a screen the next Provider does not reach. Read it from `shared/providers.ts` instead: PROVIDER_LABEL, PROVIDER_COMMAND, PROVIDER_ICON, pickDefaultProvider, or the Usage snapshot the main process already fills in',
    ).toEqual([])
  })

  it('has something to look for, so the check cannot pass by finding nothing', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(3)
    expect(sources().length).toBeGreaterThan(20)
  })
})

/** The words of `line` that belong to a Provider, as whole words, case-insensitively. */
function named(line: string): string[] {
  return FORBIDDEN.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line))
}

function lines(text: string): [number, string][] {
  return text.split('\n').map((line, index) => [index + 1, line])
}

/** Every renderer source that ships, as `[path, contents]`. Tests and capture harnesses are not. */
function sources(): [string, string][] {
  return walk(RENDERER).filter(([file]) => !/\.test\.tsx?$/.test(file) && !file.includes('/capture/'))
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
