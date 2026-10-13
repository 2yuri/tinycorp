import { describe, expect, it } from 'vitest'
import { usageChannels } from '../../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { CLAUDE_USAGE_URL, createProviderUsage, type UsageHttp } from './provider-usage'
import { registerUsageIpc } from './usage-ipc'

const ANSWER = JSON.stringify({
  five_hour: { utilization: 6, resets_at: '2026-09-18T13:00:00Z' },
  seven_day: { utilization: 15, resets_at: '2026-09-20T22:00:00Z' },
})

const CODEX_ANSWER = JSON.stringify({
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: 1_790_311_819 },
    secondary_window: { used_percent: 55, limit_window_seconds: 604_800, reset_at: 1_790_336_150 },
  },
})

function setup(http?: UsageHttp) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  let calls = 0
  const usage = createProviderUsage({
    claudeCredential: async () => ({ login: { accessToken: 'oauth-token', expiresAt: null }, lookedIn: [] }),
    codexCredential: async () => ({
      login: { accessToken: 'chatgpt-token', accountId: 'workspace-1' },
      lookedIn: [],
    }),
    http:
      http ??
      // One answer per endpoint: the snapshot is two reads, and `calls` counts Claude's so the
      // cache assertions below stay about one read rather than about how many Providers answer.
      (async ({ url }) => {
        if (url !== CLAUDE_USAGE_URL) return { status: 200, body: CODEX_ANSWER }
        calls++
        return { status: 200, body: ANSWER }
      }),
    now: () => Date.parse('2026-09-18T08:40:00Z'),
    log: () => {},
  })
  let broadcasts = 0
  registerUsageIpc({ ipc, usage, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { invoke, calls: () => calls, broadcasts: () => broadcasts }
}

describe('Usage IPC', () => {
  it('serves what each Provider reports, with the windows each one answered', async () => {
    const { invoke } = setup()

    expect(await invoke(usageChannels.read)).toEqual({
      ok: true,
      value: {
        readAt: '2026-09-18T08:40:00.000Z',
        providers: [
          {
            id: 'claude',
            name: 'Claude',
            problem: null,
            reason: null,
            accounts: [],
            windows: [
              { key: 'five_hour', label: '5h', percent: 6, resetsAt: '2026-09-18T13:00:00.000Z' },
              { key: 'seven_day', label: 'wk', percent: 15, resetsAt: '2026-09-20T22:00:00.000Z' },
            ],
          },
          {
            id: 'codex',
            name: 'Codex',
            problem: null,
            reason: null,
            accounts: [],
            windows: [
              { key: 'primary_window', label: '5h', percent: 0, resetsAt: '2026-09-25T04:50:19.000Z' },
              { key: 'secondary_window', label: 'wk', percent: 55, resetsAt: '2026-09-25T11:35:50.000Z' },
            ],
          },
          expect.objectContaining({ id: 'opencode', problem: 'not-connected' }),
        ],
      },
    })
  })

  it('reuses the cached read, and asks again on refresh', async () => {
    const { invoke, calls } = setup()

    await invoke(usageChannels.read)
    await invoke(usageChannels.read)
    expect(calls()).toBe(1)

    await invoke(usageChannels.refresh)
    expect(calls()).toBe(2)
  })

  it('tells the renderer each time fresh numbers land', async () => {
    const { invoke, broadcasts } = setup()

    await invoke(usageChannels.read)
    await invoke(usageChannels.refresh)

    expect(broadcasts()).toBe(2)
  })

  it('carries a Provider’s failure as its reason, not as an error', async () => {
    const { invoke } = setup(async () => ({ status: 500, body: 'boom' }))

    const result = (await invoke(usageChannels.read)) as {
      ok: boolean
      value: { providers: { id: string; problem: string | null; reason: string | null }[] }
    }

    expect(result.ok).toBe(true)
    expect(result.value.providers[0]).toMatchObject({ problem: 'unavailable', reason: 'Claude answered HTTP 500' })
  })
})
