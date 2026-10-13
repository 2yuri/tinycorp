import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Boss } from '../../shared/boss-profile'
import type { Company } from '../../shared/company'
import type { StackConstraints } from '../../shared/repos/repo'
import type { BossProfileStore } from '../features/company'
import type { NotesFiles } from '../features/memory'
import type { OpenDatabase } from './database'
import type { RecentCompanies } from './recents'

/**
 * A folder a test names in POSIX, as this platform really writes it: `/work/acme` on a Mac,
 * `D:\work\acme` on Windows (T166).
 *
 * The engine resolves every path it is given — a Company folder, a repo, a worktree — so a test
 * that hands it `/work/acme` and then expects `/work/acme` back is only ever a test about macOS.
 * Fixtures name the path once, through here, and both sides of the assertion say the same thing
 * wherever the suite runs.
 */
export function onDisk(path: string): string {
  return resolve(path)
}

/**
 * Throws away a folder a test made in the OS temp directory.
 *
 * Windows refuses to unlink a file anything still holds open — a database, a language server that
 * has not finished leaving — and the retries are for exactly that. What is still held after them
 * is left where it is: a folder in the OS temp directory is the OS's to clean, and never a reason
 * to fail a test about something else (T166).
 */
export function removeFolder(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  } catch {
    // Still held. The OS empties its own temp directory.
  }
}

/** One in-memory SQLite database per folder, shared by every engine given this opener. */
export function inMemoryDatabases(): OpenDatabase {
  const byFolder = new Map<string, DatabaseSync>()
  return (folder, mode) => {
    const existing = byFolder.get(folder)
    if (existing?.isOpen) return existing
    if (mode === 'existing') return null
    const db = new DatabaseSync(':memory:')
    byFolder.set(folder, db)
    return db
  }
}

export function inMemoryRecents(): RecentCompanies {
  const companies: Company[] = []
  return {
    list: () => [...companies],
    remember(company) {
      const index = companies.findIndex((c) => c.id === company.id)
      if (index === -1) companies.push(company)
      else companies[index] = company
    },
    forget(id) {
      const index = companies.findIndex((c) => c.id === id)
      if (index !== -1) companies.splice(index, 1)
    },
  }
}

/**
 * The note log and its summary tree in a map by path, shared by every engine given this store.
 *
 * Real buffers rather than strings, because the log is read by byte range and a fake that answered
 * in characters would agree with the code right up until somebody wrote a note with an accent in
 * it (T193).
 */
export function inMemoryNotesFiles(): NotesFiles {
  const files = new Map<string, Buffer>()
  const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
  return {
    size: (path) => files.get(path)?.length ?? 0,
    readAt: (path, start, length) => (files.get(path) ?? Buffer.alloc(0)).subarray(start, start + length),
    read: (path) => files.get(path)?.toString('utf8') ?? null,
    append(path, text) {
      files.set(path, Buffer.concat([files.get(path) ?? Buffer.alloc(0), Buffer.from(text, 'utf8')]))
    },
    write(path, text) {
      files.set(path, Buffer.from(text, 'utf8'))
    },
    remove(path) {
      files.delete(path)
    },
    list(folder) {
      const names: string[] = []
      for (const path of files.keys()) {
        if (folderOf(path) === folder) names.push(path.slice(folder.length + 1))
      }
      return names
    },
    rename(from, to) {
      const held = files.get(from)
      if (held === undefined) return
      files.set(to, held)
      files.delete(from)
    },
  }
}

/** A stack that is ready, so Employees can claim tickets in the repo. */
export function readyStack(overrides: Partial<StackConstraints> = {}): StackConstraints {
  return {
    language: 'TypeScript',
    framework: 'React',
    packageManager: 'pnpm',
    packageManagerVersion: '9',
    install: 'pnpm install',
    build: 'pnpm build',
    test: 'pnpm test',
    lint: 'pnpm lint',
    ...overrides,
  }
}

/** The boss profile kept in memory, for engines that must not touch `userData`. */
export function inMemoryBossProfile(seed: Partial<Boss> | null = null): BossProfileStore {
  let stored = seed
  return {
    read: () => stored,
    write(profile) {
      stored = profile
    },
  }
}

/**
 * The transport a test's MCP client connects to the Company server over: Streamable HTTP, with the
 * headers that say who is calling — an Employee's `authorization: Bearer <token>`.
 *
 * The cast is the SDK's own gap and not ours: `Transport` declares `sessionId?: string` while the
 * transport the SDK ships implements `sessionId: string | undefined`, and with
 * `exactOptionalPropertyTypes` on those are two different types (SDK 1.30). Nothing the transport
 * does changes.
 */
export function mcpTransport(url: string, headers: Record<string, string>): Transport {
  return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }) as Transport
}
