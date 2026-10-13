/**
 * The core: what a Company *is*, and the pieces every feature is written against.
 *
 * This is the module's front door, and the layer every feature may name. `database.ts` is the
 * SQLite file itself and what a `Migration` is, and `company-databases.ts` is which folder that
 * file is in — the Company's own, or this PC's AppData for a Company folder in WSL (T256); `company-context.ts` is which
 * Companies are open and everything the app keeps per Company; `company-key.ts` is the key its
 * tickets are coded with; `company-data-ignore.ts` is how the Company's own files stay out of the
 * repos it works in; `ipc-kit.ts` and `mcp-kit.ts` are the two edges a call arrives over.
 *
 * Nothing here names a feature. The engine that wires them all is one folder down, behind its own
 * front door (`core/engine`), precisely so that a feature importing this file can never close a
 * cycle through the thing that imported the feature.
 */

export { COLLEAGUE_VOICE_MIGRATION, createVoiceSettings, type VoiceSettings } from './colleague-voice'
export { type CompanyContext, createCompanyContext, type OpenCompany } from './company-context'
export {
  excludeCompanyDataFromGit,
  ignoreCompanyData,
  inFolder,
  isInsideFolder,
  sameFilesystemKind,
  worktreeRootOutside,
  worktreesBeside,
} from './company-data-ignore'
export { COMPANY_MARKER_FOLDER, type CompanyDatabases, companyDatabases } from './company-databases'
export { companyKeyOf, ticketCodeIn } from './company-key'
export {
  COMPANY_DATABASE_FILES,
  COMPANY_FILE,
  companyDatabaseExists,
  type Migration,
  type OpenDatabase,
} from './database'
export { attempt, attemptAsync, type IpcHandlerRegistry, isRecord, requireString } from './ipc-kit'
export { run } from './mcp-kit'
export type { RecentCompanies } from './recents'
export { TICKET_ID_HELP, ticketIdInput, ticketNumber } from './ticket-input'
