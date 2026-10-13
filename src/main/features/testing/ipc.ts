import { testChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { CapturePage } from '../../../shared/testing'
import {
  isValidPort,
  localUrl,
  type RepoTestChanges,
  TEST_MODES,
  TEST_RESULTS,
  type TestMode,
  type TestResult,
  type TestRun,
} from '../../../shared/testing'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { TestingFacade } from './facade'

export interface TestingIpcOptions {
  ipc: IpcHandlerRegistry
  engine: TestingFacade
  /** Capture the running app: loads the URL in a hidden window and hands back the PNG. */
  capture: CapturePage
  broadcastChanged(): void
}

/**
 * The Testing stage over IPC (T174): the attempt, the boss's pass and fail, the screenshots, and
 * Run it. Holds no state — every call goes to the engine, which owns the processes.
 */
export function registerTestingIpc({ ipc, engine, capture, broadcastChanged }: TestingIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.tests.onChange(broadcastChanged)

  ipc.handle(testChannels.of, (_event, ticketId) => attempt(() => engine.tests.of(ticketNumber(ticketId))))
  ipc.handle(testChannels.list, () => attempt(() => engine.tests.list()))

  ipc.handle(testChannels.addStep, (_event, ticketId, title, detail) =>
    attempt(() =>
      engine.tests.addStep({
        ticketId: ticketNumber(ticketId),
        title: text(title, 'A step needs to say what to check'),
        ...(detail === undefined || detail === null ? {} : { detail: String(detail) }),
      }),
    ),
  )

  ipc.handle(testChannels.setStep, (_event, stepId, result, note) =>
    attempt(() =>
      engine.tests.setStep({
        stepId: positive(stepId, 'step'),
        result: testResult(result),
        ...(note === undefined || note === null ? {} : { note: String(note) }),
      }),
    ),
  )

  ipc.handle(testChannels.attach, (_event, stepId, files) =>
    attempt(() => {
      const step = positive(stepId, 'step')
      let run: TestRun | undefined
      for (const source of pickedFiles(files)) run = engine.tests.attach({ stepId: step, source })
      return run!
    }),
  )

  ipc.handle(testChannels.capture, async (_event, stepId, ticketId, repoId) => {
    try {
      const step = positive(stepId, 'step')
      const ticket = ticketNumber(ticketId)
      const app = engine.appRuns.of(ticket).find((run) => run.repoId === String(repoId))
      if (!app || app.state !== 'running') {
        throw new Error('Start the app first: there is nothing running to capture.')
      }
      if (app.port === null) {
        throw new Error(`${app.repoName} has no port, so there is no page to capture. Set one in Company settings.`)
      }
      const shot = await capture({
        url: app.url ?? localUrl(app.port),
        name: `${app.repoName}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      })
      return { ok: true, value: engine.tests.attach({ stepId: step, source: shot }) } satisfies Result<unknown>
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Result<unknown>
    }
  })

  ipc.handle(testChannels.openAttachment, (_event, id) =>
    attempt(() => engine.tests.openAttachment(positive(id, 'screenshot'))),
  )

  ipc.handle(testChannels.pass, (_event, ticketId) => attempt(() => engine.tests.pass(ticketNumber(ticketId))))
  ipc.handle(testChannels.reportBug, (_event, ticketId, note) =>
    attempt(() =>
      engine.tests.reportBug({
        ticketId: ticketNumber(ticketId),
        ...(note === undefined || note === null ? {} : { note: String(note) }),
      }),
    ),
  )

  ipc.handle(testChannels.runnable, (_event, ticketId) =>
    attempt(() => engine.appRuns.runnable(ticketNumber(ticketId))),
  )
  ipc.handle(testChannels.startApp, (_event, ticketId, repoId) =>
    attempt(() => engine.appRuns.start({ ticketId: ticketNumber(ticketId), repoId: String(repoId), actorId: 'boss' })),
  )
  ipc.handle(testChannels.stopApp, (_event, ticketId, repoId) =>
    attempt(() => engine.appRuns.stop(ticketNumber(ticketId), String(repoId))),
  )
  ipc.handle(testChannels.appLog, (_event, ticketId, repoId) =>
    attempt(() => engine.appRuns.log(ticketNumber(ticketId), String(repoId))),
  )

  ipc.handle(testChannels.settings, () => attempt(() => engine.tests.settings()))
  ipc.handle(testChannels.setMode, (_event, mode) => attempt(() => engine.tests.setMode(testMode(mode))))
  ipc.handle(testChannels.setRepo, (_event, repoId, changes) =>
    attempt(() => engine.tests.setRepo(String(repoId), repoChanges(changes))),
  )
}

function ticketNumber(value: unknown): number {
  return positive(value, 'ticket')
}

function positive(value: unknown, what: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`Missing ${what}`)
  return value as number
}

function text(value: unknown, message: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) throw new Error(message)
  return trimmed
}

function testResult(value: unknown): TestResult {
  if (!TEST_RESULTS.includes(value as TestResult)) throw new Error('A step is "pass", "fail" or "pending"')
  return value as TestResult
}

function testMode(value: unknown): TestMode {
  if (!TEST_MODES.includes(value as TestMode)) throw new Error(`Unknown testing mode: ${String(value)}`)
  return value as TestMode
}

/** The screenshots the boss picked or pasted, as bytes the engine can write. */
function pickedFiles(value: unknown): { name: string; data: Uint8Array }[] {
  const files = Array.isArray(value) ? value : []
  if (files.length === 0) throw new Error('Pick at least one file')
  return files.map((file) => {
    const record = (file ?? {}) as { name?: unknown; data?: unknown }
    const data = record.data
    if (!(data instanceof Uint8Array) && !ArrayBuffer.isView(data as never)) {
      throw new Error('A screenshot needs its bytes')
    }
    return { name: text(record.name, 'A screenshot needs a file name'), data: data as Uint8Array }
  })
}

function repoChanges(value: unknown): RepoTestChanges {
  const input = (value ?? {}) as { mode?: unknown; runCommand?: unknown; port?: unknown }
  const changes: RepoTestChanges = {}
  if (input.mode !== undefined) changes.mode = input.mode === null ? null : testMode(input.mode)
  if (input.runCommand !== undefined) changes.runCommand = String(input.runCommand)
  if (input.port !== undefined) {
    if (input.port === null || input.port === '') changes.port = null
    else {
      const port = Number(input.port)
      if (!isValidPort(port)) throw new Error('A port must be a whole number between 1 and 65535')
      changes.port = port
    }
  }
  return changes
}
