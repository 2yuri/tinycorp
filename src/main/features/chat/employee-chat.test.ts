import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { chatChannels } from '../../../shared/domain/channels'
import { createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryRecents, mcpTransport } from '../../core/testing'
import { createClaudeAdapter } from '../../providers/claude/adapter'
import type { PtySession } from '../../providers/provider-adapter'
import { registerChatIpc } from './ipc'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface McpConfig {
  mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>
}

/**
 * The whole path an Employee's post takes, with only the CLI replaced: the Claude adapter
 * writes the MCP config a real `claude` would load, the test calls `chat_post` with exactly
 * that config, and the boss's chat (over IPC) shows the message.
 */
describe('An Employee posting through its injected MCP config', () => {
  it('shows up in the boss’s chat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'employee-chat-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const spawned: string[][] = []
    let server: CompanyMcpServer | undefined
    const engine = createCompanyEngine({
      recents: inMemoryRecents(),
      providers: {
        claude: createClaudeAdapter({
          hookUrl: 'http://127.0.0.1:9/hook',
          dataDir: join(dir, 'data'),
          env: {},
          // `claude` is never run here: the PTY is fake, so the PATH lookup is answered for it.
          installed: () => true,
          spawnPty(_file, args) {
            spawned.push(args)
            return idlePty()
          },
        }),
      },
      mcpUrl: (companyId) => server!.urlFor(companyId),
    })
    cleanups.push(() => engine.close())
    server = await startCompanyMcpServer(engine)
    cleanups.push(() => server!.close())
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc: IpcHandlerRegistry = {
      handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
    }
    let broadcasts = 0
    registerChatIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
    mkdirSync(join(dir, 'acme'))
    engine.createCompany({ folder: join(dir, 'acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)
    const args = spawned[0]!
    const configFile = args[args.indexOf('--mcp-config') + 1]!
    const { company } = (JSON.parse(readFileSync(configFile, 'utf8')) as McpConfig).mcpServers
    const client = new Client({ name: 'claude-code', version: '0.0.0' })
    await client.connect(mcpTransport(company!.url, company!.headers))
    cleanups.push(() => client.close())
    const before = broadcasts
    const result = await client.callTool({
      name: 'chat_post',
      arguments: { channel: '#tech', text: 'Hello from my terminal' },
    })

    expect(args).toContain('--strict-mcp-config')
    expect(result.isError).toBeFalsy()
    expect(broadcasts).toBeGreaterThan(before)
    expect(await handlers.get(chatChannels.read)!({ channelId: 'tech' })).toMatchObject({
      ok: true,
      value: [{ authorId: ada.id, text: 'Hello from my terminal' }],
    })
  })
})

function idlePty(): PtySession {
  return { write() {}, resize() {}, onData: () => () => {}, onExit: () => () => {}, kill() {} }
}
