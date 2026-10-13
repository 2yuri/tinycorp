/**
 * The Claude loop's Codex twin, against a real `codex` on the developer's or CI's ChatGPT
 * subscription. Slow and it spends usage, so it is not part of `pnpm test`; run it with
 * `pnpm test:claude`. Skipped without a Codex credential.
 *
 * It is deliberately smaller than `real-claude-loop.itest.ts`: the conformance suite already
 * pins what the adapter does, against a fake process. What only a real CLI can answer is whether
 * Codex's own hooks reach the receiver, whether it names its thread, and whether a pushed prompt
 * moves a Session through busy and back to idle. That is all this asks, in one turn.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryRecents } from '../../core/testing'
import { createCodexAdapter } from '../codex/adapter'
import { type HookReceiver, startHookReceiver } from '../hooks/hook-receiver'
import type { HookPayload } from '../provider-adapter'
import { codexCredential, subscriptionEnv } from './codex-credential'

const credential = codexCredential(process.env)
const STARTUP_MS = 3 * 60_000
const TURN_MS = 6 * 60_000

describe.skipIf(!credential)('Real Codex loop', () => {
  let root: string
  let companyFolder: string
  let engine: CompanyEngine | undefined
  let receiver: HookReceiver
  let mcp: CompanyMcpServer
  const hooks: HookPayload[] = []
  let output = ''

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tinycorp-real-codex-'))
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
        codex: createCodexAdapter({
          hookUrl: receiver.url,
          dataDir: join(root, 'app-data'),
          env: subscriptionEnv(process.env),
        }),
      },
      mcpUrl: (companyId) => mcp.urlFor(companyId),
      log: (line) => console.warn(`[engine] ${line}`),
    })
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
        const events = hooks.map((h) => String(h['hookEventName'] ?? h.hook_event_name))
        throw new Error(`Timed out waiting for: ${what}\nhooks: ${events.join(' ')}\nscreen:\n${output.slice(-3000)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  it(
    'starts, hooks back, names its own thread and answers a pushed prompt',
    async () => {
      const app = engine!
      app.createCompany({ folder: companyFolder, name: 'Acme' })
      app.approvals.setLevel('autonomous')
      const ada = app.employees.create({ name: 'Ada', roleId: 'backend', provider: 'codex' })
      app.terminals.attach(ada.id, (data) => {
        output = (output + data).slice(-20_000)
      })

      const { providerSessionId: chosen } = app.sessions.start(ada.id)
      await until(
        'Ada’s Session to become idle after Codex started',
        () => app.sessions.get(ada.id).status === 'idle',
        STARTUP_MS,
      )

      // Codex names its own conversation, so the engine must have adopted the thread id it sent.
      const thread = app.sessions.get(ada.id).providerSessionId
      expect(thread).not.toBeNull()
      expect(thread).not.toBe(chosen)

      expect(app.sessions.pushPrompt(ada.id, '[company] Reply with the single word ACK. Do nothing else.')).toBe(true)
      await until('Ada’s Session to go busy on the pushed prompt', () => app.sessions.get(ada.id).status === 'busy')
      await until('Ada’s Session to idle again when the turn ends', () => app.sessions.get(ada.id).status === 'idle')

      const events = hooks.map((h) => String(h['hookEventName'] ?? h.hook_event_name ?? ''))
      expect(events).toContain('SessionStart')
      expect(events).toContain('Stop')
      expect(app.sessions.stop(ada.id).status).toBe('off')
    },
    STARTUP_MS + 3 * TURN_MS,
  )
})
