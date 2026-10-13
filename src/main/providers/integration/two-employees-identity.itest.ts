/**
 * T96, against a real `claude` on the developer's or CI's subscription: two Employees of one
 * Company, running at the same time in that Company's folder, each asked who they are and which
 * memory file is theirs. The app used to write both answers into one `<company folder>/CLAUDE.md`,
 * so the last Employee to start owned the file and the rest read its identity. Slow and it spends
 * subscription usage, so it is not part of `pnpm test`; run it with `pnpm test:claude`. Skipped
 * without a credential.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import { GENERATED_INSTRUCTIONS_MARKER } from '../../../shared/session'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryRecents } from '../../core/testing'
import { notesLogFile } from '../../features/sessions/instructions'
import { createClaudeAdapter } from '../claude/adapter'
import { type HookReceiver, startHookReceiver } from '../hooks/hook-receiver'
import { claudeCredential, subscriptionEnv } from './claude-credential'

const credential = claudeCredential(process.env)
const STARTUP_MS = 3 * 60_000
const TURN_MS = 6 * 60_000

/** The identity an earlier build left in the Company folder, and that every Session then read. */
const STALE_NAME = 'Arlo'

/**
 * The identity line on `--append-system-prompt` always carried the name, so asking only for a name
 * does not catch a leaked file: the memory path does. It is per Employee, it lives in the body of
 * the instructions, and under the old shared `CLAUDE.md` both Employees read the same one.
 */
const WHO_ARE_YOU =
  'Reply in this DM with `chat_post`, in one line: your name, your title, and the absolute path of ' +
  'your memory file, copied exactly from your instructions. Call no other tool.'

describe.skipIf(!credential)('Two Employees of one Company, real Claude', () => {
  let root: string
  let companyFolder: string
  let engine: CompanyEngine
  let receiver: HookReceiver
  let mcp: CompanyMcpServer
  const terminals = new Map<string, string>()

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tinycorp-t96-'))
    companyFolder = join(root, 'gabriel')
    mkdirSync(companyFolder)
    // Exactly what the boss's Company folder held: one Employee's instructions, for everyone.
    writeFileSync(
      join(companyFolder, 'CLAUDE.md'),
      `# You are ${STALE_NAME}, PO at Gabriel\n\n${GENERATED_INSTRUCTIONS_MARKER}\n`,
    )
    let started: CompanyEngine | undefined
    receiver = await startHookReceiver((token, payload) => started?.sessions.receiveHook(token, payload))
    mcp = await startCompanyMcpServer({ mcpCaller: (companyId, token) => engine.mcpCaller(companyId, token) })
    engine = createCompanyEngine({
      recents: inMemoryRecents(),
      providers: {
        claude: createClaudeAdapter({
          hookUrl: receiver.url,
          dataDir: join(root, 'app-data'),
          env: subscriptionEnv(process.env),
        }),
      },
      mcpUrl: (companyId) => mcp.urlFor(companyId),
      log: (line) => console.warn(`[engine] ${line}`),
    })
    started = engine
  })

  afterAll(async () => {
    engine?.close()
    await receiver?.close()
    await mcp?.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** Keeps an Employee's terminal output, for failure messages. */
  function watch(employee: Employee): void {
    engine.terminals.attach(employee.id, (data) => {
      terminals.set(employee.id, ((terminals.get(employee.id) ?? '') + data).slice(-8000))
    })
  }

  async function until(what: string, check: () => boolean, timeoutMs = TURN_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!check()) {
      if (Date.now() > deadline) {
        const screens = [...terminals].map(([id, text]) => `--- ${id}\n${stripAnsi(text).slice(-1500)}`)
        throw new Error(`Timed out waiting for: ${what}\n${screens.join('\n')}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  const memoryPath = (employee: Employee) => notesLogFile(companyFolder, employee.id)

  /** What an Employee has said in its DM with the boss. */
  const saidBy = (employee: Employee) =>
    engine
      .chat()
      .read({ channelId: dmChannelId(BOSS, employee.id) })
      .filter((m) => m.authorId === employee.id)
      .map((m) => m.text)
      .join('\n')

  it(
    'answers with each Employee’s own name and memory file, and leaves no shared instructions file',
    async () => {
      engine.createCompany({ folder: companyFolder, name: 'Gabriel' })
      const hera = engine.employees.create({ name: 'Hera', roleId: 'pm' })
      const orion = engine.employees.create({ name: 'Orion', roleId: 'tech-lead' })
      watch(hera)
      watch(orion)

      engine.sessions.start(hera.id)
      engine.sessions.start(orion.id)
      await until(
        'both Sessions to become idle after SessionStart',
        () => engine.sessions.get(hera.id).status === 'idle' && engine.sessions.get(orion.id).status === 'idle',
        STARTUP_MS,
      )

      // The stale file is gone the moment a Session starts, so nothing in the folder claims an identity.
      expect(existsSync(join(companyFolder, 'CLAUDE.md'))).toBe(false)

      for (const employee of [hera, orion]) {
        engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, employee.id), text: WHO_ARE_YOU })
      }
      await until('both Employees to answer the DM', () => saidBy(hera) !== '' && saidBy(orion) !== '')

      const fromHera = saidBy(hera)
      const fromOrion = saidBy(orion)
      console.warn(`Hera said: ${fromHera}\nOrion said: ${fromOrion}`)

      expect(fromHera).toContain('Hera')
      expect(fromHera).toContain(memoryPath(hera))
      expect(fromHera).not.toContain(orion.id)
      expect(fromHera).not.toContain(STALE_NAME)
      expect(fromOrion).toContain('Orion')
      expect(fromOrion).toContain(memoryPath(orion))
      expect(fromOrion).not.toContain(hera.id)
      expect(fromOrion).not.toContain(STALE_NAME)
      expect(existsSync(join(companyFolder, 'CLAUDE.md'))).toBe(false)
    },
    STARTUP_MS + 2 * TURN_MS,
  )
})

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '')
}
