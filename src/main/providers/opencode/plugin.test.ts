import { afterEach, describe, expect, it } from 'vitest'
import type { RtkHook } from '../../../shared/rtk'
import { HOOK_TOKEN_ENV } from '../provider-hooks'
import { opencodePluginSource } from './plugin'

/**
 * The OpenCode plugin's command rewrite (T179), run rather than read.
 *
 * OpenCode has no hook file: a plugin is its whole extension surface, so the rewrite lives inside
 * the JavaScript TinyCorp writes into the Company folder. A test that only matched strings in that
 * source would pass on a plugin that throws on load — so this one imports the very module the
 * adapter writes and calls its handler.
 *
 * What it is really about is one promise: **it fails open.** A rewrite that went wrong must cost
 * the Employee its compressed output and never its command.
 */

const rtk: RtkHook = { path: '/opt/homebrew/bin/rtk', dbPath: '/data/rtk/c-1/history.db', ping: false }

/** The plugin the adapter would write, loaded as the module OpenCode loads. */
async function loadPlugin(hook: RtkHook | null): Promise<(input: unknown, output: unknown) => Promise<void>> {
  const source = opencodePluginSource('http://127.0.0.1:4555/hook', hook)
  const module = (await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  )) as {
    TinyCorpStatus: (context: { client: unknown; $: unknown }) => Promise<Record<string, unknown>>
  }
  const handlers = await module.TinyCorpStatus({ client: {}, $: shell })
  return handlers['tool.execute.before'] as (input: unknown, output: unknown) => Promise<void>
}

/** What `$` answers with for the next `rtk rewrite`, and every command it was handed. */
let answer: { stdout?: string; throws?: boolean } = {}
const ran: string[] = []

/** zx's `$`, as OpenCode hands it to a plugin: a tagged template with `.quiet().nothrow()`. */
const shell = (parts: TemplateStringsArray, ...values: unknown[]) => {
  ran.push(parts.reduce((line, part, index) => line + part + (index < values.length ? String(values[index]) : ''), ''))
  if (answer.throws) throw new Error('rtk is gone')
  return { quiet: () => ({ nothrow: () => Promise.resolve({ stdout: answer.stdout ?? '' }) }) }
}

const bash = (command: string) => {
  const args: Record<string, unknown> = { command }
  return { input: { tool: 'bash' }, output: { args }, args }
}

afterEach(() => {
  answer = {}
  ran.length = 0
  delete process.env[HOOK_TOKEN_ENV]
})

describe('the OpenCode plugin’s command rewrite', () => {
  it('replaces the command with what `rtk rewrite` answered', async () => {
    process.env[HOOK_TOKEN_ENV] = 'tok-1'
    const beforeTool = await loadPlugin(rtk)
    const call = bash('git status')
    answer = { stdout: 'rtk git status\n' }

    await beforeTool(call.input, call.output)

    expect(call.args['command']).toBe('rtk git status')
    expect(ran[0]).toBe('/opt/homebrew/bin/rtk rewrite git status')
  })

  it('rewrites the shell tool too, and nothing else', async () => {
    process.env[HOOK_TOKEN_ENV] = 'tok-1'
    const beforeTool = await loadPlugin(rtk)
    answer = { stdout: 'rtk ls' }

    const shellCall = { input: { tool: 'Shell' }, output: { args: { command: 'ls' } } }
    await beforeTool(shellCall.input, shellCall.output)
    expect(shellCall.output.args.command).toBe('rtk ls')

    const edit = { input: { tool: 'edit' }, output: { args: { command: 'ls' } } }
    await beforeTool(edit.input, edit.output)
    expect(edit.output.args.command, 'only a shell command has output for RTK to compress').toBe('ls')
  })

  it('runs the Employee’s own command when `rtk rewrite` fails', async () => {
    process.env[HOOK_TOKEN_ENV] = 'tok-1'
    const beforeTool = await loadPlugin(rtk)
    const call = bash('cargo test')
    answer = { throws: true }

    await expect(beforeTool(call.input, call.output)).resolves.toBeUndefined()

    expect(call.args['command'], 'a rewrite that went wrong costs the compression, never the command').toBe(
      'cargo test',
    )
  })

  it('runs the Employee’s own command when `rtk rewrite` answers with nothing', async () => {
    process.env[HOOK_TOKEN_ENV] = 'tok-1'
    const beforeTool = await loadPlugin(rtk)
    const call = bash('pnpm test')
    // A non-zero exit under `.nothrow()`, an unknown command, a heredoc: RTK prints nothing.
    answer = { stdout: '  \n' }

    await beforeTool(call.input, call.output)

    expect(call.args['command']).toBe('pnpm test')
  })

  it('leaves the command alone when RTK hands the same one back', async () => {
    process.env[HOOK_TOKEN_ENV] = 'tok-1'
    const beforeTool = await loadPlugin(rtk)
    const call = bash('echo hi')
    answer = { stdout: 'echo hi' }

    await beforeTool(call.input, call.output)

    expect(call.args['command']).toBe('echo hi')
  })

  it('runs nothing at all for a Company that is not compressing', async () => {
    process.env[HOOK_TOKEN_ENV] = 'tok-1'
    const beforeTool = await loadPlugin(null)
    const call = bash('git status')
    answer = { stdout: 'rtk git status' }

    await beforeTool(call.input, call.output)

    expect(call.args['command']).toBe('git status')
    expect(ran, 'a plugin written with no RTK must not shell out on every command').toEqual([])
  })

  it('says nothing and rewrites nothing when OpenCode was not started by TinyCorp', async () => {
    // Its own receiver URL, so this is its own module: a data-URL import is cached by its text,
    // and the plugin reads the token once, when it loads.
    const source = opencodePluginSource('http://127.0.0.1:4556/hook', rtk)
    const module = (await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )) as { TinyCorpStatus: (context: { client: unknown; $: unknown }) => Promise<Record<string, unknown>> }

    // No token on the process: the boss's own `opencode` in a Company folder is left alone.
    expect(await module.TinyCorpStatus({ client: {}, $: shell })).toEqual({})
  })
})
