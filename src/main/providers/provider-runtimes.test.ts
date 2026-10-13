import { describe, expect, it } from 'vitest'
import type { Provider } from '../../shared/domain/staff'
import { forgetWsl, WSL_PATH_SCRIPT, type WslOutcome, type WslRunner } from '../platform/wsl'
import { LOOPBACK } from '../platform/wsl-network'
import { createProviderRuntimes } from './provider-runtimes'

/**
 * Where each Provider runs on a Windows that has WSL on it (T167), against a fake `wsl.exe`.
 *
 * Nothing here starts a distro and nothing needs a Windows to run on: the machine is entirely in
 * the fixtures, which is the only way this can be a test the Mac and the Windows runner both run.
 */

const CATALOGUE = ['claude', 'codex'] as unknown as Provider[]
const GATEWAY = '172.29.16.1'

function utf16(text: string): WslOutcome {
  return { kind: 'output', code: 0, output: text }
}

/** One distro of the fake machine. */
interface FakeDistro {
  name: string
  running?: boolean
  /** Commands installed in the distro, on the `PATH` the boss's own shell builds — `~/.local/bin`. */
  has?: string[]
  /** Commands a login `sh` finds too, because `/etc/profile` puts them on the path. */
  onProfile?: string[]
  /** Commands only reachable at `/mnt/c/…`: the *Windows* installation, seen from in here. */
  mounted?: string[]
  /** An `~/.zshrc` that never returns, so the `PATH` read times out. */
  hangs?: boolean
}

/** The `PATH` the boss's own shell prints inside a distro — what `sh -lc` alone cannot see. */
const LOGIN_PATH = '/home/b/.local/bin:/usr/bin:/mnt/c/Windows/System32'

/** `command -v 'claude'`, with or without the distro's own `PATH` in front of it. */
const LOOKUP = /^(?:PATH='(?<path>[^']*)'; )?command -v '(?<command>.*)'$/

/**
 * A machine: which distros it has, and which command each of them holds. Every call is recorded,
 * because *how often* a distro is woken is half of what this file is about.
 */
function machine(distros: FakeDistro[]) {
  const asked: string[][] = []
  const run: WslRunner = (args) => {
    asked.push([...args])
    if (args.includes('-l')) {
      const rows = distros.map(
        (d, index) => `${index === 0 ? '*' : ' '} ${d.name}  ${d.running === false ? 'Stopped' : 'Running'}  2`,
      )
      return utf16(`  NAME  STATE  VERSION\r\n${rows.join('\r\n')}\r\n`)
    }
    const distro = distros.find((d) => d.name === args[1])
    const script = args.at(-1) ?? ''
    if (script === WSL_PATH_SCRIPT) {
      if (!distro || distro.hangs) return { kind: 'timeout' }
      return { kind: 'output', code: 0, output: `__TINYCORP_WSL_PATH__${LOGIN_PATH}__TINYCORP_WSL_PATH__` }
    }
    const lookup = LOOKUP.exec(script)
    if (lookup?.groups) {
      const command = lookup.groups['command']!
      // Without the distro's own `PATH` in front of it, only what `/etc/profile` puts there is found.
      const reachable =
        lookup.groups['path'] === undefined ? distro?.onProfile : [...(distro?.has ?? []), ...(distro?.onProfile ?? [])]
      if (reachable?.includes(command)) return utf16(`/home/b/.local/bin/${command}\n`)
      if (distro?.mounted?.includes(command)) return utf16(`/mnt/c/Users/b/AppData/Roaming/npm/${command}\n`)
      return { kind: 'output', code: 1, output: '' }
    }
    return utf16('')
  }
  return { run, asked }
}

function runtimes(options: Parameters<typeof createProviderRuntimes>[0] = {}) {
  forgetWsl()
  return createProviderRuntimes({
    platform: 'win32',
    catalogue: CATALOGUE,
    commandOf: (provider) => provider,
    env: {},
    readConfig: () => null,
    adapterAddress: () => GATEWAY,
    onWindowsPath: () => false,
    ...options,
  })
}

describe('a machine with no WSL', () => {
  it('answers with the Windows PATH and nothing else', () => {
    const service = runtimes({ run: () => ({ kind: 'missing' }), onWindowsPath: (command) => command === 'claude' })
    expect(service.placement('claude' as Provider)).toEqual({
      windows: true,
      distros: [],
      stopped: [],
      chosen: { kind: 'windows' },
      missingAt: null,
      lookedIn: [],
      reach: 'untested',
    })
    expect(service.placement('codex' as Provider).chosen).toBeNull()
  })

  it('binds loopback and nothing else', () => {
    expect(runtimes({ run: () => ({ kind: 'missing' }) }).addresses()).toEqual([LOOPBACK])
  })
})

