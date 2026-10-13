import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('openHire', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('window', new EventTarget())
  })

  it('reaches a listener that is already mounted, once', async () => {
    const { onOpenHire, openHire } = await import('./open-hire')
    const listener = vi.fn()
    onOpenHire(listener)
    openHire()
    expect(listener).toHaveBeenCalledTimes(1)
    onOpenHire(listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('waits for a listener that mounts after the request, e.g. after switching to the Employees view', async () => {
    const { onOpenHire, openHire } = await import('./open-hire')
    openHire()
    const listener = vi.fn()
    onOpenHire(listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a listener when nobody asked', async () => {
    const { onOpenHire } = await import('./open-hire')
    const listener = vi.fn()
    onOpenHire(listener)
    expect(listener).not.toHaveBeenCalled()
  })

  it('carries the role the ask named, and none when it named none', async () => {
    const { onOpenHire, openHire } = await import('./open-hire')
    const listener = vi.fn()
    onOpenHire(listener)
    openHire('r-frontend')
    expect(listener).toHaveBeenLastCalledWith({ roleId: 'r-frontend' })
    openHire()
    expect(listener).toHaveBeenLastCalledWith({})
  })
})

/**
 * The ask reached nobody for a while: the only subscriber was `staff/Staff.tsx`, which the router
 * stopped mounting, so the office header's `Hire`, the application menu's item and `/hire <role>`
 * all did nothing visible. The view the router does mount has to be the one that listens.
 */
describe('the view the shell mounts for Employees', () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

  it('is the one that subscribes to the ask', () => {
    const mounted = /employees: \([^)]*\) =>\s*\(?\s*<(\w+)/.exec(read('shell/Views.tsx'))?.[1]

    expect(mounted).toBe('EmployeesView')
    expect(read('employees/EmployeesView.tsx')).toContain('onOpenHire(')
  })
})
