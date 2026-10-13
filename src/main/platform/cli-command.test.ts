import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliExists, cliInvocation, forgetCliPaths, resolveCli, windowsQuote } from './cli-command'

/**
 * The bug this file exists for (T166): `where codex` finds `codex.cmd`, so the app said Codex was
 * installed, and then `CreateProcess` refused to start a batch file and every Session on it died.
 * So the two questions are asked of the one helper — is it here, and how is it started — and the
 * answers are held to each other.
 *
 * Windows is asked about on whatever machine the suite runs on: the platform and the environment
 * are both arguments, so the `PATHEXT` walk and the `cmd.exe` wrapping are tested here and proved
 * again on the Windows runner, where the platform is not a parameter at all.
 */

let bin: string

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'cli-command-'))
  forgetCliPaths()
})

afterEach(() => {
  rmSync(bin, { recursive: true, force: true })
  forgetCliPaths()
})

function put(name: string, mode = 0o755): string {
  const path = join(bin, name)
  writeFileSync(path, '')
  chmodSync(path, mode)
  return path
}

const windows = (extra: Record<string, string> = {}) => ({
  PATH: bin,
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS',
  ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  ...extra,
})

describe('resolveCli on Windows', () => {
  it('finds the npm shim `where` finds, as a full path', () => {
    const shim = put('codex.cmd')

    expect(resolveCli('codex', windows(), 'win32')).toBe(shim)
  })

  it('prefers the executable over the batch shim, in PATHEXT order', () => {
    const exe = put('claude.exe')
    put('claude.cmd')

    expect(resolveCli('claude', windows(), 'win32')).toBe(exe)
  })

  it('does not count a PowerShell-only shim as installed', () => {
    put('opencode.ps1')

    expect(resolveCli('opencode', windows(), 'win32')).toBeNull()
    expect(cliExists('opencode', windows(), 'win32')).toBe(false)
  })

  it('does not count a file with no extension, which Windows cannot start', () => {
    put('codex')

    expect(resolveCli('codex', windows(), 'win32')).toBeNull()
  })

  it('takes a command that already carries its extension as written', () => {
    const shim = put('codex.cmd')

    expect(resolveCli('codex.cmd', windows(), 'win32')).toBe(shim)
  })

  it('searches every folder on PATH, and unquotes the ones Windows lets be quoted', () => {
    const second = mkdtempSync(join(tmpdir(), 'cli-command-second-'))
    const shim = join(second, 'glab.cmd')
    writeFileSync(shim, '')

    const env = { ...windows(), PATH: `"${bin}"${delimiter}"${second}"` }
    expect(resolveCli('glab', env, 'win32')).toBe(shim)

    rmSync(second, { recursive: true, force: true })
  })

  it('reads Path as Windows spells it, not only PATH', () => {
    const shim = put('codex.cmd')

    // What a plain copy of `process.env` looks like on Windows: `Path`, `PATHEXT`, `ComSpec`.
    // `process.env` itself would find `PATH` either way; an object copied out of it will not.
    expect(resolveCli('codex', { Path: bin, PathExt: '.EXE;.CMD' }, 'win32')).toBe(shim)
  })

  it('answers again when PATH changes, so installing a CLI mid-session is seen', () => {
    expect(resolveCli('codex', windows(), 'win32')).toBeNull()
    const elsewhere = mkdtempSync(join(tmpdir(), 'cli-command-late-'))
    const shim = join(elsewhere, 'codex.cmd')
    writeFileSync(shim, '')

    expect(resolveCli('codex', { ...windows(), PATH: elsewhere }, 'win32')).toBe(shim)

    rmSync(elsewhere, { recursive: true, force: true })
  })
})

