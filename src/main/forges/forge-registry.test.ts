import { describe, expect, it } from 'vitest'
import {
  FORGE_CATALOGUE,
  FORGE_COMMAND,
  FORGE_ICON,
  FORGE_LABEL,
  FORGES,
  type ForgeEntry,
  forgeEntry,
  forgeOf,
  forgeOfRemote,
  forgeTables,
  remoteHost,
} from '../../shared/forges'
import type { ForgeAdapter, ForgeAdapterOptions } from '../../shared/forges/adapter'
import { onDisk } from '../core/testing'
import { adapterForRemote, buildForgeAdapters, createForgeAdapters } from './forge-registry'
import { fakeForge } from './testing'

/**
 * The catalogue is the contract a new forge is written against: an entry, an adapter that passes
 * the conformance suite, and a line in the registry. These tests fail the moment those three fall
 * out of step — a catalogued forge with no adapter would attach a repo, draw its mark on the card
 * and then fail when an Employee's work was already done, which is the worst place to find out.
 */

/** A forge nobody has written an adapter for yet, for the checks that need one. */
const GITLAB: ForgeEntry = {
  id: 'gitlab',
  name: 'GitLab',
  shortName: 'GitLab',
  command: 'glab',
  hosts: ['gitlab.com'],
  icon: 'fox',
  auth: { how: 'GitLab account, through `glab auth login`', signOut: 'glab auth logout' },
  maintainer: 'Nobody yet',
}

describe('The forge registry', () => {
  it('builds an adapter for every forge in the catalogue', () => {
    const adapters = createForgeAdapters({ installed: () => true })

    expect(Object.keys(adapters).sort()).toEqual([...FORGES].sort())
    for (const forge of FORGES) {
      const adapter = adapters[forge]!
      expect(typeof adapter.openPullRequest).toBe('function')
      expect(typeof adapter.checkCli).toBe('function')
    }
  })

  it('refuses a catalogue with a forge nobody wrote an adapter for', () => {
    expect(() => buildForgeAdapters([...FORGE_CATALOGUE, GITLAB], { github: () => fakeForge() })).toThrow(
      /No adapter registered for gitlab/,
    )
  })

  it('hands each adapter its own catalogue entry: the command it runs and the name it says', () => {
    const seen: ForgeAdapterOptions[] = []
    const factory = (options: ForgeAdapterOptions): ForgeAdapter => {
      seen.push(options)
      return fakeForge()
    }

    buildForgeAdapters([...FORGE_CATALOGUE, GITLAB], { github: factory, gitlab: factory })

    expect(seen.map((options) => [options.name, options.command])).toEqual([
      ...FORGE_CATALOGUE.map((entry) => [entry.name, entry.command]),
      ['GitLab', 'glab'],
    ])
  })

  it('finds the adapter for a repo by the host of its remote, and none for a host nobody claims', () => {
    const github = fakeForge()
    const adapters = { github }

    expect(adapterForRemote(adapters, 'git@github.com:acme/app.git')).toBe(github)
    expect(adapterForRemote(adapters, 'https://github.com/acme/app')).toBe(github)
    expect(adapterForRemote(adapters, 'https://gitlab.com/acme/app.git')).toBeNull()
    expect(adapterForRemote(adapters, null)).toBeNull()
  })
})

describe('The forge catalogue', () => {
  it('reads a remote’s host however git writes it', () => {
    expect(remoteHost('git@github.com:acme/app.git')).toBe('github.com')
    expect(remoteHost('https://github.com/acme/app.git')).toBe('github.com')
    expect(remoteHost('ssh://git@github.com/acme/app.git')).toBe('github.com')
    expect(remoteHost('github.com/acme/app')).toBe('github.com')
    expect(remoteHost('HTTPS://GitHub.com/acme/app')).toBe('github.com')
    expect(remoteHost(onDisk('/Users/boss/code/app.git'))).toBeNull()
    expect(remoteHost('  ')).toBeNull()
  })

  it('reads which forge a repo is on from its remote, and nothing from a host it does not know', () => {
    expect(forgeOf('git@github.com:acme/app.git')).toBe('github')
    // A self-hosted instance is on a host no entry can list, so it is simply not detected.
    expect(forgeOf('git@github.acme-corp.internal:acme/app.git')).toBeNull()
    expect(forgeOf('https://dev.azure.com/acme/app')).toBeNull()
    expect(forgeOf(null)).toBeNull()
  })

  it('carries a forge nobody has edited a table for, straight out of the catalogue', () => {
    const tables = forgeTables([...FORGE_CATALOGUE, GITLAB])

    expect(tables.forges).toContain('gitlab')
    expect(tables.label['gitlab']).toBe('GitLab')
    expect(tables.command['gitlab']).toBe('glab')
    expect(tables.icon['gitlab']).toBe('fox')
    expect(forgeOfRemote('https://gitlab.com/acme/app', [...FORGE_CATALOGUE, GITLAB])).toBe('gitlab')
  })

  it('keeps the app’s own tables in step with its own catalogue', () => {
    for (const entry of FORGE_CATALOGUE) {
      expect(FORGE_LABEL[entry.id]).toBe(entry.name)
      expect(FORGE_COMMAND[entry.id]).toBe(entry.command)
      expect(FORGE_ICON[entry.id]).toBe(entry.icon)
      expect(forgeEntry(entry.id)).toBe(entry)
      expect(entry.hosts.length).toBeGreaterThan(0)
      expect(entry.hosts).toEqual(entry.hosts.map((host) => host.toLowerCase()))
    }
    expect(new Set(FORGES).size).toBe(FORGES.length)
  })
})
