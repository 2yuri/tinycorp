// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import * as fixture from './fixture'
import { settingsCapture } from './SettingsCapture'

/**
 * The cheapest question a capture harness can be asked: did it draw its screen? A stub that has
 * fallen behind the shell throws on mount, React unmounts the tree and the harness shoots an empty
 * window — which the next auditor compares with the frame. That went unnoticed for eighteen days
 * (T146), so each tab the README tells them to shoot is mounted here.
 */
const TAB_HEADING: Record<string, string> = {
  general: 'Company profile',
  office: 'Rooms',
  routing: 'When a provider runs out',
  tokens: 'Compress what Employees read',
  addons: 'The ladder',
  environments: 'Employees never see these values.',
  integrations: 'MCP servers',
}

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

async function open(query: string): Promise<MountedCapture> {
  window.history.replaceState({}, '', `/settings-capture.html?${query}`)
  mounted = await mountCapture(settingsCapture)
  return mounted
}

describe('the Company settings capture harness', () => {
  it.each(Object.entries(TAB_HEADING))('draws the %s tab, not an empty window', async (tab, heading) => {
    const shot = await open(`tab=${tab}`)

    // The shell around the page, the page itself, and the tab the query asked for.
    expect(shot.text).toContain(fixture.company.name)
    expect(shot.text).toContain('Company settings')
    expect(shot.text).toContain(heading)
    // `ScreenBoundary` draws this over a screen that threw. A capture of it is a full window of
    // pixels and none of them are Company settings.
    expect(shot.text).not.toContain('This screen stopped drawing')
  })

  /**
   * The state every Company is in on its first day, and the one no capture ever shot: the tabs
   * shipped twice with an empty state nobody had designed or looked at (T181).
   */
  it.each(Object.entries(TAB_HEADING))('draws the %s tab of a Company with nothing in it', async (tab, heading) => {
    const shot = await open(`tab=${tab}&data=empty`)

    expect(shot.text).toContain(fixture.emptyCompany.name)
    expect(shot.text).toContain(heading)
    expect(shot.text).not.toContain('This screen stopped drawing')
  })

  it('draws a Company whose name is as long as one gets', async () => {
    const shot = await open('tab=general&data=long')

    expect(shot.text).toContain(fixture.longCompany.name)
    expect(shot.text).not.toContain('This screen stopped drawing')
  })

  /** The left column of frame `Cg3a8`: RTK, what it saved, and what Employees remember (T193). */
  it('draws What Employees remember under Compress, with the Company’s own budget picked', async () => {
    const shot = await open('tab=tokens')
    const at = (what: string) => shot.text.indexOf(what)

    expect(at('Compress what Employees read')).toBeLessThan(at('Saved this week'))
    expect(at('Saved this week')).toBeLessThan(at('What Employees remember'))
    expect(shot.text).toContain('Read at session start')
    expect(shot.text).toContain('Nothing is ever deleted, and search reads all of it.')
  })

  /** The two columns of frame `QgXdU`, in its order. The app drew a different one until T181. */
  it('lays General out as the frame does, and keeps the app’s build out of it', async () => {
    const shot = await open('tab=general')
    const at = (what: string) => shot.text.indexOf(what)

    expect(at('Company profile')).toBeLessThan(at('Chat & notifications'))
    expect(at('Chat & notifications')).toBeLessThan(at('Daily digest'))
    expect(at('Daily digest')).toBeLessThan(at('Team'))
    expect(at('Team')).toBeLessThan(at('Testing before merge'))
    expect(at('Testing before merge')).toBeLessThan(at('Danger zone'))
    // The build is the app's; it lives in Your profile's version row.
    expect(shot.text).not.toContain('Check now')
  })

  /**
   * A CLI that keeps one sign-in and a Company nobody has signed in for are different nothings,
   * and the empty capture is what told them apart.
   */
  it('says a Company with no sign-in has none, rather than that the CLI keeps one', async () => {
    const shot = await open('tab=routing&data=empty')

    expect(shot.text).toContain('No sign-in yet — add one in Your profile.')
  })

  /**
   * The states of frame `p4np9V`, which the machine the capture runs on cannot produce: a headless
   * Chrome cannot uninstall RTK, downgrade it, or be a Windows with a distro that lacks it.
   */
  it.each([
    ['missing', 'RTK isn’t on this computer', 'brew install rtk'],
    ['old', 'is too old', 'brew upgrade rtk'],
    ['wsl', 'Found on Windows, not in Ubuntu', 'install.sh'],
  ])('draws the Tokens tab with RTK %s, and the line that fixes it', async (state, title, command) => {
    const shot = await open(`tab=tokens&rtk=${state}`)

    expect(shot.text).toContain(title)
    expect(shot.text).toContain(command)
    expect(shot.text).not.toContain('This screen stopped drawing')
  })

  /**
   * The empty state is empty everywhere, not only in the tab. `?data=empty` emptied the page and
   * left the drawer answering for the frame's own Company, so the capture shot a Company with no
   * Employees beside a Chat row reading 12 and a Board row reading 31 — the same half-empty
   * fixture T181 was about, one panel to the left (T196).
   */
  it('hands the drawer the same empty Company it hands the tab', async () => {
    const shot = await open('tab=general&data=empty')
    const counts = [...shot.host.querySelectorAll('.shell-nav__count')].map((node) => node.textContent)

    expect(shot.text).toContain('0 Employees · Managed')
    expect(counts).toEqual([])
  })

  /**
   * `QgXdU` draws three repo overrides and an `Override for another repo` under them, which only
   * a Company with a fourth repo can produce — `FuDXm` lists four. The fixture had three, so the
   * capture was missing the row and the Danger zone under it sat 31px high (T203b).
   */
  it('leaves the frame’s fourth repo without an override, so the picker under them is drawn', async () => {
    const shot = await open('tab=general')

    expect(fixture.repos).toHaveLength(fixture.testing.repos.length)
    expect(fixture.testing.repos.filter((repo) => repo.mode === null && repo.runCommand === '')).toHaveLength(1)
    expect(shot.text).toContain('Override for another repo')
  })

  /** TinyCorp never installs RTK: the tab offers a line to run and no button that runs it. */
  it('offers no way to install RTK from inside the app', async () => {
    const shot = await open('tab=tokens&rtk=missing')

    expect(shot.text).toContain('doesn’t install it for you')
    expect(shot.text).not.toMatch(/\bInstall RTK\b/)
  })
})
