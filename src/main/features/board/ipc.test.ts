import { afterEach, describe, expect, it } from 'vitest'
import type { BoardSnapshot } from '../../../shared/domain/board'
import { boardChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerBoardIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup(openDatabase = inMemoryDatabases()) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const broadcasts: (BoardSnapshot | null)[] = []
  const engine = createCompanyEngine({ openDatabase, recents: inMemoryRecents() })
  engines.push(engine)
  registerBoardIpc({ ipc, engine, broadcastChanged: (board) => broadcasts.push(board) })
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler(...args)
  }
  return { engine, invoke, broadcasts }
}

describe('Deleting a ticket over IPC (T275)', () => {
  it('says what goes, deletes it, and redraws every board', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(boardChannels.apply, { kind: 'createTicket', input: { title: 'Duplicate' } })

    expect(await invoke(boardChannels.ticketRemoval, 1)).toEqual({
      ok: true,
      value: expect.objectContaining({ ticketId: 1, code: 'AC-1', title: 'Duplicate', holder: null }),
    })
    const before = broadcasts.length
    expect(await invoke(boardChannels.deleteTicket, 1)).toMatchObject({ ok: true, value: { code: 'AC-1' } })

    expect(await invoke(boardChannels.snapshot)).toMatchObject({ tickets: [] })
    expect(broadcasts.slice(before).at(-1)).toMatchObject({ tickets: [] })
  })

  it('answers a refusal as a failed Result, and a ticket id that is not one as missing', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(boardChannels.deleteTicket, 7)).toEqual({ ok: false, error: 'There is no ticket 7' })
    for (const bad of ['1', 0, 1.5, null]) {
      expect(await invoke(boardChannels.ticketRemoval, bad)).toEqual({ ok: false, error: 'Missing ticket' })
    }
  })
})

describe('Board IPC', () => {
  it('has no board to show while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(boardChannels.snapshot)).toBeNull()
    expect(await invoke(boardChannels.apply, { kind: 'createTicket', input: { title: 'A' } })).toEqual({
      ok: false,
      error: expect.stringMatching(/no company/i),
    })
  })

  it('applies edits and answers with the new board', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    await invoke(boardChannels.apply, { kind: 'createTicket', input: { title: 'A' } })
    await invoke(boardChannels.apply, { kind: 'setWipLimit', column: 'doing', limit: 1 })
    await invoke(boardChannels.apply, { kind: 'createTicket', input: { title: 'B' } })
    await invoke(boardChannels.apply, { kind: 'moveTicket', id: 1, column: 'doing' })
    const result = await invoke(boardChannels.apply, { kind: 'moveTicket', id: 2, column: 'doing' })

    expect(result).toMatchObject({
      ok: true,
      value: {
        columns: expect.arrayContaining([expect.objectContaining({ id: 'doing', count: 2, overLimit: true })]),
        tickets: [
          expect.objectContaining({ title: 'A', column: 'doing' }),
          expect.objectContaining({ title: 'B', column: 'doing' }),
        ],
      },
    })
    expect(await invoke(boardChannels.snapshot)).toEqual((result as { value: unknown }).value)
  })

  it('covers every kind of edit', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const apply = (command: unknown) => invoke(boardChannels.apply, command)

    await apply({ kind: 'createTarget', input: { title: 'T' } })
    await apply({ kind: 'updateTarget', id: 1, changes: { description: 'why' } })
    await apply({ kind: 'createEpic', input: { title: 'E', targetId: 1 } })
    await apply({ kind: 'updateEpic', id: 1, changes: { title: 'Epic' } })
    await apply({ kind: 'createTicket', input: { title: 'K', epicId: 1 } })
    await apply({ kind: 'updateTicket', id: 1, changes: { blocked: true } })
    await apply({ kind: 'createSubtask', input: { ticketId: 1, title: 'one' } })
    await apply({ kind: 'createSubtask', input: { ticketId: 1, title: 'two' } })
    await apply({ kind: 'updateSubtask', id: 1, changes: { done: true } })
    const last = await apply({ kind: 'deleteSubtask', id: 2 })

    expect(last).toMatchObject({
      ok: true,
      value: {
        targets: [{ title: 'T', description: 'why' }],
        epics: [{ title: 'Epic', targetId: 1 }],
        tickets: [{ title: 'K', blocked: true, subtasks: [{ title: 'one', done: true }] }],
      },
    })
  })

  it('returns refusals, including the subtask rule, as errors', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(boardChannels.apply, {
      kind: 'createTicket',
      input: { title: 'A', assigneeId: 'ada' },
    })

    const result = await invoke(boardChannels.apply, {
      kind: 'createSubtask',
      input: { ticketId: 1, title: 'x', assigneeId: 'grace' },
    })

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/assignee/i) })
  })

  it('rejects malformed commands from the renderer', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    for (const command of [
      undefined,
      'createTicket',
      { kind: 'dropTable' },
      { kind: 'createTicket' },
      { kind: 'createTicket', input: { title: 42 } },
      { kind: 'moveTicket', id: '1', column: 'doing' },
      { kind: 'updateTicket', id: 1, changes: null },
      { kind: 'setWipLimit', column: 'doing', limit: 'lots' },
    ]) {
      expect(await invoke(boardChannels.apply, command)).toMatchObject({ ok: false })
    }
    expect(await invoke(boardChannels.snapshot)).toMatchObject({ tickets: [] })
  })

  it('broadcasts the board after every edit and when the Company changes', async () => {
    const { engine, invoke, broadcasts } = setup()

    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(boardChannels.apply, { kind: 'createTicket', input: { title: 'A' } })
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    // Twice for the ticket: the board edit, then the plan it opens in Planning (T171).
    expect(broadcasts.map((b) => b?.tickets.map((t) => t.title))).toEqual([[], ['A'], ['A'], []])
  })

  it('never lets an unreadable board break opening a Company', async () => {
    const databases = inMemoryDatabases()
    const db = databases(onDisk('/work/odd'), 'create')!
    db.exec(`CREATE TABLE company (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO company VALUES ('odd', 'Odd', '2026-01-01');
      PRAGMA user_version = 99`)
    const { engine, invoke, broadcasts } = setup(databases)

    expect(engine.openCompany(onDisk('/work/odd')).name).toBe('Odd')
    expect(broadcasts).toEqual([null])
    expect(await invoke(boardChannels.apply, { kind: 'createTicket', input: { title: 'A' } })).toEqual({
      ok: false,
      error: expect.stringMatching(/no such table/i),
    })
  })
})
