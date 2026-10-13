import { windowsChannels } from '../../shared/domain/channels'
import type { WindowsMachine } from '../../shared/platform/windows-machine'
import type { IpcHandlerRegistry } from '../core'

export interface WindowsMachineIpcOptions {
  ipc: IpcHandlerRegistry
  /** Read when it is asked for, so `Check again` is what refreshes it and nothing else. */
  machine: () => WindowsMachine
  /**
   * Forgets the cached `PATH` walk, for the boss who has just installed Git for Windows while the
   * step was open. It is only that walk: the distros are listed by `wsl.exe`, whose own cache is
   * the Providers card's `Check again` to clear, and clearing it here would wake a distro for a
   * question about a `.exe` on the Windows side.
   */
  forgetPaths?: () => void
}

/** Serves the first-launch step, and Your profile's On this PC card, what this machine is (T249). */
export function registerWindowsMachineIpc({ ipc, machine, forgetPaths = () => {} }: WindowsMachineIpcOptions): void {
  ipc.handle(windowsChannels.machine, () => machine())
  ipc.handle(windowsChannels.recheck, () => {
    forgetPaths()
    return machine()
  })
}
