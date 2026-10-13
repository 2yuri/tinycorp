import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { WINDOWS_RUNTIME } from '../../shared/platform/wsl'
import { teamForgeRunner } from './run-forge'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn(), spawn: vi.fn() }))

/** A child that says what it was told and then exits, without a process anywhere. */
function fakeChild(output: string, code = 0) {
  const stream = () => Object.assign(new EventEmitter(), { setEncoding: () => {} })
  const stdout = stream()
  const stderr = stream()
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: { on: () => {}, end: () => {} },
    kill: () => {},
  })
  setTimeout(() => {
    stdout.emit('data', output)
    child.emit('close', code)
  }, 0)
  return child
}

/**
 * `gh` and `glab`, run where the team runs (T259).
 *
 * A forge CLI reads and pushes the checkout it is run in, so a checkout inside a distro needs the CLI
 * inside that distro — and the sign-in inside it, because `gh auth login` in Arch and `gh auth login`
 * on Windows are two credentials. Asking the wrong one is the mistake T167 already fixed once for
 * Providers: a card telling the boss to sign in somewhere they already are.
 */
const ARCH_PATH = '/home/b/.local/bin:/usr/bin'

describe('a forge CLI where the team runs', () => {
  it('goes into the distro, with the checkout as the distro names it', async () => {
    const calls: { file: string; args: string[] }[] = []
    vi.mocked(spawn).mockImplementation(((file: string, args: string[]) => {
      calls.push({ file, args })
      return fakeChild('https://github.com/acme/web/pull/7\n')
    }) as never)

    const run = teamForgeRunner(() => ({ kind: 'wsl', distro: 'Arch' }), {
      platform: 'win32',
      loginPath: () => ARCH_PATH,
    })
    const result = await run('gh', ['pr', 'create', '--fill'], { cwd: '\\\\wsl.localhost\\Arch\\home\\b\\acme' })

    expect(result).toMatchObject({ code: 0 })
    expect(result.stdout).toContain('/pull/7')
    expect(calls.at(-1)?.file).toBe('wsl.exe')
    expect(calls.at(-1)?.args.slice(0, 4)).toEqual(['-d', 'Arch', '--cd', '/home/b/acme'])
    expect(calls.at(-1)?.args.slice(-4)).toEqual(['gh', 'pr', 'create', '--fill'])
    // On the distro's own PATH (T258), which is the only place a `gh` in `~/.local/bin` is found —
    // and the only `gh` whose `gh auth login` is the one that can push this branch.
    expect(calls.at(-1)?.args).toContain(`PATH='${ARCH_PATH}'; exec "$0" "$@"`)
  })

  it('is the plain runner when the team runs on this PC, which is every Mac', async () => {
    vi.mocked(spawn).mockClear()
    const run = teamForgeRunner(() => WINDOWS_RUNTIME, { platform: 'win32', loginPath: () => ARCH_PATH })
    // It reaches the real `runForge`, which is `execFile`; the point is that nothing was spawned
    // through `wsl.exe` on the way, because there is no `wsl.exe` to reach on two of three platforms.
    void run('gh', ['--version'], { cwd: '/repo', timeoutMs: 1 })
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  })
})
