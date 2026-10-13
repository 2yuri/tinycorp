import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AI_JAIL_BREW, AI_JAIL_CARGO, AI_JAIL_YAY } from '../../../shared/sandbox'
import { migrate } from '../../core/engine/migrations'
import type { CliOutcome, RunCli } from '../../platform'
import { createSandbox, detectSandbox } from './sandbox'

/**
 * Finding ai-jail where an Employee's Provider really runs (T260).
 *
 * The case worth the test is the Windows one, twice over: a team on Windows **itself** has nothing
 * to install, which is a different sentence from an install that has not happened, and a team
 * inside a distro has to be looked up in **that distro** — the `PATH` the app itself walks is the
 * Windows one, and ai-jail is not on it.
 */

const says = (output: string): Promise<CliOutcome> => Promise.resolve({ kind: 'output', code: 0, output })
const version: RunCli = () => says('ai-jail 2.2.0')

/** A `PATH` with ai-jail on it, and one without. */
const onPath = (command: string) => (command === 'ai-jail' ? '/opt/homebrew/bin/ai-jail' : null)
const nowhere = () => null

const detect = (over: Partial<Parameters<typeof detectSandbox>[0]> = {}) =>
  detectSandbox({
    runCli: version,
    resolve: onPath,
    distro: () => null,
    resolveInDistro: nowhere,
    platform: 'darwin',
    ...over,
  })

describe('where ai-jail stands', () => {
  it('is found, with the version it reports and the path it was found at', async () => {
    expect(await detect()).toEqual({
      state: 'found',
      version: '2.2.0',
      path: '/opt/homebrew/bin/ai-jail',
      lookedIn: ['PATH'],
    })
  })

  it('is missing when nothing on PATH answers, and says where it looked', async () => {
    expect(await detect({ resolve: nowhere })).toEqual({
      state: 'missing',
      version: null,
      path: null,
      lookedIn: ['PATH'],
    })
  })

  it('is missing when the binary answers but names no version, rather than a Found row with a blank', async () => {
    expect((await detect({ runCli: () => says('ai-jail') })).state).toBe('missing')
    expect((await detect({ runCli: () => Promise.resolve({ kind: 'missing' as const }) })).state).toBe('missing')
  })

  it('is unsupported on Windows itself — nothing was looked for, because nothing there could answer', async () => {
    expect(await detect({ platform: 'win32', resolve: onPath })).toEqual({
      state: 'unsupported',
      version: null,
      path: null,
      lookedIn: [],
    })
  })

  /** The Windows `PATH` is not the distro's: looking there would answer for the wrong computer. */
  it('is looked for inside the distro when the team runs in WSL, and never on the Windows PATH', async () => {
    const found = await detect({
      platform: 'win32',
      distro: () => 'Arch',
      resolve: () => '/windows/ai-jail.exe',
      resolveInDistro: (command, distro) => (command === 'ai-jail' && distro === 'Arch' ? '/usr/bin/ai-jail' : null),
    })

    expect(found).toEqual({ state: 'found', version: '2.2.0', path: '/usr/bin/ai-jail', lookedIn: ['Arch PATH'] })
  })

  it('is missing in the distro even where the Windows around it has one', async () => {
    const missing = await detect({
      platform: 'win32',
      distro: () => 'Ubuntu',
      resolve: () => '/windows/ai-jail.exe',
      resolveInDistro: nowhere,
    })

    expect(missing).toEqual({ state: 'missing', version: null, path: null, lookedIn: ['Ubuntu PATH'] })
  })
})

describe('the Company’s switch and the line it is offered', () => {
  const service = (over: Parameters<typeof createSandbox>[0] extends infer T ? Partial<T> : never = {}) => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    return createSandbox({ current: () => db, runCli: version, resolve: onPath, platform: 'darwin', ...over })
  }

  it('is off until the boss turns it on, and a Session is jailed only once both are true', async () => {
    const sandbox = service()
    await sandbox.status()

    expect(sandbox.settings()).toEqual({ enabled: false })
    expect(sandbox.jailed()).toBe(false)

    sandbox.setSettings({ enabled: true })

    expect(sandbox.jailed()).toBe(true)
  })

  it('jails nothing when the boss asked for it and ai-jail is not there to run', async () => {
    const sandbox = service({ resolve: nowhere })
    await sandbox.status()
    sandbox.setSettings({ enabled: true })

    // The switch is the boss's and is kept; what changes is that the Session still starts.
    expect(sandbox.settings()).toEqual({ enabled: true })
    expect(sandbox.jailed()).toBe(false)
  })

  it('offers Homebrew on a Mac, yay on an Arch and Cargo on any other Linux', () => {
    expect(service().install()).toEqual([{ label: 'macOS', command: AI_JAIL_BREW }])
    expect(service({ platform: 'linux', readOsRelease: () => 'ID=arch\n' }).install()).toEqual([
      { label: 'Arch', command: AI_JAIL_YAY },
    ])
    expect(service({ platform: 'linux', readOsRelease: () => 'ID=ubuntu\n' }).install()).toEqual([
      { label: 'Linux', command: AI_JAIL_CARGO },
    ])
  })

  it('offers no line at all on Windows itself, and the distro’s own line when the team is in one', () => {
    expect(service({ platform: 'win32' }).install()).toEqual([])
    expect(service({ platform: 'win32', distro: () => 'Ubuntu' }).install()).toEqual([
      { label: 'Ubuntu', command: AI_JAIL_CARGO },
    ])
  })
})
