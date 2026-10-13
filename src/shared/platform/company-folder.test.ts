import { describe, expect, it } from 'vitest'
import {
  companyFolderNote,
  companyFolderRefusal,
  isNetworkFolder,
  isWslFolder,
  NETWORK_FOLDER_REFUSAL,
  SYNCED_FOLDER_WARNING,
  suggestedCompanyFolder,
  WSL_FOLDER_NOTE,
} from './company-folder'

describe('A folder a Company can live in', () => {
  it('accepts a folder in WSL, in both spellings: its database goes to this PC instead', () => {
    for (const folder of [
      '\\\\wsl.localhost\\archlinux\\home\\boss\\acme',
      '\\\\WSL.LOCALHOST\\Ubuntu\\home\\boss\\acme',
      '\\\\wsl$\\Ubuntu\\home\\boss\\acme',
    ]) {
      expect(isWslFolder(folder)).toBe(true)
      expect(companyFolderRefusal(folder)).toBeNull()
    }
  })

  it('still calls a WSL folder a network folder, which is what a worktree is placed by (T255)', () => {
    expect(isNetworkFolder('\\\\wsl.localhost\\archlinux\\home\\boss\\acme')).toBe(true)
  })

  it('refuses any other share: a folder a second PC can open would end up with a database each', () => {
    for (const folder of ['\\\\nas\\share\\acme', '\\\\FILESERVER\\teams\\acme']) {
      expect(isWslFolder(folder)).toBe(false)
      expect(isNetworkFolder(folder)).toBe(true)
      expect(companyFolderRefusal(folder)).toBe(NETWORK_FOLDER_REFUSAL)
    }
  })

  it('says where to put it instead, because the boss has to pick another folder to get past it', () => {
    expect(NETWORK_FOLDER_REFUSAL).toContain('Pick a folder on C: or another drive')
  })

  it('accepts a drive on this PC and a path on a Mac or Linux', () => {
    for (const folder of ['C:\\work\\acme', 'D:/work/acme', '/Users/boss/acme', '/home/boss/acme']) {
      expect(isNetworkFolder(folder)).toBe(false)
      expect(isWslFolder(folder)).toBe(false)
      expect(companyFolderRefusal(folder)).toBeNull()
    }
  })
})

describe('The folder a new Company is suggested in', () => {
  it('is `<home>/TinyCorp/<name>`, written the way the home folder it was handed is', () => {
    expect(suggestedCompanyFolder('C:\\Users\\boss', 'Acme')).toBe('C:\\Users\\boss\\TinyCorp\\Acme')
    expect(suggestedCompanyFolder('/Users/boss', 'Acme')).toBe('/Users/boss/TinyCorp/Acme')
    expect(suggestedCompanyFolder('/home/boss/', 'Acme Works')).toBe('/home/boss/TinyCorp/Acme Works')
  })

  it('is nothing at all without a name or a home folder: the field keeps its placeholder', () => {
    expect(suggestedCompanyFolder('/Users/boss', '   ')).toBeNull()
    expect(suggestedCompanyFolder(null, 'Acme')).toBeNull()
  })

  it('is never a share, whatever the boss types: it is built from the home folder, not the picker', () => {
    const suggested = suggestedCompanyFolder('C:\\Users\\boss', '\\\\wsl.localhost\\archlinux')

    expect(suggested).toBe('C:\\Users\\boss\\TinyCorp\\-wsl.localhost-archlinux')
    expect(companyFolderRefusal(suggested!)).toBeNull()
  })

  it('makes one folder of a name Windows could not hold as one', () => {
    expect(suggestedCompanyFolder('C:\\Users\\boss', 'Acme: Web/Ops')).toBe('C:\\Users\\boss\\TinyCorp\\Acme- Web-Ops')
    expect(suggestedCompanyFolder('C:\\Users\\boss', 'Acme.')).toBe('C:\\Users\\boss\\TinyCorp\\Acme')
  })
})

describe('The line under the folder field', () => {
  const hints = { home: 'C:\\Users\\boss', syncedRoots: ['C:\\Users\\boss\\OneDrive'] }

  it('says a WSL folder keeps its database on this PC, with the `info` mark frame iNGDQ draws', () => {
    const note = companyFolderNote('\\\\wsl.localhost\\archlinux\\home\\boss\\acme', hints)

    expect(note).toEqual({ text: WSL_FOLDER_NOTE, info: true })
    expect(WSL_FOLDER_NOTE).toContain('AppData')
  })

  it('warns about a folder OneDrive syncs, naming what it does to the database', () => {
    const warning = { text: SYNCED_FOLDER_WARNING, info: false }

    expect(companyFolderNote('C:\\Users\\boss\\OneDrive\\Documents\\acme', hints)).toEqual(warning)
    expect(companyFolderNote('c:\\users\\boss\\onedrive', hints)).toEqual(warning)
  })

  it('says nothing about a folder outside it, and nothing at all where OneDrive is not running', () => {
    expect(companyFolderNote('C:\\Users\\boss\\TinyCorp\\Acme', hints)).toBeNull()
    expect(companyFolderNote('/Users/boss/OneDriveish/acme', { home: '/Users/boss', syncedRoots: [] })).toBeNull()
  })
})
