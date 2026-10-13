import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatChannels } from '../../../shared/domain/channels'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryRecents, mcpTransport } from '../../core/testing'
import { createClaudeAdapter, HOOK_TOKEN_ENV } from '../../providers/claude/adapter'
import type { PtySession } from '../../providers/provider-adapter'
import { READY_DELAY_MS } from '../sessions/sessions'
import { registerChatIpc } from './ipc'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface McpConfig {
  mcpServers: Record<string, { url: string; headers: Record<string, string> }>
}

/**
 * The ticket's loop with only the CLI replaced: the boss DMs an idle Employee over IPC,
 * the Claude adapter types the prompt into its PTY, and the Employee answers with `chat_post`
 * over the MCP config it was given. No one touches its terminal.
 */
describe('A DM to an idle Employee', () => {
  it('is typed into its Session and answered in the chat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'employee-dm-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const spawned: { args: string[]; env: Record<string, string>; written: string[] }[] = []
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
          spawnPty(_file, args, { env }) {
            const written: string[] = []
            spawned.push({ args, env, written })
            return recordingPty(written)
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
    registerChatIpc({ ipc, engine, broadcastChanged: () => {} })
    mkdirSync(join(dir, 'acme'))
    engine.createCompany({ folder: join(dir, 'acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const dm = dmChannelId(BOSS, ada.id)

    vi.useFakeTimers()
    engine.sessions.start(ada.id)
    const { args, env, written } = spawned[0]!
    const hook = (event: string) => engine.sessions.receiveHook(env[HOOK_TOKEN_ENV]!, { hook_event_name: event })
    hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)
    await handlers.get(chatChannels.post)!(dm, 'Please fix the login bug')
    const beforeEnter = [...written]
    vi.advanceTimersByTime(250)
    hook('UserPromptSubmit')
    vi.useRealTimers()

    const configFile = args[args.indexOf('--mcp-config') + 1]!
    const { company } = (JSON.parse(readFileSync(configFile, 'utf8')) as McpConfig).mcpServers
    const client = new Client({ name: 'claude-code', version: '0.0.0' })
    await client.connect(mcpTransport(company!.url, company!.headers))
    cleanups.push(() => client.close())
    const result = await client.callTool({
      name: 'chat_post',
      arguments: { channel: '@boss', text: 'On it' },
    })
    hook('Stop')

    expect(beforeEnter).toEqual([
      expect.stringMatching(/^\[company\] DM from boss in @boss: "Please fix the login bug"/),
    ])
    expect(beforeEnter[0]).toContain('chat_post to "@boss"')
    expect(written).toEqual([beforeEnter[0], '\r'])
    expect(result.isError).toBeFalsy()
    expect(await handlers.get(chatChannels.read)!({ channelId: dm })).toMatchObject({
      ok: true,
      value: [
        { authorId: BOSS, text: 'Please fix the login bug' },
        { authorId: ada.id, text: 'On it' },
      ],
    })
    expect(engine.inbox.list(ada.id)).toEqual([expect.objectContaining({ status: 'handled' })])
    expect(engine.inbox.list(ada.id)).toHaveLength(1)
  })
})

function recordingPty(written: string[]): PtySession {
  return {
    write: (data) => void written.push(data),
    resize() {},
    onData: () => () => {},
    onExit: () => () => {},
    kill() {},
  }
}
