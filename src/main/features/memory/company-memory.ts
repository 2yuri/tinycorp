import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  BRIEF_PAGES,
  DEFAULT_COLD_DAYS,
  emptyCounts,
  formatSource,
  type MemoryContradiction,
  type MemoryCounts,
  type MemoryKind,
  type MemoryPage,
  type MemoryPageSummary,
  type MemoryQuery,
  type MemoryRevision,
  type MemoryWrite,
  parseSource,
  slugify,
} from '../../../shared/memory/company-memory'
import type { Migration } from '../../core'
import type { MemoryPageFiles } from './company-memory-files'
import { type MemoryGit, noMemoryGit } from './company-memory-git'
import { assertWritablePage, bodyLinks, newPage, pageFile, parsePage, serializePage } from './company-memory-page'
import { findContradictions } from './company-memory-terms'

/**
 * The Company memory's migration step (T175). Every table here is derived: the `.md` files under
 * `<company folder>/memory/company` are the source of truth, and `rebuild()` fills all of this
 * from them again.
 *
 * `memory_use` is the exception, and deliberately so: how often a page was read is the app's own
 * record, not the file's, so a rebuild leaves it where it is.
 */
export const COMPANY_MEMORY_MIGRATION: Migration = {
  name: 'company-memory-pages-index',
  sql: `
  CREATE TABLE memory_page (
    slug TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    repos TEXT NOT NULL DEFAULT '[]',
    links TEXT NOT NULL DEFAULT '[]',
    body TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    handoff_state TEXT,
    claimed_by TEXT,
    claimed_at TEXT
  );
  CREATE INDEX memory_page_by_kind ON memory_page (kind, archived);
  CREATE TABLE memory_source (
    slug TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    PRIMARY KEY (slug, kind, ref)
  );
  CREATE INDEX memory_source_by_ref ON memory_source (ref);
  CREATE TABLE memory_link (
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    PRIMARY KEY (a, b)
  );
  CREATE TABLE memory_use (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    used_by TEXT NOT NULL,
    used_at TEXT NOT NULL
  );
  CREATE INDEX memory_use_by_page ON memory_use (slug, used_at DESC);
  CREATE VIRTUAL TABLE memory_fts USING fts5(slug UNINDEXED, title, body, tokenize = 'unicode61');
  CREATE TABLE memory_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cold_days INTEGER NOT NULL
  );
`,
}

/** What a Handoff page is written with when a Provider switch moves an Employee (T173). */
export interface HandoffPageInput {
  /** `Vega → Codex · TC-146`, as the row reads it. */
  title: string
  body: string
  by: string
  repos?: string[]
  sources?: string[]
}

/** The Company's shared memory: the files, the index over them, and what the boss and Employees do. */
export interface CompanyMemory {
  /** Where the pages are. */
  folder: string
  /** Reads every file and fills the index from it. Returns what it then holds. */
  rebuild(): MemoryCounts
  /** The list the Memory screen draws. Reading the list is not a use: only opening a page is. */
  list(query?: MemoryQuery): MemoryPageSummary[]
  counts(): MemoryCounts
  /** One page and its body, without counting a use — what the boss's screen reads. */
  get(slug: string): MemoryPage | null
  /** One page, counting a use for `by`. What `memory_read` calls. */
  read(slug: string, by: string): MemoryPage | null
  /** Full text over titles and bodies; every hit counts as a use. */
  search(query: MemoryQuery, by: string): MemoryPageSummary[]
  /** Creates the page, or appends to it when one with that slug exists. */
  write(input: MemoryWrite & { by: string }): MemoryPage
  /** Links two pages both ways. Both have to exist. */
  link(a: string, b: string, by: string): void
  pin(slug: string, pinned: boolean, by: string): MemoryPage
  /** Moves the page into `archive/`. Git keeps it; nothing is deleted. */
  archive(slug: string, by: string): MemoryPage
  history(slug: string): MemoryRevision[]
  /** The page's markdown as one commit left it, or null. */
  revision(slug: string, commit: string): string | null
  /** Writes the page back to what `commit` had, as a new commit. */
  restore(slug: string, commit: string, by: string): MemoryPage
  /** The pages a ticket wrote, by its code, e.g. `TC-142`. */
  fromTicket(ticket: string): MemoryPageSummary[]
  /** Where one page's file is on this machine, or null when there is no such page. */
  filePath(slug: string): string | null
  /** T173's handoff page. Always `open` when written. */
  writeHandoff(input: HandoffPageInput): MemoryPage
  /** Claims a Handoff. Throws when somebody already has it — exactly once, by construction. */
  claimHandoff(slug: string, by: string): MemoryPage
  /** Closes a Handoff when its ticket lands. */
  closeHandoff(slug: string, by: string): MemoryPage
  /**
   * The bounded brief a Session's instructions carry: the titles of the most-used and pinned pages
   * that touch these repos. Titles only — the bodies are read on demand.
   */
  brief(repos: readonly string[]): { slug: string; title: string; kind: MemoryKind }[]
  /** How many days a page may go unused before it is cold. */
  coldDays(): number
  setColdDays(days: number): number
}

