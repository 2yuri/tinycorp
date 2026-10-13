import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROVIDER_CATALOGUE,
  PROVIDER_CHOICES,
  PROVIDER_COMMAND,
  PROVIDER_ICON,
  PROVIDER_LABEL,
  PROVIDER_MODELS,
  PROVIDER_SHORT_NAME,
  PROVIDER_SKILLS_FOLDER,
  PROVIDERS,
  type ProviderEntry,
  providerEntry,
  providerTables,
} from '../../shared/domain/providers'
import {
  isConfigured,
  PROVIDER_NAME,
  UNSUPPORTED_PROVIDERS,
  USAGE_PROVIDERS,
  usageList,
} from '../../shared/usage/provider-usage'
import { createProviderUsage } from '../features/usage/provider-usage'
import type { PtySession, PtySpawnOptions } from './provider-adapter'
import { createProviderAdapters } from './provider-registry'

/**
 * The catalogue is the contract a new Provider is written against: an entry, an adapter that
 * passes the conformance suite, and a line in the registry. These tests fail the moment those
 * three fall out of step, so a half-registered Provider never reaches an Employee.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function build() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-registry-'))
  dirs.push(dir)
  const spawned: { file: string; args: string[]; options: PtySpawnOptions }[] = []
  const adapters = createProviderAdapters({
    hookUrl: 'http://127.0.0.1:4555/hook',
    dataDir: join(dir, 'data'),
    env: { PATH: '/usr/bin' },
    installed: () => true,
    spawnPty(file, args, options) {
      spawned.push({ file, args, options })
      const pty: PtySession = {
        write() {},
        onData: () => () => {},
        onExit: () => () => {},
        kill() {},
        resize() {},
      }
      return pty
    },
  })
  return { adapters, spawned, dir }
}

describe('The Provider registry', () => {
  it('builds an adapter for every Provider in the catalogue, and none besides', () => {
    const { adapters } = build()

    expect(Object.keys(adapters).sort()).toEqual([...PROVIDERS].sort())
    for (const provider of PROVIDERS) expect(adapters[provider]).toBeDefined()
  })

  it('runs each Provider’s own command, as the catalogue names it', () => {
    const { adapters, spawned, dir } = build()
    const cwd = mkdtempSync(join(tmpdir(), 'tinycorp-registry-cwd-'))
    dirs.push(cwd)

    for (const provider of PROVIDERS) {
      adapters[provider]!.spawn({
        employee: employee(provider),
        cwd,
        sessionId: '11111111-2222-3333-4444-555555555555',
        hookToken: 'tok-1',
      })
    }

    expect(spawned.map((s) => s.file)).toEqual(PROVIDERS.map((p) => providerEntry(p).command))
    expect(readdirSync(dir)).not.toContain('company')
  })

  it('gives every Provider a name, a command and at least one model, with model ids unique', () => {
    const ids = PROVIDER_CATALOGUE.flatMap((entry) => entry.models.map((m) => m.id))

    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of PROVIDER_CATALOGUE) {
      expect(entry.name.trim()).not.toBe('')
      expect(entry.command.trim()).not.toBe('')
      expect(entry.models.length).toBeGreaterThan(0)
      for (const model of entry.models) expect(model.label.trim(), model.id).not.toBe('')
      // One entry per (model, effort) pair: two entries for the same pair would draw one row twice
      // in the MODEL menu and two identical segments in EFFORT (T139).
      const pairs = entry.models.map((model) => `${model.model}@${model.effort ?? ''}`)
      expect(new Set(pairs).size, entry.id).toBe(pairs.length)
      // Every entry of one model agrees on its name, because the MODEL menu draws it once.
      for (const model of entry.models) {
        const siblings = entry.models.filter((other) => other.model === model.model)
        expect(new Set(siblings.map((other) => other.label)).size, model.model).toBe(1)
        // A model either takes levels or it takes none: a null beside a word would draw a segment
        // the boss cannot get back to.
        expect(new Set(siblings.map((other) => other.effort === null)).size, model.model).toBe(1)
      }
    }
  })

  it('derives every Provider table from the catalogue, so one entry is the whole edit', () => {
    // If any of these were hand-written beside the catalogue, the next Provider would land in
    // some of them and not others. Asserting them by value is what keeps the entry sufficient.
    expect(PROVIDER_LABEL).toEqual(fromCatalogue((entry) => entry.name))
    expect(PROVIDER_SHORT_NAME).toEqual(fromCatalogue((entry) => entry.shortName))
    expect(PROVIDER_COMMAND).toEqual(fromCatalogue((entry) => entry.command))
    expect(PROVIDER_MODELS).toEqual(fromCatalogue((entry) => entry.models))
    expect(PROVIDER_ICON).toEqual(fromCatalogue((entry) => entry.icon))
    expect(PROVIDER_SKILLS_FOLDER).toEqual(fromCatalogue((entry) => entry.skillsFolder))
    expect(PROVIDER_CHOICES).toEqual(PROVIDER_CATALOGUE.map((entry) => ({ value: entry.id, label: entry.name })))
  })

  /**
   * The promise `docs/providers.md` makes to a stranger, as a test: one entry in the catalogue and
   * the Provider is in the hiring form, on the Usage page and on the drawer's meta strip. The
   * catalogue here is the real one with one more Provider appended — no file in the app is edited,
   * which is the point. If a screen ever hand-writes a Provider beside the catalogue again, one of
   * these three goes red the day the next Provider lands, rather than months later in a bug report.
   */
  describe('with one more Provider in the catalogue and nothing else edited', () => {
    const NEXT: ProviderEntry = {
      id: 'aider',
      name: 'Aider',
      shortName: 'Aider',
      command: 'aider',
      readsUsage: false,
      skillsFolder: null,
      icon: 'terminal',
      auth: { how: 'Its own login', signOut: 'aider logout', signIn: { args: ['login'], steps: [] } },
      maintainer: 'A stranger',
      models: [{ id: 'aider-default-balanced', label: 'Aider', model: 'aider-default', effort: 'medium' }],
    }
    const tables = providerTables([...PROVIDER_CATALOGUE, NEXT])

    it('appears in the hiring form’s Provider select, last, under its own name', () => {
      expect(tables.choices.at(-1)).toEqual({ value: 'aider', label: 'Aider' })
      expect(tables.models['aider']).toEqual(NEXT.models)
    })

    it('appears on the Usage page, ahead of the products with no adapter', () => {
      const usage = usageList(tables)

      expect(usage.ids).toContain('aider')
      expect(usage.names['aider']).toBe('Aider')
      // It is in the catalogue now, so it is no longer one of the products listed without one.
      expect(usage.ids.indexOf('aider')).toBeLessThan(usage.ids.length - UNSUPPORTED_PROVIDERS.length + 1)
    })

    // What the drawer's meta strip then says about it is asserted on the renderer's own side, in
    // `src/renderer/src/employee-drawer/drawer-model.test.ts`: the two processes are two programs
    // and neither test imports the other (T184).
  })

  /**
   * Skills are the one optional part of the contract (T137), and optional is where two halves
   * drift apart: the catalogue says whether a product reads skill folders and the adapter is what
   * puts them there. A Provider that claims a folder and installs nothing hands an Employee a
   * skill it does not have; one that installs into a folder the catalogue calls null tells the
   * boss `— no skills` about an Employee that has them.
   */
  it('implements installSkills exactly where the catalogue names a skills folder', () => {
    const { adapters } = build()

    for (const provider of PROVIDERS) {
      const folder = providerEntry(provider).skillsFolder
      expect(
        typeof adapters[provider]!.installSkills === 'function',
        folder
          ? `${provider} says it reads skills from ${folder} and its adapter installs none`
          : `${provider}'s adapter installs skills and its catalogue entry says it reads none`,
      ).toBe(folder !== null)
    }
  })

  it('carries every Provider onto the Usage page, ahead of the ones it cannot run', () => {
    expect(USAGE_PROVIDERS.slice(0, PROVIDERS.length)).toEqual([...PROVIDERS])
    for (const provider of PROVIDERS) {
      expect(isConfigured(provider)).toBe(true)
      expect(PROVIDER_NAME[provider]).toBe(providerEntry(provider).shortName)
    }
    for (const { id } of UNSUPPORTED_PROVIDERS) expect(isConfigured(id)).toBe(false)
  })

  it('reads a Provider’s usage only where the catalogue says it can', async () => {
    const usage = createProviderUsage({
      claudeCredential: () => Promise.resolve({ login: null, lookedIn: [] }),
      codexCredential: () => Promise.resolve({ login: null, lookedIn: [] }),
      http: () => Promise.reject(new Error('no test may spend the subscription')),
      log: () => {},
    })

    const snapshot = await usage.read()
    for (const provider of PROVIDERS) {
      const row = snapshot.providers.find((p) => p.id === provider)!
      // A Provider with no endpoint says so; one with an endpoint reports what it found there.
      expect(row.problem === 'not-connected').toBe(!providerEntry(provider).readsUsage)
      expect(row.windows).toEqual([])
      expect(row.reason).not.toBe(null)
    }
  })
})

function employee(provider: (typeof PROVIDERS)[number]) {
  return {
    id: 'emp-1',
    name: 'Ada',
    roleId: 'backend',
    title: 'Backend',
    persona: 'You build APIs.',
    capabilities: ['code' as const],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    provider,
    permissionMode: 'skip-permissions' as const,
    model: null,
    overrides: [],
    desk: 0,
    sprite: 0,
    createdAt: '2026-09-17T00:00:00.000Z',
  }
}

function fromCatalogue<T>(read: (entry: ProviderEntry) => T): Record<string, T> {
  return Object.fromEntries(PROVIDER_CATALOGUE.map((entry) => [entry.id, read(entry)]))
}
