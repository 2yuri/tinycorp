import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { RTK_COMMAND, RTK_DB_ENV, RTK_MIN_VERSION, RTK_TELEMETRY_ENV } from '../../../shared/rtk'
import { onDisk } from '../../core/testing'
import type { CliOutcome, RunCli } from '../../platform/run-cli'
import { createRtk, detectRtk, RTK_MIGRATION, type RtkDistro, readRtkSavings } from './rtk'

/**
 * Finding RTK, and what a Company does with it (T179).
 *
 * Nothing here runs a binary. Every answer is a fake, because the two questions the app asks — how
 * old is it, and is it the right `rtk` — are the two the boss's machine can get wrong, and a test
 * that needed the real binary could not ask either of them.
 */

const HERE = onDisk('/opt/homebrew/bin/rtk')

/** What running a CLI said, recorded, so a test can say which question was asked and how. */
function fakeCli(answers: Record<string, CliOutcome>): {
  run: RunCli
  asked: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[]
} {
  const asked: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] = []
  const run: RunCli = (command, args, options) => {
    asked.push({ command, args: [...args], ...(options?.env && { env: options.env }) })
    return Promise.resolve(answers[args[0] ?? ''] ?? { kind: 'missing' })
  }
  return { run, asked }
}

const says = (output: string): CliOutcome => ({ kind: 'output', code: 0, output })

/** An RTK that is here, current, and the right one. */
function workingRtk(version = '0.41.0') {
  return fakeCli({ '--version': says(`rtk ${version}`), gain: says('Usage: rtk gain [OPTIONS]') })
}

function detect(options: {
  run: RunCli
  path?: string | null
  distros?: readonly RtkDistro[]
  platform?: NodeJS.Platform
}) {
  return detectRtk({
    runCli: options.run,
    resolve: () => (options.path === undefined ? HERE : options.path),
    distros: () => options.distros ?? [],
    platform: options.platform ?? 'darwin',
  })
}

describe('finding RTK', () => {
  it('is found when it is on PATH, current and answers to `rtk gain`', async () => {
    const { run, asked } = workingRtk()

    const status = await detect({ run })

    expect(status).toEqual({ state: 'found', version: '0.41.0', path: HERE, missingIn: [] })
    // Both questions go to the binary that was found, not to whatever `rtk` resolves to next time.
    expect(asked.map((one) => one.command)).toEqual([HERE, HERE])
  })

  it('is missing when nothing on PATH answers to it', async () => {
    const { run, asked } = workingRtk()

    expect(await detect({ run, path: null })).toEqual({ state: 'missing', version: null, path: null, missingIn: [] })
    // Nothing was run: there was nothing to run.
    expect(asked).toEqual([])
  })

  it('is missing when the command is there and cannot be run', async () => {
    const { run } = fakeCli({ '--version': { kind: 'missing' } })

    expect((await detect({ run })).state).toBe('missing')
  })

  it('is missing when what is there is the other `rtk` — Rust Type Kit', async () => {
    // The name clash: it answers `--version` perfectly happily and knows no `gain` subcommand.
    const { run } = fakeCli({
      '--version': says('rtk 1.2.0'),
      gain: { kind: 'output', code: 2, output: "error: unrecognized subcommand 'gain'" },
    })

    const status = await detect({ run })

    expect(
      status.state,
      'a binary that does not know `rtk gain` is not this RTK, and hooking it would rewrite nothing',
    ).toBe('missing')
  })

  it('is too old below the first version whose hook is a native binary', async () => {
    const { run } = workingRtk('0.31.0')

    expect(await detect({ run })).toEqual({ state: 'too-old', version: '0.31.0', path: HERE, missingIn: [] })
  })

  it(`is enough from ${RTK_MIN_VERSION} itself`, async () => {
    const { run } = workingRtk(RTK_MIN_VERSION)

    expect((await detect({ run })).state).toBe('found')
  })

  it('names the distros an Employee works in that have no RTK of their own (T167)', async () => {
    const { run } = workingRtk()

    const status = await detect({
      run,
      platform: 'win32',
      distros: [
        { distro: 'Ubuntu', path: null },
        { distro: 'Debian', path: '/home/boss/.local/bin/rtk' },
      ],
    })

    expect(status.state).toBe('missing-in-wsl')
    expect(status.missingIn).toEqual(['Ubuntu'])
  })

  it('is plainly found on a Windows whose distros all have it', async () => {
    const { run } = workingRtk()

    const status = await detect({ run, platform: 'win32', distros: [{ distro: 'Ubuntu', path: '/usr/bin/rtk' }] })

    expect(status.state).toBe('found')
  })
})

