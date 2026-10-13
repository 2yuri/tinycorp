import { describe, expect, it } from 'vitest'
import { readWindowsMachine } from './windows-machine'

/**
 * What the first launch is told about this machine (T249).
 *
 * The step is drawn on Windows and nowhere else, so the reading has to say which machine this is
 * before anything else: a Mac that answered with a Git Bash row, or with an empty distro list that
 * read as *WSL is not installed*, would be a screen about a question that machine does not have.
 */

const UBUNTU = { name: 'Ubuntu', running: true, default: true }
const DEBIAN = { name: 'Debian', running: false, default: false }
const GIT_BASH = { path: 'C:\\Program Files\\Git\\bin\\bash.exe', lookedIn: ['Windows PATH'] }

describe('what the first launch is told about a Windows machine', () => {
  it('names the distros in the order they are offered, the default one first', () => {
    const machine = readWindowsMachine({
      platform: 'win32',
      distros: () => [UBUNTU, DEBIAN],
      gitBash: () => GIT_BASH,
    })

    expect(machine.windows).toBe(true)
    expect(machine.distros).toEqual([
      { name: 'Ubuntu', default: true },
      { name: 'Debian', default: false },
    ])
    expect(machine.gitBash).toEqual(GIT_BASH)
  })

  it('says a Windows with no WSL has no distros, which is not the same as not being Windows', () => {
    const machine = readWindowsMachine({ platform: 'win32', distros: () => [], gitBash: () => GIT_BASH })
    expect(machine).toMatchObject({ windows: true, distros: [] })
  })

  it('drops whether a distro was running: the step offers a place, not a state', () => {
    const machine = readWindowsMachine({ platform: 'win32', distros: () => [DEBIAN], gitBash: () => GIT_BASH })
    expect(machine.distros[0]).toEqual({ name: 'Debian', default: false })
  })
})

describe('every other desktop', () => {
  it('is not Windows, and is asked nothing: no distros, no Git Bash, no step', () => {
    let asked = 0
    const machine = readWindowsMachine({
      platform: 'darwin',
      distros: () => {
        asked += 1
        return [UBUNTU]
      },
      gitBash: () => {
        asked += 1
        return GIT_BASH
      },
    })

    expect(machine).toEqual({ windows: false, distros: [], gitBash: { path: null, lookedIn: [] } })
    expect(asked).toBe(0)
  })
})
