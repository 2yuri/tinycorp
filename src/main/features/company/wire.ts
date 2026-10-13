import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { type Boss, statusAt } from '../../../shared/boss-profile'
import type { BossProfile, Company } from '../../../shared/company'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { companyFolderRefusal, DATABASE_ON_ANOTHER_PC } from '../../../shared/platform/company-folder'
import {
  type CompanyContext,
  type CompanyDatabases,
  companyDatabaseExists,
  companyDatabases,
  type OpenCompany,
  type OpenDatabase,
  type RecentCompanies,
} from '../../core'
import type { SessionActivity } from '../sessions'
import { applyBossUpdate, type BossProfileStore, createBossProfiles } from './boss-profile'
import { createCompanyAttention } from './company-attention'
import { companyMoveTarget, moveFolder, repairWorktrees, rewriteMovedPaths } from './company-move'
import {
  ensureCompanyKey,
  freshCompanyKey,
  readBossColumns,
  readCompany as readCompanyRow,
  updateCompanyProfile,
} from './company-profile'
import { assertDataHoldsNoRepo, connectedRepoPaths, removeCompanyData } from './company-removal'
import { createCompanySummaries } from './company-summaries'
import type { BossFacade, CompanyFacade, CompanyMoveFacade } from './facade'

/** What the boss's app hands in, and a test leaves out — except the list, which every app needs. */
export interface CompanyOptions {
  /** The Launcher's list: the Companies this Mac knows, whether or not they are open. */
  recents: RecentCompanies
  /**
   * Which folder each Company's database file is in (T256): its own, or `%LOCALAPPDATA%` for a
   * Company folder in WSL. Defaults to the real answer, read off the folder and the environment.
   */
  databases?: CompanyDatabases
  /** Opens the SQLite file of a Company folder. Defaults to the file at the site `databases` names. */
  openDatabase?: OpenDatabase
  /** The boss's name until they set one in Company settings, e.g. the OS account's. Defaults to `Boss`. */
  bossName?: () => string
  /** Where the one boss profile is kept, across every Company (T79). Defaults to memory. */
  bossProfile?: BossProfileStore
}

/** What the Company lifecycle needs of the rest of the app. */
export interface CompanyDeps extends CompanyOptions {
  /** Brings a Company's database up to date. Every table in the app is made by one of these. */
  migrate(db: DatabaseSync): void
  log(line: string): void

  /**
   * A Company became the one the boss is looking at — opened, created, switched to or renamed.
   * Everything that has to catch up with the Company in front of the boss happens here.
   */
  opened(entry: OpenCompany): void
  /**
   * A Company is closing, before its caches are emptied and its database is shut. Whatever holds
   * something of its own — a Session, a language server, a child process — lets go here.
   */
  closing(entry: OpenCompany): void
  /** A Company that was open when the app closed is open again: its Sessions start back up. */
  reopened(): void
  /** That Company's boss Inbox, for the dot the Company rail shows. */
  bossInbox(entry: OpenCompany): BossInboxItem[]
  /** Every Session's activity, which is what the rail and the launcher's summaries redraw on. */
  onActivity(listener: (activity: SessionActivity) => void): () => void
}

/** The Company lifecycle, once it is wired. */
export interface CompanyFeature {
  /** The boss profile, shared by every Company. */
  boss: ReturnType<typeof createBossProfiles>
  /** Called after the current Company changes: the one listener set nearly every screen is on. */
  changed(): void
  onChange(listener: () => void): () => void
  /** That Company's Inbox moved without a post, so the rail redraws. */
  inboxChanged(companyId: string): void
  /** The Company the boss is looking at. Throws when none is open. */
  current(): Company
  /** The app is quitting: the last visit of every open Company is written down and the timers go. */
  close(): void
  facade: CompanyFacade & CompanyMoveFacade & BossFacade
}

/**
 * Wires what a Company *is* to the app that holds several of them open (T188, T201).
 *
 * Everything here is about the folder: making one, opening it, renaming it, moving it somewhere
 * else and forgetting it. No feature is named — what a close has to stop and what an open has to
 * catch up with arrive as `closing` and `opened`, so this file stays the same however many
 * features there are.
 */
