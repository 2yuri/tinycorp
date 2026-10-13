import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { companyMemoryChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { MemoryPage, MemoryPageSummary } from '../../../shared/memory/company-memory'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { inMemoryPageFiles } from './company-memory-files'
import { registerCompanyMemoryIpc } from './company-memory-ipc'
import { companyMemoryFolder } from './company-memory-page'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  // Held in this process, but named after the Company folder the way the real one is, so the
  // paths the screen is handed are the paths this platform would really write.
  const pages = inMemoryPageFiles(companyMemoryFolder(onDisk('/work/acme')))
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    memoryPages: () => pages,
  })
  engines.push(engine)
  let broadcasts = 0
  registerCompanyMemoryIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, pages, invoke, broadcasts: () => broadcasts }
}

function value<T>(result: unknown): T {
  const answer = result as Result<T>
  if (!answer.ok) throw new Error(answer.error)
  return answer.value
}

describe('Company memory IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()
    expect(await invoke(companyMemoryChannels.list, {})).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('writes a page as the boss and reads it back, and says a page changed', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    engine.updateCompany({ bossName: 'Yuri' })
    const before = broadcasts()

    const written = value<MemoryPage>(
      await invoke(companyMemoryChannels.write, {
        kind: 'decision',
        title: 'Locale handling in billing',
        body: 'Minor units, formatted at the edge.',
        repos: ['billing-api'],
        sources: ['ticket:AC-1'],
      }),
    )
    expect(written).toMatchObject({ slug: 'locale-handling-in-billing', updatedBy: 'Yuri' })
    expect(broadcasts()).toBeGreaterThan(before)

    const rows = value<MemoryPageSummary[]>(await invoke(companyMemoryChannels.list, {}))
    expect(rows.map((row) => row.slug)).toEqual(['locale-handling-in-billing'])
    expect(value<{ pages: number }>(await invoke(companyMemoryChannels.counts))).toMatchObject({ pages: 1 })
    expect(
      value<MemoryPage | null>(await invoke(companyMemoryChannels.get, 'locale-handling-in-billing')),
    ).toMatchObject({ body: 'Minor units, formatted at the edge.' })
  })

  it('pins and archives, and an archived page leaves the list without leaving the folder', async () => {
    const { engine, pages, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(companyMemoryChannels.write, { kind: 'gotcha', title: 'Vitest hangs', body: 'Use threads.' })

    expect(value<MemoryPage>(await invoke(companyMemoryChannels.pin, 'vitest-hangs', true)).pinned).toBe(true)
    expect(value<MemoryPage>(await invoke(companyMemoryChannels.archive, 'vitest-hangs')).archived).toBe(true)
    expect(value<MemoryPageSummary[]>(await invoke(companyMemoryChannels.list, {}))).toEqual([])
    expect(pages.read('archive/vitest-hangs.md')).toContain('Vitest hangs')
  })

  it('rejects a filter or a page the screen could not have meant', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(companyMemoryChannels.list, { kind: 'rumour' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown page kind/i),
    })
    expect(await invoke(companyMemoryChannels.list, { sort: 'sideways' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown sort/i),
    })
    expect(await invoke(companyMemoryChannels.write, { kind: 'handoff', title: 'x', body: 'y' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/written by the app/i),
    })
    expect(await invoke(companyMemoryChannels.setColdDays, 0)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/number of days/i),
    })
  })

  it('rebuilds the index from the folder, and answers where the folder is', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(companyMemoryChannels.write, { kind: 'glossary', title: 'Seat vs member', body: 'A seat is billed.' })

    expect(value<{ pages: number }>(await invoke(companyMemoryChannels.rebuild))).toMatchObject({ pages: 1 })
    expect(value<string>(await invoke(companyMemoryChannels.folder))).toContain('memory')
    // The file path is this platform's, built from the page's POSIX key.
    const file = value<string | null>(await invoke(companyMemoryChannels.filePath, 'seat-vs-member'))!
    expect(file).toBe(join(onDisk('/work/acme'), 'memory', 'company', 'glossary', 'seat-vs-member.md'))
    expect(await invoke(companyMemoryChannels.filePath, 'nothing-here')).toEqual({ ok: true, value: null })
    expect(value<number>(await invoke(companyMemoryChannels.coldDays))).toBe(30)
    expect(value<number>(await invoke(companyMemoryChannels.setColdDays, 7))).toBe(7)
  })
})
