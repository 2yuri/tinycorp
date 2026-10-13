import { pathsChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { PathLinksFacade } from './facade'

/**
 * What a path outside the Company is handed to. It takes one path, already resolved by the engine,
 * as an argument of its own: it never builds a command line out of it.
 */
export interface PathTools {
  /** Reveals the path in Finder, selected. */
  reveal(path: string): void
  /** Hands the path to the editor the boss picked, else to the system default (T123). */
  openInEditor(path: string): Promise<void>
}

export interface PathsIpcOptions {
  ipc: IpcHandlerRegistry
  engine: PathLinksFacade
  tools: PathTools
}

/**
 * Lets the renderer draw the paths an Employee wrote as links, and open one (T114). A click may
 * only read, reveal, or hand the path to the editor the boss picked (T123): the file comes back
 * for the Files view to open as a tab of its own (T121), and no command is ever built from it.
 */
export function registerPathsIpc({ ipc, engine, tools }: PathsIpcOptions): void {
  ipc.handle(pathsChannels.links, (_event, text) => attempt(() => engine.pathLinks.links(requireText(text))))

  ipc.handle(pathsChannels.open, (_event, path) => attempt(() => engine.pathLinks.open(requireText(path))))

  ipc.handle(pathsChannels.reveal, (_event, path) =>
    attempt(() => {
      tools.reveal(located(engine, path))
      return null
    }),
  )

  ipc.handle(pathsChannels.openInEditor, async (_event, path) => {
    try {
      await tools.openInEditor(located(engine, path))
      return { ok: true as const, value: null }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

/** The whole path behind what was written, which the engine has already checked is really there. */
function located(engine: PathLinksFacade, path: unknown): string {
  const full = engine.pathLinks.locate(requireText(path))
  if (full === null) throw new Error(`There is no file at ${String(path).trim()}`)
  return full
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing path')
  return value
}