export function register(ctx: CompanyContext, deps: CompanyDeps): CompanyFeature {
  const { recents } = deps
  const databases = deps.databases ?? companyDatabases()
  const openDatabase = deps.openDatabase ?? databases.open
  const bossName = deps.bossName ?? (() => 'Boss')
  const changed = ctx.listeners()
  const boss = createBossProfiles({
    store: deps.bossProfile ?? memoryBossProfile(),
    defaultName: bossName,
    storedCompanies: () => recents.list().map((company) => company.boss),
  })

  const summaries = createCompanySummaries({
    companies: () => facade.listCompanies(),
    openDatabase: (companyId) => ctx.entryOf(companyId)?.db,
    currentId: () => ctx.currentId(),
    readFolder: openDatabase,
    databases,
    onActivity: deps.onActivity,
  })

  const attention = createCompanyAttention({
    open: () =>
      ctx.open().map((entry) => ({
        companyId: entry.company.id,
        bossInbox: () => deps.bossInbox(entry),
      })),
    onActivity: deps.onActivity,
  })

  function makeCurrent(entry: OpenCompany): Company {
    ctx.opened(entry)
    recents.remember(entry.company)
    summaries.visited(entry.db)
    deps.opened(entry)
    changed.notify()
    return entry.company
  }

  /**
   * The Company as its row has it, with the boss taken from the one profile: the name, initials,
   * handle, character and status every Company shows are the boss's own, not the Company's (T79).
   */
  function readCompany(db: DatabaseSync, folder: string): Company | null {
    // A Company stored before T79 carries the boss the launcher knew; it seeds the profile once.
    boss.adopt(readBossColumns(db))
    const company = readCompanyRow(db, folder, bossName().trim() || 'Boss')
    return company && { ...company, boss: bossOf(boss.get()) }
  }

  // The boss is on every Company row, so a change to the profile refreshes them all.
  boss.onChanged(() => {
    for (const entry of ctx.open()) {
      entry.company = readCompany(entry.db, entry.company.folder) ?? entry.company
      recents.remember(entry.company)
    }
    changed.notify()
  })

  /** The keys of the open Companies other than `exceptId`. */
  function takenKeys(exceptId?: string): Set<string> {
    return new Set(
      ctx
        .open()
        .filter((c) => c.company.id !== exceptId)
        .map((c) => c.company.key),
    )
  }

  /** Closes an open Company and drops everything the app keeps for it. */
  function closeCompany(entry: OpenCompany): void {
    deps.closing(entry)
    // Everything anything keeps for this Company goes in one call, and a cache nobody remembered
    // goes with the rest: that is what `core/company-context.ts` is for.
    const wasCurrent = ctx.close(entry.company.id)
    entry.db.close()
    if (wasCurrent) changed.notify()
  }

  /**
   * What an open that found no database says. A Company folder in WSL keeps its database on this
   * PC, so a folder whose id file names one that is not here is not an empty folder — it is this
   * Company, opened on a machine that does not hold it, or one whose AppData has been wiped. The
   * boss is told that plainly; the Launcher offers Forget and nothing else (T256).
   */
  function nothingToOpen(folder: string): string {
    return databases.of(folder).id !== null ? DATABASE_ON_ANOTHER_PC : `There is no Company in ${folder}`
  }

  function knownCompany(id: string): Company {
    const known = ctx.entryOf(id)?.company ?? recents.list().find((c) => c.id === id)
    if (!known) throw new Error(`Unknown Company: ${id}`)
    return known
  }

  const facade: CompanyFacade & CompanyMoveFacade & BossFacade = {
    boss,

    onChange: (listener) => changed.add(listener),

    forgetCompany(id) {
      knownCompany(id)
      recents.forget(id)
      const entry = ctx.entryOf(id)
      if (entry) closeCompany(entry)
    },

    deleteCompany(id) {
      const { folder } = knownCompany(id)
      const entry = ctx.entryOf(id)
      let repoPaths: string[] = []
      if (entry) {
        repoPaths = connectedRepoPaths(entry.db)
      } else {
        const db = openDatabase(folder, 'existing')
        if (db) {
          try {
            repoPaths = connectedRepoPaths(db)
          } finally {
            db.close()
          }
        }
      }
      assertDataHoldsNoRepo(folder, repoPaths)
      facade.forgetCompany(id)
      // Read while the folder still names it: a Company in WSL keeps its database on this PC, and
      // `removeCompanyData` is about to take the id file that says where (T256).
      databases.remove(folder)
      removeCompanyData(folder)
    },

    moveCompany(id, picked) {
      // Asked of the folder the boss picked, before anything is moved: a Company on a share is one
      // that cannot open again.
      assertLockableFolder(picked)
      const known = knownCompany(id)
      const from = resolve(known.folder)
      const to = companyMoveTarget(from, picked)
      const entry = ctx.entryOf(id)
      const previous = ctx.currentId()
      // Where the database is now, asked while the folder is still there to say so (T256).
      const was = databases.of(from)
      // Closing keeps each running Session's restore mark, so reopening starts it again.
      if (entry) closeCompany(entry)
      try {
        moveFolder(from, to)
      } catch (error) {
        if (entry) facade.openCompany(from)
        throw error
      }
      // The folder's own files have moved; the database follows if it is on the wrong side now.
      databases.moved(was, to, id)
      const db = openDatabase(to, 'existing')
      if (db) {
        try {
          rewriteMovedPaths(db, from, to)
          repairWorktrees(db, deps.log)
        } finally {
          db.close()
        }
      }
      const moved = { ...known, folder: to }
      recents.remember(moved)
      if (!entry) return moved
      const reopened = facade.openCompany(to)
      const back = previous && previous !== id ? ctx.entryOf(previous) : null
      if (back) makeCurrent(back)
      return reopened
    },

    createCompany(input) {
      // Before anything else, and on the path as it was given: a share cannot be locked, and the
      // failed attempt used to leave an empty database in it (T252).
      assertLockableFolder(input.folder)
      const folder = resolve(input.folder)
      const name = (input.name ?? basename(folder)).trim()
      if (!name) throw new Error('A Company needs a name')
      if (ctx.openedAt(folder)) throw new Error(`A Company already exists in ${folder}`)

      // What the folder said before this attempt touched it: a database already in it, or an id
      // file naming one on this PC. Either way the folder is not ours to clean up if this fails.
      const before = databases.of(folder)
      const had = before.id !== null || companyDatabaseExists(before.folder)
      // The site is claimed before anything is opened, so a folder in WSL has its id file — and
      // its database in AppData — rather than a `company.sqlite` the first write cannot lock (T256).
      const site = databases.claim(folder)
      const db = openDatabase(folder, 'create')!
      try {
        deps.migrate(db)
        if (readCompany(db, folder)) throw new Error(`A Company already exists in ${folder}`)
        db.prepare('INSERT INTO company (id, name, key, created_at) VALUES (?, ?, ?, ?)').run(
          // A Company whose database is on this PC is filed under its own id, and the folder's id
          // file already names it; one that keeps its database in its folder gets a fresh one.
          site.id ?? randomUUID(),
          name,
          freshCompanyKey(name, takenKeys()),
          new Date().toISOString(),
        )
        const company = readCompany(db, folder)!
        try {
          return makeCurrent({ company, db })
        } catch (error) {
          // Registered, then something the open told threw: the app and the launcher's list would
          // otherwise hold a Company whose connection is about to be closed under them.
          facade.forgetCompany(company.id)
          throw error
        }
      } catch (error) {
        if (db.isOpen) db.close()
        // Only what this attempt made — the database wherever it went, and the id file with it.
        // A folder the boss already had keeps everything in it.
        if (!had) databases.remove(folder)
        throw error
      }
    },

    openCompany(folderInput) {
      assertLockableFolder(folderInput)
      const folder = resolve(folderInput)
      const already = ctx.openedAt(folder)
      if (already) return makeCurrent(already)

      const db = openDatabase(folder, 'existing')
      if (!db) throw new Error(nothingToOpen(folder))
      try {
        deps.migrate(db)
        const stored = readCompany(db, folder)
        if (!stored) throw new Error(nothingToOpen(folder))
        ensureCompanyKey(db, stored.name, takenKeys(stored.id))
        const company = readCompany(db, folder)!
        const opened = makeCurrent({ company, db })
        deps.reopened()
        return opened
      } catch (error) {
        db.close()
        throw error
      }
    },

    switchCompany(id) {
      const entry = ctx.entryOf(id)
      if (entry) return makeCurrent(entry)
      const known = recents.list().find((c) => c.id === id)
      if (!known) throw new Error(`Unknown Company: ${id}`)
      return facade.openCompany(known.folder)
    },

    currentCompany() {
      return ctx.currentOrNull()?.company ?? null
    },

    updateCompany(update) {
      const entry = ctx.currentEntry()
      const { bossName: name, bossInitials: initials, ...company } = update
      // The boss is one person across Companies, so their fields go to the profile, not the row.
      const profile = { ...(name !== undefined && { name }), ...(initials !== undefined && { initials }) }
      const changesBoss = Object.keys(profile).length > 0
      // Both halves are checked before either is written, so one wrong field changes nothing.
      if (changesBoss) applyBossUpdate(boss.get(), profile)
      updateCompanyProfile(entry.db, company, takenKeys(entry.company.id))
      if (changesBoss) boss.update(profile)
      entry.company = readCompany(entry.db, entry.company.folder)!
      return makeCurrent(entry)
    },

    listCompanies() {
      // A Company that is not open kept the boss it was last remembered with; the profile is newer.
      const profile = bossOf(boss.get())
      const byId = new Map(recents.list().map((c) => [c.id, { ...c, boss: profile }]))
      for (const { company } of ctx.open()) byId.set(company.id, company)
      return [...byId.values()]
    },

    companySummaries: () => summaries.list(),

    companyAttention: () => attention.list(),

    onAttentionChange: (listener) => attention.onChange(listener),
  }

  return {
    boss,
    changed: () => changed.notify(),
    onChange: (listener) => changed.add(listener),
    inboxChanged: (companyId) => attention.inboxChanged(companyId),
    current: () => ctx.currentEntry().company,
    close() {
      for (const { db } of ctx.open()) summaries.visited(db)
      summaries.close()
      attention.close()
    },
    facade,
  }
}

