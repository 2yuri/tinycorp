import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TinyCorpApi } from '../../../shared/ipc'
import { EMPTY_USAGE_SNAPSHOT } from '../../../shared/usage/provider-usage'
import { USAGE_AUTO_REFRESH_MS, useProviderUsage } from './UsageButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

function Usage() {
  useProviderUsage(false)
  return null
}

describe('the usage keeps itself current (T279)', () => {
  it('asks again every minute and when the window comes back, and stops once gone', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ ok: true as const, value: EMPTY_USAGE_SNAPSHOT }))
    window.tinyCorp = {
      usage: { read, refresh: read, onChanged: () => () => {} },
    } as unknown as TinyCorpApi
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(<Usage />))
    expect(read).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS))
    expect(read).toHaveBeenCalledTimes(2)

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(read).toHaveBeenCalledTimes(3)

    act(() => root?.unmount())
    root = null
    await act(async () => vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS * 3))
    expect(read).toHaveBeenCalledTimes(3)
  })
})
