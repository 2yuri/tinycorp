import { describe, expect, it, vi } from 'vitest'
import type { KeepAwakeMode } from '../../../shared/app/keep-awake'
import type { MenuCommand } from '../../../shared/app/menu'
import { type AppMenuItem, type AppMenuState, appMenu } from './app-menu'

function state(overrides: Partial<AppMenuState> = {}): AppMenuState {
  return {
    company: 'Acme',
    employees: 3,
    running: 2,
    paused: false,
    keepAwake: { mode: 'working', holding: true, supported: true },
    recents: [
      { id: 'acme', name: 'Acme', current: true, missing: false },
      { id: 'globex', name: 'Globex', current: false, missing: false },
    ],
    mac: true,
    ...overrides,
  }
}

function actions() {
  const sent: MenuCommand[] = []
  const modes: KeepAwakeMode[] = []
  return {
    sent,
    modes,
    send: (command: MenuCommand) => sent.push(command),
    closeCompany: vi.fn(),
    setKeepAwakeMode: (mode: KeepAwakeMode) => modes.push(mode),
    openRepo: vi.fn(),
  }
}

const labels = (items: AppMenuItem[]) => items.flatMap((item) => (item.label ? [item.label] : []))
const names = (items: AppMenuItem[]) => items.map((item) => item.label ?? item.role)

function menuOf(overrides: Partial<AppMenuState> = {}, act = actions()) {
  const items = appMenu(state(overrides), act)
  const submenu = (name: string): AppMenuItem[] =>
    items.find((item) => (item.label ?? item.role) === name)?.submenu ?? []
  const find = (name: string, where: string): AppMenuItem => {
    const found = submenu(where).find((item) => item.label === name)
    if (!found) throw new Error(`No ${name} in ${where}: ${labels(submenu(where)).join(', ')}`)
    return found
  }
  return { items, act, submenu, find }
}

describe('the application menu', () => {
  it('has the app, the Companies, the team, the views and the roles macOS owns, in that order', () => {
    const { items } = menuOf()

    expect(names(items)).toEqual(['TinyCorp', 'File', 'editMenu', 'Team', 'Go', 'View', 'windowMenu', 'help'])
  })

  it('names the boss’s own screens and the awake modes in the app menu, above Hide and Quit', () => {
    const { submenu } = menuOf()

    expect(names(submenu('TinyCorp'))).toEqual([
      'About TinyCorp',
      undefined,
      'Your profile…',
      'Company settings…',
      undefined,
      'Keep this Mac awake',
      undefined,
      'Hide TinyCorp',
      'hideOthers',
      'unhide',
      undefined,
      'Quit TinyCorp',
    ])
  })

  it('gives every item the boss reaches by hand a key', () => {
    const { find } = menuOf()
    const key = (name: string, where: string) => find(name, where).accelerator

    expect(key('Company settings…', 'TinyCorp')).toBe('CmdOrCtrl+,')
    expect(key('New Company…', 'File')).toBe('CmdOrCtrl+N')
    expect(key('Open a Company…', 'File')).toBe('CmdOrCtrl+O')
    expect(key('Close Company', 'File')).toBe('CmdOrCtrl+W')
    expect(key('Hire Employee…', 'Team')).toBe('CmdOrCtrl+Shift+H')
    expect(key('Pause all', 'Team')).toBe('CmdOrCtrl+Shift+P')
    // Resume all takes the same key, so one keystroke is the whole floor's stop and start.
    expect(menuOf({ paused: true }).find('Resume all', 'Team').accelerator).toBe('CmdOrCtrl+Shift+P')
  })

  it('reaches every view by number, in the order the menu lists them', () => {
    const { submenu } = menuOf()

    expect(submenu('Go').map((item) => [item.label, item.accelerator])).toEqual([
      ['Office', 'CmdOrCtrl+1'],
      ['Chat', 'CmdOrCtrl+2'],
      ['Board', 'CmdOrCtrl+3'],
      ['Repositories', 'CmdOrCtrl+4'],
      ['Employees', 'CmdOrCtrl+5'],
      ['Activity', 'CmdOrCtrl+6'],
      ['Review', 'CmdOrCtrl+7'],
      ['Inbox', 'CmdOrCtrl+0'],
    ])
  })

  it('keeps Reload and Developer Tools under a separator at the foot of View', () => {
    const { submenu } = menuOf()

    expect(names(submenu('View'))).toEqual([
      'Full screen',
      'Legend',
      undefined,
      'zoomIn',
      'zoomOut',
      'resetZoom',
      undefined,
      'reload',
      'forceReload',
      'toggleDevTools',
    ])
  })

  it('points Help at the repo', () => {
    const { find, act } = menuOf()

    find('TinyCorp on GitHub', 'help').click?.()

    expect(act.openRepo).toHaveBeenCalled()
  })
})

