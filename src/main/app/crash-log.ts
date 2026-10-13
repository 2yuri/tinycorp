import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type CrashReport, crashReport, crashWhen, formatCrashReport } from '../../shared/app/crash'

/**
 * The app's log of screens that stopped drawing (T128). A beta tester who reloads without copying
 * the report leaves nothing behind otherwise, so every crash the renderer or this process catches is
 * appended here first. It holds the same fields the card offers to the clipboard and no others.
 */
export interface CrashLog {
  /** Where the file is, for whoever is asked to send it. */
  readonly path: string
  record(report: CrashReport): void
  /** A throw nobody caught in this process: recorded with the build it happened in. */
  recordThrow(error: unknown, at?: Date): void
}

/** Past this the oldest half of the log goes, so a Session that throws in a loop cannot fill a disk. */
const MAX_BYTES = 512 * 1024

export interface CrashLogOptions {
  path: string
  version: string
  platform?: string
}

export function crashLog({ path, version, platform = process.platform }: CrashLogOptions): CrashLog {
  const record = (report: CrashReport) =>
    append(path, `\n--- ${crashWhen(new Date(report.at))}\n${formatCrashReport(report)}\n`)
  return {
    path,
    record,
    recordThrow: (error, at = new Date()) => record(crashReport({ source: 'main', error, version, platform, at })),
  }
}

function append(path: string, text: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    trim(path)
    appendFileSync(path, text, 'utf8')
  } catch {
    // A log that cannot be written is not worth taking the app down for.
  }
}

/** Keeps the newest half when the file outgrows `MAX_BYTES`; a missing file is nothing to trim. */
function trim(path: string): void {
  let size = 0
  try {
    size = statSync(path).size
  } catch {
    return
  }
  if (size <= MAX_BYTES) return
  const kept = readFileSync(path, 'utf8').slice(-MAX_BYTES / 2)
  writeFileSync(path, kept.slice(kept.indexOf('\n') + 1), 'utf8')
}

/**
 * The last resort in this process: a throw or a rejection nobody handled is written down rather than
 * printed to a terminal nobody is watching, and the app stays up. Returns a function that removes them.
 */
export function guardProcess(log: CrashLog, target: NodeJS.EventEmitter = process): () => void {
  const onError = (error: unknown) => log.recordThrow(error)
  const onRejection = (reason: unknown) => log.recordThrow(reason)
  target.on('uncaughtException', onError)
  target.on('unhandledRejection', onRejection)
  return () => {
    target.off('uncaughtException', onError)
    target.off('unhandledRejection', onRejection)
  }
}
