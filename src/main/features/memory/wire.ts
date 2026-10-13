import { BOSS } from '../../../shared/domain/chat'
import { captureDetail, captureSummary, slugify } from '../../../shared/memory/company-memory'
import { type CompanyContext, type OpenCompany, ticketCodeIn } from '../../core'
import type { ActivityContext } from '../activity'
import type { Board } from '../board'
import type { Chat } from '../chat'
import type { OwnFace } from '../company'
import type { CompanyPlanning } from '../planning'
import type { ReposFeature } from '../repos'
import type { ReviewThreads } from '../review'
import { type CompanyMemory, createCompanyMemory } from './company-memory'
import { capturePages, captureResult } from './company-memory-capture'
import { type MemoryPageFiles, memoryPageFilesOnDisk } from './company-memory-files'
import { createMemoryGit, type MemoryGit } from './company-memory-git'
import { companyMemoryFolder } from './company-memory-page'
import type { CompanyMemoryFacade, NotesFacade } from './facade'
import { type EmployeeNotes, employeeNotes } from './notes'
import { createNotesSettings, type NotesSettings } from './notes-budget'
import { type NotesFiles, notesFilesOnDisk } from './notes-files'

/**
 * The IO memory does — all of it injected so no test writes a real file or makes a real commit —
 * and the five features a closed ticket's capture is composed from. Memory reads them and none of
 * them reads memory, which is why the capture lives here rather than in the composition root.
 */
export interface MemoryDeps extends MemoryOptions {
  /** The clock a page's revision is stamped with. */
  now(): number
  log(line: string): void

  /** The ticket the capture is about, and who can be named in it. */
  board(entry: OpenCompany): Board
  chat(entry: OpenCompany): Chat
  /** The repos the ticket touched, so a page names them rather than their ids. */
  repos(entry: OpenCompany): ReturnType<ReposFeature['of']>
  /** The approved plan a page opens with, when the ticket had one (T171). */
  planning(entry: OpenCompany): CompanyPlanning
  /** The review threads that taught somebody something. */
  threads(entry: OpenCompany): ReviewThreads
  /** One Activity line per ticket, however many pages the capture wrote. */
  activity(entry: OpenCompany): () => ActivityContext
  /** The boss's own name, for the pages and the pins they write themselves. */
  bossName(): string
}

/** The IO the boss's app hands in, and every test leaves out. */
export interface MemoryOptions {
  /** Where Employees' note logs are read and written. Defaults to the Company folder on disk. */
  notesFiles?: NotesFiles
  /**
   * Where the Company's shared memory pages are read and written (T175). Defaults to
   * `<company folder>/memory/company` on disk.
   */
  memoryPages?: (companyFolder: string) => MemoryPageFiles
  /** The git behind those pages. Defaults to the `git` command line. */
  memoryGit?: MemoryGit
}

/** The memory feature, once it is wired. */
export interface MemoryFeature {
  /** That Company's shared wiki, made the first time it is asked for. */
  companyMemory(companyId: string): CompanyMemory
  /** The Company the boss is looking at, for the Memory screen and the IPC module. */
  currentCompanyMemory(): CompanyMemory
  /** One Employee's own note log, in that Company. Nobody else reads it. */
  notes(companyId: string, employeeId: string): EmployeeNotes
  currentNotes(employeeId: string): EmployeeNotes
  /** That Company's `Read at session start`, in tokens (T193). */
  settings(companyId: string): NotesSettings
  /** Fires after any page changes, in any open Company. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
  /**
   * The capture a closed ticket earns (T175), deterministic and with no model in it: the approved
   * plan, the review threads that taught somebody something, and the failures a fix commit closed.
   */
  captureFromTicket(entry: OpenCompany, ticketId: number, actorId: string): void
  facade: OwnFace<CompanyMemoryFacade> & NotesFacade
}

/**
 * Wires an Employee's own notes and the Company's shared wiki (T175, T186).
 *
 * One wiki per open Company, over that Company's own folder and its own git repo; the index in the
 * Company database is derived and can always be rebuilt from the files — so closing the Company
 * drops the index and reopening it builds one again.
 */
