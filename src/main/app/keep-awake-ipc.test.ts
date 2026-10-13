import { describe, expect, it } from 'vitest'
import { KEEP_AWAKE_DEFAULT, type KeepAwakeState } from '../../shared/app/keep-awake'
import { keepAwakeChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core/ipc-kit'
import type { WakeAssertion } from '../platform/wake-lock'
import { createKeepAwake } from './keep-awake'
import { registerKeepAwakeIpc } from './keep-awake-ipc'

function setup(supported = true) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const started: { released: boolean }[] = []
  const start = (): WakeAssertion => {
    const held = { released: false }
    started.push(held)
    return { release: () => (held.released = true) }
  }
  const broadcasts: KeepAwakeState[] = []
  const keepAwake = createKeepAwake({
    start,
    supported,
    store: { read: () => null, write: () => {} },
    onChanged: (state) => broadcasts.push(state),
  })
  registerKeepAwakeIpc({ ipc, keepAwake })
  return {
    keepAwake,
    broadcasts,
    started: () => started.length,
    live: () => started.filter((held) => !held.released).length,
    invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
  }
}

describe('Keep awake IPC', () => {
  it('serves the cup what it draws: the mode, the hold and whether it can hold at all', async () => {
    const awake = setup()
    expect(await awake.invoke(keepAwakeChannels.get)).toEqual({
      mode: KEEP_AWAKE_DEFAULT,
      holding: false,
      supported: true,
    })
  })

  it('holds the machine awake when the boss picks On, and lets go on Off', async () => {
    const awake = setup()

    expect(await awake.invoke(keepAwakeChannels.setMode, 'on')).toEqual({
      ok: true,
      value: { mode: 'on', holding: true, supported: true },
    })
    expect(awake.started()).toBe(1)

    await awake.invoke(keepAwakeChannels.setMode, 'off')
    expect(awake.live()).toBe(0)
    expect(awake.broadcasts.map((state) => `${state.mode}:${state.holding}`)).toEqual(['on:true', 'off:false'])
  })

  it('refuses a mode nobody offers', async () => {
    const awake = setup()
    expect(await awake.invoke(keepAwakeChannels.setMode, 'always')).toEqual({
      ok: false,
      error: expect.stringMatching(/keep-awake mode/i),
    })
    expect(awake.started()).toBe(0)
  })

  it('takes nothing, and says the cup does not belong, where nothing can hold this machine awake', async () => {
    const awake = setup(false)
    await awake.invoke(keepAwakeChannels.setMode, 'on')

    expect(awake.started()).toBe(0)
    expect(await awake.invoke(keepAwakeChannels.get)).toEqual({
      mode: 'on',
      holding: false,
      supported: false,
    })
  })
})