describe('a CLI that is only inside WSL', () => {
  it('is found there, and that is where its Sessions run', () => {
    const { run } = machine([{ name: 'Ubuntu', has: ['claude'] }])
    const service = runtimes({ run })
    expect(service.placement('claude' as Provider)).toMatchObject({
      windows: false,
      distros: ['Ubuntu'],
      chosen: { kind: 'wsl', distro: 'Ubuntu' },
      lookedIn: ['Windows PATH', 'WSL: Ubuntu'],
    })
  })

  it('is missing when it is in neither place, having been looked for in both', () => {
    const { run } = machine([{ name: 'Ubuntu', has: [] }])
    const service = runtimes({ run })
    const placement = service.placement('claude' as Provider)
    expect(placement.chosen).toBeNull()
    expect(placement.lookedIn).toEqual(['Windows PATH', 'WSL: Ubuntu'])
  })
})

describe('a CLI that is in both places', () => {
  const both = () => machine([{ name: 'Ubuntu', has: ['claude'] }])

  it('runs on Windows until the boss says otherwise', () => {
    const service = runtimes({ run: both().run, onWindowsPath: () => true })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'windows' })
  })

  it('runs where the boss picked', () => {
    const service = runtimes({
      run: both().run,
      onWindowsPath: () => true,
      picked: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
    })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
  })

  /**
   * It used to fall back to Windows here, and that is the bug (T258): a pick is the boss's answer,
   * and a Session started somewhere they did not choose — on the other installation, with the other
   * login — is not a smaller failure than one that did not start. So the place they named comes back
   * as `missingAt`, the card says the Provider is not installed *there*, and nothing starts until
   * they have either installed it there or picked somewhere else.
   */
  it('says a pick the CLI is not in is not installed there, rather than moving the boss', () => {
    const service = runtimes({
      run: both().run,
      onWindowsPath: () => true,
      picked: () => ({ kind: 'wsl', distro: 'Debian' }),
    })
    expect(service.placement('claude' as Provider)).toMatchObject({
      chosen: null,
      missingAt: { kind: 'wsl', distro: 'Debian' },
      // And the CLI really is on Windows, which is what the card offers them instead.
      windows: true,
    })
  })
})

/**
 * *Where the team runs* (T249): the boss's one answer for every Provider, asked on the first
 * launch on Windows. It sits between a Provider's own pick and where the CLI was found, and the
 * three levels are settled in `chooseRuntime`.
 */
describe('the team default', () => {
  const both = () => machine([{ name: 'Ubuntu', has: ['claude', 'codex'] }])

  it('puts a Provider with no pick of its own where the team runs', () => {
    const service = runtimes({
      run: both().run,
      onWindowsPath: () => true,
      teamDefault: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
    })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
    expect(service.runtime('codex' as Provider)).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
  })

  it('loses to the Provider’s own pick, which is the whole point of having both', () => {
    const service = runtimes({
      run: both().run,
      onWindowsPath: () => true,
      teamDefault: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
      picked: (provider) => (provider === ('claude' as Provider) ? { kind: 'windows' } : null),
    })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'windows' })
    expect(service.runtime('codex' as Provider)).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
  })

  /** The machine the boss reported T258 on: WSL chosen, `claude` on Windows, Employees on Windows. */
  it('is not installed there for a CLI that is not there — and never silently Windows', () => {
    // The team runs in Ubuntu; this CLI is only on Windows, and Windows is not what they chose.
    const { run } = machine([{ name: 'Ubuntu', has: ['codex'] }])
    const service = runtimes({
      run,
      onWindowsPath: (command) => command === 'claude',
      teamDefault: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
    })
    expect(service.placement('claude' as Provider)).toMatchObject({
      chosen: null,
      missingAt: { kind: 'wsl', distro: 'Ubuntu' },
    })
    // The Provider that *is* in there is untouched: one CLI missing moves nobody else.
    expect(service.runtime('codex' as Provider)).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
  })

  it('leaves a machine nobody has answered for where the CLIs were found', () => {
    const service = runtimes({ run: both().run, onWindowsPath: () => true })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'windows' })
  })
})

describe('the distros this machine has', () => {
  it('are offered to the first-launch step from the listing the rows were drawn from', () => {
    const { run, asked } = machine([{ name: 'Ubuntu', has: ['claude'] }, { name: 'Debian' }])
    const service = runtimes({ run })
    expect(service.distros().map((distro) => distro.name)).toEqual(['Ubuntu', 'Debian'])
    expect(service.distros()[0]?.default).toBe(true)
    // Listing starts nothing: no distro was asked for a command.
    expect(asked.every((args) => args.includes('-l'))).toBe(true)
  })

  it('are empty off Windows', () => {
    expect(runtimes({ platform: 'darwin', run: () => ({ kind: 'missing' }) }).distros()).toEqual([])
  })
})

