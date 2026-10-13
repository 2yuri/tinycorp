import { isAtWork } from '../../../shared/office/at-work'
import type { SessionStatus } from '../../../shared/session'
import type { CompanyContext, OpenCompany } from '../../core'
import type { FilesFacade, LanguageFacade, PathLinksFacade } from './facade'
import { createFileChanges, type FileChangesReader } from './file-changes'
import { createFiles, type FilePlacesInput, type FilesReader, filePlaces } from './files'
import { createLanguage, type LanguageReader } from './language'
import { createPathLinks, type PathLinksReader } from './path-links'

/** What Files reaches for: a place is a ticket worktree or a connected repo, so it is all of them. */
export interface FilesDeps {
  /** The current Company's repos, in the order the boss attached them. */
  repos(entry: OpenCompany): { list(): FilePlacesInput['repos'] }
  /** Its ticket worktrees, which is what the rest of a place list is. */
  code(entry: OpenCompany): { list(): { worktrees: FilePlacesInput['worktrees'] }[] }
  /** Its tickets and its roster, to name a worktree after the ticket and the Employee on it. */
  board(entry: OpenCompany): { snapshot(): { tickets: FilePlacesInput['tickets'] } }
  staff(entry: OpenCompany): { employees: { list(): FilePlacesInput['employees'] } }
  /** Whether the holder of a worktree is at work in it, so the boss knows what a save costs (T122). */
  sessions: { get(employeeId: string): { status: SessionStatus } }
  /**
   * Everything that can move a place. Nothing polls (T160): a Company switch, a board move, a
   * worktree made or a Session's hook is each a moment to forget what was cached.
   */
  invalidatedBy: readonly ((listener: () => void) => unknown)[]
  log(line: string): void
  /**
   * A restore point taken before a discard, where the place is a ticket worktree (T118). The only
   * action here that loses work, so it is the only one that asks another feature for anything.
   */
  beforeDiscard(input: { ticketId: number; path: string; note: string }): void
}

/**
 * What `git status` says in each place, and the boss's own stage, discard, commit and push (T160).
 * `of` and `invalidate` are the cache underneath and stay inside the feature.
 */
export interface FileChanges extends Omit<FileChangesReader, 'of' | 'invalidate'> {
  /** Called after a place's status could have moved. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** The files feature, once it is wired. */
export interface FilesFeature {
  files: FilesReader
  fileChanges: FileChanges
  /** One place's `git status`, straight off the cache. What a handoff page lists (T173). */
  changesOf: FileChangesReader['of']
  language: LanguageReader
  pathLinks: PathLinksReader
  /**
   * Something the app already knows about says a place moved — a Session's hook, a worktree
   * created, a ticket moved, the boss's own save — so forget what was cached and redraw. Nothing
   * polls (T160).
   */
  invalidate(): void
  /** A Company closed: its language servers belong to its places and go with it (T115). */
  dispose(): void
  /** The code flow's half of `FilesFacade` is the code feature's own; this is the rest. */
  facade: Pick<FilesFacade, 'files' | 'fileChanges'> & LanguageFacade & PathLinksFacade
}

/**
 * Wires the Files view over the Company's places (T186).
 *
 * The four readers are one feature because they are one screen and they all start from the same
 * list of places: the tree and the reader, the diff against HEAD, the language server behind the
 * viewer, and the links a written path turns into. `company-engine.ts` calls this directly until
 * T188 and goes on telling it when to `invalidate()`, because those are events Files cannot
 * subscribe to itself.
 */
export function register(ctx: CompanyContext, deps: FilesDeps): FilesFeature {
  const files = createFiles({
    places: () => {
      const entry = ctx.currentEntry()
      return filePlaces({
        repos: deps.repos(entry).list(),
        worktrees: deps
          .code(entry)
          .list()
          .flatMap((code) => code.worktrees),
        tickets: deps.board(entry).snapshot().tickets,
        employees: deps.staff(entry).employees.list(),
        companyKey: entry.company.key,
        running: (employeeId) => isAtWork(deps.sessions.get(employeeId).status),
      })
    },
  })
  const places = () => files.places()

  // The Changes tab's `git status`, one per place, kept until something the app already knows
  // about says it moved (T160).
  const changes = createFileChanges({ places })
  // One language server per place, started the first time Files opens a file it speaks for and
  // stopped with the Company (T115).
  const language = createLanguage({ places })
  const changed = ctx.listeners()
  function invalidate(): void {
    changes.invalidate()
    changed.notify()
  }
  for (const watch of deps.invalidatedBy) watch(invalidate)

  const fileChanges: FilesFeature['fileChanges'] = {
    list: () => changes.list(),
    diff: (placeId, path) => changes.diff(placeId, path),
    stage(placeId, paths) {
      changes.stage(placeId, paths)
      invalidate()
    },
    unstage(placeId, paths) {
      changes.unstage(placeId, paths)
      invalidate()
    },
    discard(placeId, paths) {
      const place = places().find((one) => one.id === placeId)
      if (place?.ticketId !== null && place !== undefined) {
        try {
          deps.beforeDiscard({
            ticketId: place.ticketId,
            path: place.path,
            note: `Before discarding ${paths.length === 1 ? paths[0] : `${paths.length} files`}`,
          })
        } catch (error) {
          deps.log(`Could not keep a restore point before the discard: ${(error as Error).message}`)
        }
      }
      changes.discard(placeId, paths)
      invalidate()
    },
    commit(placeId, message) {
      changes.commit(placeId, message)
      invalidate()
    },
    push(placeId) {
      changes.push(placeId)
      invalidate()
    },
    onChange: (listener) => changed.add(listener),
  }

  const pathLinks = createPathLinks({ places })

  return {
    files,
    fileChanges,
    changesOf: (placeId) => changes.of(placeId),
    language,
    pathLinks,
    invalidate,
    facade: { files, fileChanges, language, pathLinks },

    dispose() {
      // Deliberately not `files`: only the servers hold anything outside the process.
      language.stop()
    },
  }
}
