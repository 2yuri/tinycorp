import { describe, expect, it } from 'vitest'
import type { CrashReport } from '../../shared/app/crash'
import { crashChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core/ipc-kit'
import { registerCrashIpc } from './crash-ipc'
import type { CrashLog } from './crash-log'

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const written: CrashReport[] = []
  const log: CrashLog = { path: '/logs/crashes.log', record: (report) => written.push(report), recordThrow: () => {} }
  registerCrashIpc({ ipc, log, environment: { version: '1.4.0', platform: 'darwin' } })
  return { written, invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) }
}

describe('Crash IPC', () => {
  it('writes what a boundary caught to the app’s log', () => {
    const { invoke, written } = setup()

    invoke(crashChannels.record, {
      source: 'view',
      message: 'TypeError: destroy_ is not a function',
      stack: 'at FileTree (files/FileTree.tsx:48)',
      route: 'files',
      version: '9.9.9',
      platform: 'made up',
      at: new Date(2026, 8, 21, 12, 41).toISOString(),
    })

    expect(written).toEqual([
      expect.objectContaining({
        source: 'view',
        message: 'TypeError: destroy_ is not a function',
        stack: 'at FileTree (files/FileTree.tsx:48)',
        route: 'files',
        // The build is this process's, never the renderer's word for it.
        version: '1.4.0',
        platform: 'darwin',
      }),
    ])
  })

  it('redacts a path a renderer that has itself gone wrong sent anyway', () => {
    const { invoke, written } = setup()

    invoke(crashChannels.record, { source: 'view', message: "open '/Users/grace/work/acme/docs/spec.md'" })

    expect(written[0]!.message).toBe("open '…/spec.md'")
  })

  it('takes a report of any shape without throwing back at the renderer', () => {
    const { invoke, written } = setup()

    invoke(crashChannels.record, null)
    invoke(crashChannels.record, { source: 'made up', route: 42, at: 'not a date' })

    expect(written.map((report) => report.source)).toEqual(['window', 'window'])
    expect(written[1]!.route).toBeNull()
    expect(Number.isNaN(new Date(written[1]!.at).getTime())).toBe(false)
  })
})
