import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_ID, APP_NAME } from '../shared/app/app-name'
import { packaging, packagingFor } from './packaging'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The configuration electron-builder itself loads, read the way electron-builder reads it. */
function loadedConfig(): Record<string, unknown> {
  const script = "import('./electron-builder.config.mjs').then((m) => console.log(JSON.stringify(m.default)))"
  const json = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' })
  return JSON.parse(json) as Record<string, unknown>
}

/** The `package.json` scripts, so a target nothing can build is caught here rather than in CI. */
function scripts(): Record<string, string> {
  const json = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>
  }
  return json.scripts
}

describe('The package', () => {
  it('is named and identified from the module the running app names itself with', () => {
    const config = loadedConfig()
    expect(config['productName']).toBe(APP_NAME)
    expect(config['appId']).toBe(APP_ID)
    expect(config).toEqual(JSON.parse(JSON.stringify(packaging)))
  })

  it('writes the product name and the identifier in one place, not three', () => {
    for (const file of ['package.json', 'electron-builder.config.mjs', 'tools/dev-identity.mjs']) {
      const source = readFileSync(new URL(file, new URL('../../', import.meta.url)), 'utf8')
      expect(source, `${file} spells the product name out`).not.toContain(APP_NAME)
      expect(source, `${file} spells the identifier out`).not.toContain(APP_ID)
    }
    expect(readFileSync(new URL('../shared/app/app-name.ts', import.meta.url), 'utf8')).toContain(`'${APP_NAME}'`)
  })

  it('carries the icon where a packaged app looks for it, on every platform', () => {
    const config = packagingFor('linux')
    expect(config.mac.icon).toBe('resources/icon.png')
    expect(config.win.icon).toBe('resources/icon.png')
    expect(config.linux.icon).toBe('resources/icon.png')
    expect(config.extraResources).toEqual([{ from: 'resources/icon.png', to: 'icon.png' }])
  })

  describe('on macOS', () => {
    it('tells macOS the bundle name, so the menu bar and the switcher do not say Electron', () => {
      expect(packagingFor('darwin').mac.extendInfo).toEqual({ CFBundleName: APP_NAME, CFBundleDisplayName: APP_NAME })
    })

    it('builds an arm64 app and a DMG to hand someone', () => {
      expect(packagingFor('darwin').mac.target).toEqual([
        { target: 'dmg', arch: ['arm64'] },
        { target: 'dir', arch: ['arm64'] },
      ])
    })
  })

  describe('on Windows', () => {
    it('builds a one-click installer and the unpacked app the smoke run starts', () => {
      expect(packagingFor('win32').win.target).toEqual([
        { target: 'nsis', arch: ['x64'] },
        { target: 'dir', arch: ['x64'] },
      ])
      expect(scripts()['package:win']).toContain('--win')
    })

    // An installer built on a Mac shipped Electron's icon under the name "Electron": the step that
    // stamps both was off everywhere but Windows, from when it needed Wine.
    it('stamps the exe with its icon and name on every host, and signs it on none', () => {
      for (const host of ['win32', 'darwin', 'linux'] as const) {
        const { win } = packagingFor(host)
        expect(win).not.toHaveProperty('signAndEditExecutable')
        expect(win.signExecutable).toBe(false)
        expect(win.icon).toBe('resources/icon.png')
      }
    })
  })

  describe('on Linux', () => {
    it('builds an AppImage, a .deb and the unpacked app, and has a command that does it', () => {
      expect(packagingFor('linux').linux.target).toEqual([
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
        { target: 'dir', arch: ['x64'] },
      ])
      expect(scripts()['package:linux']).toContain('--linux')
    })

    it('files itself under Development, which is the Categories line of the desktop entry', () => {
      const { linux } = packagingFor('linux')
      expect(linux.category).toBe('Development')
      expect(linux.maintainer).toContain(APP_NAME)
      expect(linux.synopsis).not.toBe('')
    })

    /**
     * Electron takes its `app_id` from `desktopName` in `package.json`, and electron-builder names
     * the `.desktop` file and writes its `StartupWMClass` from the same string — but only when
     * `syncDesktopName` is on. Without all three agreeing GNOME shows a running TinyCorp as a
     * second, nameless item beside its own launcher, and a notification arrives with no icon.
     */
    it('makes Electron, the desktop file and StartupWMClass agree on one name', () => {
      expect(packagingFor('linux').linux.syncDesktopName).toBe(true)
      const name = (
        JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
          desktopName?: string
        }
      ).desktopName
      expect(name).toBe(`${APP_NAME.toLowerCase()}.desktop`)
    })

    it('has a homepage, without which the .deb refuses to build at all', () => {
      const metadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        homepage?: string
      }
      expect(metadata.homepage).toMatch(/^https:\/\//)
    })

    it('makes the .deb depend on libsecret, which is what a stored secret needs (T176)', () => {
      expect(packagingFor('linux').deb.depends).toContain('libsecret-1-0')
      // A banner is libnotify, and it is the one thing a headless dependency list forgets.
      expect(packagingFor('linux').deb.depends).toContain('libnotify4')
    })
  })

  /**
   * The fuses are burnt into the Electron binary at package time, and they are the only thing
   * standing between a process running as the boss and the process that holds every decrypted
   * secret (T199, finding H4 of `docs/security-review-2026-09.md`). The list is asserted whole,
   * key by key, so it cannot quietly shrink: a fuse dropped here is a door opened in the shipped
   * app, and nothing else in the repo would notice.
   */
  describe('the Electron fuses', () => {
    const FUSES = {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
      resetAdHocDarwinSignature: true,
    }

    it('are the same six answers, and the ad-hoc re-signing, on every platform', () => {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        expect(packagingFor(platform).electronFuses, `${platform} burns a different set`).toEqual(FUSES)
      }
    })

    it('stop the app being a Node interpreter: no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no --inspect', () => {
      const { electronFuses } = packagingFor('darwin')
      expect(electronFuses.runAsNode).toBe(false)
      expect(electronFuses.enableNodeOptionsEnvironmentVariable).toBe(false)
      expect(electronFuses.enableNodeCliInspectArguments).toBe(false)
    })

    it('hold the asar to the one the build shipped, which is what asarUnpack alone does not', () => {
      const { electronFuses } = packagingFor('darwin')
      expect(electronFuses.enableEmbeddedAsarIntegrityValidation).toBe(true)
      expect(electronFuses.onlyLoadAppFromAsar).toBe(true)
    })

    /**
     * Flipping a fuse rewrites the Electron binary, which breaks the ad-hoc signature it ships
     * with — and an unsigned binary does not run on Apple Silicon at all. Nothing re-signs it
     * afterwards, because `mac.identity` is null by decision 54, so the flip has to.
     */
    it('re-sign the macOS bundle ad-hoc, because nothing else signs it', () => {
      expect(packagingFor('darwin').mac.identity).toBeNull()
      expect(packagingFor('darwin').electronFuses.resetAdHocDarwinSignature).toBe(true)
    })

    it('survive the trip through electron-builder, which reads the config as data', () => {
      expect(loadedConfig()['electronFuses']).toEqual(FUSES)
    })
  })

  describe('node-pty', () => {
    it('is compiled against Electron on Linux, where it has no prebuild, and nowhere else', () => {
      // A `.node` built for Node and loaded by Electron throws NODE_MODULE_VERSION at the first
      // terminal, which is the whole app on a Linux desktop.
      expect(packagingFor('linux').npmRebuild).toBe(true)
      expect(packagingFor('darwin').npmRebuild).toBe(false)
      expect(packagingFor('win32').npmRebuild).toBe(false)
    })

    it('stays outside the asar on every platform, because `spawn-helper` is run as a file', () => {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        expect(packagingFor(platform).asarUnpack).toEqual(['**/node_modules/node-pty/**'])
      }
    })
  })
})
