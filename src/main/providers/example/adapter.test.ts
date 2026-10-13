import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE } from '../../../shared/domain/providers'
import { onDisk } from '../../core/testing'
import {
  type ConformanceSpec,
  describeProviderConformance,
  type FakeProcess,
  type JsonServer,
  readBackJsonServer,
  runProviderConformance,
} from '../provider-conformance'
import { createExampleAdapter } from './adapter'
import type { ExampleCli } from './cli'
import { EXAMPLE_CLI } from './cli-todo'
import { FILLED_EXAMPLE_CLI } from './filled'

/**
 * The template, driven both ways: red with its holes open, green once they are filled.
 *
 * This is the one test in the repo that watches the conformance suite fail. It is here because
 * the guide promises a stranger two things — that the template compiles and runs, and that the
 * suite tells them in words what is still missing — and both are worth a test rather than a
 * paragraph.
 */

/**
 * The template has no catalogue entry of its own (`pnpm provider:new` writes one for the folder
 * you copy it into), so the suite borrows the first Provider's, for its models alone. Everything
 * the adapter is actually asked about comes from `ExampleCli`.
 */
const borrowed = PROVIDER_CATALOGUE[0]
const borrowedModel = borrowed.models[0]

function exampleSpec(cli: ExampleCli): ConformanceSpec {
  return {
    provider: borrowed.id,
    label: 'example template',
    command: 'example',
    create: (setup) => createExampleAdapter({ ...setup, command: 'example', cli, installed: () => true }),
    instructionsOn: (process) => after(process, '--system-prompt'),
    continues: (process, sessionId) => after(process, '--continue') === sessionId,
    startsFresh: (process) => after(process, '--continue') === null,
    mcpOn(process) {
      const path = after(process, '--mcp-config')
      if (path === null) return null
      const config = JSON.parse(readFileSync(path, 'utf8')) as {
        mcpServers: { company: { url: string; headers: { Authorization: string } } }
      }
      return {
        url: config.mcpServers.company.url,
        token: config.mcpServers.company.headers.Authorization.replace('Bearer ', ''),
      }
    },
    grantedOn(process) {
      const path = after(process, '--mcp-config')
      if (path === null) return []
      const config = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, JsonServer> }
      return Object.entries(config.mcpServers)
        .filter(([name]) => name !== 'company')
        .map(([name, entry]) => readBackJsonServer(name, entry))
    },
    modelOn(process) {
      const model = after(process, '--model')
      return model === null ? null : { model, effort: after(process, '--effort') }
    },
    model: { id: borrowedModel.id, model: borrowedModel.model, effort: borrowedModel.effort },
    signals: {
      ready: { event: 'start', conversation: CONVERSATION },
      busy: { event: 'tool', conversation: CONVERSATION },
      idle: { event: 'done', conversation: CONVERSATION },
      quiet: { event: 'heartbeat', conversation: CONVERSATION },
    },
    asking: {
      hook: { event: 'ask', conversation: CONVERSATION, about: 'edit src/api/usage.ts' },
      what: 'edit src/api/usage.ts',
    },
    resumed: {
      continued: { event: 'start', conversation: CONVERSATION, resumed: true },
      fresh: { event: 'start', conversation: CONVERSATION, resumed: false },
    },
    signalSessionId: CONVERSATION,
    signIn: {
      in: { kind: 'output', code: 0, output: 'Signed in as boss@example.com' },
      out: { kind: 'output', code: 1, output: 'Not signed in.' },
    },
    limit: {
      output: 'Usage limit reached. Resets in 2h 15m.',
      now: '2026-09-21T10:00:00.000Z',
      resetsAt: '2026-09-21T12:15:00.000Z',
    },
    ordinary: 'Reading src/main/engine/providers/example/adapter.ts',
    submit: '\r',
  }
}

