import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { forgetCliPaths } from './cli-command'
import { nodePtySpawn } from './node-pty-spawn'

/**
 * The one test in the suite that starts a real process in a real pseudo-terminal, and it runs only
 * on Windows (T166).
 *
 * Everything else about the resolver is proved without spawning anything, because the seam exists
 * so no test ever needs a Provider. But the whole point of the resolver is a claim about the
 * operating system — that `CreateProcess` cannot start a `.cmd`, and that `cmd.exe /d /s /c` can —
 * and a claim about the operating system is only worth what a run on that operating system says.
 * So the Windows job spawns a shim of its own making: no Provider, no network, nothing but an echo.
 */

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'node-pty-spawn-'))
  forgetCliPaths()
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
  forgetCliPaths()
})

/** Everything the terminal printed, until the process leaves or `ms` goes by. */
function ran(file: string, args: string[], env: Record<string, string>, ms = 20_000): Promise<string> {
  return new Promise((done) => {
    const session = nodePtySpawn(file, args, { cwd: folder, env, cols: 80, rows: 24 })
    let output = ''
    const stop = setTimeout(() => {
      session.kill()
      done(output)
    }, ms)
    session.onData((data) => (output += data))
    session.onExit(() => {
      clearTimeout(stop)
      done(output)
    })
  })
}

it.runIf(process.platform === 'win32')('runs an npm-style `.cmd` shim, which CreateProcess cannot', async () => {
  // What npm writes for a global install, cut down to the one line that proves it ran.
  writeFileSync(join(folder, 'faux-cli.cmd'), '@echo off\r\necho faux-cli here: %*\r\n')
  const env = { ...process.env, PATH: folder } as Record<string, string>

  const output = await ran('faux-cli', ['--resume', 'a session id'], env)

  expect(output).toContain('faux-cli here:')
  // The argument survived the quoting `cmd.exe` puts it through, spaces and all.
  expect(output).toContain('a session id')
})

it.runIf(process.platform === 'win32')('runs a plain executable without a shell in the way', async () => {
  const env = { ...process.env } as Record<string, string>

  const output = await ran('cmd.exe', ['/d', '/s', '/c', 'echo plain exe'], env)

  expect(output).toContain('plain exe')
})
