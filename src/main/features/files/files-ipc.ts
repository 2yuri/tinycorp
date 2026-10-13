import { filesChannels } from '../../../shared/domain/channels'
import type { FileSaveRequest } from '../../../shared/files/file-edits'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { FilesFacade } from './facade'

/**
 * The boss's own tools, given a path the main process resolved itself. Neither ever builds a
 * shell string from a path: the editor gets an argument list, Finder gets the path as it is.
 */
export interface FileTools {
  /** `$EDITOR` when the machine names one, else whatever opens that file type. */
  openInEditor(path: string): Promise<void>
  /** Reveals the path in Finder, selected. */
  reveal(path: string): void
}

export interface FilesIpcOptions {
  ipc: IpcHandlerRegistry
  engine: FilesFacade
  tools: FileTools
  broadcastChanged(): void
}

/**
 * Lets the renderer read the Company's repos and worktrees, and hand one path to the boss's own
 * tools. Holds no state of its own, and never takes a path the engine has not checked.
 */
export function registerFilesIpc({ ipc, engine, tools, broadcastChanged }: FilesIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.code.onChange(broadcastChanged)

  ipc.handle(filesChannels.places, () => attempt(() => engine.files.places()))
  ipc.handle(filesChannels.tree, (_event, placeId) => attempt(() => engine.files.tree(requirePlaceId(placeId))))
  ipc.handle(filesChannels.open, (_event, placeId, path) =>
    attempt(() => engine.files.open(requirePlaceId(placeId), requirePath(path))),
  )
  ipc.handle(filesChannels.save, (_event, placeId, request) =>
    attempt(() => {
      const saved = engine.files.save(requirePlaceId(placeId), requireSave(request))
      // A save is a change on disk the tree and the marks follow, so every view is told.
      if (saved.saved) broadcastChanged()
      return saved
    }),
  )
  ipc.handle(filesChannels.create, (_event, placeId, path) =>
    attempt(() => {
      const made = engine.files.create(requirePlaceId(placeId), requirePath(path))
      broadcastChanged()
      return made
    }),
  )
  ipc.handle(filesChannels.openInEditor, async (_event, placeId, path) => {
    try {
      await tools.openInEditor(engine.files.locate(requirePlaceId(placeId), optionalPath(path)))
      return { ok: true as const, value: null }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipc.handle(filesChannels.reveal, (_event, placeId, path) =>
    attempt(() => {
      tools.reveal(engine.files.locate(requirePlaceId(placeId), optionalPath(path)))
      return null
    }),
  )

  // The Changes tab (T160). Every read is cached in the engine and every write invalidates it, so
  // nothing here runs `git status` on a render, and every view is told once the work is done.
  engine.fileChanges.onChange(broadcastChanged)
  ipc.handle(filesChannels.changes, () => attempt(() => engine.fileChanges.list()))
  ipc.handle(filesChannels.changeDiff, (_event, placeId, path) =>
    attempt(() => engine.fileChanges.diff(requirePlaceId(placeId), requirePath(path))),
  )
  ipc.handle(filesChannels.stage, (_event, placeId, paths) =>
    attempt(() => {
      engine.fileChanges.stage(requirePlaceId(placeId), requirePaths(paths))
      return null
    }),
  )
  ipc.handle(filesChannels.unstage, (_event, placeId, paths) =>
    attempt(() => {
      engine.fileChanges.unstage(requirePlaceId(placeId), requirePaths(paths))
      return null
    }),
  )
  ipc.handle(filesChannels.discard, (_event, placeId, paths) =>
    attempt(() => {
      engine.fileChanges.discard(requirePlaceId(placeId), requirePaths(paths))
      return null
    }),
  )
  ipc.handle(filesChannels.commit, (_event, placeId, message) =>
    attempt(() => {
      engine.fileChanges.commit(requirePlaceId(placeId), requireMessage(message))
      return null
    }),
  )
  ipc.handle(filesChannels.push, (_event, placeId) =>
    attempt(() => {
      engine.fileChanges.push(requirePlaceId(placeId))
      return null
    }),
  )
}

/** The paths an action names, as they came off the wire: each one is checked by the place itself. */
function requirePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Name the files to change')
  return value.map(requirePath)
}

function requireMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A commit needs a message.')
  return value
}

function requirePlaceId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing repo or worktree')
  return value
}

function requirePath(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing file path')
  return value
}

/** A save as it comes off the wire: a path, the whole text, and the digest it was opened with. */
function requireSave(value: unknown): FileSaveRequest {
  const request = value as Partial<FileSaveRequest> | null
  if (!request || typeof request !== 'object') throw new Error('Missing what to save')
  if (typeof request.text !== 'string') throw new Error('Missing the text to save')
  if (typeof request.digest !== 'string' || !request.digest) {
    throw new Error('Missing the file as it was opened, so a save could clobber someone')
  }
  return { path: requirePath(request.path), text: request.text, digest: request.digest }
}

function optionalPath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requirePath(value)
}
