import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathsChannels } from '../../../shared/domain/channels'
import { placeId } from '../../../shared/files/files'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { type PathTools, registerPathsIpc } from './paths-ipc'

const engines: CompanyEngine[] = []
const folders: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const node = readyStack()

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-paths-ipc-'))
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
  /** What the tool was called with, one call one path: never a string a shell would read. */
  const revealed: string[] = []
  const edited: string[] = []
  const tools: PathTools = {
    reveal: (path) => void revealed.push(path),
    openInEditor: async (path) => void edited.push(path),
  }
  registerPathsIpc({ ipc, engine, tools })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, revealed, edited }
}

/** A Company with one repo on disk, and a folder of screenshots that belongs to nobody. */
function company(engine: CompanyEngine) {
  const root = temporary()
  const repoPath = join(root, 'tinycorp')
  const shots = join(root, 'shots')
  mkdirSync(join(repoPath, 'src'), { recursive: true })
  mkdirSync(shots, { recursive: true })
  writeFileSync(join(repoPath, 'src/counter.ts'), 'export const one = 1\n')
  writeFileSync(join(shots, 'menu.txt'), 'a note about the menu')
  engine.createCompany({ folder: join(root, 'acme') })
  const repo = engine.repos.add({ path: repoPath, name: 'tinycorp', stack: node })
  return { repo, repoPath, shots }
}

describe('Paths IPC', () => {
  it('draws a path that is really there as a link, and leaves one that is not as text', async () => {
    const { engine, invoke } = setup()
    const { repo } = company(engine)

    expect(await invoke(pathsChannels.links, 'I changed src/counter.ts:19 today')).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          text: 'src/counter.ts:19',
          target: { kind: 'place', placeId: placeId(repo.id, null), path: 'src/counter.ts', line: 19, column: null },
        }),
      ],
    })
    expect(await invoke(pathsChannels.links, 'I changed src/missing.ts today')).toEqual({ ok: true, value: [] })
  })

  it('reads a path outside the Company for the viewer, whatever kind it is', async () => {
    const { engine, invoke } = setup()
    const { shots } = company(engine)
    writeFileSync(join(shots, 'menu.png'), 'not really a png')

    expect(await invoke(pathsChannels.open, join(shots, 'menu.txt'))).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: 'text', text: 'a note about the menu' }),
    })
    expect(await invoke(pathsChannels.open, join(shots, 'menu.png'))).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: 'image' }),
    })
  })

  it('refuses a path that is not there, and opens nothing', async () => {
    const { engine, invoke, revealed } = setup()
    const { shots } = company(engine)

    expect(await invoke(pathsChannels.open, join(shots, 'nowhere.txt'))).toEqual({
      ok: false,
      error: expect.stringMatching(/no file/i),
    })
    expect(await invoke(pathsChannels.reveal, 'rm -rf /')).toEqual({
      ok: false,
      error: expect.stringMatching(/no file/i),
    })
    expect(await invoke(pathsChannels.open, '')).toEqual({ ok: false, error: 'Missing path' })

    expect(revealed).toEqual([])
  })

  it('reveals the path the engine resolved, never the text the renderer sent', async () => {
    const { engine, invoke, revealed } = setup()
    const { repoPath } = company(engine)

    expect(await invoke(pathsChannels.reveal, 'src/counter.ts')).toEqual({ ok: true, value: null })

    expect(revealed).toEqual([join(repoPath, 'src/counter.ts')])
  })

  it('hands a written path to the editor as one argument, the whole path the engine resolved', async () => {
    const { engine, invoke, edited } = setup()
    const { repoPath } = company(engine)

    expect(await invoke(pathsChannels.openInEditor, 'src/counter.ts')).toEqual({ ok: true, value: null })

    expect(edited).toEqual([join(repoPath, 'src/counter.ts')])
  })

  it('opens nothing for a path that is not a file the Company or the Mac really has', async () => {
    const { engine, invoke, edited } = setup()
    company(engine)

    expect(await invoke(pathsChannels.openInEditor, 'src/nowhere.ts')).toEqual({
      ok: false,
      error: expect.stringMatching(/no file/i),
    })

    expect(edited).toEqual([])
  })
})
