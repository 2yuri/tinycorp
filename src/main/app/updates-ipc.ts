import { updateChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core'
import type { UpdateCheck } from './update-check'

export interface UpdatesIpcOptions {
  ipc: IpcHandlerRegistry
  updates: UpdateCheck
  /** `shell.openExternal`: the release goes to the system browser, never into an app window. */
  openExternal(url: string): void
}

/**
 * Serves the quiet line in the title bar and the Company settings row (T130). The renderer asks
 * what was found and, at the boss's word, asks again; the URL is never one the renderer supplies,
 * only the one the last check read from GitHub, so nothing a page draws can send the boss elsewhere.
 */
export function registerUpdatesIpc({ ipc, updates, openExternal }: UpdatesIpcOptions): void {
  ipc.handle(updateChannels.get, () => updates.state())
  ipc.handle(updateChannels.checkNow, () => updates.checkNow())
  ipc.handle(updateChannels.openDownloadPage, () => {
    const release = updates.state().available
    if (release) openExternal(release.url)
  })
}
