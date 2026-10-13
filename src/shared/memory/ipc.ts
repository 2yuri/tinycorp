import type { Result } from '../domain/result'
import type {
  MemoryCounts,
  MemoryPage,
  MemoryPageSummary,
  MemoryQuery,
  MemoryRevision,
  MemoryWrite,
} from './company-memory'
import type { NoteRange, NotesRaw, NotesSearch, NotesView, NotesZoom } from './notes'

/**
 * Employees' own notes in the current Company (T193). Exposed as `window.tinyCorp.notes`.
 *
 * There is no edit and no delete, and there is no `write`: the log is append-only and the boss's
 * side of it is one button, `Add note`. What the boss can change is the budget, which belongs to
 * the Company rather than to any Employee.
 */
export interface NotesApi {
  /** The drawer's Memory tab in one read: the wake, the meter and the footer's counts. */
  view(employeeId: string): Promise<Result<NotesView>>
  /** Adds a note of the boss's own, badged `From you` wherever it is read. */
  addNote(employeeId: string, text: string): Promise<Result<NotesView>>
  /** Opens one range into its two halves, or into the notes themselves. */
  zoom(employeeId: string, range: NoteRange): Promise<Result<NotesZoom>>
  /** Every note that holds the query, word for word. */
  search(employeeId: string, query: string): Promise<Result<NotesSearch>>
  /** The tail of the log exactly as it is on disk. */
  raw(employeeId: string): Promise<Result<NotesRaw>>
  /** `Read at session start`, in tokens. Per Company, so it takes no Employee. */
  budget(): Promise<Result<number>>
  setBudget(tokens: number): Promise<Result<number>>
}

/** The Company's shared memory, as the Memory screen reads and edits it (T175). */
export interface CompanyMemoryApi {
  /** Where the pages are on disk, for Open in Files. */
  folder(): Promise<Result<string>>
  list(query?: MemoryQuery): Promise<Result<MemoryPageSummary[]>>
  counts(): Promise<Result<MemoryCounts>>
  /** One page with its body, or null when there is none with that slug. */
  get(slug: string): Promise<Result<MemoryPage | null>>
  /** The boss writing a page: a commit authored by them. */
  write(input: MemoryWrite): Promise<Result<MemoryPage>>
  pin(slug: string, pinned: boolean): Promise<Result<MemoryPage>>
  /** Moves the page into `archive/`; git keeps it and nothing is deleted. */
  archive(slug: string): Promise<Result<MemoryPage>>
  link(a: string, b: string): Promise<Result<true>>
  history(slug: string): Promise<Result<MemoryRevision[]>>
  restore(slug: string, commit: string): Promise<Result<MemoryPage>>
  /** The pages one closed ticket's capture wrote, by its code. */
  fromTicket(ticket: string): Promise<Result<MemoryPageSummary[]>>
  /** Where one page's file is on this machine, for Open in Files. */
  filePath(slug: string): Promise<Result<string | null>>
  /** Reads every file again: the files are the source of truth. */
  rebuild(): Promise<Result<MemoryCounts>>
  coldDays(): Promise<Result<number>>
  setColdDays(days: number): Promise<Result<number>>
  /** Fires after any page changes and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
