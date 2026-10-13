import { CRASH_SOURCES, type CrashEnvironment, type CrashReport, crashReport } from '../../shared/app/crash'
import { crashChannels } from '../../shared/domain/channels'
import type { IpcHandlerRegistry } from '../core'
import type { CrashLog } from './crash-log'

export interface CrashIpcOptions {
  ipc: IpcHandlerRegistry
  log: CrashLog
  environment: CrashEnvironment
}

/**
 * What a screen that stopped drawing asks of the main process (T128): the build it should name, and
 * a line in the app's log. What arrives over the wire is a report the renderer built, so it is taken
 * apart and built again here — a renderer that has itself gone wrong cannot write a repo path, a
 * ticket or the boss's name into the log by handing this a different shape.
 */
export function registerCrashIpc({ ipc, log, environment }: CrashIpcOptions): void {
  ipc.handle(crashChannels.record, (_event, report) => {
    log.record(received(report, environment))
  })
}

function received(value: unknown, environment: CrashEnvironment): CrashReport {
  const report = (value ?? {}) as Partial<CrashReport>
  const at = report.at ? new Date(report.at) : new Date()
  return crashReport({
    source: CRASH_SOURCES.includes(report.source!) ? report.source! : 'window',
    error: text(report.message) || 'An error with no message',
    componentStack: text(report.stack),
    route: text(report.route) || null,
    version: environment.version,
    platform: environment.platform,
    at: Number.isNaN(at.getTime()) ? new Date() : at,
  })
}

/** A field off the wire is whatever the renderer sent; only a string of a sane length is kept. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 4000) : ''
}
