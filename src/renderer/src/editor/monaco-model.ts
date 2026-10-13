import { extensionOf } from '../../../shared/files/files'
import type { CodeRange, Diagnosed, Hovered, Severity } from '../../../shared/files/language'

/**
 * Everything the Monaco editor needs said in plain data (T222): which language it draws a file in,
 * the markers a reading turns into, and the URI a model is keyed by so a declaration in another
 * file can be followed back to the tab it belongs in.
 *
 * None of it imports Monaco. The editor is a megabyte that arrives lazily and cannot run in jsdom;
 * everything decided *about* it is here instead, where a unit test can read it.
 */

/**
 * What Monaco calls a file, by extension. Wider than `LANGUAGE_BY_EXTENSION` in `shared/files`,
 * which is the little highlighter's own list: Monaco brings a grammar for every language below at
 * no cost, so a Rust or a Go file in a repo is coloured rather than drawn grey.
 *
 * `.tsx` is `typescript` and not a language of its own — that is Monaco's own registration — and
 * TOML has no grammar there, so it takes `ini`'s, which is the same shape of file.
 */
export const MONACO_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  dart: 'dart',
  r: 'r',
  scala: 'scala',
  dockerfile: 'dockerfile',
}

/** What the little highlighter's own ids meant, for a file whose extension says nothing. */
const MONACO_LANGUAGE_BY_ID: Record<string, string> = {
  ts: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  yaml: 'yaml',
  toml: 'ini',
  shell: 'shell',
  python: 'python',
  sql: 'sql',
}

/** A file nothing has a grammar for: Monaco's own name for "draw it, colour nothing". */
export const PLAIN_TEXT = 'plaintext'

/**
 * The language Monaco draws a file in. The extension decides, because it knows `.tsx` from `.ts`
 * and `.js` from both where `OpenedFile.language` collapses all three to `ts`; the file's own id is
 * the fallback, for a `Dockerfile` or a `Makefile` that has no extension at all.
 */
export function monacoLanguageOf(path: string, language: string | null): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const byName = MONACO_LANGUAGE_BY_EXTENSION[name]
  if (byName !== undefined) return byName
  const byExtension = MONACO_LANGUAGE_BY_EXTENSION[extensionOf(path)]
  if (byExtension !== undefined) return byExtension
  return (language === null ? undefined : MONACO_LANGUAGE_BY_ID[language]) ?? PLAIN_TEXT
}

/** Monaco's own `MarkerSeverity`, as numbers, so nothing here has to import the editor. */
export const MARKER_SEVERITY: Record<Severity, number> = { error: 8, warning: 4, info: 2 }

/** One squiggle under the text, which is also a mark in the overview ruler down the right. */
export interface CodeMarker {
  severity: number
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  /** Left out entirely when the compiler gave none: Monaco's own marker has no `undefined` in it. */
  code?: string
}

/**
 * What the language server said, as Monaco's markers. Both number lines and columns from 1, so
 * this is a rename rather than a conversion — but a range that ends where it starts would draw no
 * squiggle at all, so a zero-width one is widened by a character.
 */
export function markersOf(diagnostics: readonly Diagnosed[]): CodeMarker[] {
  return diagnostics.map((one) => ({
    severity: MARKER_SEVERITY[one.severity],
    message: one.message,
    startLineNumber: one.line,
    startColumn: one.column,
    endLineNumber: one.endLine,
    endColumn: one.endLine === one.line && one.endColumn <= one.column ? one.column + 1 : one.endColumn,
    ...(one.code === null ? {} : { code: one.code }),
  }))
}

/** The scheme every model of the Files view is keyed by, so a provider answers about nothing else. */
export const CODE_SCHEME = 'tinycorp'

/** A model's URI, in the parts `monaco.Uri.from` takes. */
export interface CodeUri {
  scheme: string
  path: string
  query: string
}

/**
 * The URI one file of one place is opened under. The place goes in the query rather than the
 * authority, because a place id is `worktree:142:r-web` and a URI authority may hold no colon; a
 * file from outside the Company (T121) has no place and carries an empty one.
 */
export function codeUriOf(placeId: string | null, path: string): CodeUri {
  return { scheme: CODE_SCHEME, path: path.startsWith('/') ? path : `/${path}`, query: placeId ?? '' }
}

/** The place and the path back out of a URI, which is how a followed symbol finds its tab. */
export function codeFileOf(uri: CodeUri): { placeId: string | null; path: string } {
  return { placeId: uri.query === '' ? null : uri.query, path: uri.path.replace(/^\//, '') }
}

/** The signature and the doc comment, as the markdown Monaco's hover draws. */
export function hoverMarkdown(hovered: Hovered): string[] {
  const signature = ['```ts', hovered.signature, '```'].join('\n')
  return hovered.docs === null ? [signature] : [signature, hovered.docs]
}

/** A range as Monaco writes one, both ends 1-based. */
export interface CodeSpan {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export function spanOf(range: CodeRange): CodeSpan {
  return {
    startLineNumber: range.line,
    startColumn: range.column,
    endLineNumber: range.endLine,
    endColumn: range.endColumn,
  }
}

/** A whole line, for the decorations that tint one. */
export function lineSpan(line: number): CodeSpan {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }
}

/**
 * The worst thing said about each line, which is what the gutter puts a dot beside. One dot per
 * line however many diagnostics cover it, and a diagnostic that spans lines marks every one of
 * them — the way the viewer's own mark always did.
 */
export function worstByLine(diagnostics: readonly Diagnosed[]): Map<number, Severity> {
  const worst = new Map<number, Severity>()
  const rank: Record<Severity, number> = { error: 3, warning: 2, info: 1 }
  for (const one of diagnostics) {
    for (let line = one.line; line <= one.endLine; line += 1) {
      const had = worst.get(line)
      if (had !== undefined && rank[had] >= rank[one.severity]) continue
      worst.set(line, one.severity)
    }
  }
  return worst
}