const CONVERSATION = 'conv-7'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('The Provider template', () => {
  it('fails the suite while its holes are open, and says which part of the contract each belongs to', async () => {
    const failures = await runProviderConformance(exampleSpec(EXAMPLE_CLI))

    expect(
      failures.length,
      'the template must not pass the suite as it ships — a contributor who copies it and sends it unchanged has to be stopped by a test, not by a reviewer',
    ).toBeGreaterThan(0)
    // Every part of the contract the template leaves open is named by at least one failure.
    expect(new Set(failures.map((failure) => failure.contract))).toEqual(
      new Set([
        'spawn',
        'instructions',
        'isolation',
        'resume',
        'mcp',
        'model',
        'signals',
        'limits',
        'prompt',
        'shutdown',
        'preflight',
      ]),
    )
  })

  it('fails in words a stranger can act on, naming the file to edit', async () => {
    const failures = await runProviderConformance(exampleSpec(EXAMPLE_CLI))

    for (const failure of failures) {
      expect(failure.message, `${failure.contract}: ${failure.title} failed with nothing to read`).not.toBe('')
      // Not a diff of two objects: a sentence, starting with the part of the contract it belongs to.
      expect(failure.message.split('\n')[0], `${failure.contract}: ${failure.title}`).toMatch(/^[a-z]+: .{20,}/)
    }
    const resume = failures.find((failure) => failure.contract === 'resume')!
    expect(resume.message).toContain('providers/example/cli-todo.ts')
    expect(resume.message).toContain('docs/providers.md#resume')
  })

  it('passes the suite once every hole is filled', async () => {
    expect(await runProviderConformance(exampleSpec(FILLED_EXAMPLE_CLI))).toEqual([])
  })

  it('keeps a Session on the boss’s own subscription: no API key reaches the process', () => {
    const spawned: { env: Record<string, string> }[] = []
    const dir = temp()
    const adapter = createExampleAdapter({
      hookUrl: 'http://127.0.0.1:4555/hook',
      dataDir: join(dir, 'data'),
      command: 'example',
      installed: () => true,
      cli: FILLED_EXAMPLE_CLI,
      env: {
        PATH: '/usr/bin',
        EXAMPLE_API_KEY: 'sk-example-1',
        EXAMPLE_AUTH_TOKEN: 'tok-example-1',
        EXAMPLE_SESSION: 'inherited',
        EXAMPLE_HOME: onDisk('/home/boss/.example'),
      },
      spawnPty(_file, _args, options) {
        spawned.push({ env: options.env })
        return {
          write() {},
          onData: () => () => {},
          onExit: () => () => {},
          kill() {},
          resize() {},
        }
      },
    })

    adapter.spawn({
      employee: employee(borrowed.id),
      cwd: dir,
      sessionId: '11111111-2222-3333-4444-555555555555',
      hookToken: 'tok-1',
    })

    const env = spawned[0]!.env
    expect(env['EXAMPLE_API_KEY'], 'an API key on the Session is a PR that gets refused').toBeUndefined()
    expect(env['EXAMPLE_AUTH_TOKEN']).toBeUndefined()
    expect(env['EXAMPLE_SESSION'], 'a Session must not adopt its parent’s conversation').toBeUndefined()
    expect(env['EXAMPLE_HOME'], 'the boss’s login is inherited, never stripped').toBe(onDisk('/home/boss/.example'))
  })
})

// The template, filled in, is what every other Provider's test file looks like.
describeProviderConformance(exampleSpec(FILLED_EXAMPLE_CLI))

/** The value after `flag` on the command line, or null when the flag is not there. */
function after(process: FakeProcess, flag: string): string | null {
  const at = process.args.indexOf(flag)
  return at === -1 ? null : (process.args[at + 1] ?? null)
}

function employee(provider: (typeof PROVIDER_CATALOGUE)[number]['id']) {
  return {
    id: 'emp-1',
    name: 'Ada',
    roleId: 'backend',
    title: 'Backend',
    persona: 'You build APIs.',
    capabilities: ['code' as const],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    provider,
    permissionMode: 'skip-permissions' as const,
    model: null,
    overrides: [],
    desk: 0,
    sprite: 0,
    createdAt: '2026-09-17T00:00:00.000Z',
  }
}

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-example-env-'))
  dirs.push(dir)
  return dir
}
