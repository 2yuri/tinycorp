/**
 * The Files view (T113): one place at a time — a repo of the Company, or an Employee's worktree
 * for a ticket — with a tree over it and a viewer that opens a file by its kind.
 */

/** What an Employee did to a file in their worktree, against the branch it started from. */
export type FileChange = 'added' | 'modified' | 'removed'

/** The letter the tree puts beside a changed file. */
export const CHANGE_MARK: Record<FileChange, string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
}

/** A place the Files view can open: a repo itself, or one ticket's worktree of it. */
export interface FilePlace {
  /** `repo:<repoId>` or `worktree:<ticketId>:<repoId>`; see `placeId`. */
  id: string
  repoId: string
  repoName: string
  /** Absolute path of the folder the tree is rooted at. */
  path: string
  /** Null for the repo itself. */
  ticketId: number | null
  /** `TC-142`, or null for the repo itself. */
  ticketKey: string | null
  ticketTitle: string | null
  /** The Employee who holds the ticket; null when nobody does, or for the repo itself. */
  holderName: string | null
  /** The worktree's branch; null for the repo itself. */
  branch: string | null
  /** The branch the worktree started from, which its changes are read against; null for a repo. */
  base: string | null
  /**
   * Whether whoever holds the ticket has a Session running in this worktree right now (T122).
   * A warning above the file, never a lock: the boss may still write.
   */
  sessionRunning: boolean
}

export function placeId(repoId: string, ticketId: number | null): string {
  return ticketId === null ? `repo:${repoId}` : `worktree:${ticketId}:${repoId}`
}

/** `tinycorp · Ada's worktree · TC-142 the counter speaks`, the line under the Files title. */
export function placeLabel(place: FilePlace): string {
  if (place.ticketId === null) return `${place.repoName} · the repository`
  const whose = place.holderName ? `${place.holderName}'s worktree` : 'the worktree'
  const ticket = [place.ticketKey, place.ticketTitle].filter(Boolean).join(' ')
  return [place.repoName, whose, ticket].filter(Boolean).join(' · ')
}

/** One node of a place's tree, listed flat: the renderer nests them. */
export interface FileEntry {
  /** Relative to the place's root, `/`-separated. */
  path: string
  kind: 'file' | 'folder'
  /** What the Employee did to it in this worktree; null when they left it alone. */
  change: FileChange | null
}

/** A place's whole tree, as the panel on the left draws it. */
export interface FileTree {
  placeId: string
  /** Folders before files, each level in alphabetical order. */
  entries: FileEntry[]
  /** True when the walk hit its cap, so the tree is not the whole folder. */
  truncated: boolean
}

/**
 * Which viewer opens a file. `code` and `markdown` and `text` carry their text, `image` a data URL,
 * `binary` and `too-big` carry neither and say so instead.
 */
export type FileKind = 'code' | 'markdown' | 'image' | 'text' | 'binary' | 'too-big'

/** One file of a place, read in the main process and opened by kind. */
export interface OpenedFile {
  /** Relative to the place's root. */
  path: string
  kind: FileKind
  /** The whole file's size in bytes, even when only a head was read. */
  size: number
  /** The text, or the head of it; null for an image, a binary file and one too big. */
  text: string | null
  /** True when `text` is only the head of the file. */
  truncated: boolean
  /** How many lines `text` holds; null when there is none. */
  lines: number | null
  /** `data:image/png;base64,…` for an image; null otherwise. */
  dataUrl: string | null
  /** The language for highlighting, e.g. `ts`; null when there is none to highlight. */
  language: string | null
  /** The line numbers the Employee changed here, as this file numbers them. Empty for a repo. */
  changedLines: number[]
  /** What the Employee did to this file in the worktree; null when they left it alone. */
  change: FileChange | null
  /**
   * A digest of the bytes that were read, which a save hands back so the main process can tell the
   * file changed underneath (T122). Null for a file too big to have been read at all.
   */
  digest: string | null
}

/** `1.2 KB`, `48 lines` and the rest of the chips, from bytes. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 1024 * 1024) return `${round(bytes / 1024)} KB`
  return `${round(bytes / (1024 * 1024))} MB`
}

function round(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

/** The extensions the image viewer draws. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const

/** What the code viewer highlights, by extension. The languages the repos actually hold. */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  json: 'json',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  py: 'python',
  sql: 'sql',
  toml: 'toml',
}

/**
 * The last segment of a path: what the file is called. Both separators, because a path an Employee
 * wrote is a path on their machine (T166) and on Windows that one is `\`.
 */
export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** The last `.`-separated part of a path, lowercased; empty when the name has none. */
export function extensionOf(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Whether the app draws this file as a picture rather than reading it as text. */
export function isImageFile(path: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(path))
}
