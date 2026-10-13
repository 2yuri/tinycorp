import type { Result } from '../domain/result'
import type { EditorsState } from './editors'
import type { ChangedFileDiff, PlaceChanges } from './file-changes'
import type { FileSaveRequest, FileSaveResult } from './file-edits'
import type { FilePlace, FileTree, OpenedFile } from './files'
import type { CodeSpot, Defined, Hovered, LanguageReading } from './language'
import type { PathLink } from './path-links'

/**
 * The Files view (T113): the Company's own repos and ticket worktrees, read one file at a time.
 * The main process owns every path; the renderer only ever names a place and a path inside it.
 * Exposed as `window.tinyCorp.files`.
 */
export interface FilesApi {
  /** Every place the view can open: each ticket worktree, then each connected repo. */
  places(): Promise<Result<FilePlace[]>>
  /** The place's folders and files, marked with what the Employee changed in it. */
  tree(placeId: string): Promise<Result<FileTree>>
  /** One file of the place, opened by its kind. A path outside the place is refused. */
  open(placeId: string, path: string): Promise<Result<OpenedFile>>
  /**
   * Writes the boss's text back to a file of the place (T122). A file that changed underneath
   * since it was opened is not overwritten: both versions come back to pick from.
   */
  save(placeId: string, request: FileSaveRequest): Promise<Result<FileSaveResult>>
  /** Makes an empty file inside the place and opens it. A name it already has is refused. */
  create(placeId: string, path: string): Promise<Result<OpenedFile>>
  /** Hands the file (or the place itself) to the editor the boss picked (T123), else the system default. */
  openInEditor(placeId: string, path?: string): Promise<Result<null>>
  /** Reveals the file (or the place itself) in Finder. */
  reveal(placeId: string, path?: string): Promise<Result<null>>
  /**
   * The Changes tab (T160): every place with something changed in it, read from one
   * `git status --porcelain` per place and cached until an event the app already has says it moved.
   * A place with nothing changed is not in the list; nor is a worktree whose folder has gone.
   */
  changes(): Promise<Result<PlaceChanges[]>>
  /** One changed file's two sides against HEAD, or null when git has no text for it at all. */
  changeDiff(placeId: string, path: string): Promise<Result<ChangedFileDiff | null>>
  /** Puts the paths in that place's index. */
  stage(placeId: string, paths: string[]): Promise<Result<null>>
  /** Takes the paths back out of that place's index, leaving the working tree alone. */
  unstage(placeId: string, paths: string[]): Promise<Result<null>>
  /**
   * Throws away everything uncommitted about those paths. The renderer has already asked the boss;
   * the main process takes the restore point, where the place is a ticket worktree (T118).
   */
  discard(placeId: string, paths: string[]): Promise<Result<null>>
  /** Commits what is staged in that place, with the boss's own message. */
  commit(placeId: string, message: string): Promise<Result<null>>
  /** Pushes that place's branch, publishing it when it has no upstream yet. */
  push(placeId: string): Promise<Result<null>>
  /** Fires when the places change — a new worktree, a renamed repo — and on Company switch. */
  onChanged(listener: () => void): () => void
}

/**
 * The paths an Employee wrote, wherever the app draws their text (T114). The main process finds
 * them, checks they are really there and resolves them; the renderer only ever sends the text back
 * and the written path it wants opened. Exposed as `window.tinyCorp.paths`.
 */
export interface PathsApi {
  /** Every path in `text` that is a file, with where a click on it goes. Never throws at a word. */
  links(text: string): Promise<Result<PathLink[]>>
  /**
   * Reads a path outside the Company for the Files view, which opens it as a tab of its own
   * (T121). Every kind comes back the way the Files view reads one of the Company's own.
   */
  open(path: string): Promise<Result<OpenedFile>>
  /** Reveals a written path in Finder. Nothing else is done with it. */
  reveal(path: string): Promise<Result<null>>
  /** Hands a written path to the editor the boss picked (T123), by the same choice Files uses. */
  openInEditor(path: string): Promise<Result<null>>
}

/**
 * Which editor opens a file (T123). The main process owns both what this Mac has and the boss's
 * pick; the renderer only draws the button and sends the row the boss clicked. Exposed as
 * `window.tinyCorp.editors`.
 */
export interface EditorsApi {
  /** What was found on this Mac, what the boss picked, and what is in force right now. */
  get(): Promise<EditorsState>
  /** The boss picked a row of the `OPEN WITH` list: an editor id, or `system`. */
  choose(id: string): Promise<Result<EditorsState>>
  /** Fires after the boss picks, so every window's button says the same thing. */
  onChanged(listener: (state: EditorsState) => void): () => void
}

/**
 * What the code viewer knows about the language of the file it is drawing (T115). Every call
 * carries the text the boss is looking at, unsaved or not, so what the server says follows the
 * editor and not the file on disk. Nothing here writes. Exposed as `window.tinyCorp.language`.
 */
export interface LanguageApi {
  /** The file as a whole: what the server complains about, and the symbols the outline lists. */
  read(placeId: string, path: string, text: string): Promise<Result<LanguageReading>>
  /** The type and the doc comment at a spot; null when the server knows nothing there. */
  hover(placeId: string, path: string, spot: CodeSpot, text: string): Promise<Result<Hovered | null>>
  /** Where the symbol at a spot is declared, in a place of the Company or nowhere it owns. */
  definition(placeId: string, path: string, spot: CodeSpot, text: string): Promise<Result<Defined | null>>
}
