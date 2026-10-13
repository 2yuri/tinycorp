import { launcherChannels } from '../../shared/domain/channels'
import type { WindowLayout } from '../../shared/ipc'
import type { DetectedRepo } from '../../shared/repos/repo'
import { attempt, type IpcHandlerRegistry, requireString } from '../core'
import type { CompanyEngine } from '../core/engine'

export interface WindowSize {
  width: number
  height: number
  /** The smallest the user can drag the window to in this layout. */
  minWidth: number
  minHeight: number
}

/** Window sizes from the design: the Launcher frame (fixed) and the desktop app frame. */
export const WINDOW_SIZES: Record<WindowLayout, WindowSize> = {
  launcher: { width: 680, height: 740, minWidth: 680, minHeight: 740 },
  company: { width: 1512, height: 944, minWidth: 1024, minHeight: 640 },
}

export interface LauncherIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CompanyEngine
  detectRepo(path: string): DetectedRepo
  /** Resizes the window that sent `event`. */
  resize(event: unknown, size: WindowSize): void
  /** The logo in a Company's folder as a `data:` URL, or null (T280): each row draws it for its initials. */
  logoOf?(folder: string): string | null
}

/** What the Launcher window asks of the main process. Holds no state of its own. */
export function registerLauncherIpc({ ipc, engine, detectRepo, resize, logoOf }: LauncherIpcOptions): void {
  ipc.handle(launcherChannels.summaries, () =>
    engine.companySummaries().map((summary) => (logoOf ? { ...summary, logo: logoOf(summary.folder) } : summary)),
  )

  ipc.handle(launcherChannels.detectRepo, (_event, path) => attempt(() => detectRepo(requireString(path, 'repo path'))))

  ipc.handle(launcherChannels.setWindowLayout, (event, layout) => {
    if (layout !== 'launcher' && layout !== 'company') throw new Error(`Unknown window layout: ${String(layout)}`)
    resize(event, WINDOW_SIZES[layout])
  })
}
