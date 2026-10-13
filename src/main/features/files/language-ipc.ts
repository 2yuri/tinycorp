import { languageChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { CodeSpot } from '../../../shared/files/language'
import type { IpcHandlerRegistry } from '../../core'
import type { LanguageFacade } from './facade'

export interface LanguageIpcOptions {
  ipc: IpcHandlerRegistry
  engine: LanguageFacade
}

/**
 * Lets the code viewer ask the place's language server what it is looking at (T115). It holds no
 * state of its own and never takes a path the engine has not checked; the text that comes with
 * every call is the boss's own, so a diagnostic follows the editor rather than the disk.
 */
export function registerLanguageIpc({ ipc, engine }: LanguageIpcOptions): void {
  ipc.handle(languageChannels.read, (_event, placeId, path, text) =>
    attempted(() => engine.language.read(requirePlaceId(placeId), requirePath(path), requireText(text))),
  )
  ipc.handle(languageChannels.hover, (_event, placeId, path, spot, text) =>
    attempted(() =>
      engine.language.hover(requirePlaceId(placeId), requirePath(path), requireSpot(spot), requireText(text)),
    ),
  )
  ipc.handle(languageChannels.definition, (_event, placeId, path, spot, text) =>
    attempted(() =>
      engine.language.definition(requirePlaceId(placeId), requirePath(path), requireSpot(spot), requireText(text)),
    ),
  )
}

/**
 * `attempt` for an answer that has to be waited for. A server that refuses, dies or never answers
 * comes back as an error the viewer draws its quiet line from, never as a rejection nobody caught.
 */
async function attempted<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function requirePlaceId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing repo or worktree')
  return value
}

function requirePath(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing file path')
  return value
}

/** The text the viewer is showing. An empty file is text too, so only a missing one is refused. */
function requireText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Missing the text the viewer is showing')
  return value
}

/** A spot off the wire, numbered the way the viewer numbers it: both from one. */
function requireSpot(value: unknown): CodeSpot {
  const spot = value as Partial<CodeSpot> | null
  if (!spot || typeof spot !== 'object') throw new Error('Missing where in the file')
  if (!Number.isInteger(spot.line) || !Number.isInteger(spot.column) || spot.line! < 1 || spot.column! < 1) {
    throw new Error('Missing where in the file')
  }
  return { line: spot.line!, column: spot.column! }
}
