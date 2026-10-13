/**
 * The Claude loop's OpenCode twin, against a real `opencode` on whichever account the developer or
 * CI already signed it in to. Slow and it spends that account's usage, so it is not part of
 * `pnpm test`; run it with `pnpm test:claude`. Skipped on a machine without `opencode` installed,
 * and without a login, so CI spends nothing.
 *
 * It is deliberately small: the conformance suite already pins what the adapter does, against a
 * fake process. What only a real CLI can answer is whether OpenCode loads the plugin TinyCorp
 * writes into the Company folder, whether its events reach the receiver, whether it names its own
 * conversation, and whether a pushed prompt moves a Session through busy and back to idle. That is
 * all the first test asks, in one turn.
 *
 * The second is the reasoning effort (T140). OpenCode takes it as `agent.<name>.variant` in the
 * config, and the only question a fake process cannot answer is whether the real binary reads that
 * key, at that path, off the file TinyCorp wrote — `--variant` is an option of `opencode run`, and
 * this adapter spawns the TUI. So it starts a Session on a model the catalogue names a level for,
 * asks `opencode` itself what it resolved the agent to, and runs a turn at it.
 *
 * What it deliberately does not claim is that the word is a level this model accepts. Nothing
 * validates a variant: 1.18.31 runs `--variant zzz-not-a-variant` without a murmur, at its
 * default. A wrong level is never an error anyone sees — which is the whole reason the catalogue
 * may only hold levels read off `opencode models`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { providerEntry } from '../../../shared/domain/providers'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryRecents } from '../../core/testing'
import { type HookReceiver, startHookReceiver } from '../hooks/hook-receiver'
import { AGENT_NAME, createOpencodeAdapter } from '../opencode/adapter'
import { PLUGIN_PATH, READY_EVENT } from '../opencode/plugin'
import type { HookPayload } from '../provider-adapter'
import { opencodeCredential, subscriptionEnv } from './opencode-credential'

const credential = opencodeCredential(process.env)
const STARTUP_MS = 3 * 60_000
const TURN_MS = 6 * 60_000

/**
 * A catalogue model with a reasoning effort that this machine's OpenCode can actually run.
 *
 * OpenCode fronts several products and only offers the ones the boss signed in to, so the
 * catalogue's `provider/model` has to match a login in `auth.json` — otherwise the Session would
 * fail for a missing account and say nothing about the variant. Null skips the test rather than
 * failing it.
 */
const WITH_VARIANT =
  providerEntry('opencode').models.find(
    (option) => option.effort !== null && (credential?.providers ?? []).includes(option.model.split('/')[0]!),
  ) ?? null

