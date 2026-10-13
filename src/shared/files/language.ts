/**
 * What the code viewer knows about the language it is drawing (T115): the type under the pointer,
 * where a symbol is declared, what the compiler complains about, and the file's own symbols.
 *
 * The main process runs one language server per place and speaks LSP to it; nothing of that
 * protocol reaches here. These are the plain shapes the viewer draws, numbered the way the viewer
 * numbers lines: line 1 is the first line, column 1 the first character of it.
 */

/** A spot in a file, as the viewer numbers it: both 1-based. */
export interface CodeSpot {
  line: number
  column: number
}

/** A run of one file, from one spot up to but not including another. */
export interface CodeRange {
  line: number
  column: number
  endLine: number
  endColumn: number
}

/** How loudly the language server said it. */
export type Severity = 'error' | 'warning' | 'info'

/** One thing the language server complains about, on the line it complains about it. */
export interface Diagnosed extends CodeRange {
  severity: Severity
  message: string
  /** The compiler's own number, e.g. `2322`; null when it gave none. */
  code: string | null
}

/** One symbol of a file, as the outline lists them: nesting flattened to a depth. */
export interface Outlined {
  name: string
  /** `function`, `interface`, `method`… what the server calls it, in the boss's words. */
  kind: string
  /** Where clicking it lands. */
  line: number
  column: number
  /** 0 for a top-level symbol, 1 for a member of one, and so on. */
  depth: number
}

/** The type and the doc comment of whatever was under the pointer. */
export interface Hovered {
  /** The signature as the compiler writes it, already stripped of its code fence. */
  signature: string
  /** The doc comment under it; null when the symbol has none. */
  docs: string | null
  /** What the hover is about, so the viewer can underline exactly that. */
  range: CodeRange
}

/** Where a symbol is declared. A definition outside the place is opened as its own tab (T121). */
export interface Defined {
  /** The place the declaration is in; null when it is a file the Company does not own. */
  placeId: string | null
  /** Relative to the place, or the whole path when `placeId` is null. */
  path: string
  line: number
  column: number
}

/** Whether a place has a language server for a file, and why not when it has none. */
export type LanguageStatus = 'ready' | 'starting' | 'none' | 'failed'

/** What the viewer has to draw beside a file: everything that is about the file as a whole. */
export interface LanguageReading {
  status: LanguageStatus
  /** The quiet line under the file when there is nothing to say about it; null when there is. */
  reason: string | null
  diagnostics: Diagnosed[]
  outline: Outlined[]
}

/** Nothing known: what the viewer draws for a file no server speaks for. */
export const NOTHING_KNOWN: LanguageReading = { status: 'none', reason: null, diagnostics: [], outline: [] }

/**
 * The LSP language id for a file, by extension — which is also the list of what a server is ever
 * started for. TypeScript first, since that is what the repos hold.
 */
export const LANGUAGE_IDS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
}

/** What the language server calls this file, or null when none of them speaks for it. */
export function languageIdOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return LANGUAGE_IDS[name.slice(dot + 1).toLowerCase()] ?? null
}

/** `3 errors, 1 warning`, the line above the list; empty when the file is clean. */
export function diagnosticsSummary(diagnostics: readonly Diagnosed[]): string {
  const errors = diagnostics.filter((one) => one.severity === 'error').length
  const rest = diagnostics.length - errors
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`)
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'warning' : 'warnings'}`)
  return parts.join(', ')
}

/** The worst thing said about a file, which is what the tab and the head show. */
export function worstOf(diagnostics: readonly Diagnosed[]): Severity | null {
  if (diagnostics.some((one) => one.severity === 'error')) return 'error'
  if (diagnostics.some((one) => one.severity === 'warning')) return 'warning'
  return diagnostics.length > 0 ? 'info' : null
}

/** Everything said about one line, for the mark the viewer puts on it. */
export function onLine(diagnostics: readonly Diagnosed[], line: number): Diagnosed[] {
  return diagnostics.filter((one) => one.line <= line && line <= one.endLine)
}
