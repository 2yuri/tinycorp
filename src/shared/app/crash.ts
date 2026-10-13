/**
 * What the app knows about a screen that stopped drawing (T128). The shape is the whole promise the
 * `Something Broke` card makes: the message, where it came from, the screen, the build and the time —
 * and nothing else. Nothing here ever holds a Company folder, a ticket, a message body or the boss's
 * name, so a report a beta tester pastes into a mail carries no work of theirs.
 */
export interface CrashReport {
  /** Where it was caught: a view, the whole window, or the main process. */
  source: CrashSource
  /** The error's message, with any absolute path redacted. */
  message: string
  /** The React component stack, or the error's own, a frame per line and already redacted. */
  stack: string
  /** The view the boss was on — `board`, `files` — or null outside one. */
  route: string | null
  /** The app's version, as the build reports it. */
  version: string
  /** `darwin`, `win32`, `linux`. */
  platform: string
  /** When it was caught, ISO 8601. */
  at: string
}

/** The build a report names: what the main process alone can say about this window. */
export interface CrashEnvironment {
  version: string
  platform: string
}

export const CRASH_SOURCES = ['view', 'window', 'main'] as const
export type CrashSource = (typeof CRASH_SOURCES)[number]

/** How many frames of a stack a report carries. Enough to place the throw, short enough to paste. */
const STACK_FRAMES = 12

/**
 * An absolute path anywhere in a message or a stack. A repo lives at one, so none of them travels:
 * only the last segment stays, which names the file without saying whose it is or where it sits.
 * The lookbehind keeps the path inside a URL — a dev component stack is full of them — out of it,
 * since those name this app's own source and not the boss's disk.
 */
const ABSOLUTE_PATH = /(?<![\w:/\\])(?:[A-Za-z]:[\\/]|\/)(?:[\w .@~+-]+[\\/])*[\w .@~+-]+/g

/** Replaces every absolute path with `…/` and its last segment. */
export function redactPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (path) => {
    const last = path.split(/[\\/]/).filter(Boolean).at(-1)
    return last ? `…/${last}` : '…'
  })
}

export interface CrashInput {
  source: CrashSource
  error: unknown
  /** React's own component stack, when a boundary caught it. */
  componentStack?: string | null
  route?: string | null
  version: string
  platform: string
  at: Date
}

/** Builds the report from what was caught, redacting as it goes. Everything else is left out. */
export function crashReport(input: CrashInput): CrashReport {
  const error = input.error
  const message = error instanceof Error ? named(error) : String(error)
  const raw = input.componentStack?.trim() || (error instanceof Error ? (error.stack ?? '') : '')
  return {
    source: input.source,
    message: redactPaths(message).trim() || 'An error with no message',
    stack: stackLines(raw),
    route: input.route ?? null,
    version: input.version,
    platform: input.platform,
    at: input.at.toISOString(),
  }
}

/** `TypeError: destroy_ is not a function`, or just the name when the throw carried no message. */
function named(error: Error): string {
  return error.message.trim() ? `${error.name}: ${error.message}` : error.name
}

/** The first `STACK_FRAMES` frames, trimmed, redacted, and without the message the stack repeats. */
function stackLines(raw: string): string {
  return raw
    .split('\n')
    .map((line) => redactPaths(line).trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, STACK_FRAMES)
    .join('\n')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `21 Sep 2026, 12:41` — the card's when, and the log's. Local time, and never a locale's guess. */
export function crashWhen(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${two(at.getHours())}:${two(at.getMinutes())}`
}

/** The card's second line: where it came from and when, as `at FileTree (files/FileTree.tsx:48) · 21 Sep 2026, 12:41`. */
export function crashOrigin(report: CrashReport): string {
  const frame = report.stack.split('\n')[0]?.trim()
  const when = crashWhen(new Date(report.at))
  return frame ? `${frame} · ${when}` : when
}

/** What `Copy report` puts on the clipboard, and what the app's log keeps. */
export function formatCrashReport(report: CrashReport): string {
  return [
    `TinyCorp ${report.version} · ${report.platform}`,
    `${report.at} · ${report.source} · screen ${report.route ?? 'none'}`,
    '',
    report.message,
    report.stack,
  ]
    .join('\n')
    .trimEnd()
}
