import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../core/testing'
import { clearSessionFiles, forgetSessionFile, writeSessionFile } from './session-files'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeFolder(folder)
})

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-files-'))
  folders.push(dir)
  return dir
}

const BEARER = '{"authorization":"Bearer sess-4f3a2b"}'

describe('A Session’s own files', () => {
  it('writes one per Session, and hands back where it put it', () => {
    const dir = dataDir()

    const path = writeSessionFile(dir, 'mcp', 'session-a', BEARER)

    expect(path).toBe(join(dir, 'mcp', 'session-a.json'))
    expect(readFileSync(path, 'utf8')).toBe(BEARER)
  })

  it.skipIf(process.platform === 'win32')('keeps the file and its folder to this account', () => {
    const dir = dataDir()

    const path = writeSessionFile(dir, 'mcp', 'session-a', BEARER)

    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'mcp')).mode & 0o777).toBe(0o700)
  })

  /**
   * The finding itself (T199, H5): the token in that file is one `cat` away for every other
   * Employee, all of which run as the same OS user as the app. The only thing that shortens the
   * window is deleting it, and before this nothing did.
   */
  it('takes the file away when the Session ends, and leaves every other Session’s', () => {
    const dir = dataDir()
    writeSessionFile(dir, 'mcp', 'session-a', BEARER)
    writeSessionFile(dir, 'mcp', 'session-b', BEARER)

    forgetSessionFile(dir, 'mcp', 'session-a')

    expect(existsSync(join(dir, 'mcp', 'session-a.json'))).toBe(false)
    expect(existsSync(join(dir, 'mcp', 'session-b.json'))).toBe(true)
  })

  it('says nothing about a Session that never had a file', () => {
    const dir = dataDir()

    expect(() => forgetSessionFile(dir, 'mcp', 'never-started')).not.toThrow()
  })

  /**
   * A provider session id arrives from the Session's own hooks, and the shape rule that refuses
   * one that is really a path is `isProviderSessionId` (T199, finding H1). Writing under one was
   * already wrong; deleting under one would make this change a way to remove any file the boss
   * owns, so both ends ask.
   */
  it('refuses a session id that would write, or delete, outside its own folder', () => {
    const dir = dataDir()
    const outside = join(dir, 'boss.json')
    writeFileSync(outside, 'the boss’s own file\n')

    // `<dir>/mcp/../boss.json` is the boss's file: refused on the way in, ignored on the way out.
    const traversal = ['..', 'boss'].join(sep)
    expect(() => writeSessionFile(dir, 'mcp', traversal, BEARER)).toThrow(/provider session id/)
    forgetSessionFile(dir, 'mcp', traversal)

    expect(existsSync(outside)).toBe(true)
  })

  it('clears out whatever the last run of the app left behind', () => {
    const dir = dataDir()
    writeSessionFile(dir, 'mcp', 'session-a', BEARER)
    writeSessionFile(dir, 'opencode', 'session-b', BEARER)

    clearSessionFiles(dir)

    expect(existsSync(dir)).toBe(false)
  })

  it('is written again after a clear, without the app having to make the folder', () => {
    const dir = dataDir()
    clearSessionFiles(dir)

    const path = writeSessionFile(dir, 'mcp', 'session-a', BEARER)

    expect(readFileSync(path, 'utf8')).toBe(BEARER)
  })
})
