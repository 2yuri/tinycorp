import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { restorePointChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, readyStack } from '../../core/testing'
import { createGitService } from '../../platform/git-service'
import { registerRestorePointsIpc } from './ipc'
import { createRestoreGit } from './restore-points-git'

const engines: CompanyEngine[] = []
const scratch: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'restore-points-ipc-'))
  scratch.push(root)
  const repoPath = join(root, 'app')
  execFileSync('git', ['init', '--initial-branch=main', repoPath], { stdio: 'ignore' })
  writeFileSync(join(repoPath, 'README.md'), '# app\n')
  execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync(
    'git',
    // Signing off: the boss's own `commit.gpgsign` would ask for a passphrase no test can answer.
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'],
    { cwd: repoPath, stdio: 'ignore' },
  )
  const folder = join(root, 'company')
  mkdirSync(folder)

  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git: createGitService(),
    restoreGit: createRestoreGit(),
    log: () => {},
  })
  engines.push(engine)
  let broadcasts = 0
  registerRestorePointsIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, folder, repoPath, broadcasts: () => broadcasts }
}

describe('Restore points IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(restorePointChannels.of, 1)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('refuses a request with no ticket or no point named', async () => {
    const { invoke } = setup()

    expect(await invoke(restorePointChannels.of, 'nope')).toEqual({ ok: false, error: 'Missing ticket id' })
    expect(await invoke(restorePointChannels.goBack, '')).toEqual({ ok: false, error: 'Missing restore point' })
  })

  it('lists a ticket’s points and broadcasts when one is taken', async () => {
    const { engine, invoke, folder, repoPath, broadcasts } = setup()
    engine.createCompany({ folder, name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const repo = engine.repos.add({ path: repoPath, name: 'app', stack: readyStack() })
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [repo.id] })
    const before = broadcasts()

    engine.board().moveTicket(ticket.id, 'doing')

    expect(await invoke(restorePointChannels.of, ticket.id)).toEqual({
      ok: true,
      value: [expect.objectContaining({ ticketId: ticket.id, reason: 'start', note: 'Login' })],
    })
    expect(broadcasts()).toBeGreaterThan(before)
  })

  it('says what going back would lose, and goes back', async () => {
    const { engine, invoke, folder, repoPath } = setup()
    engine.createCompany({ folder, name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const repo = engine.repos.add({ path: repoPath, name: 'app', stack: readyStack() })
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [repo.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    const path = engine.code.of(ticket.id).worktrees[0]!.path
    writeFileSync(join(path, 'scratch.txt'), 'scratch\n')
    const listed = (await invoke(restorePointChannels.of, ticket.id)) as { value: { id: string }[] }
    const id = listed.value[0]!.id

    expect(await invoke(restorePointChannels.losses, id)).toEqual({
      ok: true,
      value: { commits: [], uncommitted: true, stops: { employeeId: ada.id, name: 'Ada' } },
    })
    expect(await invoke(restorePointChannels.goBack, id)).toEqual({
      ok: true,
      value: expect.objectContaining({ id }),
    })
  })
})
