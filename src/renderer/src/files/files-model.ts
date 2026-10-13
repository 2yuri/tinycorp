import {
  CHANGE_MARK,
  type FileChange,
  type FileEntry,
  type FilePlace,
  type OpenedFile,
  sizeLabel,
} from '../../../shared/files/files'

/** One row of the tree panel, already flattened by what is open and what the find box asked for. */
export interface FileRow {
  path: string
  /** What the row shows: the name alone in the tree, the whole path while finding. */
  label: string
  kind: 'file' | 'folder'
  /** How far in the row is drawn; always 0 while the find box has something in it. */
  depth: number
  change: FileChange | null
  /** Folders only: whether this one is open. */
  open: boolean
}

export interface FileRowsInput {
  entries: readonly FileEntry[]
  /** The folders the boss opened, by path. */
  open: ReadonlySet<string>
  /** What the find box holds; empty shows the tree itself. */
  query?: string
}

/**
 * The rows the tree draws. With nothing in the find box it is the tree, folded to the folders the
 * boss opened; with something in it, every file whose path holds that text, flat.
 */
export function fileRows({ entries, open, query = '' }: FileRowsInput): FileRow[] {
  const wanted = query.trim().toLowerCase()
  if (wanted) {
    return entries
      .filter((entry) => entry.kind === 'file' && entry.path.toLowerCase().includes(wanted))
      .map((entry) => ({
        path: entry.path,
        label: entry.path,
        kind: entry.kind,
        depth: 0,
        change: entry.change,
        open: false,
      }))
  }
  return entries
    .filter((entry) => foldersOf(entry.path).every((folder) => open.has(folder)))
    .map((entry) => ({
      path: entry.path,
      label: nameOf(entry.path),
      kind: entry.kind,
      depth: entry.path.split('/').length - 1,
      change: entry.change,
      open: entry.kind === 'folder' && open.has(entry.path),
    }))
}

/** Every folder above a path, outermost first: `src`, `src/shared` for `src/shared/office.ts`. */
export function foldersOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The folders to open so a path is in view, on top of the ones already open. */
export function openedFor(open: ReadonlySet<string>, path: string): Set<string> {
  return new Set([...open, ...foldersOf(path)])
}

/** Opening a closed folder, closing an open one. */
export function toggleFolder(open: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(open)
  if (!next.delete(path)) next.add(path)
  return next
}

/**
 * The folders to start with: the way down to the file the view opens on, so the tree shows where
 * it is and nothing else. With no file to open, the first level stands open instead.
 */
export function firstOpenFolders(entries: readonly FileEntry[], path: string | null): Set<string> {
  if (path) return new Set(foldersOf(path))
  return new Set(entries.filter((entry) => entry.kind === 'folder' && !entry.path.includes('/')).map((e) => e.path))
}

/** The file the view opens on: the first one the Employee changed, else the first file at all. */
export function firstFile(entries: readonly FileEntry[]): string | null {
  const files = entries.filter((entry) => entry.kind === 'file')
  return (files.find((entry) => entry.change !== null) ?? files[0])?.path ?? null
}

/** `src / shared / office / counter.ts`, as the viewer's head shows it. */
export function crumbsOf(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** The letter the tree puts beside a changed file, or null when it is untouched. */
export function changeMark(change: FileChange | null): string | null {
  return change === null ? null : CHANGE_MARK[change]
}

/** The chips at the right of the viewer's head: whose file it is, and how much of it there is. */
export function fileChips(file: OpenedFile, holderName: string | null): { text: string; tone: 'change' | 'plain' }[] {
  const chips: { text: string; tone: 'change' | 'plain' }[] = []
  if (file.change !== null || file.changedLines.length > 0) {
    chips.push({ text: `${holderName ?? 'The Employee'} is in this file`, tone: 'change' })
  }
  if (file.lines !== null) {
    chips.push({ text: `${file.lines} ${file.lines === 1 ? 'line' : 'lines'}`, tone: 'plain' })
  }
  chips.push({ text: sizeLabel(file.size), tone: 'plain' })
  return chips
}

/** What the viewer says under a file it did not read whole. */
export function truncationNotice(file: OpenedFile): string | null {
  if (!file.truncated || file.text === null) return null
  const read = new TextEncoder().encode(file.text).length
  return `Only the first ${sizeLabel(read)} of ${sizeLabel(file.size)} is shown. Open in editor for the rest.`
}

/** What the viewer says instead of a file it will not try. */
export function refusalNotice(file: OpenedFile): string | null {
  if (file.kind === 'binary') return `This is a binary file (${sizeLabel(file.size)}). There is no text to show.`
  if (file.kind === 'too-big')
    return `This file is ${sizeLabel(file.size)}, too big to read here. Open it in your editor.`
  return null
}

/** Whether a file is drawn pixel for pixel by default: a sprite sheet is, a photograph is not. */
export function looksLikeSprite(path: string): boolean {
  return /sheet|sprite|icon|tile|pixel/i.test(nameOf(path))
}

/**
 * The places as the subtitle's picker lists them (T262): each repo itself, then the worktrees cut
 * from it. The engine lists every worktree first, which is what the view should open on, but a
 * list that ran on down the window put every repo under the last worktree — below the view's edge,
 * where nothing could reach it.
 */
export function pickerPlaces(places: readonly FilePlace[]): FilePlace[] {
  // Every worktree has its repo in the list: the engine drops one whose repo is gone.
  return places
    .filter((place) => place.ticketId === null)
    .flatMap((repo) => [repo, ...places.filter((one) => one.ticketId !== null && one.repoId === repo.repoId)])
}
