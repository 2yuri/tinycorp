// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Boss, defaultBoss } from '../../../shared/boss-profile'
import type { WindowsMachine } from '../../../shared/platform/windows-machine'
import { OnThisPcCard } from './OnThisPcCard'

/**
 * Your profile → On this PC (T249, frame `t1VDYQ`), and what it is on a machine the frame is not
 * about.
 *
 * The rule the card exists to keep is the ticket's: **the right-click setting shows on every OS**,
 * and the Windows rows show on Windows. A card that drew a WSL picker on a Mac would be a row about
 * a question that machine does not have; one that hid the right button there would be a setting the
 * boss can only reach by buying a PC.
 */

const GIT_BASH = { path: 'C:\\Program Files\\Git\\bin\\bash.exe', lookedIn: ['PATH'] }

function machine(over: Partial<WindowsMachine> = {}): WindowsMachine {
  return { windows: true, distros: [{ name: 'Ubuntu', default: true }], gitBash: GIT_BASH, ...over }
}

/** The platform the card reads for the right-click default and the modifier it names. */
const desktop = { value: 'win32' }
;(window as unknown as { tinyCorp: Record<string, unknown> }).tinyCorp['shell'] = {
  get platform() {
    return desktop.value
  },
}

let host: HTMLDivElement
let root: Root
let saved: Record<string, unknown>[]

beforeEach(() => {
  desktop.value = 'win32'
  saved = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function mount(over: Partial<WindowsMachine> = {}, boss: Boss = defaultBoss('Ada')) {
  act(() => root.render(<OnThisPcCard machine={machine(over)} boss={boss} onSave={(update) => saved.push(update)} />))
}

const text = () => host.textContent ?? ''

describe('On this PC, on Windows', () => {
  it('shows where the team runs, its distro, and what this machine has for Git Bash', () => {
    mount()
    expect(text()).toContain('On this PC')
    expect(text()).toContain('Where your team runs')
    expect(text()).toContain('WSL distribution')
    expect(text()).toContain('Found')
    expect(text()).toContain('C:\\Program Files\\Git\\bin\\bash.exe')
  })

  it('says how to install Git Bash, and why, when this machine has none', () => {
    mount({ gitBash: { path: null, lookedIn: ['PATH'] } })
    expect(text()).toContain('Not installed')
    expect(text()).toContain('winget install --id Git.Git -e')
    expect(text()).toContain('Needed only while your team runs on Windows.')
  })

  it('saves a moved team at once, rather than into Your profile’s draft', () => {
    mount({}, { ...defaultBoss('Ada'), defaultRuntime: 'wsl:Ubuntu' })
    const windows = [...host.querySelectorAll('input[name^="team-runtime"]')][0]
    act(() => windows?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(saved).toEqual([{ defaultRuntime: 'windows' }])
  })

  it('saves the right-click on the spot too', () => {
    mount()
    const menu = [...host.querySelectorAll('input[name^="right-click"]')][1]
    act(() => menu?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(saved).toEqual([{ rightClick: 'menu' }])
  })
})

describe('On this PC, on a Mac or a Linux desktop', () => {
  beforeEach(() => {
    desktop.value = 'darwin'
  })

  it('keeps the right-click row — the one question every desktop really has', () => {
    mount({ windows: false, distros: [], gitBash: { path: null, lookedIn: [] } })
    expect(text()).toContain('Right-click in the terminal')
    expect(text()).toContain('On this computer')
  })

  it('draws none of the Windows rows, which are about a question it does not have', () => {
    mount({ windows: false, distros: [], gitBash: { path: null, lookedIn: [] } })
    expect(text()).not.toContain('Where your team runs')
    expect(text()).not.toContain('WSL distribution')
    expect(text()).not.toContain('Git Bash')
  })
})
