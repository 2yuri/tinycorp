import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../../core/testing'
import { runWithEnvironment } from './env-run'

/**
 * The runner, against a real child process (T176).
 *
 * This is the one part that must be tried for real: the promise every other test rests on is that
 * a value goes into the child and does not come back out, and a fake spawn cannot show that. The
 * "command" is this same Node, running a script written into a temp folder, so it says the same
 * thing on the Windows runner as it does on a Mac.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeFolder(folder)
})

const DATABASE_URL = 'postgres://app:h7fs8@db.internal:5432/billing'

/** A command that runs `source` with this Node, quoted so both `sh` and `cmd.exe` parse it. */
function script(source: string): { command: string; cwd: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'tinycorp-run-'))
  folders.push(cwd)
  writeFileSync(join(cwd, 'script.js'), source)
  return { command: `"${process.execPath}" "${join(cwd, 'script.js')}"`, cwd }
}

const values = [{ name: 'DATABASE_URL', value: DATABASE_URL }]

describe('Running a command with an environment', () => {
  it('puts the values in the child process and redacts them out of what comes back', async () => {
    const { command, cwd } = script('console.log("connecting with " + process.env.DATABASE_URL)')

    const result = await runWithEnvironment({ command, cwd, values })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('connecting with ‹DATABASE_URL›')
    expect(result.stdout).not.toContain('h7fs8')
    expect(result.redacted).toBe(1)
  })

  it('redacts a value the command printed in base64, the way a header carries one', async () => {
    const { command, cwd } = script(
      'console.log("authorization: Basic " + Buffer.from(process.env.DATABASE_URL).toString("base64"))',
    )

    const result = await runWithEnvironment({ command, cwd, values })

    expect(result.stdout.trim()).toBe('authorization: Basic ‹DATABASE_URL›')
  })

  it('redacts a value written out in pieces, with nothing flushed in between', async () => {
    const { command, cwd } = script(
      `const v = process.env.DATABASE_URL
       for (const part of [v.slice(0, 9), v.slice(9, 20), v.slice(20)]) process.stdout.write(part)
       process.stdout.write("\\n")`,
    )

    const result = await runWithEnvironment({ command, cwd, values })

    expect(result.stdout.trim()).toBe('‹DATABASE_URL›')
  })

  it('redacts the error stream too', async () => {
    const { command, cwd } = script('console.error("failed for " + process.env.DATABASE_URL); process.exit(3)')

    const result = await runWithEnvironment({ command, cwd, values })

    expect(result.exitCode).toBe(3)
    expect(result.stderr.trim()).toBe('failed for ‹DATABASE_URL›')
  })

  it('gives the command the app’s own environment as well, so a PATH still works', async () => {
    const { command, cwd } = script('console.log(process.env.TINYCORP_TEST_MARKER)')

    const result = await runWithEnvironment({
      command,
      cwd,
      values,
      base: { ...process.env, TINYCORP_TEST_MARKER: 'from-the-app' },
    })

    expect(result.stdout.trim()).toBe('from-the-app')
  })

  it('stops a command that runs too long, and says so', async () => {
    const { command, cwd } = script('setInterval(() => {}, 1000)')

    const result = await runWithEnvironment({ command, cwd, values, timeoutMs: 300 })

    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  it('is cancellable, and hands back what the command printed first', async () => {
    const { command, cwd } = script('console.log("started"); setInterval(() => {}, 1000)')
    const control = new AbortController()

    const running = runWithEnvironment({ command, cwd, values, signal: control.signal })
    setTimeout(() => control.abort(), 250)
    const result = await running

    expect(result.cancelled).toBe(true)
    expect(result.stdout).toContain('started')
  })

  it('bounds the output, and says it cut it off', async () => {
    const { command, cwd } = script('console.log("x".repeat(20000))')

    const result = await runWithEnvironment({ command, cwd, values, maxBytes: 500 })

    expect(result.truncated).toBe(true)
    expect(result.stdout).toContain('output cut off here')
    expect(result.stdout.length).toBeLessThan(700)
  })

  it('answers with the failure rather than throwing when the command cannot start', async () => {
    const { cwd } = script('')

    const result = await runWithEnvironment({ command: 'this-command-does-not-exist-anywhere', cwd, values })

    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toBe('')
  })
})

describe('Ending a command on each platform', () => {
  it('kills the whole tree on Windows, because the child there is the shell and not the work', async () => {
    const killed: { file: string; args: readonly string[] }[] = []
    const child = {
      pid: 4242,
      stdout: null,
      stderr: null,
      kill: () => killed.push({ file: 'kill()', args: [] }),
      on(event: string, listener: (code: number | null) => void) {
        // Never exits by itself: the timeout is what ends it, which is what is being checked.
        if (event === 'never') listener(null)
      },
    }
    const spawnCommand = ((file: string, args: readonly string[]) => {
      killed.push({ file, args })
      return child
    }) as unknown as NonNullable<Parameters<typeof runWithEnvironment>[0]['spawnCommand']>

    const running = runWithEnvironment({
      command: 'pnpm dev',
      cwd: 'C:\\work',
      values: [],
      platform: 'win32',
      timeoutMs: 10,
      spawnCommand,
    })
    // The promise never settles on its own here; what matters is the call the timeout made.
    await new Promise((resolve) => setTimeout(resolve, 60))
    void running

    expect(killed.at(-1)).toEqual({ file: 'taskkill', args: ['/pid', '4242', '/t', '/f'] })
  })
})
