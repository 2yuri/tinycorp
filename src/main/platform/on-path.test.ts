import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliInvocation, forgetCliPaths } from './cli-command'
import { forgetInstalled, onPath } from './on-path'

/**
 * `onPath` is what an Employee's drawer draws "installed" from, and what refuses to start a Session
 * without one. It used to ask `where` on Windows, which answers for shims nothing here can spawn —
 * so the drawer promised a Provider the app could not start (T166). It is the resolver's answer now,
 * and this file holds the promise to the spawn.
 */

let bin: string

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'on-path-'))
  forgetInstalled()
})

afterEach(() => {
  rmSync(bin, { recursive: true, force: true })
  forgetCliPaths()
})

/** A `claude` this platform would really start: an image on Windows, an executable file elsewhere. */
function installClaude(): void {
  const tool = join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude')
  writeFileSync(tool, '')
  chmodSync(tool, 0o755)
}

it('says a command on PATH is here', () => {
  installClaude()

  expect(onPath('claude', { PATH: bin })).toBe(true)
  expect(onPath('nothing', { PATH: bin })).toBe(false)
})

it('answers again for a different PATH, so a CLI installed mid-session is found', () => {
  expect(onPath('claude', { PATH: bin })).toBe(false)
  installClaude()

  // The same PATH: the cached "no" stands until something forgets it.
  expect(onPath('claude', { PATH: bin })).toBe(false)
  forgetInstalled()
  expect(onPath('claude', { PATH: bin })).toBe(true)
})

describe('what it promises the spawn', () => {
  it('never says installed for something the spawn could not start', () => {
    // A PowerShell-only shim: `where codex` finds it, and nothing in TinyCorp runs one.
    writeFileSync(join(bin, 'codex.ps1'), '')
    const env = { PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' }

    // On Windows this is the whole point; off it, the file is not executable either way.
    expect(onPath('codex', env)).toBe(false)
  })

  it('says installed only where the invocation names a real file', () => {
    writeFileSync(join(bin, 'codex.cmd'), '')
    const env = { PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'cmd.exe' }

    const invocation = cliInvocation('codex', [], env, 'win32')
    expect(invocation.args[3]).toContain(join(bin, 'codex.cmd'))
  })
})
