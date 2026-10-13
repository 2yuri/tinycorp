import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { AppRun, CapturePage, TestRun, TestSettings } from '../../../shared/testing'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack, removeFolder } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import type { SpawnRun } from './app-runs'
import { registerTestingIpc } from './ipc'

const engines: CompanyEngine[] = []
const scratch: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) removeFolder(dir)
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const captured: { url: string }[] = []
  const capture: CapturePage = async ({ url, name }) => {
    captured.push({ url })
    return { name, data: new Uint8Array([137, 80, 78, 71]) }
  }
  const spawnRun: SpawnRun = () => ({ onOutput: () => {}, onExit: () => {}, kill: () => {} })
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git,
    spawnRun,
    log: () => {},
  })
  engines.push(engine)
  let broadcasts = 0
  registerTestingIpc({ ipc, engine, capture, broadcastChanged: () => broadcasts++ })
  const invoke = async <T>(channel: string, ...args: unknown[]) => (await handlers.get(channel)!(...args)) as Result<T>

  // A Company on disk: a screenshot is a real file in its folder.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'testing-ipc-')))
  scratch.push(base)
  const folder = join(base, 'acme')
  mkdirSync(folder)
  const acme = engine.createCompany({ folder, name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })

  async function inTesting() {
    engine.tests.setMode('you')
    engine.tests.setRepo(web.id, { runCommand: 'pnpm dev', port: 5173 })
    const ticket = engine.board().createTicket({ title: 'Usage chart', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    engine.reviews.approve(ticket.id)
    return ticket
  }

  return { engine, acme, web, invoke, inTesting, captured, broadcasts: () => broadcasts }
}

const value = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('Testing over IPC', () => {
  it('sets who tests, per Company and per repo', async () => {
    const { web, invoke } = setup()

    expect(value(await invoke<TestSettings>(testChannels.settings)).mode).toBe('nobody')
    value(await invoke<TestSettings>(testChannels.setMode, 'both'))
    const settings = value(
      await invoke<TestSettings>(testChannels.setRepo, web.id, { mode: 'you', runCommand: 'pnpm dev', port: '5173' }),
    )

    expect(settings.mode).toBe('both')
    expect(settings.repos).toEqual([{ repoId: web.id, mode: 'you', runCommand: 'pnpm dev', port: 5173 }])
  })

  it('refuses a port that is not one', async () => {
    const { web, invoke } = setup()

    const refused = await invoke(testChannels.setRepo, web.id, { port: '70000' })

    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/between 1 and 65535/) })
  })

  it('records a step, attaches a screenshot, and passes the ticket', async () => {
    const { engine, invoke, inTesting } = setup()
    const ticket = await inTesting()
    const run = value(await invoke<TestRun>(testChannels.of, ticket.id))
    expect(run.state).toBe('you')

    value(await invoke<TestRun>(testChannels.addStep, ticket.id, 'Open the chart', 'and count the bars'))
    const steps = value(await invoke<TestRun>(testChannels.of, ticket.id)).steps
    const withNote = value(
      await invoke<TestRun>(testChannels.setStep, steps[0]!.id, 'pass', 'looks right on first open'),
    )

    expect(withNote.steps[0]).toMatchObject({ result: 'pass', note: 'looks right on first open', testedBy: 'boss' })

    const attached = value(
      await invoke<TestRun>(testChannels.attach, steps[0]!.id, [{ name: 'shot.png', data: new Uint8Array([1, 2, 3]) }]),
    )
    expect(attached.steps[0]!.attachments).toEqual([expect.objectContaining({ name: 'shot.png', size: 3 })])

    const passed = value(await invoke<TestRun>(testChannels.pass, ticket.id))
    expect(passed.state).toBe('passed')
    expect(engine.board().snapshot().tickets[0]!.column).not.toBe('review')
  })

  it('runs the app, logs it, and captures the page it serves', async () => {
    const { web, invoke, inTesting, captured } = setup()
    const ticket = await inTesting()
    const step = value(await invoke<TestRun>(testChannels.addStep, ticket.id, 'Open the chart')).steps[0]!

    const notRunning = await invoke(testChannels.capture, step.id, ticket.id, web.id)
    expect(notRunning).toEqual({ ok: false, error: expect.stringMatching(/Start the app first/) })

    const app = value(await invoke<AppRun>(testChannels.startApp, ticket.id, web.id))
    expect(app).toMatchObject({ state: 'running', url: 'http://localhost:5173' })

    const captured_run = value(await invoke<TestRun>(testChannels.capture, step.id, ticket.id, web.id))
    expect(captured).toEqual([{ url: 'http://localhost:5173' }])
    expect(captured_run.steps[0]!.attachments).toHaveLength(1)

    expect(value(await invoke<string[]>(testChannels.appLog, ticket.id, web.id))).toEqual([])
    expect(value(await invoke<AppRun>(testChannels.stopApp, ticket.id, web.id)).state).toBe('exited')
  })

  it('reports a bug back to Doing', async () => {
    const { engine, invoke, inTesting } = setup()
    const ticket = await inTesting()

    const failed = value(await invoke<TestRun>(testChannels.reportBug, ticket.id, 'The chart never loads'))

    expect(failed.state).toBe('failed')
    expect(engine.board().snapshot().tickets[0]!.column).toBe('doing')
  })

  it('tells the windows something changed', async () => {
    const { invoke, inTesting, broadcasts } = setup()
    const ticket = await inTesting()
    const before = broadcasts()

    value(await invoke<TestRun>(testChannels.addStep, ticket.id, 'Open the chart'))

    expect(broadcasts()).toBeGreaterThan(before)
  })
})
