import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_FILE } from '../../core'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { createClaudeAdapter } from '../../providers/claude/adapter'
import type { PtySession, PtySpawnOptions } from '../../providers/provider-adapter'
import { READY_DELAY_MS } from './sessions'

/**
 * A Session holds its own hook token by design — it is in its own environment, and its own hooks
 * are how the app learns it is working. So the provider session id a hook names is a string the
 * Employee itself chooses, and the app spends it as CLI argv and as a file path (T199-H1, the
 * security review's finding H1). The adapter here is the real one over a fake PTY, so the argv
 * asserted is the argv a real `claude` would be started with.
 */

interface Spawned {
  args: string[]
  options: PtySpawnOptions
}

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

/** One run of the app over a real Company folder, so quitting and opening again is a real restart. */
function launch(folder: string, notesFiles = inMemoryNotesFiles()) {
  const spawned: Spawned[] = []
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    notesFiles,
    log: () => {},
    mcpUrl: (companyId) => `http://127.0.0.1:9000/mcp/${companyId}`,
    providers: {
      claude: createClaudeAdapter({
        hookUrl: 'http://127.0.0.1:4555/hook',
        dataDir: join(folder, '.app-data'),
        env: { PATH: '/usr/bin' },
        installed: () => true,
        spawnPty(_file, args, options): PtySession {
          spawned.push({ args, options })
          return { write() {}, onData: () => () => {}, onExit: () => () => {}, kill() {}, resize() {} }
        },
      }),
    },
  })
  engines.push(engine)
  return { engine, spawned }
}

function quit(engine: CompanyEngine): void {
  engines.splice(engines.indexOf(engine), 1)
  engine.close()
}

/** The token this Session's hooks send back, read off its own environment the way it can read it. */
const hookTokenOf = (spawned: Spawned) => spawned.options.env['TINYCORP_HOOK_TOKEN']!

/** An Employee hired on `interactive`, whose Session ran once and whose app then quit. */
function employeeThatRan() {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-hook-id-'))
  folders.push(folder)
  const memoryFiles = inMemoryNotesFiles()
  const { engine, spawned } = launch(folder, memoryFiles)
  engine.createCompany({ folder, name: 'Acme' })
  const hera = engine.employees.create({ name: 'Hera', roleId: 'backend', permissionMode: 'interactive' })
  const chosen = engine.sessions.start(hera.id).providerSessionId!
  const token = hookTokenOf(spawned[0]!)
  vi.advanceTimersByTime(READY_DELAY_MS)
  return { folder, memoryFiles, engine, spawned, hera, chosen, token }
}

describe('the provider session id a hook names', () => {
  it('does not become the flag the next resume is started with', () => {
    const run = employeeThatRan()

    // The review's own exploit, as one curl from inside the Employee's own shell.
    run.engine.sessions.receiveHook(run.token, {
      hook_event_name: 'Stop',
      session_id: '--dangerously-skip-permissions',
    })

    expect(run.engine.sessions.get(run.hera.id).providerSessionId, 'the hook rewrote the stored id').toBe(run.chosen)

    quit(run.engine)
    const second = launch(run.folder, run.memoryFiles)
    second.engine.openCompany(run.folder)

    const resumed = second.spawned[0]!.args
    expect(resumed.slice(0, 2)).toEqual(['--resume', run.chosen])
    expect(resumed, 'an Employee hired on interactive came back with permission prompts off').not.toContain(
      '--dangerously-skip-permissions',
    )
  })

  it('does not become the path the next Session’s MCP config is written to', () => {
    const run = employeeThatRan()

    run.engine.sessions.receiveHook(run.token, {
      hook_event_name: 'Stop',
      session_id: `..${'/..'.repeat(6)}/Users/boss/.claude`,
    })

    expect(run.engine.sessions.get(run.hera.id).providerSessionId).toBe(run.chosen)

    quit(run.engine)
    const second = launch(run.folder, run.memoryFiles)
    second.engine.openCompany(run.folder)

    // The resume runs on the app's own id, so the file injectMcp writes is inside the app's own
    // data folder rather than wherever the hook's `..` walked to.
    const config = second.spawned[0]!.args[second.spawned[0]!.args.indexOf('--mcp-config') + 1]!
    expect(config.startsWith(join(run.folder, '.app-data')), config).toBe(true)
  })

  it('still learns the id a Provider that names its own conversations reports', () => {
    const run = employeeThatRan()

    run.engine.sessions.receiveHook(run.token, { hook_event_name: 'Stop', session_id: 'ses_9f2b7c1d' })

    expect(run.engine.sessions.get(run.hera.id).providerSessionId).toBe('ses_9f2b7c1d')
  })
})

describe('a stored provider session id an older build let a hook write', () => {
  it('is not resumed on: the Employee comes back on a fresh Session instead', () => {
    const run = employeeThatRan()
    quit(run.engine)
    storedIdBecomes(run.folder, run.hera.id, '--dangerously-skip-permissions')

    const second = launch(run.folder, run.memoryFiles)
    second.engine.openCompany(run.folder)

    const resumed = second.spawned[0]!.args
    expect(resumed[0]).toBe('--session-id')
    expect(resumed).not.toContain('--resume')
    expect(resumed).not.toContain('--dangerously-skip-permissions')
  })

  it('is not the line the boss is handed to paste into their own terminal', () => {
    const run = employeeThatRan()
    expect(run.engine.sessions.handoffCommand(run.hera.id)?.command).toContain(run.chosen)

    storedIdBecomes(run.folder, run.hera.id, '--dangerously-skip-permissions')

    expect(
      run.engine.sessions.handoffCommand(run.hera.id),
      'the boss is handed a line that turns the flag on',
    ).toBeNull()
  })
})

/** What an older build would have stored when the Session named its own id. */
function storedIdBecomes(folder: string, employeeId: string, id: string): void {
  const db = new DatabaseSync(join(folder, COMPANY_FILE))
  db.prepare('UPDATE session SET provider_session_id = ? WHERE employee_id = ?').run(id, employeeId)
  db.close()
}
