import { afterEach, describe, expect, it } from 'vitest'
import { notesChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { NotesRaw, NotesSearch, NotesView, NotesZoom } from '../../../shared/memory/notes'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryNotesFiles, inMemoryRecents, onDisk } from '../../core/testing'
import { registerNotesIpc } from './notes-ipc'

/**
 * The drawer's Memory tab and the Tokens card, over the seam (T193).
 *
 * The two things it has to keep true: an Employee's notes are its own, and the boss's side of the
 * log is only ever a write that adds — there is no edit and no delete channel to call.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    notesFiles: inMemoryNotesFiles(),
  })
  engines.push(engine)
  registerNotesIpc({ ipc, engine })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, handlers }
}

function value<T>(result: unknown): T {
  const answer = result as Result<T>
  if (!answer.ok) throw new Error(answer.error)
  return answer.value
}

describe('Notes IPC', () => {
  it('reports an error while no Company is open, rather than drawing an empty drawer', async () => {
    const { invoke } = setup()

    expect(await invoke(notesChannels.view, 'someone')).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('refuses an Employee the Company does not have', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(notesChannels.view, 'nobody')).toEqual({
      ok: false,
      error: expect.stringContaining('Unknown Employee'),
    })
  })

  it('reads one Employee’s notes, and never another’s', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'frontend' })

    await invoke(notesChannels.addNote, ada.id, 'Ship small PRs.')

    expect(value<NotesView>(await invoke(notesChannels.view, ada.id)).notes).toBe(1)
    expect(value<NotesView>(await invoke(notesChannels.view, grace.id)).notes).toBe(0)
  })

  it('badges the boss’s own note, and answers with the view it leaves behind', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    const view = value<NotesView>(await invoke(notesChannels.addNote, ada.id, 'Ship small PRs.'))

    expect(view.recent[0]).toMatchObject({ id: 0, by: 'boss', text: 'Ship small PRs.' })
  })

  it('has no way to edit or delete a note: the log only grows', () => {
    const { handlers } = setup()

    expect([...handlers.keys()].sort()).toEqual(Object.values(notesChannels).sort())
    expect([...handlers.keys()].join(' ')).not.toMatch(/edit|delete/)
  })

  it('searches every note word for word, taking the boss’s words as words and not a pattern', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    await invoke(notesChannels.addNote, ada.id, 'run pnpm test -- --pool=threads')
    await invoke(notesChannels.addNote, ada.id, 'nothing to do with the runner')

    const found = value<NotesSearch>(await invoke(notesChannels.search, ada.id, '--pool=threads'))

    expect(found.matches.map((note) => note.text)).toEqual(['run pnpm test -- --pool=threads'])
  })

  it('opens a range, and refuses one that is not two whole numbers', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    for (let at = 0; at < 8; at++) await invoke(notesChannels.addNote, ada.id, `note ${at}`)

    expect(value<NotesZoom>(await invoke(notesChannels.zoom, ada.id, { lo: 0, hi: 8 })).notes).toHaveLength(8)
    expect(await invoke(notesChannels.zoom, ada.id, { lo: 8, hi: 0 })).toMatchObject({ ok: false })
    expect(await invoke(notesChannels.zoom, ada.id, 'nope')).toMatchObject({ ok: false })
  })

  it('hands back the log as it is on disk for Raw log', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    await invoke(notesChannels.addNote, ada.id, 'Ship small PRs.')

    const raw = value<NotesRaw>(await invoke(notesChannels.raw, ada.id))

    expect(raw.text).toContain('\tboss\tShip small PRs.')
    expect(raw).toMatchObject({ total: 1, truncated: false })
  })
})

describe('Read at session start', () => {
  it('is 4k for a new Company, and is what the boss sets it to', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(value<number>(await invoke(notesChannels.budget))).toBe(4_000)
    expect(value<number>(await invoke(notesChannels.setBudget, 8_000))).toBe(8_000)
    expect(value<number>(await invoke(notesChannels.budget))).toBe(8_000)
  })

  it('refuses a number that is not one of the three, and keeps the one that was set', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(notesChannels.setBudget, 3_000)).toMatchObject({ ok: false })
    expect(await invoke(notesChannels.setBudget, 'lots')).toMatchObject({ ok: false })
    expect(value<number>(await invoke(notesChannels.budget))).toBe(4_000)
  })

  it('is what the drawer’s meter is drawn against', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    await invoke(notesChannels.setBudget, 2_000)

    expect(value<NotesView>(await invoke(notesChannels.view, ada.id)).budget).toBe(2_000)
  })
})
