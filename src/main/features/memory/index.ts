/**
 * Memory: an Employee's own notes (T73, T193), and the Company's shared wiki (T175).
 *
 * Two things that share a word and a screen. `notes.ts` is one append-only log per Employee, read
 * back at every Session start as a wake of fixed size; `company-memory.ts` is the git-backed wiki
 * every Employee reads through MCP and only the boss writes — nothing in it is written by a model
 * (`docs/company-memory.md`).
 *
 * This is the module's front door. What is not here is not for other modules: the page format, the
 * log's line format, the summary tree, the wake planner and the fakes stay inside, and the tests
 * name them directly.
 */

export { COMPANY_MEMORY_MIGRATION, type CompanyMemory } from './company-memory'
export { capturingWakes } from './company-memory-capture'
export { registerCompanyMemoryIpc } from './company-memory-ipc'
export { registerCompanyMemoryTools } from './company-memory-tools'
export type { CompanyMemoryFacade, NotesFacade } from './facade'
export type { EmployeeNotes } from './notes'
export { NOTES_BUDGET_MIGRATION } from './notes-budget'
export type { NotesFiles } from './notes-files'
export { registerNotesIpc } from './notes-ipc'
export { registerNotesTools } from './notes-tools'
export { renderWake } from './notes-wake'
export { type MemoryOptions, register as registerMemory } from './wire'
