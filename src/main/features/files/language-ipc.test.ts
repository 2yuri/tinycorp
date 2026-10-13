import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { languageChannels } from '../../../shared/domain/channels'
import { placeId } from '../../../shared/files/files'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack, removeFolder } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { typescriptAt } from './language'
import { registerLanguageIpc } from './language-ipc'

const engines: CompanyEngine[] = []
const folders: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) removeFolder(folder)
})

const node = readyStack()

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-language-ipc-'))
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
  registerLanguageIpc({ ipc, engine })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke }
}

/** A Company whose one repo has TypeScript of its own — the one this test run is using. */
function company(engine: CompanyEngine, { typescript = true } = {}) {
  const path = temporary()
  writeFileSync(join(path, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }))
  writeFileSync(join(path, 'counter.ts'), '/** One of them. */\nexport const one: number = 1\n')
  if (typescript) {
    mkdirSync(join(path, 'node_modules'))
    const found = typescriptAt(dirname(fileURLToPath(import.meta.url)))!
    symlinkSync(resolve(found.bin, '..', '..'), join(path, 'node_modules', 'typescript'), 'dir')
  }
  engine.createCompany({ folder: onDisk('/work/acme') })
  const repo = engine.repos.add({ path, name: 'tinycorp', stack: node })
  return { repo, id: placeId(repo.id, null), path }
}

describe('Language IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(languageChannels.read, 'repo:none', 'counter.ts', '')).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('reads the file the viewer is showing, and answers a hover in it', async () => {
    const { engine, invoke } = setup()
    const { id } = company(engine)
    const text = '/** One of them. */\nexport const one: number = 1\n'

    expect(await invoke(languageChannels.read, id, 'counter.ts', text)).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'ready',
        reason: null,
        diagnostics: [],
        outline: [expect.objectContaining({ name: 'one', kind: 'variable', line: 2 })],
      }),
    })
    expect(await invoke(languageChannels.hover, id, 'counter.ts', { line: 2, column: 14 }, text)).toEqual({
      ok: true,
      value: expect.objectContaining({ signature: expect.stringContaining('const one: number') }),
    })
  }, 60_000)

  it('reads the unsaved text the boss typed, not the file on disk', async () => {
    const { engine, invoke } = setup()
    const { id } = company(engine)

    const result = (await invoke(languageChannels.read, id, 'counter.ts', 'export const one: number = "two"\n')) as {
      value: { diagnostics: { line: number; message: string }[] }
    }
    expect(result.value.diagnostics).toEqual([
      expect.objectContaining({ line: 1, message: expect.stringMatching(/not assignable/) }),
    ])
  }, 60_000)

  it('opens a file of a repo with no language server anyway, saying why it is quiet', async () => {
    const { engine, invoke } = setup()
    const { id } = company(engine, { typescript: false })

    expect(await invoke(languageChannels.read, id, 'counter.ts', 'export const one = 1\n')).toEqual({
      ok: true,
      value: {
        status: 'none',
        reason: expect.stringMatching(/no TypeScript of its own/),
        diagnostics: [],
        outline: [],
      },
    })
    // …and the file itself still opens, highlighted, with nothing about the server in the way.
    expect(engine.files.open(id, 'counter.ts')).toMatchObject({
      kind: 'code',
      language: 'ts',
      text: '/** One of them. */\nexport const one: number = 1\n',
    })
  })

  it('refuses a place it does not know, a missing path and a spot that is not one', async () => {
    const { engine, invoke } = setup()
    const { id } = company(engine, { typescript: false })

    expect(await invoke(languageChannels.read, 'repo:nobody', 'counter.ts', '')).toEqual({
      ok: false,
      error: expect.stringMatching(/no repo or worktree/i),
    })
    expect(await invoke(languageChannels.read, id, '', '')).toEqual({ ok: false, error: 'Missing file path' })
    expect(await invoke(languageChannels.read, id, 'counter.ts', null)).toEqual({
      ok: false,
      error: 'Missing the text the viewer is showing',
    })
    expect(await invoke(languageChannels.hover, id, 'counter.ts', { line: 0, column: 1 }, '')).toEqual({
      ok: false,
      error: 'Missing where in the file',
    })
  })
})