describe('cliInvocation on Windows', () => {
  it('runs a `.cmd` shim through cmd.exe, because CreateProcess cannot start one', () => {
    const shim = put('codex.cmd')

    const invocation = cliInvocation('codex', ['--ask-for-approval', 'on-request'], windows(), 'win32')

    expect(invocation.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(invocation.verbatim).toBe(true)
    expect(invocation.args).toEqual(['/d', '/s', '/c', `"${shim} --ask-for-approval on-request"`])
  })

  it('runs a `.bat` shim the same way', () => {
    const shim = put('thing.bat')

    expect(cliInvocation('thing', [], windows(), 'win32').args[3]).toBe(`"${shim}"`)
  })

  it('starts an `.exe` itself, at its full path and with its arguments untouched', () => {
    const exe = put('claude.exe')

    const invocation = cliInvocation('claude', ['--resume', 'abc'], windows(), 'win32')

    expect(invocation).toEqual({ file: exe, args: ['--resume', 'abc'], verbatim: false })
  })

  it('quotes an argument with spaces, and the shim path when the folder has them', () => {
    const spaced = mkdtempSync(join(tmpdir(), 'cli-command-spaced-'))
    const dir = join(spaced, 'Program Files')
    mkdirSync(dir)
    writeFileSync(join(dir, 'codex.cmd'), '')

    const invocation = cliInvocation(
      'codex',
      ['--append-system-prompt', 'You are Ada, an engineer.'],
      { ...windows(), PATH: dir },
      'win32',
    )

    expect(invocation.args[3]).toBe(`""${join(dir, 'codex.cmd')}" --append-system-prompt "You are Ada, an engineer.""`)

    rmSync(spaced, { recursive: true, force: true })
  })

  it('hands a command it cannot find back as it was, so the spawn fails with ENOENT', () => {
    expect(cliInvocation('nothing', ['x'], windows(), 'win32')).toEqual({
      file: 'nothing',
      args: ['x'],
      verbatim: false,
    })
  })

  it('takes COMSPEC when a machine has moved its command interpreter, in any case', () => {
    put('codex.cmd')

    expect(cliInvocation('codex', [], { ...windows(), ComSpec: 'D:\\tools\\cmd.exe' }, 'win32').file).toBe(
      'D:\\tools\\cmd.exe',
    )
    const shouted = { PATH: bin, PATHEXT: '.CMD', COMSPEC: 'E:\\cmd.exe' }
    expect(cliInvocation('codex', [], shouted, 'win32').file).toBe('E:\\cmd.exe')
  })
})

describe('windowsQuote', () => {
  it('leaves a plain argument alone', () => {
    expect(windowsQuote('--resume')).toBe('--resume')
  })

  it('quotes anything with a space, and the empty argument', () => {
    expect(windowsQuote('two words')).toBe('"two words"')
    expect(windowsQuote('')).toBe('""')
  })

  it('escapes a quote, and doubles the backslashes that lead into one', () => {
    expect(windowsQuote('say "hi"')).toBe('"say \\"hi\\""')
    // The trailing backslash of a quoted argument doubles, or it would escape the closing quote.
    expect(windowsQuote('C:\\Program Files\\')).toBe('"C:\\Program Files\\\\"')
    // Nothing to quote: a path with a trailing backslash needs no quotes and gets none.
    expect(windowsQuote('C:\\path\\')).toBe('C:\\path\\')
  })

  it('quotes the characters cmd would otherwise read as its own', () => {
    expect(windowsQuote('a&b')).toBe('"a&b"')
    expect(windowsQuote('a|b')).toBe('"a|b"')
    expect(windowsQuote('a>b')).toBe('"a>b"')
  })
})

describe('resolveCli off Windows', () => {
  it('finds a command on PATH', () => {
    const tool = put('claude')

    expect(resolveCli('claude', { PATH: bin }, 'darwin')).toBe(tool)
  })

  // Windows has no execute bit and `accessSync(X_OK)` always says yes there, so the question only
  // means something where the bit exists.
  it.skipIf(process.platform === 'win32')('does not count a file nobody can execute', () => {
    put('claude', 0o644)

    expect(resolveCli('claude', { PATH: bin }, 'darwin')).toBeNull()
  })

  it('takes a command that names a path where it points, and nowhere else', () => {
    const tool = put('claude')

    expect(resolveCli(tool, { PATH: '' }, 'darwin')).toBe(tool)
    expect(resolveCli(join(bin, 'nope'), { PATH: bin }, 'darwin')).toBeNull()
  })

  it('never wraps anything in a shell', () => {
    put('claude')

    expect(cliInvocation('claude', ['--resume', 'a b'], { PATH: bin }, 'darwin')).toEqual({
      file: 'claude',
      args: ['--resume', 'a b'],
      verbatim: false,
    })
  })
})
