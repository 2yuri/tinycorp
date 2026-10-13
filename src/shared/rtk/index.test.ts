import { describe, expect, it } from 'vitest'
import {
  parseRtkGain,
  RTK_DB_ENV,
  RTK_INSTALL_SCRIPT,
  RTK_MIN_VERSION,
  RTK_NOT_FOUND,
  RTK_TELEMETRY_ENV,
  type RtkStatus,
  rtkChip,
  rtkCompressWords,
  rtkEnv,
  rtkFixCommands,
  rtkHookBadge,
  rtkNewEnough,
  rtkStatusWords,
  rtkTokenCount,
  rtkUsable,
  rtkVersionOf,
  rtkWeekStart,
} from './index'

/**
 * RTK's own words and numbers, read (T179).
 *
 * Everything here is about believing the binary exactly as far as it can be believed: its version
 * string, its JSON, and the one number it reports — which is an estimate, and has to read as one
 * everywhere the boss sees it.
 */

const found: RtkStatus = { state: 'found', version: '0.41.0', path: '/opt/homebrew/bin/rtk', missingIn: [] }

describe('the version RTK reports', () => {
  it('is read out of its own line', () => {
    expect(rtkVersionOf('rtk 0.41.0')).toBe('0.41.0')
    expect(rtkVersionOf('rtk 0.41.0 (abc1234 2026-09-01)\n')).toBe('0.41.0')
  })

  it('is nothing at all when the answer names no version', () => {
    expect(rtkVersionOf('rtk')).toBeNull()
    expect(rtkVersionOf('')).toBeNull()
  })

  it('is new enough only from the first release whose hook runs on every platform', () => {
    expect(rtkNewEnough(RTK_MIN_VERSION)).toBe(true)
    expect(rtkNewEnough('0.37.3')).toBe(true)
    expect(rtkNewEnough('0.41.0')).toBe(true)
    expect(rtkNewEnough('1.0.0')).toBe(true)
    expect(rtkNewEnough('0.37.1')).toBe(false)
    expect(rtkNewEnough('0.28.2')).toBe(false)
    // A version nobody could read is never enough: the hook would be the shell script.
    expect(rtkNewEnough(null)).toBe(false)
  })
})

describe('what the status row says', () => {
  it('names the version and the binary when RTK is here', () => {
    expect(rtkStatusWords(found)).toEqual({ title: 'RTK 0.41.0 found', body: '/opt/homebrew/bin/rtk' })
  })

  it('tells the boss TinyCorp will not install it for them', () => {
    const words = rtkStatusWords(RTK_NOT_FOUND)

    expect(words.title).toBe('RTK isn’t on this computer')
    expect(words.body).toContain('doesn’t install it for you')
  })

  it('names the minimum when what is here is older', () => {
    const words = rtkStatusWords({ state: 'too-old', version: '0.31.0', path: '/usr/bin/rtk', missingIn: [] })

    expect(words.title).toBe('RTK 0.31.0 is too old')
    expect(words.body).toContain(RTK_MIN_VERSION)
  })

  it('names the distro an Employee works in when the RTK it would use is not there', () => {
    const words = rtkStatusWords({
      state: 'missing-in-wsl',
      version: '0.41.0',
      path: 'C:\\rtk.exe',
      missingIn: ['Ubuntu'],
    })

    expect(words.title).toBe('Found on Windows, not in Ubuntu')
    expect(words.body).toContain('run uncompressed')
  })
})

/**
 * `Compress command output` said one of two things for four states: on, or `Available once RTK is
 * found.` — which a Windows Company with RTK on the host and none in its distro read as a switch
 * that does nothing, and a Company on an old RTK read as one that would never come back. Each of
 * the four frames writes its own line (T196).
 */
describe('what the compress switch says it covers', () => {
  it('names the Company it is on for', () => {
    expect(rtkCompressWords(found, 'Tiny Corp')).toContain('Every Employee in Tiny Corp.')
  })

  it('says what would make it available when RTK is not here at all', () => {
    expect(rtkCompressWords(RTK_NOT_FOUND, 'Tiny Corp')).toBe('Available once RTK is found.')
  })

  it('names the version that would turn it on when what is here is older', () => {
    const status: RtkStatus = { state: 'too-old', version: '0.31.0', path: '/usr/bin/rtk', missingIn: [] }

    expect(rtkCompressWords(status, 'Tiny Corp')).toBe(`Available once RTK is ${RTK_MIN_VERSION} or newer.`)
  })

  it('says who it is already on for, and who joins, when only the distro is missing it', () => {
    const status: RtkStatus = {
      state: 'missing-in-wsl',
      version: '0.41.0',
      path: 'C:\\rtk.exe',
      missingIn: ['Ubuntu'],
    }

    expect(rtkCompressWords(status, 'Tiny Corp')).toBe(
      'On for Employees on Windows. Employees in WSL join once RTK is inside Ubuntu.',
    )
  })
})

