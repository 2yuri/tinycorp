import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_DATA_COMPANIES,
  COMPANY_MARKER_FILE,
  COMPANY_MARKER_FOLDER,
  companyDatabases,
  NO_LOCAL_APP_DATA,
} from './company-databases'
import { COMPANY_FILE } from './database'
import { removeFolder } from './testing'

/**
 * The share is declared rather than made: a `\\wsl.localhost\…` path only exists on Windows, and a
 * test that could only run there is a test that runs nowhere. What is faked is the one question
 * the code asks about the OS — is this folder on a share — and everything else is real files.
 */
const tempDirs: string[] = []

function tempFolder(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tinycorp-${name}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) removeFolder(dir)
})

/** A site keeper whose shares are the folders under `shareRoot`, with AppData in a temp folder. */
function keeper(localAppData: string, shareRoot: string) {
  return companyDatabases({ localAppData, onShare: (folder) => folder.startsWith(shareRoot) })
}

function markerOf(folder: string): unknown {
  return JSON.parse(readFileSync(join(folder, COMPANY_MARKER_FOLDER, COMPANY_MARKER_FILE), 'utf8'))
}

function appDataFolder(localAppData: string, id: string): string {
  return join(localAppData, ...APP_DATA_COMPANIES, id)
}

describe('Where a Company keeps its database', () => {
  it('is its own folder for a Company on a drive of this PC, with no file to say so', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = tempFolder('drive')

    const site = keeper(localAppData, share).claim(folder)

    expect(site).toEqual({ folder, id: null })
    expect(existsSync(join(folder, COMPANY_MARKER_FOLDER))).toBe(false)
  })

  it('is `%LOCALAPPDATA%\\TinyCorp\\Companies\\<id>` for a Company folder in WSL', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = join(share, 'Acme')
    mkdirSync(folder)

    const site = keeper(localAppData, share).claim(folder)

    expect(site.id).toBeTruthy()
    expect(site.folder).toBe(appDataFolder(localAppData, site.id!))
  })

  it('names that id in the Company folder, so opening the folder finds the database again', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = join(share, 'Acme')
    mkdirSync(folder)
    const sites = keeper(localAppData, share)

    const claimed = sites.claim(folder)

    expect(markerOf(folder)).toEqual({ id: claimed.id, database: 'this-pc' })
    expect(sites.of(folder)).toEqual(claimed)
  })

  it('keeps the id a folder already names, so a second claim never re-files the same Company', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = join(share, 'Acme')
    mkdirSync(folder)
    const sites = keeper(localAppData, share)

    const first = sites.claim(folder)

    expect(sites.claim(folder, 'a-different-id')).toEqual(first)
  })

  it('leaves a database somebody carried into the distro themselves where they put it', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = join(share, 'Acme')
    mkdirSync(folder)
    writeFileSync(join(folder, COMPANY_FILE), '')

    expect(keeper(localAppData, share).claim(folder)).toEqual({ folder, id: null })
  })

  it('ignores a file in the folder that is not ours, rather than filing the Company under nonsense', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = join(share, 'Acme')
    mkdirSync(join(folder, COMPANY_MARKER_FOLDER), { recursive: true })
    for (const text of ['not json at all', '{}', '{"id":"","database":"this-pc"}', '{"id":"x"}']) {
      writeFileSync(join(folder, COMPANY_MARKER_FOLDER, COMPANY_MARKER_FILE), text)

      expect(keeper(localAppData, share).of(folder)).toEqual({ folder, id: null })
    }
  })

  it('says so out loud where there is no %LOCALAPPDATA% to put it in', () => {
    const share = tempFolder('share')

    expect(() => companyDatabases({ localAppData: null, onShare: () => true }).claim(share)).toThrow(NO_LOCAL_APP_DATA)
  })
})

