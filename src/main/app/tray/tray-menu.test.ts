import { describe, expect, it, vi } from 'vitest'
import { type TrayFacts, traySummary } from '../../../shared/app/tray'
import { type TrayActions, trayMenu } from './tray-menu'

function summaryOf(overrides: Partial<TrayFacts> = {}) {
  return traySummary({
    sessions: { ada: 'busy' },
    pendingRequesterIds: [],
    askingIds: [],
    outOfBudget: false,
    paused: false,
    companies: [{ id: 'acme', name: 'Acme', current: true }],
    ...overrides,
  })
}

function actions(): TrayActions & { opened: (string | null)[] } {
  const opened: (string | null)[] = []
  return { opened, open: (id) => opened.push(id), pauseAll: vi.fn(), resumeAll: vi.fn(), quit: vi.fn() }
}

const labels = (items: { label?: string }[]) => items.flatMap((item) => (item.label ? [item.label] : []))

describe('the menu-bar item’s menu', () => {
  it('says what the floor is doing in its first, unclickable row', () => {
    const menu = trayMenu(summaryOf({ sessions: { ada: 'busy', bo: 'idle' }, pendingRequesterIds: ['bo'] }), actions())

    expect(menu[0]).toMatchObject({ label: '2 at work · 1 waiting on you', enabled: false })
  })

  it('offers every known Company to reopen, and opens the one the boss picks', () => {
    const act = actions()
    const menu = trayMenu(
      summaryOf({
        companies: [
          { id: 'acme', name: 'Acme', current: true },
          { id: 'globex', name: 'Globex', current: false },
        ],
      }),
      act,
    )

    expect(labels(menu)).toContain('Open Acme')
    expect(labels(menu)).toContain('Open Globex')
    menu.find((item) => item.label === 'Open Globex')?.click?.()
    expect(act.opened).toEqual(['globex'])
  })

  it('offers the app itself when no Company is known', () => {
    const act = actions()
    const menu = trayMenu(summaryOf({ companies: [] }), act)

    menu.find((item) => item.label === 'Open TinyCorp')?.click?.()
    expect(act.opened).toEqual([null])
  })

  it('pauses everything, exactly as the office header’s button does', () => {
    const act = actions()
    const menu = trayMenu(summaryOf(), act)

    const pause = menu.find((item) => item.label === 'Pause all')
    expect(pause?.enabled).toBe(true)
    pause?.click?.()
    expect(act.pauseAll).toHaveBeenCalled()
  })

  it('greys out Pause all when there is no Session to stop', () => {
    const menu = trayMenu(summaryOf({ sessions: { ada: 'off' } }), actions())

    expect(menu.find((item) => item.label === 'Pause all')?.enabled).toBe(false)
  })

  it('reads Resume all while the Company is paused (decision 38)', () => {
    const act = actions()
    const menu = trayMenu(summaryOf({ sessions: { ada: 'off' }, paused: true }), act)

    expect(labels(menu)).not.toContain('Pause all')
    menu.find((item) => item.label === 'Resume all')?.click?.()
    expect(act.resumeAll).toHaveBeenCalled()
  })

  it('quits for real', () => {
    const act = actions()
    const menu = trayMenu(summaryOf(), act)

    menu.at(-1)?.click?.()
    expect(act.quit).toHaveBeenCalled()
    expect(menu.at(-1)?.label).toBe('Quit TinyCorp')
  })
})
