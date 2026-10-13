import { shellChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core'

export interface ShellIpcOptions {
  ipc: IpcHandlerRegistry
  toggleMaximize(): void
}

/** The window chrome the renderer draws itself: the maximize button. The boss's name is Company settings'. */
export function registerShellIpc({ ipc, toggleMaximize }: ShellIpcOptions): void {
  ipc.handle(shellChannels.toggleMaximize, () => toggleMaximize())
}