/**
 * Refuses a folder a Company cannot live in, before anything is written there (T252, T256).
 *
 * That is a network share other than WSL: SQLite cannot lock a file over one, and a folder a
 * second PC can open would split into one database per PC. A folder in WSL is accepted, and its
 * database goes to this PC instead — `core/company-databases.ts`.
 *
 * Every way a Company folder is chosen goes through one of the three flows above, so this is the
 * one place the rule has to hold. The Create step asks the same question of the folder the boss
 * picked, the moment they pick it, and `shared/platform/company-folder.ts` is what both read.
 *
 * It is asked of the path exactly as it arrived, before `resolve`: off Windows a `\\` is an
 * ordinary character, so `resolve` would hand back the current directory with the share's name
 * inside it and the refusal would only work on the platform the bug came from.
 */
function assertLockableFolder(folder: string): void {
  const refusal = companyFolderRefusal(folder)
  if (refusal) throw new Error(refusal)
}

/** The boss as a Company shows them: the profile's own fields, nothing the Company owns. */
function bossOf(boss: Boss): BossProfile {
  return {
    name: boss.name,
    initials: boss.initials,
    handle: boss.handle,
    sprite: boss.sprite,
    status: statusAt(boss, Date.now()),
  }
}

/** The default store: the profile lives only as long as the engine, so tests write no files. */
export function memoryBossProfile(): BossProfileStore {
  let stored: Boss | null = null
  return {
    read: () => stored,
    write(profile) {
      stored = profile
    },
  }
}
