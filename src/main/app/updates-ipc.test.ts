import { describe, expect, it } from 'vitest'
import type { UpdateState } from '../../shared/app/updates'
import { updateChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core/ipc-kit'
import type { UpdateCheck } from './update-check'
import { registerUpdatesIpc } from './updates-ipc'

const newer: UpdateState = {
  current: '0.3.9',
  available: {
    tag: 'v0.4.0',
    version: '0.4.0',
    publishedAt: '2026-09-18T09:00:00Z',
    url: 'https://github.com/2yuri/tinycorp/releases/tag/v0.4.0',
  },
  checkedAt: '2026-09-18T10:00:00Z',
  checking: false,
}

function setup(state: UpdateState) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const opened: string[] = []
  let checks = 0
  const updates: UpdateCheck = {
    state: () => state,
    check: async () => state,
    checkNow: async () => {
      checks++
      return state
    },
  }
  registerUpdatesIpc({ ipc, updates, openExternal: (url) => opened.push(url) })
  return { invoke: (channel: string) => handlers.get(channel)!(), opened, checks: () => checks }
}

describe('Updates IPC', () => {
  it('hands the renderer the running version and what was found', async () => {
    expect(await setup(newer).invoke(updateChannels.get)).toEqual(newer)
  })

  it('Check now asks again', async () => {
    const ipc = setup(newer)
    await ipc.invoke(updateChannels.checkNow)
    expect(ipc.checks()).toBe(1)
  })

  it('Open the download page opens the release GitHub named, in the system browser', async () => {
    const ipc = setup(newer)
    await ipc.invoke(updateChannels.openDownloadPage)
    expect(ipc.opened).toEqual(['https://github.com/2yuri/tinycorp/releases/tag/v0.4.0'])
  })

  it('opens nothing when there is no newer build', async () => {
    const ipc = setup({ ...newer, available: null })
    await ipc.invoke(updateChannels.openDownloadPage)
    expect(ipc.opened).toEqual([])
  })
})