describe('a distro that was asleep', () => {
  it('is woken by the probe, and the row is told so', () => {
    const { run } = machine([{ name: 'Ubuntu', running: false, has: ['claude'] }])
    expect(runtimes({ run }).placement('claude' as Provider).stopped).toEqual(['Ubuntu'])
  })
})

describe('what it costs to ask', () => {
  it('stops at the first distro that has the CLI: waking the rest would buy nothing', () => {
    const { run, asked } = machine([
      { name: 'Ubuntu', has: ['claude'] },
      { name: 'Debian', has: ['claude'] },
    ])
    const service = runtimes({ run })
    expect(service.placement('claude' as Provider).distros).toEqual(['Ubuntu'])
    expect(asked.some((args) => args[1] === 'Debian')).toBe(false)
  })

  it('asks each distro once per command, however many times a row is drawn', () => {
    const { run, asked } = machine([{ name: 'Ubuntu', has: ['claude'] }])
    const service = runtimes({ run })
    for (let draw = 0; draw < 5; draw += 1) service.placement('claude' as Provider)
    expect(asked.filter((args) => args.at(-1)?.includes('claude'))).toHaveLength(1)
    // And `wsl.exe -l -v` once, not once per Provider.
    expect(asked.filter((args) => args.includes('-l'))).toHaveLength(1)
  })

  it('asks again after Check again', () => {
    const { run, asked } = machine([{ name: 'Ubuntu', has: ['claude'] }])
    const service = runtimes({ run })
    service.placement('claude' as Provider)
    service.forget()
    service.placement('claude' as Provider)
    expect(asked.filter((args) => args.at(-1)?.includes('claude'))).toHaveLength(2)
  })

  it('re-picks without asking anything: the boss moved a Provider, the machine did not change', () => {
    const { run, asked } = machine([{ name: 'Ubuntu', has: ['claude'] }])
    const service = runtimes({ run, onWindowsPath: () => true })
    service.placement('claude' as Provider)
    const before = asked.length
    service.repick()
    service.placement('claude' as Provider)
    expect(asked).toHaveLength(before)
  })

  it('decides what to bind from the distro list alone, without waking one', () => {
    const { run, asked } = machine([{ name: 'Ubuntu', has: [] }])
    expect(runtimes({ run }).addresses()).toEqual([LOOPBACK, GATEWAY])
    expect(asked.every((args) => args.includes('-l'))).toBe(true)
  })
})

describe('the self-test', () => {
  it('lands on the row of the Provider that runs in the distro', () => {
    const { run } = machine([{ name: 'Ubuntu', has: ['claude'] }])
    const blocked: WslRunner = (args) => (args.at(-1)?.startsWith('curl') ? { kind: 'failed', output: '' } : run(args))
    const service = runtimes({ run: blocked })
    service.test('http://127.0.0.1:4555/health', 'tok', 'x-tinycorp-token')
    expect(service.placement('claude' as Provider).reach).toBe('blocked')
    // A Provider that is nowhere has nothing to test, and says nothing about it.
    expect(service.placement('codex' as Provider).reach).toBe('untested')
  })
})

/**
 * Finding the CLI the way the boss's own shell does (T258).
 *
 * Every case here is a machine where the old lookup answered wrongly and said nothing about it: a
 * distro whose `PATH` only an interactive shell builds, a Windows shim reached over `/mnt`, and a
 * team distro the search stopped short of.
 */