describe('On a Mac or a Linux, where there is no WSL share', () => {
  it('keeps every Company database inside its own folder, as it always has', () => {
    const folder = tempFolder('company')
    // The real predicate and the real environment: nothing here is a share, so nothing moves.
    const sites = companyDatabases({ localAppData: tempFolder('appdata') })

    expect(sites.of(folder)).toEqual({ folder, id: null })
    expect(sites.claim(folder)).toEqual({ folder, id: null })
    expect(existsSync(join(folder, COMPANY_MARKER_FOLDER))).toBe(false)
  })
})

describe('Moving a Company folder', () => {
  it('carries the database out to this PC when the folder enters WSL', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const sites = keeper(localAppData, share)
    // The folder has already moved, database and all: that is what `moveFolder` does first.
    const to = join(share, 'Acme')
    mkdirSync(to)
    writeFileSync(join(to, COMPANY_FILE), 'the tables')

    sites.moved({ folder: '/gone/acme', id: null }, to, 'company-1')

    expect(existsSync(join(to, COMPANY_FILE))).toBe(false)
    expect(readFileSync(join(appDataFolder(localAppData, 'company-1'), COMPANY_FILE), 'utf8')).toBe('the tables')
    expect(markerOf(to)).toEqual({ id: 'company-1', database: 'this-pc' })
    expect(sites.of(to).folder).toBe(appDataFolder(localAppData, 'company-1'))
  })

  it('carries it back into the folder when the folder leaves WSL, and takes the id file with it', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const sites = keeper(localAppData, share)
    const held = appDataFolder(localAppData, 'company-1')
    mkdirSync(held, { recursive: true })
    writeFileSync(join(held, COMPANY_FILE), 'the tables')
    // The id file travelled with the folder, which is now on a drive.
    const to = tempFolder('drive')
    mkdirSync(join(to, COMPANY_MARKER_FOLDER))
    writeFileSync(
      join(to, COMPANY_MARKER_FOLDER, COMPANY_MARKER_FILE),
      JSON.stringify({ id: 'company-1', database: 'this-pc' }),
    )

    sites.moved({ folder: held, id: 'company-1' }, to, 'company-1')

    expect(readFileSync(join(to, COMPANY_FILE), 'utf8')).toBe('the tables')
    expect(existsSync(held)).toBe(false)
    expect(existsSync(join(to, COMPANY_MARKER_FOLDER))).toBe(false)
    expect(sites.of(to)).toEqual({ folder: to, id: null })
  })

  it('moves nothing when both ends are the same kind of folder', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const sites = keeper(localAppData, share)
    const held = appDataFolder(localAppData, 'company-1')
    mkdirSync(held, { recursive: true })
    writeFileSync(join(held, COMPANY_FILE), 'the tables')
    const to = join(share, 'Elsewhere')
    mkdirSync(to)

    sites.moved({ folder: held, id: 'company-1' }, to, 'company-1')

    expect(readFileSync(join(held, COMPANY_FILE), 'utf8')).toBe('the tables')
  })
})

describe('Removing what a Company keeps', () => {
  it('takes the database this PC holds and the id file, and nothing else in the folder', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const sites = keeper(localAppData, share)
    const folder = join(share, 'Acme')
    mkdirSync(folder)
    const site = sites.claim(folder)
    mkdirSync(site.folder, { recursive: true })
    writeFileSync(join(site.folder, COMPANY_FILE), 'the tables')
    writeFileSync(join(folder, 'notes.md'), 'the boss picked their own folder')

    sites.remove(folder)

    expect(existsSync(site.folder)).toBe(false)
    expect(existsSync(join(folder, COMPANY_MARKER_FOLDER))).toBe(false)
    expect(existsSync(join(folder, 'notes.md'))).toBe(true)
  })

  it('takes the database in the folder for a Company on a drive, and leaves the folder', () => {
    const localAppData = tempFolder('appdata')
    const share = tempFolder('share')
    const folder = tempFolder('drive')
    writeFileSync(join(folder, COMPANY_FILE), 'the tables')
    writeFileSync(join(folder, 'notes.md'), 'mine')

    keeper(localAppData, share).remove(folder)

    expect(existsSync(join(folder, COMPANY_FILE))).toBe(false)
    expect(existsSync(join(folder, 'notes.md'))).toBe(true)
  })
})