describe.skipIf(!credential)('Real OpenCode loop', () => {
  let root: string
  let companyFolder: string
  let engine: CompanyEngine | undefined
  let receiver: HookReceiver
  let mcp: CompanyMcpServer
  const hooks: HookPayload[] = []
  let output = ''

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tinycorp-real-opencode-'))
    companyFolder = join(root, 'acme')
    mkdirSync(companyFolder)
    receiver = await startHookReceiver((token, payload) => {
      hooks.push(payload)
      engine?.sessions.receiveHook(token, payload)
    })
    mcp = await startCompanyMcpServer({ mcpCaller: (companyId, token) => engine!.mcpCaller(companyId, token) })
    engine = createCompanyEngine({
      recents: inMemoryRecents(),
      providers: {
        opencode: createOpencodeAdapter({
          hookUrl: receiver.url,
          dataDir: join(root, 'app-data'),
          env: subscriptionEnv(process.env),
        }),
      },
      mcpUrl: (companyId) => mcp.urlFor(companyId),
      log: (line) => console.warn(`[engine] ${line}`),
    })
    // Both tests hire into the same Company, so it is opened once here rather than by whichever
    // test happens to run first.
    engine.createCompany({ folder: companyFolder, name: 'Acme' })
    engine.approvals.setLevel('autonomous')
  })

  afterAll(async () => {
    engine?.close()
    await receiver.close()
    await mcp.close()
    rmSync(root, { recursive: true, force: true })
  })

  async function until(what: string, check: () => boolean, timeoutMs = TURN_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!check()) {
      if (Date.now() > deadline) {
        const events = hooks.map((h) => String(h['type'] ?? h.hook_event_name))
        throw new Error(`Timed out waiting for: ${what}\nhooks: ${events.join(' ')}\nscreen:\n${output.slice(-3000)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  it(
    'loads its plugin, hooks back, names its own conversation and answers a pushed prompt',
    async () => {
      const app = engine!
      const ada = app.employees.create({ name: 'Ada', roleId: 'backend', provider: 'opencode' })
      app.terminals.attach(ada.id, (data) => {
        output = (output + data).slice(-20_000)
      })

      const { providerSessionId: chosen } = app.sessions.start(ada.id)
      expect(existsSync(join(companyFolder, PLUGIN_PATH))).toBe(true)
      await until(
        'Ada’s Session to become idle after OpenCode started',
        () => app.sessions.get(ada.id).status === 'idle',
        STARTUP_MS,
      )
      // The ready signal is the plugin's own: OpenCode's own stream says nothing at start-up.
      expect(hooks.map((h) => h['type'])).toContain(READY_EVENT)

      expect(app.sessions.pushPrompt(ada.id, '[company] Reply with the single word ACK. Do nothing else.')).toBe(true)
      await until('Ada’s Session to go busy on the pushed prompt', () => app.sessions.get(ada.id).status === 'busy')
      await until('Ada’s Session to idle again when the turn ends', () => app.sessions.get(ada.id).status === 'idle')

      // OpenCode names its own conversation, so the engine must have adopted the id it sent.
      const conversation = app.sessions.get(ada.id).providerSessionId
      expect(conversation).not.toBeNull()
      expect(conversation).not.toBe(chosen)
      expect(conversation!.startsWith('ses_')).toBe(true)

      const events = hooks.map((h) => String(h['type'] ?? ''))
      expect(events).toContain('session.created')
      expect(events).toContain('session.idle')
      expect(app.sessions.stop(ada.id).status).toBe('off')
    },
    STARTUP_MS + 3 * TURN_MS,
  )

  it.skipIf(!WITH_VARIANT)(
    'starts a Session at the effort the catalogue claims, and takes a turn at it',
    async () => {
      const app = engine!
      const level = WITH_VARIANT!
      // A model id belongs to one Provider, so naming the model is naming OpenCode (T139).
      const grace = app.employees.create({ name: 'Grace', roleId: 'backend', model: level.id })
      app.terminals.attach(grace.id, (data) => {
        output = (output + data).slice(-20_000)
      })

      const { providerSessionId: chosen } = app.sessions.start(grace.id)

      // The config OpenCode was handed, in the app's own folder: the level is here and not on the
      // command line, because `--variant` is an option of `opencode run` and this is the TUI.
      const path = join(root, 'app-data', 'opencode', `${chosen}.json`)
      const config = JSON.parse(readFileSync(path, 'utf8')) as { agent: Record<string, { variant?: string }> }
      expect(config.agent[AGENT_NAME]!.variant).toBe(level.effort)

      // And the same question asked of `opencode` rather than of the file: this is the real binary
      // resolving the agent out of OPENCODE_CONFIG, so it answers whether the key and the path are
      // the ones it reads. It is not a check on the word — nothing is.
      const resolved = JSON.parse(
        execFileSync('opencode', ['debug', 'agent', AGENT_NAME], {
          env: { ...process.env, OPENCODE_CONFIG: path },
          encoding: 'utf8',
        }),
      ) as { variant?: string }
      expect(resolved.variant, 'OpenCode did not read the effort out of the config TinyCorp wrote').toBe(level.effort)

      await until(
        'Grace’s Session to become idle after OpenCode started at the claimed effort',
        () => app.sessions.get(grace.id).status === 'idle',
        STARTUP_MS,
      )
      // And a turn at it, because the config being read is not the whole of it: the Session has
      // to get through a turn with the level set, on the real account.
      expect(app.sessions.pushPrompt(grace.id, '[company] Reply with the single word ACK. Do nothing else.')).toBe(true)
      await until('Grace’s Session to go busy on the pushed prompt', () => app.sessions.get(grace.id).status === 'busy')
      await until('Grace’s turn to end at the claimed effort', () => app.sessions.get(grace.id).status === 'idle')

      expect(app.sessions.stop(grace.id).status).toBe('off')
    },
    STARTUP_MS + 3 * TURN_MS,
  )
})
