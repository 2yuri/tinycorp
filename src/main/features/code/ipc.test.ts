import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { registerCodeIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git: fakeGit(),
  })
  engines.push(engine)
  let broadcasts = 0
  registerCodeIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

describe('Code flow IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(codeChannels.list)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('lists tickets’ worktrees and PRs, and broadcasts when they change', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [web.id] })
    const before = broadcasts()

    engine.board().moveTicket(ticket.id, 'doing')

    expect(await invoke(codeChannels.list)).toEqual({
      ok: true,
      value: [
        {
          ticketId: ticket.id,
          worktrees: [expect.objectContaining({ repoId: web.id, branch: `ticket-ac-${ticket.id}-login` })],
          pullRequests: [],
        },
      ],
    })
    expect(broadcasts()).toBeGreaterThan(before)
  })

  it('reads what GitHub says about a ticket’s PRs, and refuses a missing ticket id', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

    expect(await invoke(codeChannels.details, ticket.id)).toEqual({
      ok: true,
      value: [expect.objectContaining({ ticketId: ticket.id, repoId: web.id, mergeable: 'unknown', checks: [] })],
    })
    expect(await invoke(codeChannels.details, 'x')).toEqual({ ok: false, error: 'Missing ticket id' })
  })
})
