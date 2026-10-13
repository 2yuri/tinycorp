import { shell } from 'electron'
import type { FileTools } from './files-ipc'
import type { PathTools } from './paths-ipc'

/**
 * What a file is handed to: the editor the boss picked (T123), and the system default behind it.
 * The chosen editor gets the path as an argument of its own; nothing here builds a shell string.
 */
export interface EditorHandOver {
  /** True once the chosen editor has the file. False means there is none, or it would not start. */
  open(path: string): Promise<boolean>
}

/** The system default takes it when no editor does, and says so when it cannot either. */
async function openAnyway(path: string): Promise<void> {
  const failure = await shell.openPath(path)
  if (failure) throw new Error(failure)
}

/** The boss's own tools on this machine: the editor they picked, and Finder. macOS first (T113). */
export function desktopFileTools(editors: EditorHandOver): FileTools {
  return {
    async openInEditor(path) {
      if (await editors.open(path)) return
      await openAnyway(path)
    },
    reveal(path) {
      shell.showItemInFolder(path)
    },
  }
}

/**
 * What a path an Employee wrote is handed to when it is nowhere the Company owns (T114): Finder,
 * or the same editor the boss picked for everything else (T123). It gets the resolved path as one
 * argument, never a command. The file itself is read for the Files view, which opens it as a tab
 * (T121), rather than handed to the machine's own opener.
 */
export function desktopPathTools(editors: EditorHandOver): PathTools {
  return {
    reveal(path) {
      shell.showItemInFolder(path)
    },
    async openInEditor(path) {
      if (await editors.open(path)) return
      await openAnyway(path)
    },
  }
}