describe('the lines the boss is offered', () => {
  it('copy the whole install line even where the row prints a shorter one', () => {
    const linux = rtkFixCommands(RTK_NOT_FOUND, 'linux').find((one) => one.label === 'Linux')

    expect(linux?.shown).toBe('curl -fsSL …/install.sh | sh')
    expect(linux?.command, 'a line the boss can read and a line that works must be the same paste').toBe(
      RTK_INSTALL_SCRIPT,
    )
  })

  it('are the three platforms’ own when RTK is nowhere', () => {
    expect(rtkFixCommands(RTK_NOT_FOUND, 'darwin').map((one) => one.command)).toEqual([
      'brew install rtk',
      'winget install rtk-ai.rtk',
      RTK_INSTALL_SCRIPT,
    ])
  })

  it('are this machine’s upgrade when what is here is too old', () => {
    const old: RtkStatus = { state: 'too-old', version: '0.31.0', path: '/usr/bin/rtk', missingIn: [] }

    expect(rtkFixCommands(old, 'darwin')).toEqual([{ label: 'macOS', command: 'brew upgrade rtk' }])
    expect(rtkFixCommands(old, 'win32')).toEqual([{ label: 'Windows', command: 'winget upgrade rtk-ai.rtk' }])
    expect(rtkFixCommands(old, 'linux')).toEqual([
      { label: 'Linux', command: RTK_INSTALL_SCRIPT, shown: expect.stringContaining('install.sh') },
    ])
  })

  it('run inside the distro when that is where RTK is missing', () => {
    const wsl: RtkStatus = { state: 'missing-in-wsl', version: '0.41.0', path: 'C:\\rtk.exe', missingIn: ['Ubuntu'] }

    expect(rtkFixCommands(wsl, 'win32')).toEqual([
      { label: 'Ubuntu', command: RTK_INSTALL_SCRIPT, shown: expect.stringContaining('install.sh') },
    ])
  })

  it('are none at all when RTK is here and current', () => {
    expect(rtkFixCommands(found, 'darwin')).toEqual([])
  })
})

describe('whether a Session can be hooked', () => {
  it('can where RTK is found, and where only a distro is missing it', () => {
    expect(rtkUsable(found)).toBe(true)
    expect(rtkUsable({ ...found, state: 'missing-in-wsl', missingIn: ['Ubuntu'] })).toBe(true)
  })

  it('cannot where RTK is missing or too old', () => {
    expect(rtkUsable(RTK_NOT_FOUND)).toBe(false)
    expect(rtkUsable({ ...found, state: 'too-old' })).toBe(false)
  })
})

describe('the environment a hooked Session carries', () => {
  it('points RTK at this Company’s own history and blocks its ping', () => {
    expect(rtkEnv({ path: '/usr/bin/rtk', dbPath: '/data/rtk/c-1/history.db', ping: false })).toEqual({
      [RTK_DB_ENV]: '/data/rtk/c-1/history.db',
      [RTK_TELEMETRY_ENV]: '1',
    })
  })

  it('lets the ping out only where the boss turned it on', () => {
    const env = rtkEnv({ path: '/usr/bin/rtk', dbPath: '/data/rtk/c-1/history.db', ping: true })

    expect(env[RTK_TELEMETRY_ENV]).toBeUndefined()
    expect(env[RTK_DB_ENV]).toBe('/data/rtk/c-1/history.db')
  })

  it('is empty for a Session that runs with no RTK', () => {
    expect(rtkEnv(null)).toEqual({})
  })
})