export function register(ctx: CompanyContext, deps: MemoryDeps): MemoryFeature {
  const files = deps.notesFiles ?? notesFilesOnDisk
  const pages = deps.memoryPages ?? ((folder: string) => memoryPageFilesOnDisk(companyMemoryFolder(folder)))
  const git = deps.memoryGit ?? createMemoryGit()
  const changed = ctx.listeners()
  const wikis = ctx.perCompany((entry) =>
    createCompanyMemory({
      db: entry.db,
      files: pages(entry.company.folder),
      git,
      now: () => new Date(deps.now()),
      onChanged: () => changed.notify(),
    }),
  )
  /**
   * One note log per Employee per open Company, and **kept**: the log's read index lives in its
   * closure, so making a second one for the next call would mean walking the file again. Closing
   * the Company drops them with everything else `perCompany` holds (T193).
   */
  const logs = ctx.perCompany((entry) => ({
    folder: entry.company.folder,
    byEmployee: new Map<string, EmployeeNotes>(),
  }))
  const settings = ctx.perCompany((entry) => createNotesSettings(entry.db, () => changed.notify()))

  function notesIn(company: { folder: string; byEmployee: Map<string, EmployeeNotes> }, employeeId: string) {
    const held = company.byEmployee.get(employeeId)
    if (held) return held
    const made = employeeNotes({
      files,
      companyFolder: company.folder,
      employeeId,
      now: () => new Date(deps.now()),
    })
    company.byEmployee.set(employeeId, made)
    return made
  }

  /** What the boss types into the drawer's search, as a pattern that matches it word for word. */
  const literal = (query: string) => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const current = () => wikis.current()

  function captureFromTicket(entry: OpenCompany, ticketId: number, actorId: string): void {
    try {
      const ticket = deps
        .board(entry)
        .snapshot()
        .tickets.find((t) => t.id === ticketId)
      if (!ticket) return
      const repos = deps.repos(entry).list()
      const people = deps.chat(entry).people()
      const code = ticketCodeIn(entry.db, ticket.id)
      const plan = deps.planning(entry).of({ kind: 'ticket', id: ticket.id })
      const pages = capturePages({
        ticket,
        code,
        repoNames: Object.fromEntries(repos.map((repo) => [repo.id, repo.name])),
        plan: plan && plan.status === 'approved' ? plan : null,
        threads: deps.threads(entry).list(ticket.id),
        nameOf: (id) =>
          id === BOSS ? entry.company.boss.name : (people.find((p) => p.id === id)?.name ?? 'a colleague'),
        by: entry.company.name,
      })
      const memory = wikis.of(entry)
      // A Handoff this ticket opened closes with it, whatever else the capture writes (`I44S1a`a).
      for (const page of memory.fromTicket(code)) {
        if (page.kind === 'handoff' && page.handoff?.state !== 'done')
          memory.closeHandoff(page.slug, entry.company.name)
      }
      if (pages.length === 0) return
      const written = pages.map((page) => {
        const before = memory.get(slugify(page.title))
        const saved = memory.write({ ...page, by: entry.company.name })
        return { slug: saved.slug, title: saved.title, kind: saved.kind, created: before === null }
      })
      const result = captureResult(code, written, pages)
      deps
        .activity(entry)()
        .log.record({
          kind: 'memory_captured',
          actorId: 'company',
          actorName: 'Memory',
          summary: captureSummary(result),
          detail: [captureDetail(result), written[0]?.title].filter(Boolean).join(' · ') || null,
          subject: { kind: 'memory', id: code, label: code },
          code: [code],
          badge: { label: 'No model', tone: 'neutral' },
          payload: { ticket: code, slugs: written.map((page) => page.slug), actorId },
        })
    } catch (error) {
      // A capture that cannot be written must never stop a ticket closing.
      deps.log(`Memory: could not capture ${ticketId}: ${(error as Error).message}`)
    }
  }

  /** One Employee's note log in the current Company; throws for anyone it does not have. */
  function notesOf(employeeId: string): EmployeeNotes {
    const entry = ctx.currentEntry()
    if (
      !deps
        .chat(entry)
        .people()
        .some((person) => person.id === employeeId)
    ) {
      throw new Error(`Unknown Employee: ${employeeId}`)
    }
    return notesIn(logs.of(entry), employeeId)
  }

  return {
    companyMemory: (companyId) => wikis.ofId(companyId),
    currentCompanyMemory: current,
    notes: (companyId, employeeId) => notesIn(logs.ofId(companyId), employeeId),
    currentNotes: (employeeId) => notesIn(logs.current(), employeeId),
    settings: (companyId) => settings.ofId(companyId),
    onChanged: (listener) => changed.add(listener),
    captureFromTicket,
    facade: {
      notes: {
        view: (employeeId) => notesOf(employeeId).view(settings.current().budget()),
        addNote(employeeId, text) {
          const employee = notesOf(employeeId)
          employee.add(text, 'boss')
          return employee.view(settings.current().budget())
        },
        zoom: (employeeId, range) => notesOf(employeeId).zoom(range),
        search: (employeeId, query) => notesOf(employeeId).search(literal(query)),
        raw: (employeeId) => notesOf(employeeId).raw(),
        budget: () => settings.current().budget(),
        setBudget: (tokens) => settings.current().setBudget(tokens),
      },
      companyMemory: {
        folder: () => current().folder,
        list: (query) => current().list(query),
        counts: () => current().counts(),
        get: (slug) => current().get(slug),
        // The boss's own edits are commits authored by them, like an Employee's.
        write: (input) => current().write({ ...input, by: deps.bossName() }),
        pin: (slug, pinned) => current().pin(slug, pinned, deps.bossName()),
        archive: (slug) => current().archive(slug, deps.bossName()),
        link: (a, b) => current().link(a, b, deps.bossName()),
        history: (slug) => current().history(slug),
        restore: (slug, commit) => current().restore(slug, commit, deps.bossName()),
        fromTicket: (ticket) => current().fromTicket(ticket),
        filePath: (slug) => current().filePath(slug),
        rebuild: () => current().rebuild(),
        coldDays: () => current().coldDays(),
        setColdDays: (days) => current().setColdDays(days),
        onChanged: (listener) => changed.add(listener),
      },
    },
  }
}
