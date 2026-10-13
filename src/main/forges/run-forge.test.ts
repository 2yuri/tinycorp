import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { runForge } from './run-forge'

/**
 * What the forge CLI is handed is its environment, so the CLI under test is one that prints one.
 * Node itself, rather than `/usr/bin/env`, because the same test has to say something on Windows —
 * where there is no such file, and where the variable is spelled `Path` (T166).
 */
const PRINT_ENV = ['-p', 'JSON.stringify(process.env)']

/** The environment the command really ran with, by whatever case this platform names it in. */
function environmentOf(stdout: string): Record<string, string> {
  const printed = JSON.parse(stdout) as Record<string, string>
  return Object.fromEntries(Object.entries(printed).map(([name, value]) => [name.toUpperCase(), value]))
}

describe('Running a forge CLI for real', () => {
  it('lays an adapter\u2019s settings over the app\u2019s environment, keeping the rest of it', async () => {
    const result = await runForge(process.execPath, PRINT_ENV, {
      cwd: tmpdir(),
      env: { TINYCORP_FORGE_SETTING: 'off' },
    })

    expect(result.code).toBe(0)
    const env = environmentOf(result.stdout)
    expect(env['TINYCORP_FORGE_SETTING']).toBe('off')
    // The CLI still finds its own login where the boss put it: the app's own PATH is inherited.
    expect(env['PATH']).toBe(process.env['PATH'])
  })

  it('runs with the app\u2019s environment untouched when an adapter has no settings', async () => {
    const result = await runForge(process.execPath, PRINT_ENV, { cwd: tmpdir() })

    const env = environmentOf(result.stdout)
    expect(env['TINYCORP_FORGE_SETTING']).toBeUndefined()
    expect(env['PATH']).toBe(process.env['PATH'])
  })
})