describe('what the menu can do with no Company open', () => {
  const nothing: Partial<AppMenuState> = { company: null, employees: 0, running: 0 }

  it('still opens a Company and still sets the awake mode', () => {
    const { find, submenu } = menuOf(nothing)

    expect(find('New Company…', 'File').enabled).not.toBe(false)
    expect(find('Open a Company…', 'File').enabled).not.toBe(false)
    expect(find('Open Recent', 'File').enabled).toBe(true)
    expect(submenu('TinyCorp').find((item) => item.label === 'Keep this Mac awake')?.enabled).not.toBe(false)
  })

  it('greys what has no Company to act on', () => {
    const { find, submenu } = menuOf(nothing)

    expect(find('Close Company', 'File').enabled).toBe(false)
    expect(find('Move Company…', 'File').enabled).toBe(false)
    expect(find('Company settings…', 'TinyCorp').enabled).toBe(false)
    expect(submenu('Team').every((item) => item.type === 'separator' || item.enabled === false)).toBe(true)
    expect(submenu('Go').every((item) => item.enabled === false)).toBe(true)
    expect(find('Legend', 'View').enabled).toBe(false)
  })

  it('offers nothing to reopen before the boss has opened anything', () => {
    const { find } = menuOf({ ...nothing, recents: [] })

    const recent = find('Open Recent', 'File')
    expect(recent.enabled).toBe(false)
    expect(labels(recent.submenu ?? [])).toEqual(['Nothing yet'])
  })
})

describe('the Team menu', () => {
  it('hires in a Company with nobody, and has no Session to touch', () => {
    const { find } = menuOf({ employees: 0, running: 0 })

    expect(find('Hire Employee…', 'Team').enabled).toBe(true)
    expect(find('Pause all', 'Team').enabled).toBe(false)
    expect(find('Start every Session', 'Team').enabled).toBe(false)
    expect(find('Stop every Session', 'Team').enabled).toBe(false)
  })

  it('pauses and stops while Sessions run, and starts whoever is still off', () => {
    const { find } = menuOf({ employees: 3, running: 2 })

    expect(find('Pause all', 'Team').enabled).toBe(true)
    expect(find('Stop every Session', 'Team').enabled).toBe(true)
    expect(find('Start every Session', 'Team').enabled).toBe(true)
  })

  it('has nobody left to start once everyone is running', () => {
    const { find } = menuOf({ employees: 3, running: 3 })

    expect(find('Start every Session', 'Team').enabled).toBe(false)
  })

  it('reads Resume all while the Company is paused, and starts nothing behind its back', () => {
    const { find, submenu } = menuOf({ paused: true, employees: 3, running: 0 })

    expect(labels(submenu('Team'))).not.toContain('Pause all')
    expect(find('Resume all', 'Team').enabled).not.toBe(false)
    // While paused a Session cannot be started at all: Resume all is the way back (decision 38).
    expect(find('Start every Session', 'Team').enabled).toBe(false)
    expect(find('Stop every Session', 'Team').enabled).toBe(false)
  })
})

describe('Keep this Mac awake', () => {
  it('offers the cup’s three modes with the live one ticked, and sets the one picked', () => {
    const { submenu, act } = menuOf({ keepAwake: { mode: 'working', holding: true, supported: true } })
    const modes = submenu('TinyCorp').find((item) => item.label === 'Keep this Mac awake')?.submenu ?? []

    expect(modes.map((item) => [item.label, item.checked])).toEqual([
      ['On', false],
      ['While anyone is working', true],
      ['Off', false],
    ])
    modes.find((item) => item.label === 'Off')?.click?.()
    expect(act.modes).toEqual(['off'])
  })

  it('is missing entirely where there is no assertion to hold, as the cup is', () => {
    const { submenu } = menuOf({ keepAwake: { mode: 'off', holding: false, supported: false } })

    expect(labels(submenu('TinyCorp'))).not.toContain('Keep this Mac awake')
  })
})

