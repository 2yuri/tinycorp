import type {
  MemoryCounts,
  MemoryPage,
  MemoryPageSummary,
  MemoryQuery,
  MemoryRevision,
  MemoryWrite,
} from '../../../shared/memory/company-memory'
import type { NoteRange, NotesRaw, NotesSearch, NotesView, NotesZoom } from '../../../shared/memory/notes'
import type { CompanyChanged } from '../company'

/**
 * The drawer's Memory tab and the Tokens card's own half of it (T188, T193): one Employee's
 * append-only note log, and the Company's `Read at session start`.
 *
 * There is no edit and no delete on it, because there is none in the log: the boss's write is one
 * more note, and what they can change about the rest is how much of it a Session reads.
 */
export interface NotesFacade {
  notes: {
    /** The Memory tab in one read: the wake, the meter and the footer's counts. */
    view(employeeId: string): NotesView
    /** Adds a note of the boss's own, badged `From you` wherever it is read. */
    addNote(employeeId: string, text: string): NotesView
    zoom(employeeId: string, range: NoteRange): NotesZoom
    /** Every note that holds the query, word for word. */
    search(employeeId: string, query: string): NotesSearch
    raw(employeeId: string): NotesRaw
    /** `Read at session start`, in tokens, for the whole Company. */
    budget(): number
    setBudget(tokens: number): number
  }
}

/** The Company's shared memory as the boss's screen uses it (T175). */
export interface CompanyMemoryView {
  /** Where the pages are, for Open in Files. */
  folder(): string
  list(query?: MemoryQuery): MemoryPageSummary[]
  counts(): MemoryCounts
  get(slug: string): MemoryPage | null
  /** The boss writing a page: a commit authored by them. */
  write(input: MemoryWrite): MemoryPage
  pin(slug: string, pinned: boolean): MemoryPage
  archive(slug: string): MemoryPage
  link(a: string, b: string): void
  history(slug: string): MemoryRevision[]
  restore(slug: string, commit: string): MemoryPage
  /** The pages one ticket's capture wrote, by its code. */
  fromTicket(ticket: string): MemoryPageSummary[]
  /** Where one page's file is on this machine, for Open in Files. */
  filePath(slug: string): string | null
  /** Reads every file again. The files are the source of truth; this proves it. */
  rebuild(): MemoryCounts
  coldDays(): number
  setColdDays(days: number): number
  /** Fires after any page changes, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/** The Company memory screen's face. */
export interface CompanyMemoryFacade extends CompanyChanged {
  /** A git-backed markdown wiki every Employee reads and writes (T175). */
  companyMemory: CompanyMemoryView
}