describe('what a Provider’s row says', () => {
  const row = { provider: 'claude' as const, name: 'Claude Code', how: 'Bash hook', keepsApprovals: true }

  it('is Hooked when this Company is compressing', () => {
    expect(rtkHookBadge(row, true)).toBe('Hooked')
  })

  it('is Off when it is not', () => {
    expect(rtkHookBadge(row, false)).toBe('Off')
  })

  it('says a product that rewrites nothing is not hooked, on or off', () => {
    const none = { ...row, how: null, keepsApprovals: false }

    expect(rtkHookBadge(none, true)).toBe('Not hooked')
    expect(rtkHookBadge(none, false)).toBe('Not hooked')
  })

  it('says so where an Employee that asks first is left unhooked', () => {
    expect(rtkHookBadge({ ...row, keepsApprovals: false }, true)).toBe('Hooked · not when asking')
  })
})

describe('reading `rtk gain --daily --format json`', () => {
  const gain = JSON.stringify({
    summary: {
      total_commands: 900,
      total_input: 4_000_000,
      total_output: 1_000_000,
      total_saved: 3_000_000,
      avg_savings_pct: 75,
    },
    daily: [
      {
        date: '2026-09-10',
        commands: 100,
        input_tokens: 1_000_000,
        output_tokens: 700_000,
        saved_tokens: 300_000,
        savings_pct: 30,
      },
      {
        date: '2026-09-18',
        commands: 200,
        input_tokens: 1_000_000,
        output_tokens: 300_000,
        saved_tokens: 700_000,
        savings_pct: 70,
      },
      {
        date: '2026-09-20',
        commands: 100,
        input_tokens: 1_000_000,
        output_tokens: 250_000,
        saved_tokens: 750_000,
        savings_pct: 75,
      },
    ],
  })

  it('adds up the days of the window and no others', () => {
    // The week starts on the 17th, so the 10th is another week's and stays out of it.
    expect(parseRtkGain(gain, '2026-09-17')).toEqual({
      cutPercent: 73,
      tokensNotRead: 1_450_000,
      commandsFiltered: 300,
    })
  })

  it('reads the whole summary when no window is asked for', () => {
    expect(parseRtkGain(gain)).toEqual({ cutPercent: 75, tokensNotRead: 3_000_000, commandsFiltered: 900 })
  })

  it('is zero, not nothing, for a week RTK filtered no command in', () => {
    expect(parseRtkGain(gain, '2026-10-01')).toEqual({ cutPercent: 0, tokensNotRead: 0, commandsFiltered: 0 })
  })

  it('reads nothing at all out of an answer that is not this RTK’s JSON', () => {
    // An older RTK that does not take `--format json`, one that printed a warning first, and a
    // binary that is not this RTK: the tab draws no numbers rather than invented ones.
    expect(parseRtkGain('Total commands: 4212')).toBeNull()
    expect(parseRtkGain('[warn] no hook installed\n{"summary":')).toBeNull()
    expect(parseRtkGain('{"ok":true}')).toBeNull()
    expect(parseRtkGain('')).toBeNull()
  })

  it('reads nothing out of a summary whose numbers are not numbers', () => {
    expect(parseRtkGain('{"summary":{"total_commands":"lots","total_input":1,"total_saved":1}}')).toBeNull()
  })
})

describe('the week the tab covers', () => {
  it('starts six days before today, so today is the seventh', () => {
    expect(rtkWeekStart(new Date('2026-09-23T10:00:00Z'))).toBe('2026-09-17')
  })
})

describe('the numbers as they are drawn', () => {
  it('rounds a large count the way the frame does', () => {
    expect(rtkTokenCount(1_800_000)).toBe('1.8M')
    expect(rtkTokenCount(2_000_000)).toBe('2M')
    expect(rtkTokenCount(41_000)).toBe('41K')
    expect(rtkTokenCount(4212)).toBe('4,212')
  })
})

describe('the chip in an Employee’s terminal header', () => {
  const savings = { cutPercent: 68, tokensNotRead: 412_000, commandsFiltered: 1204 }

  it('says what was cut, and calls the number an estimate', () => {
    const chip = rtkChip(savings, true)

    expect(chip?.label).toBe('RTK · 68% cut this session')
    expect(chip?.title).toContain('bytes ÷ 4')
  })

  it('drops “this session” where RTK cannot narrow its history to one', () => {
    expect(rtkChip(savings, false)?.label).toBe('RTK · 68% cut')
  })

  it('is nothing at all with no numbers, or none yet', () => {
    expect(rtkChip(null, true)).toBeNull()
    expect(rtkChip({ cutPercent: 0, tokensNotRead: 0, commandsFiltered: 0 }, true)).toBeNull()
  })
})
