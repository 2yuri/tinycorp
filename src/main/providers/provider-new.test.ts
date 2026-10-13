import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CATALOGUE,
  createProvider,
  DOCS,
  PROVIDERS,
  pascal,
  REGISTRY,
  TEMPLATE,
  upper,
} from '../../../tools/provider-new.mjs'

/**
 * `pnpm provider:new <id>`, the first move of a Provider pull request.
 *
 * A contributor's first step is a command rather than a copy-paste, because a copy-paste is where
 * "adding a Provider is easy" quietly stops being true: the folder gets renamed and the registry
 * line does not, or the catalogue entry lands and the docs table does not, and nobody finds out
 * until the next Provider. The command writes all of it or none of it.
 *
 * It runs against a copy of this repo's own files in a temp folder, so the test cannot leave a
 * half-registered Provider behind.
 */

const REPO = join(import.meta.dirname, '..', '..', '..')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The Provider folders under `src/main/providers`; the registry and the suite sit beside them. */
function providerFolders(root: string): string[] {
  return readdirSync(join(root, PROVIDERS), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

/** A copy of the four things the command reads, in a folder of its own. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'tinycorp-provider-new-'))
  dirs.push(root)
  for (const file of [CATALOGUE, REGISTRY, DOCS]) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    cpSync(join(REPO, file), join(root, file))
  }
  cpSync(join(REPO, TEMPLATE), join(root, TEMPLATE), { recursive: true })
  return root
}

describe('pnpm provider:new', () => {
  it('writes the folder, the catalogue entry, the registry line and the docs row, and nothing else', () => {
    const root = repo()

    const written = createProvider(root, { id: 'goose', name: 'Goose', command: 'goose' })

    expect(written).toEqual([
      CATALOGUE,
      REGISTRY,
      DOCS,
      `${PROVIDERS}/goose/cli.ts`,
      `${PROVIDERS}/goose/cli-todo.ts`,
      `${PROVIDERS}/goose/adapter.ts`,
      `${PROVIDERS}/goose/adapter.test.ts`,
    ])
    expect(providerFolders(root)).toEqual(['example', 'goose'])
  })

  it('leaves no trace of the template in the folder it copied', () => {
    const root = repo()
    createProvider(root, { id: 'goose', name: 'Goose', command: 'goose' })

    for (const name of readdirSync(join(root, PROVIDERS, 'goose'))) {
      const text = readFileSync(join(root, PROVIDERS, 'goose', name), 'utf8')
      expect(text, `${name} still mentions the template it was copied from`).not.toMatch(/example/i)
      expect(text, `${name} still has a placeholder the command should have replaced`).not.toContain('__')
    }
    const adapter = readFileSync(join(root, PROVIDERS, 'goose', 'adapter.ts'), 'utf8')
    expect(adapter).toContain('export function createGooseAdapter')
    expect(adapter).toContain("import { GOOSE_CLI } from './cli-todo'")
  })

  it('registers it so the app can reach it: catalogue, adapter table and the import above it', () => {
    const root = repo()
    createProvider(root, { id: 'goose', name: 'Goose', command: 'goose' })

    const catalogue = readFileSync(join(root, CATALOGUE), 'utf8')
    expect(catalogue).toContain("id: 'goose'")
    expect(catalogue).toContain("command: 'goose'")
    // On its own line, under the entry before it: a catalogue a contributor has to reformat by
    // hand is one the command did not really write.
    expect(catalogue).toContain("  },\n  {\n    id: 'goose',")
    expect(catalogue).not.toMatch(/}, +{/)
    // Last, so the catalogue's first entry stays the Provider every form starts on.
    expect(catalogue.indexOf("id: 'goose'")).toBeGreaterThan(catalogue.indexOf("id: 'claude'"))

    const registry = readFileSync(join(root, REGISTRY), 'utf8')
    expect(registry).toContain("import { createGooseAdapter } from './goose/adapter'")
    expect(registry).toContain("goose: (options) => createGooseAdapter(shared('goose', options)),")
  })

  it('adds the row a Provider pull request has to include', () => {
    const root = repo()
    createProvider(root, { id: 'goose', name: 'Goose', command: 'goose' })

    const docs = readFileSync(join(root, DOCS), 'utf8')
    expect(docs).toContain('| Goose | `goose` |')
  })

  it('refuses an id that is already a Provider, without writing anything', () => {
    const root = repo()
    const before = readFileSync(join(root, CATALOGUE), 'utf8')

    expect(() => createProvider(root, { id: 'claude', name: 'Claude', command: 'claude' })).toThrow(/already in/)
    expect(readFileSync(join(root, CATALOGUE), 'utf8')).toBe(before)
    expect(providerFolders(root)).toEqual(['example'])
  })

  it('refuses an id whose folder exists, and an id that is not one', () => {
    const root = repo()
    createProvider(root, { id: 'goose', name: 'Goose', command: 'goose' })

    expect(() => createProvider(root, { id: 'goose', name: 'Goose', command: 'goose' })).toThrow(/already/)
    for (const bad of ['', 'Open Code', 'OpenCode', '1code', 'x']) {
      expect(() => createProvider(root, { id: bad, name: 'X', command: 'x' })).toThrow(/is not a Provider id/)
    }
  })

  it('names a dashed id the way TypeScript needs it', () => {
    expect(pascal('open-code')).toBe('OpenCode')
    expect(upper('open-code')).toBe('OPEN_CODE')

    const root = repo()
    createProvider(root, { id: 'open-code', name: 'OpenCode', command: 'open-code' })

    const registry = readFileSync(join(root, REGISTRY), 'utf8')
    expect(registry).toContain("'open-code': (options) => createOpenCodeAdapter(shared('open-code', options)),")
  })
})
