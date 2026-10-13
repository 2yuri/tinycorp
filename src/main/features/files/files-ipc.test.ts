import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { filesChannels } from '../../../shared/domain/channels'
import { placeId } from '../../../shared/files/files'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { type FileTools, registerFilesIpc } from './files-ipc'

const engines: CompanyEngine[] = []
const folders: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const node = readyStack()

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-files-ipc-'))
  folders.push(folder)
  return folder
}

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
  const opened: string[] = []
  const revealed: string[] = []
  const tools: FileTools = {
    openInEditor: async (path) => void opened.push(path),
    reveal: (path) => void revealed.push(path),
  }
  let broadcasts = 0
  registerFilesIpc({ ipc, engine, tools, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, opened, revealed, broadcasts: () => broadcasts }
}

/** A Company with one repo on disk, so the tree has something real to walk. */
function company(engine: CompanyEngine) {
  const path = temporary()
  mkdirSync(join(path, 'src'))
  writeFileSync(join(path, 'src/counter.ts'), 'export const one = 1\n')
  writeFileSync(join(path, 'secret.txt'), 'this one is above the repo')
  engine.createCompany({ folder: onDisk('/work/acme') })
  const repo = engine.repos.add({ path: join(path, 'src'), name: 'tinycorp', stack: node })
  return { repo, path }
}

describe('Files IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(filesChannels.places)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('lists the places, walks a tree and opens a file inside it', async () => {
    const { engine, invoke } = setup()
    const { repo } = company(engine)

    expect(await invoke(filesChannels.places)).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: placeId(repo.id, null), repoName: 'tinycorp' })],
    })
    expect(await invoke(filesChannels.tree, placeId(repo.id, null))).toEqual({
      ok: true,
      value: expect.objectContaining({ entries: [{ path: 'counter.ts', kind: 'file', change: null }] }),
    })
    expect(await invoke(filesChannels.open, placeId(repo.id, null), 'counter.ts')).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: 'code', text: 'export const one = 1\n' }),
    })
  })

  it('refuses a path that climbs out of the place, and a place it does not know', async () => {
    const { engine, invoke } = setup()
    const { repo } = company(engine)

    expect(await invoke(filesChannels.open, placeId(repo.id, null), '../secret.txt')).toEqual({
      ok: false,
      error: expect.stringMatching(/outside/),
    })
    expect(await invoke(filesChannels.open, placeId(repo.id, null), '')).toEqual({
      ok: false,
      error: 'Missing file path',
    })
    expect(await invoke(filesChannels.tree, 'repo:nobody')).toEqual({
      ok: false,
      error: expect.stringMatching(/no repo or worktree/i),
    })
  })

  it('hands the path the engine resolved to the boss’s own tools, never the renderer’s', async () => {
    const { engine, invoke, opened, revealed } = setup()
    const { repo } = company(engine)

    expect(await invoke(filesChannels.openInEditor, placeId(repo.id, null), 'counter.ts')).toEqual({
      ok: true,
      value: null,
    })
    expect(await invoke(filesChannels.reveal, placeId(repo.id, null))).toEqual({ ok: true, value: null })
    expect(await invoke(filesChannels.openInEditor, placeId(repo.id, null), '../secret.txt')).toEqual({
      ok: false,
      error: expect.stringMatching(/outside/),
    })

    expect(opened).toEqual([expect.stringMatching(/src[/\\]counter\.ts$/)])
    expect(revealed).toEqual([expect.stringMatching(/src$/)])
  })

  it('saves the boss’s text, refuses a stale one, and creates a file inside the place', async () => {
    const { engine, invoke } = setup()
    const { repo, path } = company(engine)
    const id = placeId(repo.id, null)
    const opened = (await invoke(filesChannels.open, id, 'counter.ts')) as { value: { digest: string } }

    expect(
      await invoke(filesChannels.save, id, {
        path: 'counter.ts',
        text: 'export const two = 2\n',
        digest: opened.value.digest,
      }),
    ).toEqual({ ok: true, value: expect.objectContaining({ saved: true }) })
    expect(readFileSync(join(path, 'src/counter.ts'), 'utf8')).toBe('export const two = 2\n')

    // The digest the boss opened with is stale now: the save stops with both versions.
    const stale = (await invoke(filesChannels.save, id, {
      path: 'counter.ts',
      text: 'export const three = 3\n',
      digest: opened.value.digest,
    })) as { value: { saved: boolean; conflict: { theirs: string; yours: string } } }
    expect(stale.value.saved).toBe(false)
    expect(stale.value.conflict).toMatchObject({
      theirs: 'export const two = 2\n',
      yours: 'export const three = 3\n',
    })

    expect(await invoke(filesChannels.create, id, 'notes.md')).toEqual({
      ok: true,
      value: expect.objectContaining({ path: 'notes.md', kind: 'markdown', text: '' }),
    })
    expect(await invoke(filesChannels.create, id, 'notes.md')).toEqual({
      ok: false,
      error: expect.stringMatching(/already exists/),
    })
  })

  it('refuses a save with nothing to check the file against', async () => {
    const { engine, invoke } = setup()
    const { repo } = company(engine)

    expect(await invoke(filesChannels.save, placeId(repo.id, null), { path: 'counter.ts', text: 'x' })).toEqual({
      ok: false,
      error: expect.stringMatching(/as it was opened/),
    })
  })

  it('names the files an action is for, and refuses a commit with no message', async () => {
    const { engine, invoke } = setup()
    const { repo } = company(engine)
    const id = placeId(repo.id, null)

    expect(await invoke(filesChannels.stage, id, [])).toEqual({
      ok: false,
      error: expect.stringMatching(/name the files/i),
    })
    expect(await invoke(filesChannels.commit, id, '   ')).toEqual({
      ok: false,
      error: expect.stringMatching(/needs a message/i),
    })
  })

  it('leaves a place with nothing changed out of the list rather than showing it empty', async () => {
    const { engine, invoke } = setup()
    company(engine)

    // The repo of a test is a folder on disk that git knows nothing about: no status, no group.
    expect(await invoke(filesChannels.changes)).toEqual({ ok: true, value: [] })
  })

  it('tells the renderer when the places change', async () => {
    const { engine, invoke, broadcasts } = setup()
    const { repo } = company(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const ticket = engine.board().createTicket({ title: 'the counter speaks', assigneeId: ada.id, repos: [repo.id] })
    const before = broadcasts()

    engine.board().moveTicket(ticket.id, 'doing')

    expect(broadcasts()).toBeGreaterThan(before)
    const places = (await invoke(filesChannels.places)) as { value: { id: string; holderName: string | null }[] }
    expect(places.value[0]).toMatchObject({ id: placeId(repo.id, ticket.id), holderName: 'Ada' })
  })
})
