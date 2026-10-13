import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { createClaudeAdapter } from '../../providers/claude/adapter'
import { createCodexAdapter } from '../../providers/codex/adapter'
import type { PtySession, PtySpawnOptions } from '../../providers/provider-adapter'
import { providerMissing } from './sessions'

/**
 * An Employee's Provider decides which CLI its Session runs, and the adapters that decide it are
 * the real ones over a fake PTY: the argv here is the argv the app would hand a real process.
 */

interface Spawned {
  file: string
  args: string[]
  options: PtySpawnOptions
}

const engines: CompanyEngine[] = []
const folders: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function launch({ codexInstalled = true }: { codexInstalled?: boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-provider-'))
  folders.push(folder)
  const spawned: Spawned[] = []
  const record = (file: string, args: string[], options: PtySpawnOptions): PtySession => {
    spawned.push({ file, args, options })
    return { write() {}, onData: () => () => {}, onExit: () => () => {}, kill() {}, resize() {} }
  }
  const shared = {
    hookUrl: 'http://127.0.0.1:4555/hook',
    dataDir: join(folder, '.app-data'),
    env: { PATH: '/usr/bin' },
    spawnPty: record,
  }
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    notesFiles: inMemoryNotesFiles(),
    log: () => {},
    mcpUrl: (companyId) => `http://127.0.0.1:9000/mcp/${companyId}`,
    providers: {
      claude: createClaudeAdapter({ ...shared, installed: () => true }),
      codex: createCodexAdapter({ ...shared, installed: () => codexInstalled }),
    },
  })
  engines.push(engine)
  engine.createCompany({ folder, name: 'Gabriel' })
  return { engine, spawned, folder }
}

describe('An Employee’s Provider at spawn', () => {
  it('runs codex for a Codex Employee and claude for a Claude one, side by side', () => {
    const { engine, spawned } = launch()
    const hera = engine.employees.create({ name: 'Hera', roleId: 'pm', provider: 'claude' })
    const orion = engine.employees.create({ name: 'Orion', roleId: 'tech-lead', provider: 'codex' })

    engine.sessions.start(hera.id)
    engine.sessions.start(orion.id)

    const [forHera, forOrion] = spawned as [Spawned, Spawned]
    expect(forHera.file).toBe('claude')
    expect(forHera.args).toContain('--append-system-prompt')
    expect(forHera.args.join(' ')).toContain('You are Hera, PM at Gabriel')
    expect(forOrion.file).toBe('codex')
    expect(forOrion.args).not.toContain('--append-system-prompt')
    expect(forOrion.args.join(' ')).toContain('additional_developer_instructions=')
    expect(forOrion.args.join(' ')).toContain('You are Orion, Tech Lead at Gabriel')
  })

  it('gives each Provider the Company MCP server in its own shape', () => {
    const { engine, spawned } = launch()
    const hera = engine.employees.create({ name: 'Hera', roleId: 'pm', provider: 'claude' })
    const orion = engine.employees.create({ name: 'Orion', roleId: 'tech-lead', provider: 'codex' })

    engine.sessions.start(hera.id)
    engine.sessions.start(orion.id)

    const [forHera, forOrion] = spawned as [Spawned, Spawned]
    expect(forHera.args).toContain('--mcp-config')
    expect(forOrion.args).not.toContain('--mcp-config')
    expect(forOrion.args.join(' ')).toContain('mcp_servers.company.url=')
  })

  it('learns the thread Codex named itself, and resumes on that, not on the app’s id', () => {
    const { engine, spawned } = launch()
    const orion = engine.employees.create({ name: 'Orion', roleId: 'tech-lead', provider: 'codex' })
    engine.sessions.start(orion.id)
    const chosen = engine.sessions.get(orion.id).providerSessionId!
    const token = hookTokenOf(spawned[0]!)

    engine.sessions.receiveHook(token, { hookEventName: 'SessionStart', threadId: 'thr-codex-1' })

    expect(chosen).not.toBe('thr-codex-1')
    expect(engine.sessions.get(orion.id).providerSessionId).toBe('thr-codex-1')
  })

  it('says an uninstalled Provider is missing instead of failing at spawn', () => {
    const { engine } = launch({ codexInstalled: false })
    const hera = engine.employees.create({ name: 'Hera', roleId: 'pm', provider: 'claude' })
    const orion = engine.employees.create({ name: 'Orion', roleId: 'tech-lead', provider: 'codex' })

    expect(engine.sessions.get(hera.id).providerReady).toBe(true)
    expect(engine.sessions.get(orion.id).providerReady).toBe(false)
    expect(() => engine.sessions.start(orion.id)).toThrow(providerMissing('codex'))
    expect(providerMissing('codex')).toContain('codex')
  })
})

/** The token a spawn's Session was given, read off its environment. */
function hookTokenOf(spawned: Spawned): string {
  return spawned.options.env['TINYCORP_HOOK_TOKEN']!
}
