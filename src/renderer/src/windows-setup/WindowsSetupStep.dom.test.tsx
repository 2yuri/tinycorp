// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultBoss } from '../../../shared/boss-profile'
import type { WindowsMachine } from '../../../shared/platform/windows-machine'
import { WindowsSetupStep } from './WindowsSetupStep'

/**
 * The first launch on Windows as the boss meets it (T249, frames `laIUL` and `QFh5u`).
 *
 * What is pinned here is the promise the ticket makes and the one the boss decided afterwards:
 * both answers arrive preselected so `Continue` is one press, and `Continue` does not exist for a
 * team that cannot work — a team on Windows with no Git for Windows has no `bash` and no `git`.
 */

const GIT_BASH = { path: 'C:\\Program Files\\Git\\bin\\bash.exe', lookedIn: ['PATH'] }
const NO_GIT_BASH = { path: null, lookedIn: ['PATH', 'C:\\Program Files\\Git\\bin'] }

function machine(over: Partial<WindowsMachine> = {}): WindowsMachine {
  return { windows: true, distros: [{ name: 'Ubuntu', default: true }], gitBash: GIT_BASH, ...over }
}
/**
 * The step is the Launcher's own window, and that window carries the update notice and the title
 * bar — two readers of the bridge this test has nothing to say about. They are given the empty
 * answers a window with no preload gives, which is what they are written against.
 */
;(window as unknown as { tinyCorp: Record<string, unknown> }).tinyCorp['updates'] = {
  get: () => Promise.resolve({ state: 'idle' }),
  onChanged: () => () => {},
}
;(window as unknown as { tinyCorp: Record<string, unknown> }).tinyCorp['shell'] = {
  platform: 'win32',
  toggleMaximize: () => Promise.resolve(),
}

let host: HTMLDivElement
let root: Root
let saved: { defaultRuntime: string | null; rightClick: string }[]
let rechecked: number

beforeEach(() => {
  saved = []
  rechecked = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function mount(over: Partial<WindowsMachine> = {}) {
  act(() =>
    root.render(
      <WindowsSetupStep
        machine={machine(over)}
        boss={defaultBoss('Ada')}
        onRecheck={() => {
          rechecked += 1
        }}
        onDone={(answers) => saved.push(answers)}
      />,
    ),
  )
}

const button = (label: string) =>
  [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label)) ?? null

const text = () => host.textContent ?? ''

describe('the first launch on Windows', () => {
  it('opens on WSL with the machine’s own distro, so Continue is one press', () => {
    mount()
    act(() => button('Continue')?.click())

    expect(saved).toEqual([{ defaultRuntime: 'wsl:Ubuntu', rightClick: 'paste' }])
  })

  it('says what the other mouse button will do, which nobody discovers by trying', () => {
    mount()
    expect(text()).toContain('Right-click pastes the clipboard. Ctrl + right-click opens the menu.')
  })

  /** There is no Skip: the boss decided the setup is required (both answers come preselected). */
  it('offers no way past it but Continue', () => {
    mount()
    expect(button('Skip')).toBeNull()
  })

  it('holds a team on Windows that has no Git for Windows, and says both ways out', () => {
    mount({ gitBash: NO_GIT_BASH })
    act(() => host.querySelectorAll('input[name="team-runtime"]')[0]?.dispatchEvent(clickEvent()))

    expect(button('Continue')?.disabled).toBe(true)
    expect(text()).toContain('Git for Windows is not installed')
    expect(text()).toContain('Install Git for Windows and check again — or run your team in WSL.')
    // The install line, and everywhere it looked, so a boss who has it elsewhere can see why.
    expect(text()).toContain('winget install --id Git.Git -e')
    expect(text()).toContain('Looked in: PATH · C:\\Program Files\\Git\\bin')
  })

  it('lets the boss out of it by moving the team into WSL', () => {
    mount({ gitBash: NO_GIT_BASH })
    // Windows first, which blocks; then WSL, which does not.
    act(() => host.querySelectorAll('input[name="team-runtime"]')[0]?.dispatchEvent(clickEvent()))
    expect(button('Continue')?.disabled).toBe(true)

    act(() => host.querySelectorAll('input[name="team-runtime"]')[1]?.dispatchEvent(clickEvent()))
    expect(button('Continue')?.disabled).toBe(false)
    expect(text()).not.toContain('Git for Windows is not installed')
  })

  it('walks the machine again when the boss has just installed it', () => {
    mount({ gitBash: NO_GIT_BASH })
    act(() => host.querySelectorAll('input[name="team-runtime"]')[0]?.dispatchEvent(clickEvent()))

    act(() => button('Check again')?.click())
    expect(rechecked).toBe(1)
  })

  it('saves the right-click the boss picked, not the one it opened on', () => {
    mount()
    const menu = [...host.querySelectorAll('input[name^="right-click"]')][1]
    act(() => menu?.dispatchEvent(clickEvent()))
    act(() => button('Continue')?.click())

    expect(saved).toEqual([{ defaultRuntime: 'wsl:Ubuntu', rightClick: 'menu' }])
    expect(text()).toContain('Right-click opens the menu. Ctrl + right-click pastes the clipboard.')
  })

  it('offers Windows alone on a machine with no WSL, and lets it through when Git Bash is there', () => {
    mount({ distros: [] })
    expect(button('Continue')?.disabled).toBe(false)
    act(() => button('Continue')?.click())
    expect(saved).toEqual([{ defaultRuntime: 'windows', rightClick: 'paste' }])
  })
})

/** A real click on a radio, which is what React's `onChange` listens for. */
function clickEvent() {
  return new MouseEvent('click', { bubbles: true, cancelable: true })
}
