import { describe, expect, it } from 'vitest'
import { shellInvocation } from './shell-command'

/**
 * How one command line starts on each of the three platforms, and inside a distro (T166, T167,
 * T176). Every case is asserted from a fixed platform, so the whole table is checked wherever the
 * suite runs — a test that only says something on the machine it happens to be on says nothing.
 */

const cwd = '/work/acme/worktrees/billing-api/ticket-tc-151'
const WINDOWS_CWD = 'C:\\work\\acme\\worktrees\\billing-api'

describe('Starting a command line', () => {
  it('uses the POSIX shell on macOS and on Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(shellInvocation('pnpm db:migrate', { cwd, platform, env: {} })).toMatchObject({
        file: '/bin/sh',
        args: ['-c', 'pnpm db:migrate'],
        verbatim: false,
        cwd,
      })
    }
  })

  it('uses the command interpreter on Windows, in the form `/s` is defined against', () => {
    const invocation = shellInvocation('pnpm db:migrate', {
      cwd: WINDOWS_CWD,
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    })

    expect(invocation).toMatchObject({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '"pnpm db:migrate"'],
      // Without this, Node re-quotes the line and `cmd` sees something else than what was written.
      verbatim: true,
      cwd: WINDOWS_CWD,
    })
  })

  it('falls back to cmd.exe where a Windows has no ComSpec', () => {
    expect(shellInvocation('pnpm build', { cwd: WINDOWS_CWD, platform: 'win32', env: {} }).file).toBe('cmd.exe')
  })

  it('runs inside the distro when the Employee’s Provider lives in WSL, with the cwd translated', () => {
    const invocation = shellInvocation('pnpm db:migrate', {
      cwd: 'C:\\work\\acme',
      platform: 'win32',
      runtime: { kind: 'wsl', distro: 'Ubuntu' },
      env: {},
    })

    expect(invocation.file).toBe('wsl.exe')
    expect(invocation.args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/work/acme',
      '-e',
      'sh',
      '-lc',
      'exec "$0" "$@"',
      'sh',
      '-c',
      'pnpm db:migrate',
    ])
    // `spawn` still runs on Windows, so it gets the Windows cwd; `--cd` carries the distro's.
    expect(invocation.cwd).toBe('C:\\work\\acme')
  })

  it('names the injected values in WSLENV, so they reach the Linux process at all', () => {
    const invocation = shellInvocation('pnpm db:migrate', {
      cwd: 'C:\\work\\acme',
      platform: 'win32',
      runtime: { kind: 'wsl', distro: 'Ubuntu' },
      env: { ...process.env, DATABASE_URL: 'postgres://app:h7fs8@db/billing' },
    })

    expect(invocation.env['WSLENV']?.split(':')).toContain('DATABASE_URL')
  })

  it('hands the line to the distro exactly as it was written', () => {
    const invocation = shellInvocation('cat C:\\work\\acme\\notes.md', {
      cwd: 'C:\\work\\acme',
      platform: 'win32',
      runtime: { kind: 'wsl', distro: 'Ubuntu' },
      env: {},
    })

    // `translatePaths` rewrites an argument that *is* a path, never one inside a sentence: a
    // command line is the Employee's own text, and rewriting a `C:` in the middle of it is how
    // instructions came out with `/mnt/e/` in them once (see wsl-path.ts). The cwd is what crosses.
    expect(invocation.args.at(-1)).toBe('cat C:\\work\\acme\\notes.md')
    expect(invocation.args).toContain('/mnt/c/work/acme')
  })
})