describe('Open Recent', () => {
  it('lists the Companies in the order it is handed, ticks the open one and never reopens it', () => {
    const { find, act } = menuOf()
    const recents = find('Open Recent', 'File').submenu ?? []

    expect(recents.map((item) => [item.label, item.checked, item.enabled])).toEqual([
      ['Acme', true, false],
      ['Globex', false, true],
    ])
    recents.find((item) => item.label === 'Globex')?.click?.()
    expect(act.sent).toEqual([{ kind: 'open-recent', companyId: 'globex' }])
  })

  it('greys a Company whose folder is gone rather than dropping it', () => {
    const { find } = menuOf({
      recents: [{ id: 'gone', name: 'Gone', current: false, missing: true }],
    })

    expect((find('Open Recent', 'File').submenu ?? [])[0]).toMatchObject({ label: 'Gone', enabled: false })
  })
})

describe('every item does what its own button does', () => {
  const commands: [string, string, MenuCommand][] = [
    ['TinyCorp', 'Your profile…', { kind: 'go', target: 'profile' }],
    ['TinyCorp', 'Company settings…', { kind: 'go', target: 'settings' }],
    ['File', 'New Company…', { kind: 'new-company' }],
    ['File', 'Open a Company…', { kind: 'open-company' }],
    ['File', 'Move Company…', { kind: 'move-company' }],
    ['Team', 'Hire Employee…', { kind: 'hire' }],
    ['Team', 'Pause all', { kind: 'pause-all' }],
    ['Team', 'Start every Session', { kind: 'start-every-session' }],
    ['Team', 'Stop every Session', { kind: 'stop-every-session' }],
    ['Go', 'Office', { kind: 'go', target: 'office' }],
    ['Go', 'Chat', { kind: 'go', target: 'chat' }],
    ['Go', 'Board', { kind: 'go', target: 'board' }],
    ['Go', 'Repositories', { kind: 'go', target: 'repositories' }],
    ['Go', 'Employees', { kind: 'go', target: 'employees' }],
    ['Go', 'Activity', { kind: 'go', target: 'activity' }],
    ['Go', 'Review', { kind: 'go', target: 'review' }],
    ['Go', 'Inbox', { kind: 'go', target: 'inbox' }],
    ['View', 'Legend', { kind: 'legend' }],
  ]

  for (const [where, label, command] of commands) {
    it(`${label} sends ${command.kind}`, () => {
      const { find, act } = menuOf()

      find(label, where).click?.()

      expect(act.sent).toEqual([command])
    })
  }

  it('Resume all sends the Resume all the header’s button sends', () => {
    const { find, act } = menuOf({ paused: true })

    find('Resume all', 'Team').click?.()

    expect(act.sent).toEqual([{ kind: 'resume-all' }])
  })

  it('lets the window decide what ⌘W closes', () => {
    const { find, act } = menuOf()

    find('Close Company', 'File').click?.()

    expect(act.closeCompany).toHaveBeenCalled()
  })
})

describe('away from macOS', () => {
  it('keeps the same items, with the app menu’s own moved into File and Help', () => {
    const { items, submenu } = menuOf({ mac: false, keepAwake: { mode: 'off', holding: false, supported: false } })

    expect(names(items)).toEqual(['File', 'editMenu', 'Team', 'Go', 'View', 'windowMenu', 'help'])
    expect(names(submenu('File'))).toEqual([
      'New Company…',
      'Open a Company…',
      'Open Recent',
      undefined,
      'Close Company',
      'Move Company…',
      undefined,
      'Your profile…',
      'Company settings…',
      undefined,
      'quit',
    ])
    expect(labels(submenu('help'))).toEqual(['TinyCorp on GitHub', 'About TinyCorp'])
  })
})