describe('what RTK says it saved', () => {
  const gain = JSON.stringify({
    summary: { total_commands: 10, total_input: 100, total_output: 30, total_saved: 70, avg_savings_pct: 70 },
    daily: [
      { date: '2026-09-20', commands: 8, input_tokens: 100, output_tokens: 30, saved_tokens: 70, savings_pct: 70 },
    ],
  })

  it('is read against this Company’s own history file, with the ping blocked', async () => {
    const { run, asked } = fakeCli({ gain: says(gain) })
    const dbPath = onDisk('/data/rtk/c-1/history.db')

    const savings = await readRtkSavings({ runCli: run, path: HERE, dbPath, now: new Date('2026-09-23T00:00:00Z') })

    expect(savings).toEqual({ cutPercent: 70, tokensNotRead: 70, commandsFiltered: 8 })
    expect(asked[0]?.args).toEqual(['gain', '--daily', '--format', 'json'])
    expect(asked[0]?.env?.[RTK_DB_ENV]).toBe(dbPath)
    expect(asked[0]?.env?.[RTK_TELEMETRY_ENV], 'reading a number is not consent to send one').toBe('1')
  })

  it('is nothing at all when RTK could not be asked, or answered with something else', async () => {
    const dead = fakeCli({ gain: { kind: 'timeout' } })
    const noisy = fakeCli({ gain: says('Run some rtk commands to start tracking savings.') })
    const when = { path: HERE, dbPath: onDisk('/data/rtk/c-1/history.db'), now: new Date('2026-09-23T00:00:00Z') }

    expect(await readRtkSavings({ ...when, runCli: dead.run })).toBeNull()
    expect(await readRtkSavings({ ...when, runCli: noisy.run })).toBeNull()
  })
})

/** A Company database with the migration this module owns, and nothing else. */
function companyDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(RTK_MIGRATION.sql)
  return db
}

function service(over: Partial<Parameters<typeof createRtk>[0]> = {}) {
  const db = companyDb()
  const { run } = workingRtk()
  return {
    db,
    rtk: createRtk({
      current: () => db,
      currentId: () => 'c-1',
      dataDir: onDisk('/data/rtk'),
      providers: {},
      runCli: run,
      resolve: () => HERE,
      platform: 'darwin',
      ...over,
    }),
  }
}

describe('what a Company does with RTK', () => {
  it('compresses by default, and never sends RTK’s ping unasked', () => {
    const { rtk } = service()

    expect(rtk.settings()).toEqual({ enabled: true, ping: false })
  })

  it('remembers each switch on its own', () => {
    const { rtk } = service()

    expect(rtk.setSettings({ ping: true })).toEqual({ enabled: true, ping: true })
    expect(rtk.setSettings({ enabled: false })).toEqual({ enabled: false, ping: true })
    expect(rtk.settings()).toEqual({ enabled: false, ping: true })
  })

  it('hands a Session this Company’s own history file, in the app’s folder', async () => {
    const { rtk } = service()
    await rtk.status()

    expect(rtk.hookFor('c-1')).toEqual({
      path: HERE,
      dbPath: join(onDisk('/data/rtk'), 'c-1', 'history.db'),
      ping: false,
    })
  })

  it('hands a Session nothing while nobody has looked for RTK yet', () => {
    const { rtk } = service()

    expect(rtk.hookFor('c-1')).toBeNull()
  })

  it('hands a Session nothing once the Company turns compression off', async () => {
    const { rtk } = service()
    await rtk.status()
    rtk.setSettings({ enabled: false })

    expect(rtk.hookFor('c-1')).toBeNull()
  })

  it('hands a Session nothing when the RTK on this machine is too old', async () => {
    const { run } = workingRtk('0.31.0')
    const { rtk } = service({ runCli: run })
    await rtk.status()

    expect(rtk.hookFor('c-1')).toBeNull()
  })

  it('still hooks the Employees on Windows when only a distro is missing RTK', async () => {
    const { rtk } = service({ platform: 'win32', distros: () => [{ distro: 'Ubuntu', path: null }] })
    await rtk.status()

    expect(rtk.hookFor('c-1')?.path).toBe(HERE)
  })

  it('asks the machine once, and again only when the boss presses Check again', async () => {
    let asks = 0
    const { rtk } = service({
      resolve: () => {
        asks += 1
        return HERE
      },
    })

    await rtk.status()
    await rtk.status()
    expect(asks).toBe(1)

    await rtk.recheck()
    expect(asks).toBe(2)
  })

  it('says a Provider with no command rewrite is not hooked, rather than pretending', () => {
    const { rtk } = service({
      providers: {
        claude: { commandRewriteHook: () => ({ how: 'Bash hook', keepsApprovals: true, install: () => {} }) } as never,
      },
    })
    const rows = rtk.rows()

    expect(rows.find((row) => row.provider === 'claude')?.how).toBe('Bash hook')
    expect(rows.filter((row) => row.how === null).length).toBeGreaterThan(0)
  })

  it('tells whoever is watching when the status or a switch changes', async () => {
    const { rtk } = service()
    let changes = 0
    rtk.onChange(() => (changes += 1))

    await rtk.status()
    rtk.setSettings({ ping: true })

    expect(changes).toBe(2)
  })
})

describe('the command RTK is looked for under', () => {
  it('is the bare name, so the resolver answers the Windows question too', () => {
    // `cli-command.ts` walks PATHEXT: `rtk.exe` on Windows, `rtk` everywhere else.
    expect(RTK_COMMAND).toBe('rtk')
  })
})