describe('where the lookup looks', () => {
  it('finds a CLI in ~/.local/bin, which only the boss’s own shell has on PATH', () => {
    // `has` is on the interactive PATH and nowhere `/etc/profile` can see — Arch with no ~/.profile.
    const { run, asked } = machine([{ name: 'Arch', has: ['claude'] }])
    const service = runtimes({ run })
    expect(service.placement('claude' as Provider)).toMatchObject({
      distros: ['Arch'],
      chosen: { kind: 'wsl', distro: 'Arch' },
    })
    // The lookup asked the distro for its own PATH before it asked for the command.
    expect(asked.some((args) => args.at(-1) === WSL_PATH_SCRIPT)).toBe(true)
    expect(service.loginPath('Arch')).toBe(LOGIN_PATH)
  })

  it('ignores the Windows npm shim at /mnt/c, which is not a CLI in the distro', () => {
    const { run } = machine([{ name: 'Arch', mounted: ['claude'] }])
    const service = runtimes({ run, onWindowsPath: () => true })
    // Not "found in both", so there is no choice to offer and no distro to run in.
    expect(service.placement('claude' as Provider)).toMatchObject({ distros: [], windows: true })
  })

  it('looks in the team’s distro first, so the search never stops short of it', () => {
    const { run, asked } = machine([
      { name: 'Ubuntu', has: ['claude'] },
      { name: 'Arch', has: ['claude'] },
    ])
    const service = runtimes({ run, teamDefault: () => ({ kind: 'wsl', distro: 'Arch' }) })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'wsl', distro: 'Arch' })
    // Ubuntu is the default distro and has it too, and was never woken: Arch answered first.
    expect(asked.some((args) => args[1] === 'Ubuntu')).toBe(false)
  })

  it('looks in this Provider’s own pick before the team’s distro', () => {
    const { run } = machine([
      { name: 'Ubuntu', has: ['claude'] },
      { name: 'Arch', has: ['claude'] },
    ])
    const service = runtimes({
      run,
      teamDefault: () => ({ kind: 'wsl', distro: 'Arch' }),
      picked: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
    })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'wsl', distro: 'Ubuntu' })
  })

  /** An `~/.zshrc` that waits for a keystroke must not stop the app finding anything at all. */
  it('falls back to today’s login sh when the distro’s shell hangs', () => {
    const { run, asked } = machine([{ name: 'Arch', hangs: true, onProfile: ['claude'], has: ['codex'] }])
    const service = runtimes({ run })
    expect(service.runtime('claude' as Provider)).toEqual({ kind: 'wsl', distro: 'Arch' })
    expect(asked.some((args) => args.at(-1) === "command -v 'claude'")).toBe(true)
    // And what only the interactive shell would have found is missing, which is the cost of the hang.
    expect(service.placement('codex' as Provider).distros).toEqual([])
    expect(service.loginPath('Arch')).toBeNull()
  })
})

/**
 * Where the **team** runs (T259) — the one answer for everything TinyCorp runs that is not a Provider
 * Session: git, `gh`, `rtk`, a repo's run command, a test run.
 *
 * It is not `runtime(provider)`. That one is gated on a CLI being installed somewhere, because a
 * Session cannot start without one; this one is a fact about the machine. A boss who has chosen Arch
 * has chosen it for their git whether or not they have got round to installing `claude` in there.
 */
describe('where the team runs', () => {
  it('is the distro the boss chose', () => {
    const { run } = machine([{ name: 'Arch', has: [] }])
    expect(runtimes({ run, teamDefault: () => ({ kind: 'wsl', distro: 'Arch' }) }).team()).toEqual({
      kind: 'wsl',
      distro: 'Arch',
    })
  })

  it('is Windows when they have chosen nothing', () => {
    const { run } = machine([{ name: 'Arch', has: ['claude'] }])
    expect(runtimes({ run }).team()).toEqual({ kind: 'windows' })
  })

  it('is Windows when the distro they chose is no longer on this machine', () => {
    // Not the stale pick: every command would go to a distro that is not there, which is worse than
    // going to the machine the app itself is running on.
    const { run } = machine([{ name: 'Arch', has: ['claude'] }])
    expect(runtimes({ run, teamDefault: () => ({ kind: 'wsl', distro: 'Debian' }) }).team()).toEqual({
      kind: 'windows',
    })
  })

  it('is Windows on a Mac, whatever a synced profile says', () => {
    const { run } = machine([])
    expect(runtimes({ run, platform: 'darwin', teamDefault: () => ({ kind: 'wsl', distro: 'Arch' }) }).team()).toEqual({
      kind: 'windows',
    })
  })

  it('finds a command where the team runs, and not on the other side', () => {
    const { run } = machine([{ name: 'Arch', has: ['rtk'] }])
    const inArch = runtimes({ run, teamDefault: () => ({ kind: 'wsl', distro: 'Arch' }) })
    expect(inArch.inTeam('rtk')).toBe('/home/b/.local/bin/rtk')
    expect(inArch.inTeam('gh')).toBeNull()
  })

  it('falls back to the Windows PATH when the team runs on Windows', () => {
    const { run } = machine([{ name: 'Arch', has: ['rtk'] }])
    const onWindows = runtimes({ run, onWindowsPath: (command) => command === 'gh' })
    expect(onWindows.inTeam('gh')).toBe('gh')
    // The `rtk` inside Arch is not on the Windows `PATH`, and a hook written with it would name a
    // program that does not exist where the command actually runs (T179).
    expect(onWindows.inTeam('rtk')).toBeNull()
  })
})