export interface CompanyMemoryOptions {
  db: DatabaseSync
  files: MemoryPageFiles
  /** Defaults to a memory that keeps no history, so a test never needs git. */
  git?: MemoryGit
  now?: () => Date
  /** Called after anything is written, so the screen refreshes. */
  onChanged?(): void
}

interface PageRow {
  slug: string
  kind: string
  title: string
  repos: string
  links: string
  body: string
  updated_by: string
  created_at: string
  updated_at: string
  pinned: number
  archived: number
  handoff_state: string | null
  claimed_by: string | null
  claimed_at: string | null
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export function createCompanyMemory({
  db,
  files,
  git = noMemoryGit(),
  now = () => new Date(),
  onChanged,
}: CompanyMemoryOptions): CompanyMemory {
  git.init(files.folder)

  function changed(): void {
    onChanged?.()
  }

  function rowToPage(row: PageRow): MemoryPage {
    const sources = db.prepare('SELECT kind, ref FROM memory_source WHERE slug = ? ORDER BY rowid').all(row.slug) as {
      kind: string
      ref: string
    }[]
    return {
      slug: row.slug,
      kind: row.kind as MemoryKind,
      title: row.title,
      repos: JSON.parse(row.repos) as string[],
      sources: sources.map((source) => parseSource(`${source.kind}:${source.ref}`)),
      links: JSON.parse(row.links) as string[],
      body: row.body,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      pinned: row.pinned === 1,
      archived: row.archived === 1,
      handoff:
        row.kind === 'handoff'
          ? {
              state: (row.handoff_state ?? 'open') as 'open' | 'claimed' | 'done',
              claimedBy: row.claimed_by,
              claimedAt: row.claimed_at,
            }
          : null,
    }
  }

  function rowOf(slug: string): PageRow | null {
    return (db.prepare('SELECT * FROM memory_page WHERE slug = ?').get(slug) as unknown as PageRow | undefined) ?? null
  }

  function allPages(): MemoryPage[] {
    const rows = db.prepare('SELECT * FROM memory_page ORDER BY slug').all() as unknown as PageRow[]
    return rows.map(rowToPage)
  }

  /** Writes one page to the index. The file is written by the caller, which also commits it. */
  function index(page: MemoryPage): void {
    db.prepare(
      `INSERT INTO memory_page
         (slug, kind, title, repos, links, body, updated_by, created_at, updated_at, pinned, archived,
          handoff_state, claimed_by, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, repos = excluded.repos, links = excluded.links,
         body = excluded.body, updated_by = excluded.updated_by, created_at = excluded.created_at,
         updated_at = excluded.updated_at, pinned = excluded.pinned, archived = excluded.archived,
         handoff_state = excluded.handoff_state, claimed_by = excluded.claimed_by,
         claimed_at = excluded.claimed_at`,
    ).run(
      page.slug,
      page.kind,
      page.title,
      JSON.stringify(page.repos),
      JSON.stringify(page.links),
      page.body,
      page.updatedBy,
      page.createdAt,
      page.updatedAt,
      page.pinned ? 1 : 0,
      page.archived ? 1 : 0,
      page.handoff?.state ?? null,
      page.handoff?.claimedBy ?? null,
      page.handoff?.claimedAt ?? null,
    )
    db.prepare('DELETE FROM memory_source WHERE slug = ?').run(page.slug)
    const source = db.prepare('INSERT OR IGNORE INTO memory_source (slug, kind, ref) VALUES (?, ?, ?)')
    for (const entry of page.sources) source.run(page.slug, entry.kind, entry.ref)
    db.prepare('DELETE FROM memory_fts WHERE slug = ?').run(page.slug)
    db.prepare('INSERT INTO memory_fts (slug, title, body) VALUES (?, ?, ?)').run(page.slug, page.title, page.body)
    db.prepare('DELETE FROM memory_link WHERE a = ?').run(page.slug)
    const link = db.prepare('INSERT OR IGNORE INTO memory_link (a, b) VALUES (?, ?)')
    for (const other of page.links) link.run(page.slug, other)
  }

  /** Writes the file, indexes the page and commits it as `author`. */
  function save(page: MemoryPage, author: string, message: string, movedFrom?: string): MemoryPage {
    const file = pageFile(page.kind, page.slug, page.archived)
    if (movedFrom && movedFrom !== file) files.move(movedFrom, file)
    files.write(file, serializePage(page))
    index(page)
    git.commit(files.folder, { files: movedFrom && movedFrom !== file ? [movedFrom, file] : [file], message, author })
    changed()
    return page
  }

  /** `vega-codex-tc-146`, or `-2` after it when that one is taken. */
  function freeSlug(base: string): string {
    if (!base || !memory.get(base)) return base
    for (let n = 2; ; n++) {
      const next = `${base}-${n}`
      if (!memory.get(next)) return next
    }
  }

  function settings(): { cold_days: number } {
    const row = db.prepare('SELECT cold_days FROM memory_setting WHERE id = 1').get() as
      | { cold_days: number }
      | undefined
    if (row) return row
    db.prepare('INSERT INTO memory_setting (id, cold_days) VALUES (1, ?)').run(DEFAULT_COLD_DAYS)
    return { cold_days: DEFAULT_COLD_DAYS }
  }

  function use(slug: string, by: string): void {
    db.prepare('INSERT INTO memory_use (slug, used_by, used_at) VALUES (?, ?, ?)').run(slug, by, now().toISOString())
  }

  /** Last use and uses this week, per page, in one pass. */
  function usage(): Map<string, { lastUsedAt: string | null; usesThisWeek: number }> {
    const since = new Date(now().getTime() - WEEK_MS).toISOString()
    const rows = db
      .prepare(
        `SELECT slug, MAX(used_at) AS last_used, SUM(CASE WHEN used_at >= ? THEN 1 ELSE 0 END) AS week
           FROM memory_use GROUP BY slug`,
      )
      .all(since) as { slug: string; last_used: string | null; week: number }[]
    return new Map(rows.map((row) => [row.slug, { lastUsedAt: row.last_used, usesThisWeek: Number(row.week) }]))
  }

  function contradictions(pages: readonly MemoryPage[]): Map<string, MemoryContradiction> {
    return findContradictions(
      pages
        .filter((page) => !page.archived)
        .map(({ slug, title, kind, repos, body }) => ({ slug, title, kind, repos, body })),
    )
  }

  function summarise(pages: readonly MemoryPage[]): MemoryPageSummary[] {
    const uses = usage()
    const clashes = contradictions(pages)
    const coldMs = settings().cold_days * DAY_MS
    const at = now().getTime()
    return pages.map((page) => {
      const seen = uses.get(page.slug) ?? { lastUsedAt: null, usesThisWeek: 0 }
      const reference = Date.parse(seen.lastUsedAt ?? page.updatedAt ?? page.createdAt)
      const { body: _body, ...rest } = page
      return {
        ...rest,
        lastUsedAt: seen.lastUsedAt,
        usesThisWeek: seen.usesThisWeek,
        cold: !page.archived && Number.isFinite(reference) && at - reference > coldMs,
        contradiction: clashes.get(page.slug) ?? null,
      }
    })
  }

  function sortRows(rows: MemoryPageSummary[], sort: MemoryQuery['sort']): MemoryPageSummary[] {
    const when = (row: MemoryPageSummary) => Date.parse(row.lastUsedAt ?? row.updatedAt) || 0
    if (sort === 'new') return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    // Cold first, and the coldest of them first: the boss's list of what to look at.
    if (sort === 'cold') return [...rows].sort((a, b) => Number(b.cold) - Number(a.cold) || when(a) - when(b))
    return [...rows].sort((a, b) => when(b) - when(a))
  }

  function matching(query: MemoryQuery): MemoryPage[] {
    const text = ftsQuery(query.search ?? '')
    const slugs = text ? new Set(ftsSlugs(db, text)) : null
    return allPages().filter((page) => {
      if (!query.archived && page.archived) return false
      if (query.archived && !page.archived) return false
      if (query.kind && page.kind !== query.kind) return false
      if (query.repo && !page.repos.includes(query.repo)) return false
      if (slugs && !slugs.has(page.slug)) return false
      return true
    })
  }

  const memory: CompanyMemory = {
    folder: files.folder,

    rebuild() {
      db.exec('DELETE FROM memory_page')
      db.exec('DELETE FROM memory_source')
      db.exec('DELETE FROM memory_link')
      db.exec('DELETE FROM memory_fts')
      for (const file of files.list()) {
        const text = files.read(file)
        if (text === null) continue
        const page = parsePage(file, text)
        if (page) index(page)
      }
      return memory.counts()
    },

    counts() {
      const rows = summarise(allPages())
      const counts = emptyCounts()
      for (const row of rows) {
        if (row.archived) {
          counts.archived += 1
          continue
        }
        counts.pages += 1
        counts.byKind[row.kind] += 1
        if (row.cold) counts.cold += 1
        if (row.contradiction) counts.contradictions += 1
      }
      // A contradiction is a pair; the footer counts pairs, not the pages in them.
      counts.contradictions = Math.ceil(counts.contradictions / 2)
      return counts
    },

    list(query = {}) {
      const rows = sortRows(summarise(matching(query)), query.sort)
      return query.limit === undefined ? rows : rows.slice(0, query.limit)
    },

    get(slug) {
      const row = rowOf(slug)
      return row ? rowToPage(row) : null
    },

    read(slug, by) {
      const page = memory.get(slug)
      if (!page) return null
      use(slug, by)
      changed()
      return page
    },

    search(query, by) {
      const found = memory.list({ ...query, sort: query.sort ?? 'used' })
      for (const row of found) use(row.slug, by)
      if (found.length > 0) changed()
      return found
    },

    write({ kind, title, body, sources, repos, mode = 'append', by }) {
      const stamp = now().toISOString()
      const slug = slugify(title)
      const existing = slug ? memory.get(slug) : null
      if (existing && existing.kind !== kind) {
        throw new Error(`"${title}" already exists as a ${existing.kind}; give this page another title`)
      }
      const text = (body ?? '').trim()
      const nextBody = existing && mode === 'append' ? `${existing.body.replace(/\s+$/, '')}\n\n${text}` : text
      const page = newPage({
        kind,
        title: existing?.title ?? title.trim(),
        ...(slug ? { slug } : {}),
        body: nextBody,
        repos: [...new Set([...(existing?.repos ?? []), ...(repos ?? [])])],
        sources: [...new Set([...(existing?.sources ?? []).map(formatSource), ...(sources ?? []).filter(Boolean)])],
        links: [...new Set([...(existing?.links ?? []), ...bodyLinks(nextBody)])],
        updatedBy: by,
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
        pinned: existing?.pinned ?? false,
        archived: existing?.archived ?? false,
        ...(existing?.handoff && { handoff: existing.handoff }),
      })
      assertWritablePage(page)
      // A page that was archived and is written again comes back: somebody still needs it.
      page.archived = false
      const from = existing ? pageFile(existing.kind, existing.slug, existing.archived) : undefined
      return save(page, by, `${existing ? 'Update' : 'Add'} ${page.kind} ${page.slug}`, from)
    },

    link(a, b, by) {
      if (a === b) throw new Error('A page cannot be linked to itself')
      const left = memory.get(a)
      const right = memory.get(b)
      if (!left) throw new Error(`There is no memory page "${a}"`)
      if (!right) throw new Error(`There is no memory page "${b}"`)
      if (!left.links.includes(b)) save({ ...left, links: [...left.links, b] }, by, `Link ${a} to ${b}`)
      if (!right.links.includes(a)) save({ ...right, links: [...right.links, a] }, by, `Link ${b} to ${a}`)
    },

    pin(slug, pinned, by) {
      const page = memory.get(slug)
      if (!page) throw new Error(`There is no memory page "${slug}"`)
      return save({ ...page, pinned }, by, `${pinned ? 'Pin' : 'Unpin'} ${slug}`)
    },

    archive(slug, by) {
      const page = memory.get(slug)
      if (!page) throw new Error(`There is no memory page "${slug}"`)
      if (page.archived) return page
      const from = pageFile(page.kind, page.slug, false)
      return save(
        { ...page, archived: true, updatedAt: now().toISOString(), updatedBy: by },
        by,
        `Archive ${slug}`,
        from,
      )
    },

    history(slug) {
      const page = memory.get(slug)
      if (!page) return []
      return git.history(files.folder, pageFile(page.kind, page.slug, page.archived))
    },

    revision(slug, commit) {
      const page = memory.get(slug)
      if (!page) return null
      return git.show(files.folder, commit, pageFile(page.kind, page.slug, page.archived))
    },

    restore(slug, commit, by) {
      const page = memory.get(slug)
      if (!page) throw new Error(`There is no memory page "${slug}"`)
      const text = memory.revision(slug, commit)
      if (text === null) throw new Error(`Commit ${commit.slice(0, 7)} has no ${slug}`)
      const file = pageFile(page.kind, page.slug, page.archived)
      const restored = parsePage(file, text)
      if (!restored) throw new Error(`Commit ${commit.slice(0, 7)} does not hold a memory page`)
      return save(
        { ...restored, updatedAt: now().toISOString(), updatedBy: by },
        by,
        `Restore ${slug} from ${commit.slice(0, 7)}`,
      )
    },

    filePath(slug) {
      const page = memory.get(slug)
      return page ? join(files.folder, ...pageFile(page.kind, page.slug, page.archived).split('/')) : null
    },

    fromTicket(ticket) {
      const slugs = db.prepare("SELECT slug FROM memory_source WHERE kind = 'ticket' AND ref = ?").all(ticket) as {
        slug: string
      }[]
      const wanted = new Set(slugs.map((row) => row.slug))
      return summarise(allPages().filter((page) => wanted.has(page.slug)))
    },

    writeHandoff({ title, body, by, repos, sources }) {
      const stamp = now().toISOString()
      const page = newPage({
        kind: 'handoff',
        // Two switches of the same Employee to the same Provider on the same ticket are two
        // handoffs, not one: the second must not reopen the first, which somebody has claimed.
        slug: freeSlug(slugify(title)),
        title,
        body,
        ...(repos !== undefined && { repos }),
        ...(sources !== undefined && { sources }),
        updatedBy: by,
        createdAt: stamp,
        updatedAt: stamp,
        handoff: { state: 'open', claimedBy: null, claimedAt: null },
      })
      assertWritablePage(page)
      return save(page, by, `Add handoff ${page.slug}`)
    },

    claimHandoff(slug, by) {
      const page = memory.get(slug)
      if (!page || !page.handoff) throw new Error(`There is no handoff "${slug}"`)
      if (page.handoff.state !== 'open') {
        throw new Error(
          `${slug} is already ${page.handoff.state}${page.handoff.claimedBy ? ` — ${page.handoff.claimedBy} has it` : ''}`,
        )
      }
      const stamp = now().toISOString()
      return save(
        {
          ...page,
          updatedAt: stamp,
          updatedBy: by,
          handoff: { state: 'claimed', claimedBy: by, claimedAt: stamp },
        },
        by,
        `Claim handoff ${slug}`,
      )
    },

    closeHandoff(slug, by) {
      const page = memory.get(slug)
      if (!page || !page.handoff) throw new Error(`There is no handoff "${slug}"`)
      const stamp = now().toISOString()
      return save(
        { ...page, updatedAt: stamp, updatedBy: by, handoff: { ...page.handoff, state: 'done' } },
        by,
        `Close handoff ${slug}`,
      )
    },

    brief(repos) {
      const wanted = new Set(repos)
      const rows = summarise(allPages()).filter(
        (page) =>
          !page.archived &&
          page.kind !== 'handoff' &&
          (page.repos.length === 0 || page.repos.some((repo) => wanted.has(repo))),
      )
      // Pinned first, then most used this week, then most recently used: what a Session is likely
      // to need, cut to a length instructions can always carry.
      return rows
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            b.usesThisWeek - a.usesThisWeek ||
            Date.parse(b.lastUsedAt ?? b.updatedAt) - Date.parse(a.lastUsedAt ?? a.updatedAt),
        )
        .slice(0, BRIEF_PAGES)
        .map(({ slug, title, kind }) => ({ slug, title, kind }))
    },

    coldDays: () => settings().cold_days,

    setColdDays(days) {
      const value = Math.max(1, Math.round(days))
      settings()
      db.prepare('UPDATE memory_setting SET cold_days = ? WHERE id = 1').run(value)
      changed()
      return value
    },
  }

  return memory
}

/**
 * What FTS5 is asked, from what the boss typed. Everything that is not a letter or a digit goes:
 * an unbalanced quote or a bare `-` is a syntax error to FTS5, and a search box must never be able
 * to throw. The last word gets a `*` so a search narrows as it is typed.
 */
export function ftsQuery(search: string): string | null {
  const words = search
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((word) => word !== '')
  if (words.length === 0) return null
  return words.map((word, i) => (i === words.length - 1 ? `"${word}"*` : `"${word}"`)).join(' AND ')
}

function ftsSlugs(db: DatabaseSync, query: string): string[] {
  try {
    const rows = db.prepare('SELECT slug FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank').all(query) as {
      slug: string
    }[]
    return rows.map((row) => row.slug)
  } catch {
    return []
  }
}
