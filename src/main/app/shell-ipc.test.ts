import { describe, expect, it } from 'vitest'
import { shellChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core/ipc-kit'
import { registerShellIpc } from './shell-ipc'

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  let toggles = 0
  registerShellIpc({ ipc, toggleMaximize: () => toggles++ })
  return { invoke: (channel: string) => handlers.get(channel)!(), toggles: () => toggles }
}

describe('Shell IPC', () => {
  it('toggles the window maximize', () => {
    const shell = setup()
    shell.invoke(shellChannels.toggleMaximize)
    expect(shell.toggles()).toBe(1)
  })
})
